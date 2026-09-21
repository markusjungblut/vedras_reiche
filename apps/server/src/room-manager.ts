import { randomBytes, randomUUID } from "node:crypto";
import {
  applyAction,
  createGameState,
  createGameViewForPlayer,
  DIGITAL_MAP_CONFIG,
  DomainError,
  GameActionType,
  GamePhase,
  type CardSource,
  type GameAction,
  type GameState,
  type PlayerGameView,
  type RandomSource,
} from "@vedras/game-core";
import {
  NetworkErrorCode,
  type GameActionDto,
  type PublicRoomState,
} from "@vedras/protocol";

export type RoomStatus = "WAITING" | "RUNNING" | "FINISHED";

export interface RoomConnection {
  readonly send: (message: unknown) => void;
  readonly close: (code: number, reason: string) => void;
}

export interface RoomParticipant {
  readonly playerId: string;
  readonly name: string;
  readonly sessionToken: string;
  readonly processedCommandIds: Set<string>;
  connected: boolean;
  connection?: RoomConnection;
}

export interface GameRoom {
  readonly roomId: string;
  status: RoomStatus;
  readonly hostPlayerId: string;
  readonly participants: Map<string, RoomParticipant>;
  gameState?: GameState;
  revision: number;
  commandQueue: Promise<void>;
}

export interface Session {
  readonly room: GameRoom;
  readonly participant: RoomParticipant;
}

export interface CommandSuccess {
  readonly accepted: true;
  readonly duplicate: boolean;
  readonly revision: number;
  readonly state: GameState;
}

export interface CommandFailure {
  readonly accepted: false;
  readonly code: NetworkErrorCode | string;
  readonly message: string;
  readonly revision: number;
}

export type CommandResult = CommandSuccess | CommandFailure;

export class RoomError extends Error {
  constructor(readonly code: NetworkErrorCode, message: string) {
    super(message);
    this.name = "RoomError";
  }
}

export interface RoomManagerOptions {
  readonly randomSource: RandomSource;
  readonly cardSource: CardSource;
  readonly now?: () => string;
  readonly roomIdFactory?: () => string;
  readonly playerIdFactory?: () => string;
  readonly sessionTokenFactory?: () => string;
}

const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function defaultRoomId(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]!).join("");
}

function actionTypeIsKnown(action: GameActionDto): boolean {
  return typeof action.type === "string" && Object.values(GameActionType).includes(action.type as GameActionType);
}

function playerNameIsValid(playerName: string): boolean {
  return playerName.trim().length > 0 && playerName.trim().length <= 80;
}

