import { createHash, randomBytes } from "node:crypto";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { argon2id, hash, verify } from "argon2";
import Fastify, { type FastifyRequest } from "fastify";
import { minimumPasswordLength, personalities, petActions, type Personality, type PetActionRequest, type SessionInfo } from "../../../shared/pet.js";
import { ApiError, openDatabase } from "./database.js";

const sessionName = "petdog_session";
const sessionSeconds = 30 * 24 * 60 * 60;
const loginLimit = { rateLimit: { max: 8, timeWindow: "1 minute" } };
const passwordCost = { type: argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 };
const prefix = "/pet-api/v1";

type Credentials = { email: string; password: string };
type Adopt = { name: string; personality: Personality };
type ServerOptions = {
  databasePath: string;
  origins: string[];
  secureCookie: boolean;
  registrationOpen: boolean;
  logger?: boolean;
  clock?: () => number;
};

const name = { type: "string", minLength: 1, maxLength: 24, pattern: "\\S" };
const credentials = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: false,
  properties: {
    email: { type: "string", format: "email", maxLength: 254 },
    password: { type: "string", minLength: minimumPasswordLength, maxLength: 128 },
  },
};

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newSession(now: number) {
  const token = randomBytes(32).toString("base64url");
  return { token, hashed: hashToken(token), expiresAt: now + sessionSeconds * 1000 };
}

export async function createApp(options: ServerOptions) {
  const db = openDatabase(options.databasePath);
  const clock = options.clock ?? Date.now;
  const dummyHash = await hash(randomBytes(24), passwordCost);
  const app = Fastify({
    bodyLimit: 8 * 1024,
    logger: options.logger ?? false,
    trustProxy: "127.0.0.1",
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const cookieOptions = { path: "/pet-api/", httpOnly: true, sameSite: "lax" as const, secure: options.secureCookie };

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.removeContentTypeParser("text/plain");
  app.addHook("onClose", async () => { db.close(); });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if ((request.method === "POST" || request.method === "PATCH") && !options.origins.includes(request.headers.origin ?? "")) {
      throw new ApiError(403, "请求来源无效。");
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ message: error.message });
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, "petdog API request failed");
    const message = status === 429 ? "请求太频繁，请稍后再试。" : status < 500 ? "请检查输入后再试。" : "云端暂时无法处理请求。";
    return reply.code(status).send({ message });
  });

  function session(token: string | undefined) {
    return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? db.findSession(hashToken(token), clock()) : undefined;
  }

  function requireUser(request: FastifyRequest) {
    const user = session(request.cookies[sessionName]);
    if (!user) throw new ApiError(401, "请先登录。");
    if (request.headers["x-petdog-account"] !== String(user.id)) {
      throw new ApiError(409, "登录账号已变化，请同步后再试。");
    }
    return user;
  }

  app.get("/pet-api/healthz", async () => {
    db.healthy();
    return { ok: true };
  });

  app.get(prefix + "/auth/me", async (request): Promise<SessionInfo> => {
    return { user: session(request.cookies[sessionName]) ?? null, registrationOpen: options.registrationOpen };
  });

  app.post<{ Body: Credentials }>(prefix + "/auth/register", { schema: { body: credentials }, config: loginLimit }, async (request, reply) => {
    if (!options.registrationOpen) throw new ApiError(403, "注册暂未开放。");
    const email = request.body.email.toLowerCase();
    const passwordHash = await hash(request.body.password, passwordCost);
    const now = clock();
    const { token, hashed, expiresAt } = newSession(now);
    db.addUser(email, passwordHash, now, hashed, expiresAt);
    return reply.setCookie(sessionName, token, { ...cookieOptions, maxAge: sessionSeconds }).code(201).send({ user: { email } });
  });

  app.post<{ Body: Credentials }>(prefix + "/auth/login", { schema: { body: credentials }, config: loginLimit }, async (request, reply) => {
    const email = request.body.email.toLowerCase();
    const user = db.findUser(email);
    const verified = await verify(user?.passwordHash ?? dummyHash, request.body.password);
    if (!user || !verified) throw new ApiError(401, "邮箱或密码不正确。");
    const now = clock();
    const { token, hashed, expiresAt } = newSession(now);
    db.addSession(user.id, hashed, expiresAt, now);
    return reply.setCookie(sessionName, token, { ...cookieOptions, maxAge: sessionSeconds }).send({ user: { email } });
  });

  app.post(prefix + "/auth/logout", async (request, reply) => {
    const token = request.cookies[sessionName];
    if (token && session(token)) {
      requireUser(request);
      db.removeSession(hashToken(token));
    }
    return reply.clearCookie(sessionName, cookieOptions).code(204).send();
  });

  app.get(prefix + "/pet", async (request) => {
    const user = requireUser(request);
    return { pet: db.getPet(user.id, clock()) };
  });

  app.post<{ Body: Adopt }>(prefix + "/pet", {
    schema: { body: { type: "object", required: ["name", "personality"], additionalProperties: false,
      properties: { name, personality: { type: "string", enum: [...personalities] } } } },
  }, async (request) => {
    const user = requireUser(request);
    return { pet: db.adopt(user.id, request.body.name.trim(), request.body.personality, clock()) };
  });

  app.patch<{ Body: { name: string } }>(prefix + "/pet/profile", {
    schema: { body: { type: "object", required: ["name"], additionalProperties: false, properties: { name } } },
  }, async (request) => {
    const user = requireUser(request);
    return { pet: db.rename(user.id, request.body.name.trim(), clock()) };
  });

  app.post<{ Body: PetActionRequest }>(prefix + "/pet/actions", {
    schema: { body: {
      type: "object",
      required: ["action", "requestId", "expectedVersion"],
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: [...petActions] },
        requestId: { type: "string", format: "uuid" },
        expectedVersion: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      },
    } },
  }, async (request, reply) => {
    const user = requireUser(request);
    const { pet, conflict } = db.act(user.id, request.body, clock());
    if (conflict) return reply.code(409).send({ message: "宠物状态已在另一台设备更新。", pet });
    return { pet };
  });

  return app;
}
