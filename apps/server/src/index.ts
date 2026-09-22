import { resolve, join } from "node:path";
import { CryptoCardSource, CryptoRandomSource } from "./random.js";
import { RoomManager } from "./room-manager.js";
import { FileRoomStore } from "./room-store.js";
import { createVedrasServer } from "./server.js";

const dataDirectory = resolve(process.env.VEDRAS_DATA_DIR ?? "data");
const log = (event: string, details: Readonly<Record<string, string | number | boolean>>) =>
  process.stdout.write(JSON.stringify({ event, ...details }) + "\n");
const manager = new RoomManager({
  randomSource: new CryptoRandomSource(),
  cardSource: new CryptoCardSource(),
  roomStore: new FileRoomStore(join(dataDirectory, "rooms"), (event, details) => log(event, details)),
  logger: log,
});
const restored = await manager.restore();
process.stdout.write(`Persistence initialized\nLoaded ${restored.loaded} rooms\n${restored.skipped} invalid rooms\n`);

const origins = process.env.WEB_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
const server = createVedrasServer({
  roomManager: manager,
  ...(origins === undefined || origins.length === 0 ? {} : { webOrigins: origins }),
});

process.stdout.write(`Vedras server listens on :${server.port}\n`);
