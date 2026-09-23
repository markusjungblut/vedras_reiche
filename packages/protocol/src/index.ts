/** This package contains transport DTOs only. It deliberately has no game-core dependency. */
export const PROTOCOL_VERSION = 1 as const;
/** Technical transport and rendering limits, not gameplay rules. */
export const MAX_MAP_WIDTH = 200;
export const MAX_MAP_HEIGHT = 200;
export const MAX_MAP_CELLS = 25_000;
export const MAX_WEBSOCKET_PAYLOAD_BYTES = 64 * 1024;

export enum NetworkErrorCode {
  ProtocolVersionMismatch = "PROTOCOL_VERSION_MISMATCH",
  InvalidMessage = "INVALID_MESSAGE",
  AuthenticationRequired = "AUTHENTICATION_REQUIRED",
  InvalidSession = "INVALID_SESSION",
  UnknownCommand = "UNKNOWN_COMMAND",
  CommandRejected = "COMMAND_REJECTED",
  RoomNotFound = "ROOM_NOT_FOUND",
  RoomAlreadyStarted = "ROOM_ALREADY_STARTED",
  RoomFull = "ROOM_FULL",
  NotHost = "NOT_HOST",
  InvalidStartConfiguration = "INVALID_START_CONFIGURATION",
  PersistenceFailed = "PERSISTENCE_FAILED",
  SessionReplaced = "SESSION_REPLACED",
  PlayerRemoved = "PLAYER_REMOVED",
  OriginNotAllowed = "ORIGIN_NOT_ALLOWED"
}

/** A serialisable action payload. The server narrows it against the explicit GameAction enum. */
export interface GameActionDto {
  readonly type: string;
  readonly playerId?: string;
  readonly [key: string]: unknown;
}

export interface AuthenticateMessage {
  readonly type: "AUTHENTICATE";
  readonly protocolVersion: number;
  readonly roomId: string;
  readonly sessionToken: string;
}

export interface GameCommandMessage {
  readonly type: "GAME_COMMAND";
  readonly commandId: string;
  readonly action: GameActionDto;
}

export interface PingMessage {
  readonly type: "PING";
}

export type ClientMessage = AuthenticateMessage | GameCommandMessage | PingMessage;

export interface PublicRoomPlayer {
  readonly playerId: string;
  readonly name: string;
  readonly connected: boolean;
}

export interface MapDimensionsDto {
  readonly width: number;
  readonly height: number;
}

export interface PublicRoomState {
  readonly roomId: string;
  readonly status: "WAITING" | "RUNNING" | "FINISHED";
  readonly players: readonly PublicRoomPlayer[];
  readonly hostPlayerId: string;
  readonly map: MapDimensionsDto;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly rematchOfRoomId?: string;
}

export interface RoomSnapshotMessage {
  readonly type: "ROOM_SNAPSHOT";
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly room: PublicRoomState;
  readonly revision: number;
  /** Server-generated PlayerGameView; kept unknown here to avoid protocol → core coupling. */
  readonly gameView?: unknown;
}

export interface CommandAcceptedMessage {
  readonly type: "COMMAND_ACCEPTED";
  readonly commandId: string;
  readonly revision: number;
}

export interface CommandRejectedMessage {
  readonly type: "COMMAND_REJECTED";
  readonly commandId: string;
  readonly code: NetworkErrorCode | string;
  readonly message: string;
  readonly revision: number;
}

export interface ServerErrorMessage {
  readonly type: "SERVER_ERROR";
  readonly code: NetworkErrorCode;
  readonly message: string;
}

export interface PongMessage {
  readonly type: "PONG";
}

/** Sent only to currently connected players of a finished room after its host creates a new lobby. */
export interface RematchOfferMessage {
  readonly type: "REMATCH_OFFER";
  readonly roomId: string;
  readonly rematchOfRoomId: string;
}

export type ServerMessage =
  | RoomSnapshotMessage
  | CommandAcceptedMessage
  | CommandRejectedMessage
  | ServerErrorMessage
  | PongMessage
  | RematchOfferMessage;

export interface CreateRoomRequest {
  readonly playerName: string;
}

export interface CreateRoomResponse {
  readonly roomId: string;
  readonly playerId: string;
  readonly sessionToken: string;
}

export interface JoinRoomRequest {
  readonly playerName: string;
}

export interface StartRoomRequest {
  readonly sessionToken: string;
  readonly playerOrder: readonly string[];
  readonly firstMapDrawerPlayerId: string;
  readonly map?: MapDimensionsDto;
}

export interface UpdateRoomMapRequest {
  readonly sessionToken: string;
  readonly map: MapDimensionsDto;
}

export interface SessionTokenRequest {
  readonly sessionToken: string;
}
