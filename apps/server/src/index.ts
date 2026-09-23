import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { CryptoCardSource, CryptoRandomSource } from "./random.js";
import { RoomManager } from "./room-manager.js";
import { FileRoomStore } from "./room-store.js";
import { loadRuntimeConfig } from "./runtime-config.js";
import { createVedrasServer } from "./server.js";

const log = (event: string, details: Readonly<Record<string, string | number | boolean>>) =>
  process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }) + "\n");
const configuration = loadRuntimeConfig();
const roomStore = new FileRoomStore(join(configuration.dataDirectory, "rooms"), (event, details) => log(event, details));
const manager = new RoomManager({
  randomSource: new CryptoRandomSource(),
  cardSource: new CryptoCardSource(),
  roomStore,
  logger: log,
});

try {
  await roomStore.ensureReady();
  if (configuration.production && configuration.webDistDirectory !== undefined) {
    await access(join(configuration.webDistDirectory, "index.html"), constants.R_OK);
  }
  const restored = await manager.restore();
  if (!manager.isStorageHealthy()) throw new Error("Persistent room storage could not be restored.");
  log("persistence_initialized", { loadedRooms: restored.loaded, skippedRooms: restored.skipped });
} catch (error) {
  log("startup_failed", { component: "storage" });
  process.stderr.write(`Vedras server did not start: ${error instanceof Error ? error.message : "persistent storage is unavailable"}\n`);
  process.exitCode = 1;
  throw error;
}

const server = createVedrasServer({
  roomManager: manager,
  port: configuration.port,
  webOrigins: configuration.webOrigins,
  allowCrossOrigin: !configuration.production,
  production: configuration.production,
  ...(configuration.webDistDirectory === undefined ? {} : { staticDirectory: configuration.webDistDirectory }),
  logger: log,
});

log("server_listening", { port: server.port, production: configuration.production });

let shutdownRequested = false;
const shutdown = (signal: "SIGINT" | "SIGTERM") => {
  if (shutdownRequested) return;
  shutdownRequested = true;
  log("shutdown_requested", { signal });
  void server.close().then(() => {
    log("shutdown_complete", { signal });
    process.exit(0);
  }).catch(() => {
    log("shutdown_failed", { signal });
    process.exit(1);
  });
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
