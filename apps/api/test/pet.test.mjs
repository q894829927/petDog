import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApp } from "../dist/apps/api/src/app.js";

const origin = "https://petdog.example";
const password = "test-password-4584";
const prefix = "/pet-api/v1";
const day = 86_400_000;

function sender(app, account) {
  return (method, path, payload) => app.inject({
    method,
    url: prefix + path,
    headers: { origin, ...(account?.headers ?? {}) },
    payload,
  });
}

async function signIn(app, email, mode = "register") {
  const send = sender(app);
  const response = await send("POST", "/auth/" + mode, { email, password });
  assert.equal(response.statusCode, mode === "register" ? 201 : 200, response.body);
  const cookieHeader = response.headers["set-cookie"];
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=Lax/);
  assert.match(cookieHeader, /Path=\/pet-api\//);
  const cookie = cookieHeader.split(";")[0];
  const me = await app.inject({ url: prefix + "/auth/me", headers: { cookie } });
  const { user } = me.json();
  assert.equal(user.email, email.toLowerCase());
  return { headers: { cookie, "x-petdog-account": String(user.id) }, token: cookie.split("=")[1] };
}

const options = { origins: [origin], secureCookie: true, registrationOpen: true };

test("validates input, rate-limits login, and refuses cross-origin mutations", async () => {
  const app = await createApp({ ...options, databasePath: ":memory:" });
  try {
    assert.equal((await app.inject("/pet-api/healthz")).statusCode, 200);
    assert.equal((await app.inject(prefix + "/pet")).statusCode, 401);
    const wrongOrigin = await app.inject({
      method: "POST", url: prefix + "/auth/register", headers: { origin: "https://other.example" },
      payload: { email: "a@example.com", password },
    });
    assert.equal(wrongOrigin.statusCode, 403);
    const wrongContent = await app.inject({
      method: "POST", url: prefix + "/auth/register", headers: { origin, "content-type": "text/plain" },
      payload: "email=a@example.com",
    });
    assert.equal(wrongContent.statusCode, 415);
    const send = sender(app);
    assert.equal((await send("POST", "/auth/register", { email: "not-an-email", password })).statusCode, 400);
    assert.equal((await send("POST", "/auth/register", { email: "a@example.com", password: "short" })).statusCode, 400);
    await signIn(app, "one@example.com");
    assert.equal((await send("POST", "/auth/register", { email: "ONE@example.com", password })).statusCode, 409);
    for (let attempt = 0; attempt < 8; attempt++) {
      assert.equal((await send("POST", "/auth/login", { email: "one@example.com", password: "wrong-password" })).statusCode, 401);
    }
    assert.equal((await send("POST", "/auth/login", { email: "one@example.com", password })).statusCode, 429);
  } finally {
    await app.close();
  }
});

