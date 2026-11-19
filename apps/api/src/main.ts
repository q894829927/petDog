import { createApp } from "./app.js";

const production = process.env.NODE_ENV === "production";
const databasePath = process.env.PETDOG_DB;
const origin = process.env.PETDOG_ORIGIN;
if (production && (!databasePath || !origin?.startsWith("https://"))) {
  throw new Error("Production requires PETDOG_DB and an HTTPS PETDOG_ORIGIN");
}

const app = await createApp({
  databasePath: databasePath ?? "petdog.sqlite",
  origins: origin ? [origin] : ["http://127.0.0.1:5173", "http://localhost:5173"],
  secureCookie: production || (origin?.startsWith("https://") ?? false),
  registrationOpen: !production || process.env.PETDOG_ALLOW_REGISTER === "1",
  logger: true,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void app.close(); });
}
await app.listen({ host: "127.0.0.1", port: Number(process.env.PETDOG_PORT ?? 3180) });
