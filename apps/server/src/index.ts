import { CryptoCardSource, CryptoRandomSource } from "./random.js";
import { RoomManager } from "./room-manager.js";
import { createVedrasServer } from "./server.js";

const manager = new RoomManager({
  randomSource: new CryptoRandomSource(),
  cardSource: new CryptoCardSource(),
});

const origins = process.env.WEB_ORIGIN?.split(",").map((origin) => origin.trim()).filter(Boolean);
const server = createVedrasServer({
  roomManager: manager,
  ...(origins === undefined || origins.length === 0 ? {} : { webOrigins: origins }),
});

process.stdout.write(`Vedras server listens on :${server.port}\n`);
