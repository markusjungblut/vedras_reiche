import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  NetworkErrorCode,
  MAX_WEBSOCKET_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
  type ClientMessage,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type UpdateRoomMapRequest,
  type RoomSnapshotMessage,
  type ServerErrorMessage,
  type StartRoomRequest,
} from "@vedras/protocol";
import type { GameRoom, RoomConnection, RoomManager } from "./room-manager.js";
import { RoomError } from "./room-manager.js";

export interface VedrasServerOptions {
  readonly roomManager: RoomManager;
  readonly port?: number;
  readonly webOrigins?: readonly string[];
  /** Enables CORS for separately running development clients. Production uses one origin and leaves it off. */
  readonly allowCrossOrigin?: boolean;
  /** Directory containing the built Vite client. It is only served when explicitly configured. */
  readonly staticDirectory?: string;
  readonly production?: boolean;
  readonly logger?: (event: string, details: Readonly<Record<string, string | number | boolean>>) => void;
}

export interface VedrasServer {
  readonly httpServer: HttpServer;
  readonly port: number;
  close(): Promise<void>;
}

interface SocketSession {
  readonly roomId: string;
  readonly playerId: string;
  readonly sessionToken: string;
  readonly connection: RoomConnection;
}

const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const RESERVED_STATIC_PREFIXES = ["/api", "/ws", "/health", "/data"];
const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedJson(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 5_000 && value.every((item) => isBoundedJson(item, depth + 1));
  return isRecord(value) && Object.keys(value).length <= 64 && Object.values(value).every((item) => isBoundedJson(item, depth + 1));
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "PING") return Object.keys(value).length === 1;
  if (value.type === "AUTHENTICATE") return typeof value.protocolVersion === "number" && Number.isSafeInteger(value.protocolVersion) &&
    typeof value.roomId === "string" && value.roomId.length > 0 && value.roomId.length <= 32 &&
    typeof value.sessionToken === "string" && value.sessionToken.length > 0 && value.sessionToken.length <= 256;
  if (value.type === "GAME_COMMAND") return typeof value.commandId === "string" && value.commandId.trim().length > 0 && value.commandId.length <= 160 &&
    isRecord(value.action) && typeof value.action.type === "string" && value.action.type.length > 0 && value.action.type.length <= 100 &&
    Object.keys(value.action).length <= 64 && isBoundedJson(value.action);
  return false;
}