test("isolates accounts and applies a retried action once across concurrent devices", async () => {
  let now = Date.UTC(2026, 10, 19);
  const app = await createApp({ ...options, databasePath: ":memory:", clock: () => now });
  try {
    const owner = await signIn(app, "owner@example.com");
    const other = await signIn(app, "other@example.com");
    const secondDevice = await signIn(app, "owner@example.com", "login");
    const first = sender(app, owner);
    const second = sender(app, secondDevice);
    const stranger = sender(app, other);
    assert.equal((await stranger("GET", "/pet")).json().pet, null);
    assert.equal((await first("POST", "/pet", { name: "  ", personality: "playful" })).statusCode, 400);
    const adoption = { name: "团子", personality: "reserved" };
    const pet = (await first("POST", "/pet", adoption)).json().pet;
    assert.equal(pet.name, "团子");
    const adoptedTwice = (await second("POST", "/pet", { name: "另一个名字", personality: "playful" })).json().pet;
    assert.deepEqual(adoptedTwice, pet);
    await stranger("POST", "/pet", { name: "栗子", personality: "playful" });
    const mismatched = sender(app, { headers: { ...other.headers, "x-petdog-account": owner.headers["x-petdog-account"] } });
    assert.equal((await mismatched("PATCH", "/pet/profile", { name: "串号" })).statusCode, 409);
    assert.equal((await stranger("GET", "/pet")).json().pet.name, "栗子");

    now += 4 * 3_600_000;
    const offline = (await second("GET", "/pet")).json().pet;
    assert.equal(offline.hunger, 56);
    assert.equal(offline.hydration, 52);
    assert.equal(offline.energy, 50);
    assert.equal(offline.serverTime, now);
    const action = (kind, version) => ({ action: kind, expectedVersion: version, requestId: randomUUID() });
    const feed = action("feed", offline.version);
    const play = action("play", offline.version);
    const outcomes = await Promise.all([first("POST", "/pet/actions", feed), second("POST", "/pet/actions", play)]);
    assert.deepEqual(outcomes.map((response) => response.statusCode).sort(), [200, 409]);
    const rejected = outcomes.findIndex((response) => response.statusCode === 409);
    const retryAction = rejected === 0 ? feed : play;
    const retryStatus = await second("POST", "/pet/actions", { ...retryAction, expectedVersion: outcomes[rejected].json().pet.version });
    assert.equal(retryStatus.statusCode, 200);
    const afterBoth = (await first("GET", "/pet")).json().pet;
    assert.equal(afterBoth.hunger, 80);
    assert.equal(afterBoth.energy, 42);
    assert.equal(afterBoth.affection, 4);
    const duplicate = await Promise.all([first("POST", "/pet/actions", feed), second("POST", "/pet/actions", feed)]);
    assert.deepEqual(duplicate[0].json().pet, duplicate[1].json().pet);
    assert.deepEqual((await second("GET", "/pet")).json().pet, afterBoth);
    assert.equal((await first("POST", "/pet/actions", { ...feed, action: "drink" })).statusCode, 409);
    const drank = (await second("POST", "/pet/actions", action("drink", afterBoth.version))).json().pet;
    assert.equal(drank.hydration, 82);
    const brushed = (await second("POST", "/pet/actions", action("brush", drank.version))).json().pet;
    assert.equal(brushed.cleanliness, 100);
    const asleep = (await second("POST", "/pet/actions", action("sleep", brushed.version))).json().pet;
    assert.equal(asleep.sleeping, true);
    now += 10 * 60_000;
    assert.equal((await first("GET", "/pet")).json().pet.energy, 100);
    now += 14 * day;
    const longOffline = (await first("GET", "/pet")).json().pet;
    assert.equal(longOffline.hunger, 0);
    assert.equal(longOffline.hydration, 0);
    assert.equal(longOffline.affection, 6);
    assert.equal((await first("POST", "/auth/logout")).statusCode, 204);
    assert.equal((await first("GET", "/pet")).statusCode, 401);
    assert.equal((await second("GET", "/pet")).statusCode, 200);
  } finally {
    await app.close();
  }
});

test("retains the pet across process restarts and saves hashes in SQLite", async () => {
  const folder = mkdtempSync(join(tmpdir(), "petdog-api-test-"));
  const path = join(folder, "state.sqlite");
  try {
    const app = await createApp({ ...options, databasePath: path });
    const account = await signIn(app, "persistent@example.com");
    const send = sender(app, account);
    await send("POST", "/pet", { name: "豆豆", personality: "affectionate" });
    await send("PATCH", "/pet/profile", { name: "栗子" });
    await app.close();

    const db = new DatabaseSync(path, { readOnly: true });
    const passwordHash = db.prepare("SELECT password_hash FROM users").get().password_hash;
    assert.match(passwordHash, /^\$argon2id\$/);
    assert.equal(db.prepare("SELECT token_hash FROM sessions").get().token_hash,
      createHash("sha256").update(account.token).digest("hex"));
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
    db.close();

    const reopened = await createApp({ ...options, databasePath: path });
    try {
      const response = await sender(reopened, account)("GET", "/pet");
      assert.equal(response.json().pet.name, "栗子");
    } finally {
      await reopened.close();
    }
  } finally {
    for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
    rmdirSync(folder);
  }
});
