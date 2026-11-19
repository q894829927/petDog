import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Personality, PetActionRequest, PetSnapshot } from "../../../shared/pet.js";
import { applyEffect, settle } from "./simulation.js";

type PetRow = Omit<PetSnapshot, "sleeping"> & { id: number; sleeping: number };

export class ApiError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export function openDatabase(path: string) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

  function transaction<T>(run: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  transaction(() => {
    const version = db.prepare("PRAGMA user_version").get()?.user_version;
    if (version === 0) {
      db.exec(readFileSync(new URL("../../../../migrations/001_initial.sql", import.meta.url), "utf8"));
      db.exec("PRAGMA user_version = 1");
    } else if (version !== 1) {
      throw new Error("Unsupported petdog database version: " + version);
    }
  });

  const getPet = db.prepare(`
    SELECT id, name, personality, adopted_at AS adoptedAt, last_simulated_at AS serverTime,
           hunger, hydration, energy, cleanliness, happiness, affection, sleeping, version
    FROM pets WHERE user_id = ?
  `);
  const updatePet = db.prepare(`
    UPDATE pets SET name = ?, hunger = ?, hydration = ?, energy = ?, cleanliness = ?, happiness = ?,
        affection = ?, sleeping = ?, last_simulated_at = ?, version = ?
    WHERE id = ?
  `);
  const getAction = db.prepare("SELECT action, result FROM pet_actions WHERE pet_id = ? AND request_id = ?");
  const insertAction = db.prepare("INSERT INTO pet_actions (pet_id, request_id, action, result, created_at) VALUES (?, ?, ?, ?, ?)");

  function row(userId: number) {
    return getPet.get(userId) as PetRow | undefined;
  }

  function asSnapshot({ id: _id, sleeping, ...state }: PetRow): PetSnapshot {
    return { ...state, sleeping: sleeping === 1 };
  }

  function save(petId: number, pet: PetSnapshot) {
    const version = pet.version + 1;
    updatePet.run(pet.name, pet.hunger, pet.hydration, pet.energy, pet.cleanliness, pet.happiness,
      pet.affection, Number(pet.sleeping), pet.serverTime, version, petId);
    return { ...pet, version };
  }

  function refresh(record: PetRow, now: number) {
    const snapshot = asSnapshot(record);
    return now > snapshot.serverTime ? save(record.id, settle(snapshot, now)) : snapshot;
  }

  return {
    close: () => db.close(),
    healthy: () => db.prepare("SELECT 1").get(),
    addUser(email: string, hash: string, now: number, tokenHash: string, expiresAt: number) {
      return transaction(() => {
        const entry = db.prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING")
          .run(email, hash, now);
        if (!entry.changes) throw new ApiError(409, "这个邮箱已经注册，请登录。");
        db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, entry.lastInsertRowid, expiresAt);
      });
    },
    findUser(email: string) {
      return db.prepare("SELECT id, password_hash AS passwordHash FROM users WHERE email = ?").get(email) as
        { id: number; passwordHash: string } | undefined;
    },
    addSession(userId: number, tokenHash: string, expiresAt: number, now: number) {
      transaction(() => {
        db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
        db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
      });
    },
    findSession(tokenHash: string, now: number) {
      return db.prepare(`
        SELECT users.id, users.email FROM sessions
        JOIN users ON users.id = sessions.user_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      `).get(tokenHash, now) as { id: number; email: string } | undefined;
    },
    removeSession(tokenHash: string) {
      db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    },
    adopt(userId: number, name: string, personality: Personality, now: number) {
      return transaction(() => {
        db.prepare(`
          INSERT INTO pets (user_id, name, personality, adopted_at, last_simulated_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO NOTHING
        `).run(userId, name, personality, now, now);
        return refresh(row(userId)!, now);
      });
    },
    getPet(userId: number, now: number) {
      return transaction(() => {
        const record = row(userId);
        return record ? refresh(record, now) : null;
      });
    },
    rename(userId: number, name: string, now: number) {
      return transaction(() => {
        const record = row(userId);
        if (!record) throw new ApiError(404, "请先领养宠物。");
        if (record.name === name) return refresh(record, now);
        return save(record.id, { ...settle(asSnapshot(record), now), name });
      });
    },
    act(userId: number, input: PetActionRequest, now: number) {
      return transaction(() => {
        const record = row(userId);
        if (!record) throw new ApiError(404, "请先领养宠物。");
        const existing = getAction.get(record.id, input.requestId) as { action: string; result: string } | undefined;
        if (existing) {
          if (existing.action !== input.action) throw new ApiError(409, "这项互动编号已被使用。");
          return { pet: JSON.parse(existing.result) as PetSnapshot, conflict: false };
        }
        if (record.version !== input.expectedVersion) return { pet: refresh(record, now), conflict: true };
        const current = settle(asSnapshot(record), now);
        if (input.action === "play" && current.energy < 8) throw new ApiError(422, "精力不足，休息一会儿再玩球。");
        const pet = save(record.id, applyEffect(current, input.action));
        insertAction.run(record.id, input.requestId, input.action, JSON.stringify(pet), pet.serverTime);
        return { pet, conflict: false };
      });
    },
  };
}
