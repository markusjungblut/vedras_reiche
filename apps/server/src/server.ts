import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  NetworkErrorCode,
  PROTOCOL_VERSION,
  type ClientMessage,
  type CreateRoomRequest,
  type JoinRoomRequest,
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

function parseMessage(data: RawData): ClientMessage | undefined {
  try {
    const parsed = JSON.parse(data.toString()) as unknown;
    return parsed !== null && typeof parsed === "object" && "type" in parsed ? parsed as ClientMessage : undefined;
  } catch {
    return undefined;
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

function errorPayload(error: unknown): { code: NetworkErrorCode; message: string } {
  if (error instanceof RoomError) return { code: error.code, message: error.message };
  return { code: NetworkErrorCode.InvalidMessage, message: "The request could not be processed." };
}

export function createVedrasServer(options: VedrasServerOptions): VedrasServer {
  const allowedOrigins = new Set(options.webOrigins ?? DEFAULT_ORIGINS);
  const log = options.logger ?? ((event, details) => process.stdout.write(JSON.stringify({ event, ...details }) + "\n"));
  const isAllowedOrigin = (origin: string | undefined): origin is string => origin === undefined || allowedOrigins.has(origin);
  const httpServer = createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (!isAllowedOrigin(origin)) {
      writeJson(response, 403, { code: NetworkErrorCode.OriginNotAllowed, message: "Origin is not allowed." });
      return;
    }
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      if (origin !== undefined) response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { status: "ok", protocolVersion: PROTOCOL_VERSION }, origin);
      return;
    }
    try {
      if (request.method === "POST" && url.pathname === "/api/rooms") {
        const body = await readJson(request);
        if (!bodyHasPlayerName(body)) throw new RoomError(NetworkErrorCode.InvalidMessage, "A player name is required.");
        const { room, participant } = options.roomManager.createRoom(body.playerName);
        log("room_created", { roomId: room.roomId, playerId: participant.playerId });
        writeJson(response, 201, { roomId: room.roomId, playerId: participant.playerId, sessionToken: participant.sessionToken }, origin);
        return;
      }
      const joinMatch = /^\/api\/rooms\/([^/]+)\/join$/.exec(url.pathname);
      if (request.method === "POST" && joinMatch?.[1] !== undefined) {
        const body = await readJson(request);
        if (!bodyHasPlayerName(body)) throw new RoomError(NetworkErrorCode.InvalidMessage, "A player name is required.");
        const { room, participant } = options.roomManager.joinRoom(decodeURIComponent(joinMatch[1]), body.playerName);
        log("player_joined", { roomId: room.roomId, playerId: participant.playerId });
        broadcastRoom(options.roomManager, room);
        writeJson(response, 201, { roomId: room.roomId, playerId: participant.playerId, sessionToken: participant.sessionToken }, origin);
        return;
      }
      const startMatch = /^\/api\/rooms\/([^/]+)\/start$/.exec(url.pathname);
      if (request.method === "POST" && startMatch?.[1] !== undefined) {
        const body = await readJson(request);
        if (!bodyIsStartRequest(body)) throw new RoomError(NetworkErrorCode.InvalidMessage, "Start configuration is invalid.");
        const room = options.roomManager.startRoom(
          decodeURIComponent(startMatch[1]), body.sessionToken, body.playerOrder, body.firstMapDrawerPlayerId,
        );
        log("game_started", { roomId: room.roomId, playerCount: room.participants.size });
        broadcastRoom(options.roomManager, room);
        writeJson(response, 200, { room: options.roomManager.getPublicRoomState(room), revision: room.revision }, origin);
        return;
      }
      writeJson(response, 404, { code: NetworkErrorCode.RoomNotFound, message: "Route not found." }, origin);
    } catch (error) {
      const payload = errorPayload(error);
      const status = payload.code === NetworkErrorCode.RoomNotFound ? 404 :
        payload.code === NetworkErrorCode.RoomAlreadyStarted || payload.code === NetworkErrorCode.RoomFull ? 409 : 400;
      writeJson(response, status, payload, origin);
    }
  });

  const websocketServer = new WebSocketServer({ noServer: true });
  const socketSessions = new Map<WebSocket, SocketSession>();
  const alive = new Map<WebSocket, boolean>();

  httpServer.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!isAllowedOrigin(origin) || url.pathname !== "/ws") {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
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
    websocket.on("pong", () => alive.set(websocket, true));
    websocket.on("message", async (data) => {
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
          socketSessions.set(websocket, { roomId: room.roomId, playerId: participant.playerId, sessionToken: participant.sessionToken, connection });
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
      const result = await options.roomManager.processCommand(session.roomId, session.sessionToken, message.commandId, message.action);
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
  return {
    httpServer,
    port,
    close: () => new Promise((resolve, reject) => {
      clearInterval(heartbeat);
      websocketServer.close();
      httpServer.close((error) => error === undefined ? resolve() : reject(error));
    }),
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