/** Holds the only full GameState for all in-memory rooms. */
export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly now: () => string;
  private readonly roomIdFactory: () => string;
  private readonly playerIdFactory: () => string;
  private readonly sessionTokenFactory: () => string;

  constructor(private readonly options: RoomManagerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.roomIdFactory = options.roomIdFactory ?? defaultRoomId;
    this.playerIdFactory = options.playerIdFactory ?? randomUUID;
    this.sessionTokenFactory = options.sessionTokenFactory ?? (() => randomBytes(32).toString("base64url"));
  }

  createRoom(playerName: string): { room: GameRoom; participant: RoomParticipant } {
    if (!playerNameIsValid(playerName)) throw new RoomError(NetworkErrorCode.InvalidMessage, "A player name is required.");
    let roomId = this.roomIdFactory();
    while (this.rooms.has(roomId)) roomId = this.roomIdFactory();
    const participant = this.createParticipant(playerName);
    const room: GameRoom = {
      roomId,
      status: "WAITING",
      hostPlayerId: participant.playerId,
      participants: new Map([[participant.playerId, participant]]),
      revision: 0,
      commandQueue: Promise.resolve(),
    };
    this.rooms.set(roomId, room);
    return { room, participant };
  }

  joinRoom(roomId: string, playerName: string): { room: GameRoom; participant: RoomParticipant } {
    const room = this.getRoom(roomId);
    if (room.status !== "WAITING") throw new RoomError(NetworkErrorCode.RoomAlreadyStarted, "The room has already started.");
    if (room.participants.size >= MAX_PLAYERS) throw new RoomError(NetworkErrorCode.RoomFull, "The room already has six players.");
    if (!playerNameIsValid(playerName)) throw new RoomError(NetworkErrorCode.InvalidMessage, "A player name is required.");
    const participant = this.createParticipant(playerName);
    room.participants.set(participant.playerId, participant);
    return { room, participant };
  }

  startRoom(
    roomId: string,
    sessionToken: string,
    playerOrder: readonly string[],
    firstMapDrawerPlayerId: string,
  ): GameRoom {
    const session = this.authenticate(roomId, sessionToken);
    const room = session.room;
    if (session.participant.playerId !== room.hostPlayerId) throw new RoomError(NetworkErrorCode.NotHost, "Only the host can start the room.");
    if (room.status !== "WAITING") throw new RoomError(NetworkErrorCode.RoomAlreadyStarted, "The room has already started.");
    if (room.participants.size < MIN_PLAYERS) throw new RoomError(NetworkErrorCode.InvalidStartConfiguration, "At least two players are required.");
    const participantIds = [...room.participants.keys()];
    if (playerOrder.length !== participantIds.length || new Set(playerOrder).size !== playerOrder.length ||
        playerOrder.some((id) => !room.participants.has(id)) || !playerOrder.includes(firstMapDrawerPlayerId)) {
      throw new RoomError(NetworkErrorCode.InvalidStartConfiguration, "Player order must contain each current player exactly once.");
    }
    const players = playerOrder.map((id) => ({ id, name: room.participants.get(id)!.name }));
    let state = createGameState({ gameId: room.roomId, players, startPlayerId: playerOrder[0]! });
    state = applyAction(state, {
      type: GameActionType.BeginMapCreation,
      firstPlayerId: firstMapDrawerPlayerId,
      map: DIGITAL_MAP_CONFIG,
    }, this.context()).state;
    room.gameState = state;
    room.status = "RUNNING";
    room.revision += 1;
    return room;
  }

  authenticate(roomId: string, sessionToken: string): Session {
    const room = this.getRoom(roomId);
    const participant = [...room.participants.values()].find((candidate) => candidate.sessionToken === sessionToken);
    if (participant === undefined) throw new RoomError(NetworkErrorCode.InvalidSession, "The session token is invalid.");
    return { room, participant };
  }

  attachConnection(roomId: string, sessionToken: string, connection: RoomConnection): { session: Session; previousConnection?: RoomConnection } {
    const session = this.authenticate(roomId, sessionToken);
    const previousConnection = session.participant.connection;
    session.participant.connection = connection;
    session.participant.connected = true;
    return previousConnection === undefined ? { session } : { session, previousConnection };
  }

  disconnect(roomId: string, playerId: string, connection: RoomConnection): void {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(playerId);
    if (participant?.connection === connection) {
      delete participant.connection;
      participant.connected = false;
    }
  }

  isCurrentConnection(roomId: string, playerId: string, connection: RoomConnection): boolean {
    return this.rooms.get(roomId)?.participants.get(playerId)?.connection === connection;
  }

  getRoom(roomId: string): GameRoom {
    const room = this.rooms.get(roomId);
    if (room === undefined) throw new RoomError(NetworkErrorCode.RoomNotFound, "The room was not found.");
    return room;
  }

  getPublicRoomState(room: GameRoom): PublicRoomState {
    return {
      roomId: room.roomId,
      status: room.status,
      hostPlayerId: room.hostPlayerId,
      players: [...room.participants.values()].map((participant) => ({
        playerId: participant.playerId,
        name: participant.name,
        connected: participant.connected,
      })),
    };
  }

  getPlayerView(room: GameRoom, playerId: string): PlayerGameView | undefined {
    return room.gameState === undefined ? undefined : createGameViewForPlayer(room.gameState, playerId);
  }

  async processCommand(roomId: string, sessionToken: string, commandId: string, action: GameActionDto): Promise<CommandResult> {
    const session = this.authenticate(roomId, sessionToken);
    const room = session.room;
    const execute = async (): Promise<CommandResult> => {
      if (room.gameState === undefined || room.status !== "RUNNING") {
        return this.failure(room, NetworkErrorCode.CommandRejected, "The game is not running.");
      }
      if (!actionTypeIsKnown(action)) return this.failure(room, NetworkErrorCode.UnknownCommand, "The command is not supported.");
      if (typeof commandId !== "string" || commandId.trim().length === 0 || commandId.length > 160) {
        return this.failure(room, NetworkErrorCode.InvalidMessage, "A command ID is required.");
      }
      if (session.participant.processedCommandIds.has(commandId)) {
        return { accepted: true, duplicate: true, revision: room.revision, state: room.gameState };
      }
      if (action.playerId !== undefined && action.playerId !== session.participant.playerId) {
        return this.failure(room, NetworkErrorCode.CommandRejected, "A player may act only for their own session.");
      }
      try {
        const next = applyAction(room.gameState, action as GameAction, this.context());
        room.gameState = next.state;
        room.revision += 1;
        session.participant.processedCommandIds.add(commandId);
        if (room.gameState.phase === GamePhase.Finished) room.status = "FINISHED";
        return { accepted: true, duplicate: false, revision: room.revision, state: room.gameState };
      } catch (error) {
        const code = error instanceof DomainError ? error.code : NetworkErrorCode.CommandRejected;
        return this.failure(room, code, "Die Aktion ist im aktuellen Zustand nicht erlaubt.");
      }
    };
    const pending = room.commandQueue.then(execute, execute);
    room.commandQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private createParticipant(playerName: string): RoomParticipant {
    return {
      playerId: this.playerIdFactory(),
      name: playerName.trim(),
      sessionToken: this.sessionTokenFactory(),
      processedCommandIds: new Set(),
      connected: false,
    };
  }

  private context(): { readonly randomSource: RandomSource; readonly cardSource: CardSource; readonly timestamp: string } {
    return { randomSource: this.options.randomSource, cardSource: this.options.cardSource, timestamp: this.now() };
  }

  private failure(room: GameRoom, code: NetworkErrorCode | string, message: string): CommandFailure {
    return { accepted: false, code, message, revision: room.revision };
  }
}