function rawDataSize(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((size, chunk) => size + chunk.length, 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  return data.length;
}

function parseMessage(data: RawData): ClientMessage | undefined {
  if (rawDataSize(data) > MAX_WEBSOCKET_PAYLOAD_BYTES) return undefined;
  try {
    const parsed = JSON.parse(data.toString()) as unknown;
    return isClientMessage(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function applySecurityHeaders(response: ServerResponse, production: boolean): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (production) {
    response.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; style-src 'self'; script-src 'self'");
  }
}

function writeJson(response: ServerResponse, status: number, payload: unknown, origin?: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (origin !== undefined) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.end(JSON.stringify(payload));
}

function isReservedStaticPath(pathname: string): boolean {
  return RESERVED_STATIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isPathInside(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function staticContentType(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 64 * 1024) throw new RoomError(NetworkErrorCode.InvalidMessage, "Request body is too large.");
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new RoomError(NetworkErrorCode.InvalidMessage, "Request body must be JSON.");
  }
}

function bodyHasPlayerName(body: unknown): body is CreateRoomRequest | JoinRoomRequest {
  return body !== null && typeof body === "object" && "playerName" in body && typeof body.playerName === "string";
}

function bodyIsStartRequest(body: unknown): body is StartRoomRequest {
  return body !== null && typeof body === "object" && "sessionToken" in body && typeof body.sessionToken === "string" &&
    "playerOrder" in body && Array.isArray(body.playerOrder) && body.playerOrder.every((id) => typeof id === "string") &&
    "firstMapDrawerPlayerId" in body && typeof body.firstMapDrawerPlayerId === "string";
}

function bodyIsUpdateMapRequest(body: unknown): body is UpdateRoomMapRequest {
  return body !== null && typeof body === "object" && "sessionToken" in body && typeof body.sessionToken === "string" &&
    "map" in body && body.map !== null && typeof body.map === "object" &&
    "width" in body.map && typeof body.map.width === "number" && "height" in body.map && typeof body.map.height === "number";
}

function errorPayload(error: unknown): { code: NetworkErrorCode; message: string } {
  if (error instanceof RoomError) return { code: error.code, message: error.message };
  return { code: NetworkErrorCode.InvalidMessage, message: "The request could not be processed." };
}

async function serveStaticFile(request: IncomingMessage, response: ServerResponse, pathname: string, staticDirectory: string): Promise<void> {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    writeJson(response, 400, { code: NetworkErrorCode.InvalidMessage, message: "Invalid path." });
    return;
  }
  if (decodedPathname.includes("\0")) {
    writeJson(response, 400, { code: NetworkErrorCode.InvalidMessage, message: "Invalid path." });
    return;
  }

  let root: string;
  try {
    root = await realpath(staticDirectory);
  } catch {
    writeJson(response, 503, { code: NetworkErrorCode.PersistenceFailed, message: "Web client is unavailable." });
    return;
  }

  const requested = resolve(root, `.${decodedPathname}`);
  if (!isPathInside(root, requested)) {
    writeJson(response, 403, { code: NetworkErrorCode.OriginNotAllowed, message: "Path is not allowed." });
    return;
  }

  let filePath = requested;
  let spaFallback = decodedPathname === "/";
  try {
    const resolved = await realpath(requested);
    const details = await stat(resolved);
    if (!details.isFile() || !isPathInside(root, resolved)) throw new Error("not a static file");
    filePath = resolved;
  } catch {
    if (extname(decodedPathname) !== "") {
      writeJson(response, 404, { code: NetworkErrorCode.RoomNotFound, message: "Static file not found." });
      return;
    }
    spaFallback = true;
    filePath = resolve(root, "index.html");
  }

  try {
    const resolved = await realpath(filePath);
    const details = await stat(resolved);
    if (!details.isFile() || !isPathInside(root, resolved)) throw new Error("static file is outside the web build");
    response.statusCode = 200;
    response.setHeader("Content-Type", staticContentType(resolved));
    if (!spaFallback && decodedPathname.startsWith("/assets/")) response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    else response.setHeader("Cache-Control", "no-cache");
    if (request.method === "HEAD") response.end();
    else response.end(await readFile(resolved));
  } catch {
    writeJson(response, 503, { code: NetworkErrorCode.PersistenceFailed, message: "Web client is unavailable." });
  }
}

export function createVedrasServer(options: VedrasServerOptions): VedrasServer {
  const allowedOrigins = new Set(options.webOrigins ?? DEFAULT_ORIGINS);
  const log = options.logger ?? ((event, details) => process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }) + "\n"));
  const isAllowedOrigin = (origin: string | undefined): origin is string => origin === undefined || allowedOrigins.has(origin);
  const corsOrigin = (origin: string | undefined): string | undefined => options.allowCrossOrigin === true && origin !== undefined ? origin : undefined;
  let shuttingDown = false;
  const httpServer = createServer(async (request, response) => {
    const origin = request.headers.origin;
    applySecurityHeaders(response, options.production === true);
    if (shuttingDown) {
      writeJson(response, 503, { code: NetworkErrorCode.PersistenceFailed, message: "Server is shutting down." });
      return;
    }
    if (!isAllowedOrigin(origin)) {
      writeJson(response, 403, { code: NetworkErrorCode.OriginNotAllowed, message: "Origin is not allowed." });
      return;
    }
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      const cors = corsOrigin(origin);
      if (cors !== undefined) {
        response.setHeader("Access-Control-Allow-Origin", cors);
        response.setHeader("Access-Control-Allow-Headers", "Content-Type");
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.setHeader("Vary", "Origin");
      }
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, options.roomManager.isStorageHealthy() ? 200 : 503, {
        status: options.roomManager.isStorageHealthy() ? "ok" : "error",
        storage: options.roomManager.isStorageHealthy() ? "ok" : "error",
        protocolVersion: PROTOCOL_VERSION,
      }, corsOrigin(origin));
      return;
    }
    try {
      if (request.method === "POST" && url.pathname === "/api/rooms") {
        const body = await readJson(request);
        if (!bodyHasPlayerName(body)) throw new RoomError(NetworkErrorCode.InvalidMessage, "A player name is required.");
        const { room, participant, sessionToken } = await options.roomManager.createRoom(body.playerName);
        log("room_created", { roomId: room.roomId, playerId: participant.playerId });
        writeJson(response, 201, { roomId: room.roomId, playerId: participant.playerId, sessionToken }, corsOrigin(origin));
        return;
      }
      const joinMatch = /^\/api\/rooms\/([^/]+)\/join$/.exec(url.pathname);
      if (request.method === "POST" && joinMatch?.[1] !== undefined) {
        const body = await readJson(request);
        if (!bodyHasPlayerName(body)) throw new RoomError(NetworkErrorCode.InvalidMessage, "A player name is required.");
        const { room, participant, sessionToken } = await options.roomManager.joinRoom(decodeURIComponent(joinMatch[1]), body.playerName);
        log("player_joined", { roomId: room.roomId, playerId: participant.playerId });
        broadcastRoom(options.roomManager, room);
        writeJson(response, 201, { roomId: room.roomId, playerId: participant.playerId, sessionToken }, corsOrigin(origin));
        return;
      }
      const startMatch = /^\/api\/rooms\/([^/]+)\/start$/.exec(url.pathname);
      if (request.method === "POST" && startMatch?.[1] !== undefined) {
        const body = await readJson(request);
        if (!bodyIsStartRequest(body)) throw new RoomError(NetworkErrorCode.InvalidMessage, "Start configuration is invalid.");
        const room = await options.roomManager.startRoom(
          decodeURIComponent(startMatch[1]), body.sessionToken, body.playerOrder, body.firstMapDrawerPlayerId, body.map,
        );
        log("game_started", { roomId: room.roomId, playerCount: room.participants.size });
        broadcastRoom(options.roomManager, room);
        writeJson(response, 200, { room: options.roomManager.getPublicRoomState(room), revision: room.revision }, corsOrigin(origin));
        return;
      }
      const mapMatch = /^\/api\/rooms\/([^/]+)\/map$/.exec(url.pathname);
      if (request.method === "POST" && mapMatch?.[1] !== undefined) {
        const body = await readJson(request);
        if (!bodyIsUpdateMapRequest(body)) throw new RoomError(NetworkErrorCode.InvalidMessage, "Map configuration is invalid.");
        const room = await options.roomManager.updateMap(decodeURIComponent(mapMatch[1]), body.sessionToken, body.map);
        broadcastRoom(options.roomManager, room);
        writeJson(response, 200, { room: options.roomManager.getPublicRoomState(room), revision: room.revision }, corsOrigin(origin));
        return;
      }
      if (isReservedStaticPath(url.pathname)) {
        writeJson(response, 404, { code: NetworkErrorCode.RoomNotFound, message: "Route not found." }, corsOrigin(origin));
        return;
      }
      if ((request.method === "GET" || request.method === "HEAD") && options.staticDirectory !== undefined) {
        await serveStaticFile(request, response, url.pathname, options.staticDirectory);
        return;
      }
      writeJson(response, 404, { code: NetworkErrorCode.RoomNotFound, message: "Route not found." }, corsOrigin(origin));
    } catch (error) {
      const payload = errorPayload(error);
      const status = payload.code === NetworkErrorCode.PersistenceFailed ? 500 : payload.code === NetworkErrorCode.RoomNotFound ? 404 :
        payload.code === NetworkErrorCode.RoomAlreadyStarted || payload.code === NetworkErrorCode.RoomFull ? 409 : 400;
      if (!(error instanceof RoomError)) log("request_failed", { route: url.pathname, code: payload.code });
      writeJson(response, status, payload, corsOrigin(origin));
    }
  });

  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES });
  const socketSessions = new Map<WebSocket, SocketSession>();
  const alive = new Map<WebSocket, boolean>();

  httpServer.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    const url = new URL(request.url ?? "/", "http://localhost");
    if (shuttingDown || !isAllowedOrigin(origin) || url.pathname !== "/ws") {
      socket.write(`HTTP/1.1 ${shuttingDown ? "503 Service Unavailable" : "403 Forbidden"}\r\n\r\n`);
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => websocketServer.emit("connection", websocket, request));
  });

  websocketServer.on("connection", (websocket) => {
    alive.set(websocket, true);
    const connection: RoomConnection = {
      send: (message) => {
        if (websocket.readyState === WebSocket.OPEN) websocket.send(JSON.stringify(message));
      },
      close: (code, reason) => {
        if (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING) websocket.close(code, reason);
      },
    };
    websocket.on("error", () => log("websocket_error", { reason: "invalid_payload" }));
    websocket.on("pong", () => alive.set(websocket, true));
    websocket.on("message", async (data) => {
      if (shuttingDown) {
        connection.close(1001, "Server is shutting down.");
        return;
      }
      const message = parseMessage(data);
      if (message === undefined) {
        sendError(connection, NetworkErrorCode.InvalidMessage, "Message must be valid JSON.");
        return;
      }
      if (message.type === "PING") {
        connection.send({ type: "PONG" });
        return;
      }
      if (message.type === "AUTHENTICATE") {
        if (message.protocolVersion !== PROTOCOL_VERSION) {
          sendError(connection, NetworkErrorCode.ProtocolVersionMismatch, "Protocol version is incompatible.");
          connection.close(4001, NetworkErrorCode.ProtocolVersionMismatch);
          return;
        }
        try {
          const attached = options.roomManager.attachConnection(message.roomId, message.sessionToken, connection);
          if (attached.previousConnection !== undefined && attached.previousConnection !== connection) {
            sendError(attached.previousConnection, NetworkErrorCode.SessionReplaced, "This session connected in another browser.");
            attached.previousConnection.close(4002, NetworkErrorCode.SessionReplaced);
          }
          const { room, participant } = attached.session;
          socketSessions.set(websocket, { roomId: room.roomId, playerId: participant.playerId, sessionToken: message.sessionToken, connection });
          log("player_connected", { roomId: room.roomId, playerId: participant.playerId });
          broadcastRoom(options.roomManager, room);
        } catch (error) {
          const payload = errorPayload(error);
          sendError(connection, payload.code, payload.message);
          connection.close(4003, payload.code);
        }
        return;
      }
      if (message.type !== "GAME_COMMAND") {
        sendError(connection, NetworkErrorCode.InvalidMessage, "Authenticate before sending commands.");
        return;
      }
      const session = socketSessions.get(websocket);
      if (session === undefined) {
        sendError(connection, NetworkErrorCode.AuthenticationRequired, "Authenticate before sending commands.");
        return;
      }
      if (!options.roomManager.isCurrentConnection(session.roomId, session.playerId, connection)) {
        sendError(connection, NetworkErrorCode.SessionReplaced, "This session connected in another browser.");
        connection.close(4002, NetworkErrorCode.SessionReplaced);
        return;
      }
      let result: Awaited<ReturnType<RoomManager["processCommand"]>>;
      try {
        result = await options.roomManager.processCommand(session.roomId, session.sessionToken, message.commandId, message.action);
      } catch (error) {
        const payload = errorPayload(error);
        sendError(connection, payload.code, payload.message);
        log("command_failed", { roomId: session.roomId, playerId: session.playerId, code: payload.code });
        return;
      }
      if (result.accepted) {
        connection.send({ type: "COMMAND_ACCEPTED", commandId: message.commandId, revision: result.revision });
        const room = options.roomManager.getRoom(session.roomId);
        log("command_accepted", { roomId: room.roomId, playerId: session.playerId, revision: result.revision, duplicate: result.duplicate });
        broadcastRoom(options.roomManager, room);
        if (room.status === "FINISHED") log("game_finished", { roomId: room.roomId, revision: room.revision });
      } else {
        connection.send({ type: "COMMAND_REJECTED", commandId: message.commandId, code: result.code, message: result.message, revision: result.revision });
        log("command_rejected", { roomId: session.roomId, playerId: session.playerId, revision: result.revision });
      }
    });
    websocket.on("close", () => {
      alive.delete(websocket);
      const session = socketSessions.get(websocket);
      socketSessions.delete(websocket);
      if (session !== undefined) {
        options.roomManager.disconnect(session.roomId, session.playerId, session.connection);
        const room = options.roomManager.getRoom(session.roomId);
        log("player_disconnected", { roomId: session.roomId, playerId: session.playerId });
        broadcastRoom(options.roomManager, room);
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const websocket of websocketServer.clients) {
      if (alive.get(websocket) === false) {
        websocket.terminate();
        continue;
      }
      alive.set(websocket, false);
      websocket.ping();
    }
  }, 30_000);

  const configuredPort = options.port ?? Number(process.env.PORT ?? 3001);
  httpServer.listen(configuredPort);
  const address = httpServer.address() as AddressInfo | null;
  const port = address?.port ?? configuredPort;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    shuttingDown = true;
    clearInterval(heartbeat);
    for (const websocket of websocketServer.clients) websocket.close(1001, "Server is shutting down.");
    const forcedTermination = setTimeout(() => {
      for (const websocket of websocketServer.clients) websocket.terminate();
    }, 5_000);
    forcedTermination.unref();
    closing = new Promise((resolveClose, rejectClose) => {
      websocketServer.close((websocketError) => {
        clearTimeout(forcedTermination);
        httpServer.close((httpError) => {
          const error = websocketError ?? httpError;
          if (error === undefined) resolveClose();
          else rejectClose(error);
        });
      });
    });
    return closing;
  };
  return {
    httpServer,
    port,
    close,
  };
}

function sendError(connection: RoomConnection, code: NetworkErrorCode, message: string): void {
  const payload: ServerErrorMessage = { type: "SERVER_ERROR", code, message };
  connection.send(payload);
}

export function broadcastRoom(roomManager: RoomManager, room: GameRoom): void {
  for (const participant of room.participants.values()) {
    if (participant.connection === undefined) continue;
    const snapshot: RoomSnapshotMessage = {
      type: "ROOM_SNAPSHOT",
      protocolVersion: PROTOCOL_VERSION,
      room: roomManager.getPublicRoomState(room),
      revision: room.revision,
      ...(room.gameState === undefined ? {} : { gameView: roomManager.getPlayerView(room, participant.playerId) }),
    };
    participant.connection.send(snapshot);
  }
}
