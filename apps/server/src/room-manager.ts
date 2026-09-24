import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
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
  type GridMapConfig,
  type PlayerGameView,
  type RandomSource,
} from "@vedras/game-core";
import { MAX_MAP_CELLS, MAX_MAP_HEIGHT, MAX_MAP_WIDTH, NetworkErrorCode, type AccountRoomSummaryDto, type AccountStatisticsDto, type GameActionDto, type MatchDetailDto, type MatchHistoryListItemDto, type PublicRoomState } from "@vedras/protocol";
import {
  MAX_ACCEPTED_COMMANDS,
  PERSISTENCE_VERSION,
  deserializeGameState,
  deserializePersistedRoom,
  serializeGameState,
  type PersistedParticipant,
  type PersistedRoom,
  type RoomStore,
} from "./room-store.js";
import {
  MemoryMatchHistoryStore,
  aggregateAccountStats,
  buildMatchSummary,
  createMatchTelemetry,
  detailForAccount,
  listItemsForAccount,
  updateMatchTelemetry,
  type MatchHistoryStore,
  type MatchTelemetry,
} from "./match-history.js";

export type RoomStatus = "WAITING" | "RUNNING" | "FINISHED";

export interface RoomConnection {
  readonly send: (message: unknown) => void;
  readonly close: (code: number, reason: string) => void;
}

export interface RoomParticipant {
  readonly playerId: string;
  /** Stable account identity for new rooms. Legacy participants intentionally have no inferred account. */
  readonly accountId?: string;
  readonly name: string;
  readonly sessionTokenHash: string;
  readonly joinedAt: string;
  connected: boolean;
  connection?: RoomConnection;
}

export interface AcceptedCommand {
  readonly playerId: string;
  readonly commandId: string;
  readonly revision: number;
}

export interface GameRoom {
  readonly roomId: string;
  status: RoomStatus;
  readonly hostPlayerId: string;
  map: GridMapConfig;
  readonly participants: Map<string, RoomParticipant>;
  gameState?: GameState;
  readonly acceptedCommands: AcceptedCommand[];
  revision: number;
  readonly createdAt: string;
  updatedAt: string;
  /** Shared presentation-only anchor, set when this room starts. */
  musicStartedAt?: string;
  /** Historical peaks persisted with the room, never read by Game Core. */
  matchTelemetry?: MatchTelemetry;
  rematchOfRoomId?: string;
  commandQueue: Promise<void>;
}

export interface Session {
  readonly room: GameRoom;
  readonly participant: RoomParticipant;
}

export interface CreatedRoom {
  readonly room: GameRoom;
  readonly participant: RoomParticipant;
  /** Returned only once to the browser. It never becomes part of a Room snapshot. */
  readonly sessionToken: string;
  readonly resumed?: boolean;
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

export interface RestoreResult {
  readonly loaded: number;
  readonly skipped: number;
}

interface PersistenceChanges {
  readonly status?: RoomStatus;
  readonly participants?: readonly RoomParticipant[];
  readonly map?: GridMapConfig;
  readonly revision?: number;
  readonly gameState?: GameState;
  readonly acceptedCommands?: readonly AcceptedCommand[];
  readonly updatedAt?: string;
  readonly musicStartedAt?: string;
  readonly matchTelemetry?: MatchTelemetry;
  readonly rematchOfRoomId?: string;
}

export class RoomError extends Error {
  constructor(readonly code: NetworkErrorCode, message: string) {
    super(message);
    this.name = "RoomError";
  }
}

export interface RoomManagerOptions {
  readonly randomSource: RandomSource;
  readonly cardSource: CardSource;
  readonly roomStore?: RoomStore;
  readonly now?: () => string;
  readonly roomIdFactory?: () => string;
  readonly playerIdFactory?: () => string;
  readonly sessionTokenFactory?: () => string;
  readonly logger?: (event: string, details: Readonly<Record<string, string | number | boolean>>) => void;
  readonly matchHistoryStore?: MatchHistoryStore;
}

const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, PersistedRoom>();

  async loadAll(): Promise<readonly PersistedRoom[]> { return [...this.rooms.values()]; }
  async load(roomId: string): Promise<PersistedRoom | undefined> { return this.rooms.get(roomId); }
  async save(room: PersistedRoom): Promise<void> { this.rooms.set(room.roomId, room); }
  async delete(roomId: string): Promise<void> { this.rooms.delete(roomId); }
}

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

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokensMatch(storedHash: string, suppliedToken: string): boolean {
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashSessionToken(suppliedToken), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Holds the only full GameState for all in-memory rooms. Storage stays behind RoomStore. */
export class RoomManager {
  private readonly rooms = new Map<string, GameRoom>();
  private readonly pendingRoomIds = new Set<string>();
  private readonly now: () => string;
  private readonly roomIdFactory: () => string;
  private readonly playerIdFactory: () => string;
  private readonly sessionTokenFactory: () => string;
  private readonly roomStore: RoomStore;
  private readonly matchHistoryStore: MatchHistoryStore;
  private storageHealthy = true;

  constructor(private readonly options: RoomManagerOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.roomIdFactory = options.roomIdFactory ?? defaultRoomId;
    this.playerIdFactory = options.playerIdFactory ?? randomUUID;
    this.sessionTokenFactory = options.sessionTokenFactory ?? (() => randomBytes(32).toString("base64url"));
    this.roomStore = options.roomStore ?? new MemoryRoomStore();
    this.matchHistoryStore = options.matchHistoryStore ?? new MemoryMatchHistoryStore();
  }

  async restore(): Promise<RestoreResult> {
    try {
      const snapshots = await this.roomStore.loadAll();
      let loaded = 0;
      let skipped = 0;
      for (const snapshot of snapshots) {
        const parsed = deserializePersistedRoom(snapshot as unknown);
        if (parsed.room === undefined || this.rooms.has(parsed.room.roomId)) {
          skipped += 1;
          continue;
        }
        this.rooms.set(parsed.room.roomId, this.fromPersisted(parsed.room));
        loaded += 1;
      }
      await this.backfillFinishedMatches();
      const diagnostics = this.roomStore as RoomStore & { getLastLoadSkipped?: () => number };
      skipped += diagnostics.getLastLoadSkipped?.() ?? 0;
      this.storageHealthy = true;
      return { loaded, skipped };
    } catch {
      this.storageHealthy = false;
      this.options.logger?.("persistence_restore_failed", {});
      return { loaded: 0, skipped: 0 };
    }
  }

  isStorageHealthy(): boolean { return this.storageHealthy; }

  async createRoom(playerName: string, accountId?: string): Promise<CreatedRoom> {
    if (!playerNameIsValid(playerName)) throw new RoomError(NetworkErrorCode.InvalidMessage, "A player name is required.");
    const roomId = this.reserveRoomId();
    const created = this.createParticipant(playerName, accountId);
    const now = this.now();
    const room: GameRoom = {
      roomId,
      status: "WAITING",
      hostPlayerId: created.participant.playerId,
      map: { ...DIGITAL_MAP_CONFIG },
      participants: new Map([[created.participant.playerId, created.participant]]),
      acceptedCommands: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
      commandQueue: Promise.resolve(),
    };
    try {
      await this.persist(room);
      this.rooms.set(roomId, room);
      return { room, participant: created.participant, sessionToken: created.sessionToken };
    } finally {
      this.pendingRoomIds.delete(roomId);
    }
  }

  async joinRoom(roomId: string, playerName: string, accountId?: string): Promise<CreatedRoom> {
    if (!playerNameIsValid(playerName)) throw new RoomError(NetworkErrorCode.InvalidMessage, "A player name is required.");
    const room = this.getRoom(roomId);
    return this.inRoomQueue(room, async () => {
      const existing = accountId === undefined ? undefined : [...room.participants.values()].find((participant) => participant.accountId === accountId);
      if (existing !== undefined) {
        const resumed = this.reissueParticipantToken(existing);
        const participants = [...room.participants.values()].map((participant) => participant.playerId === existing.playerId ? resumed.participant : participant);
        const updatedAt = this.now();
        await this.persist(room, { participants, updatedAt });
        room.participants.set(resumed.participant.playerId, resumed.participant);
        room.updatedAt = updatedAt;
        return { room, participant: resumed.participant, sessionToken: resumed.sessionToken, resumed: true };
      }
      if (room.status !== "WAITING") throw new RoomError(NetworkErrorCode.RoomAlreadyStarted, "The room has already started.");
      if (room.participants.size >= MAX_PLAYERS) throw new RoomError(NetworkErrorCode.RoomFull, "The room already has six players.");
      const created = this.createParticipant(playerName, accountId);
      const updatedAt = this.now();
      await this.persist(room, { participants: [...room.participants.values(), created.participant], updatedAt });
      room.participants.set(created.participant.playerId, created.participant);
      room.updatedAt = updatedAt;
      return { room, participant: created.participant, sessionToken: created.sessionToken };
    });
  }

  async startRoom(roomId: string, sessionToken: string, playerOrder: readonly string[], firstMapDrawerPlayerId: string, mapConfig?: GridMapConfig): Promise<GameRoom> {
    const initialSession = this.authenticate(roomId, sessionToken);
    return this.inRoomQueue(initialSession.room, async () => {
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
      const selectedMap = mapConfig ?? room.map;
      if (!isMapConfigValid(selectedMap)) throw new RoomError(NetworkErrorCode.InvalidStartConfiguration, mapConfigurationMessage());
      const players = playerOrder.map((id) => ({ id, name: room.participants.get(id)!.name }));
      let state = createGameState({ gameId: room.roomId, players, startPlayerId: playerOrder[0]! });
      state = applyAction(state, { type: GameActionType.BeginMapCreation, firstPlayerId: firstMapDrawerPlayerId, map: selectedMap }, this.context()).state;
      const revision = room.revision + 1;
      const updatedAt = this.now();
      const matchTelemetry = createMatchTelemetry(state);
      await this.persist(room, { status: "RUNNING", map: selectedMap, gameState: state, revision, updatedAt, musicStartedAt: updatedAt, matchTelemetry });
      room.gameState = state;
      room.map = copyMap(selectedMap);
      room.status = "RUNNING";
      room.revision = revision;
      room.updatedAt = updatedAt;
      room.musicStartedAt = updatedAt;
      room.matchTelemetry = matchTelemetry;
      return room;
    });
  }

  async updateMap(roomId: string, sessionToken: string, map: GridMapConfig): Promise<GameRoom> {
    const initialSession = this.authenticate(roomId, sessionToken);
    return this.inRoomQueue(initialSession.room, async () => {
      const session = this.authenticate(roomId, sessionToken);
      const room = session.room;
      if (session.participant.playerId !== room.hostPlayerId) throw new RoomError(NetworkErrorCode.NotHost, "Only the host can configure the map.");
      if (room.status !== "WAITING") throw new RoomError(NetworkErrorCode.RoomAlreadyStarted, "The room has already started.");
      if (!isMapConfigValid(map)) throw new RoomError(NetworkErrorCode.InvalidStartConfiguration, mapConfigurationMessage());
      const revision = room.revision + 1;
      const updatedAt = this.now();
      await this.persist(room, { map, revision, updatedAt });
      room.map = copyMap(map);
      room.revision = revision;
      room.updatedAt = updatedAt;
      return room;
    });
  }

  async removeWaitingParticipant(roomId: string, sessionToken: string, playerId: string): Promise<{ readonly room: GameRoom; readonly removed: RoomParticipant }> {
    const initialSession = this.authenticate(roomId, sessionToken);
    return this.inRoomQueue(initialSession.room, async () => {
      const session = this.authenticate(roomId, sessionToken);
      const room = session.room;
      if (session.participant.playerId !== room.hostPlayerId) throw new RoomError(NetworkErrorCode.NotHost, "Only the host can remove waiting players.");
      if (room.status !== "WAITING") throw new RoomError(NetworkErrorCode.RoomAlreadyStarted, "Players can only be removed before the game starts.");
      if (playerId === room.hostPlayerId) throw new RoomError(NetworkErrorCode.InvalidMessage, "The host cannot remove themself.");
      const removed = room.participants.get(playerId);
      if (removed === undefined) throw new RoomError(NetworkErrorCode.RoomNotFound, "The player was not found in this room.");
      const participants = [...room.participants.values()].filter((participant) => participant.playerId !== playerId);
      const revision = room.revision + 1;
      const updatedAt = this.now();
      await this.persist(room, { participants, revision, updatedAt });
      room.participants.delete(playerId);
      room.revision = revision;
      room.updatedAt = updatedAt;
      return { room, removed };
    });
  }

  async createRematch(roomId: string, sessionToken: string): Promise<CreatedRoom> {
    const initialSession = this.authenticate(roomId, sessionToken);
    return this.inRoomQueue(initialSession.room, async () => {
      const session = this.authenticate(roomId, sessionToken);
      const source = session.room;
      if (session.participant.playerId !== source.hostPlayerId) throw new RoomError(NetworkErrorCode.NotHost, "Only the host of the finished room can create a rematch.");
      if (source.status !== "FINISHED") throw new RoomError(NetworkErrorCode.RoomAlreadyStarted, "A rematch can only be created after the game has finished.");
      const newRoomId = this.reserveRoomId();
      const created = this.createParticipant(session.participant.name, session.participant.accountId);
      const now = this.now();
      const rematch: GameRoom = {
        roomId: newRoomId,
        status: "WAITING",
        hostPlayerId: created.participant.playerId,
        map: copyMap(source.map),
        participants: new Map([[created.participant.playerId, created.participant]]),
        acceptedCommands: [],
        revision: 0,
        createdAt: now,
        updatedAt: now,
        rematchOfRoomId: source.roomId,
        commandQueue: Promise.resolve(),
      };
      try {
        await this.persist(rematch);
        this.rooms.set(rematch.roomId, rematch);
        return { room: rematch, participant: created.participant, sessionToken: created.sessionToken };
      } finally {
        this.pendingRoomIds.delete(newRoomId);
      }
    });
  }

  authenticate(roomId: string, sessionToken: string): Session {
    const room = this.getRoom(roomId);
    const participant = [...room.participants.values()].find((candidate) => tokensMatch(candidate.sessionTokenHash, sessionToken));
    if (participant === undefined) throw new RoomError(NetworkErrorCode.InvalidSession, "The session token is invalid.");
    return { room, participant };
  }

  attachConnection(roomId: string, sessionToken: string, connection: RoomConnection, accountId?: string): { session: Session; previousConnection?: RoomConnection } {
    const session = this.authenticate(roomId, sessionToken);
    if (accountId !== undefined && session.participant.accountId !== accountId) {
      throw new RoomError(NetworkErrorCode.AuthenticationRequired, "Die Kontoanmeldung passt nicht zu dieser Partie.");
    }
    const previousConnection = session.participant.connection;
    session.participant.connection = connection;
    session.participant.connected = true;
    return previousConnection === undefined ? { session } : { session, previousConnection };
  }

  disconnect(roomId: string, playerId: string, connection: RoomConnection): void {
    const participant = this.rooms.get(roomId)?.participants.get(playerId);
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

  listRoomsForAccount(accountId: string): readonly AccountRoomSummaryDto[] {
    return [...this.rooms.values()].flatMap((room) => {
      const participant = [...room.participants.values()].find((candidate) => candidate.accountId === accountId);
      if (participant === undefined) return [];
      return [{ roomId: room.roomId, status: room.status, playerId: participant.playerId,
        playerNames: [...room.participants.values()].map((candidate) => candidate.name), updatedAt: room.updatedAt,
        ...(room.gameState === undefined ? {} : { round: room.gameState.round, maxRounds: room.gameState.maxRounds }) }];
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  getPublicRoomState(room: GameRoom): PublicRoomState {
    return {
      roomId: room.roomId,
      status: room.status,
      hostPlayerId: room.hostPlayerId,
      map: copyMap(room.map),
      players: [...room.participants.values()].map((participant) => ({ playerId: participant.playerId, name: participant.name, connected: participant.connected })),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      serverTime: this.now(),
      ...(room.musicStartedAt === undefined ? {} : { musicStartedAt: room.musicStartedAt }),
      ...(room.rematchOfRoomId === undefined ? {} : { rematchOfRoomId: room.rematchOfRoomId }),
    };
  }

  getPlayerView(room: GameRoom, playerId: string): PlayerGameView | undefined {
    return room.gameState === undefined ? undefined : createGameViewForPlayer(room.gameState, playerId);
  }

  async getAccountStats(accountId: string): Promise<AccountStatisticsDto> {
    return aggregateAccountStats(await this.matchHistoryStore.listForAccount(accountId), accountId);
  }

  async listMatchesForAccount(accountId: string, limit?: number): Promise<readonly MatchHistoryListItemDto[]> {
    return listItemsForAccount(await this.matchHistoryStore.listForAccount(accountId, limit), accountId);
  }

  async getMatchForAccount(accountId: string, matchId: string): Promise<MatchDetailDto | undefined> {
    const summary = await this.matchHistoryStore.get(matchId);
    return summary === undefined ? undefined : detailForAccount(summary, accountId);
  }

  async processCommand(roomId: string, sessionToken: string, commandId: string, action: GameActionDto): Promise<CommandResult> {
    const initialSession = this.authenticate(roomId, sessionToken);
    return this.inRoomQueue(initialSession.room, async () => {
      const session = this.authenticate(roomId, sessionToken);
      const room = session.room;
      if (room.gameState === undefined || room.status !== "RUNNING") return this.failure(room, NetworkErrorCode.CommandRejected, "The game is not running.");
      if (!actionTypeIsKnown(action)) return this.failure(room, NetworkErrorCode.UnknownCommand, "The command is not supported.");
      if (typeof commandId !== "string" || commandId.trim().length === 0 || commandId.length > 160) return this.failure(room, NetworkErrorCode.InvalidMessage, "A command ID is required.");
      const prior = room.acceptedCommands.find((candidate) => candidate.playerId === session.participant.playerId && candidate.commandId === commandId);
      if (prior !== undefined) return { accepted: true, duplicate: true, revision: prior.revision, state: room.gameState };
      if (action.playerId !== undefined && action.playerId !== session.participant.playerId) return this.failure(room, NetworkErrorCode.CommandRejected, "A player may act only for their own session.");
      try {
        const priorState = room.gameState;
        const state = applyAction(priorState, action as GameAction, this.context()).state;
        const revision = room.revision + 1;
        const acceptedCommands = [...room.acceptedCommands, { playerId: session.participant.playerId, commandId, revision }].slice(-MAX_ACCEPTED_COMMANDS);
        const status: RoomStatus = state.phase === GamePhase.Finished ? "FINISHED" : room.status;
        const updatedAt = this.now();
        const matchTelemetry = updateMatchTelemetry(room.matchTelemetry, state, state.events.slice(priorState.events.length));
        await this.persist(room, { gameState: state, revision, acceptedCommands, status, updatedAt, matchTelemetry });
        room.gameState = state;
        room.revision = revision;
        room.acceptedCommands.splice(0, room.acceptedCommands.length, ...acceptedCommands);
        room.status = status;
        room.updatedAt = updatedAt;
        room.matchTelemetry = matchTelemetry;
        if (status === "FINISHED") await this.archiveFinishedRoom(room);
        return { accepted: true, duplicate: false, revision, state };
      } catch (error) {
        if (error instanceof RoomError) throw error;
        const code = error instanceof DomainError ? error.code : NetworkErrorCode.CommandRejected;
        return this.failure(room, code, "Die Aktion ist im aktuellen Zustand nicht erlaubt.");
      }
    });
  }

  private async inRoomQueue<T>(room: GameRoom, task: () => Promise<T>): Promise<T> {
    const pending = room.commandQueue.then(task, task);
    room.commandQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async persist(room: GameRoom, changes: PersistenceChanges = {}): Promise<void> {
    try {
      const snapshot = this.toPersisted(room, changes);
      await this.roomStore.save(snapshot);
      this.storageHealthy = true;
    } catch {
      this.storageHealthy = false;
      this.options.logger?.("persistence_save_failed", { roomId: room.roomId, revision: changes.revision ?? room.revision });
      throw new RoomError(NetworkErrorCode.PersistenceFailed, "Der Spielstand konnte nicht sicher gespeichert werden.");
    }
  }

  private toPersisted(room: GameRoom, changes: PersistenceChanges): PersistedRoom {
    const state = changes.gameState === undefined ? room.gameState : changes.gameState;
    const serializedState = state === undefined ? undefined : deserializeGameState(serializeGameState(state));
    if (state !== undefined && serializedState === undefined) throw new RoomError(NetworkErrorCode.PersistenceFailed, "Der Spielstand ist nicht speicherbar.");
    const participants = changes.participants ?? [...room.participants.values()];
    return {
      persistenceVersion: PERSISTENCE_VERSION,
      roomId: room.roomId,
      status: changes.status ?? room.status,
      hostPlayerId: room.hostPlayerId,
      participants: participants.map(toPersistedParticipant),
      map: copyMap(changes.map ?? room.map),
      revision: changes.revision ?? room.revision,
      ...(serializedState === undefined ? {} : { gameState: serializedState }),
      acceptedCommands: [...(changes.acceptedCommands ?? room.acceptedCommands)].slice(-MAX_ACCEPTED_COMMANDS),
      createdAt: room.createdAt,
      updatedAt: changes.updatedAt ?? room.updatedAt,
      ...((changes.musicStartedAt ?? room.musicStartedAt) === undefined ? {} : { musicStartedAt: changes.musicStartedAt ?? room.musicStartedAt }),
      ...((changes.matchTelemetry ?? room.matchTelemetry) === undefined ? {} : { matchTelemetry: changes.matchTelemetry ?? room.matchTelemetry }),
      ...((changes.rematchOfRoomId ?? room.rematchOfRoomId) === undefined ? {} : { rematchOfRoomId: changes.rematchOfRoomId ?? room.rematchOfRoomId }),
    };
  }

  private fromPersisted(snapshot: PersistedRoom): GameRoom {
    return {
      roomId: snapshot.roomId,
      status: snapshot.status,
      hostPlayerId: snapshot.hostPlayerId,
      map: copyMap(snapshot.map),
      participants: new Map(snapshot.participants.map((participant) => [participant.playerId, {
        playerId: participant.playerId, ...(participant.accountId === undefined ? {} : { accountId: participant.accountId }), name: participant.name,
        sessionTokenHash: participant.sessionTokenHash, joinedAt: participant.joinedAt, connected: false,
      }])),
      ...(snapshot.gameState === undefined ? {} : { gameState: snapshot.gameState }),
      acceptedCommands: [...snapshot.acceptedCommands],
      revision: snapshot.revision,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      ...(snapshot.musicStartedAt === undefined ? {} : { musicStartedAt: snapshot.musicStartedAt }),
      ...(snapshot.matchTelemetry === undefined ? (snapshot.gameState === undefined ? {} : { matchTelemetry: createMatchTelemetry(snapshot.gameState) }) : { matchTelemetry: snapshot.matchTelemetry }),
      ...(snapshot.rematchOfRoomId === undefined ? {} : { rematchOfRoomId: snapshot.rematchOfRoomId }),
      commandQueue: Promise.resolve(),
    };
  }

  private createParticipant(playerName: string, accountId?: string): { readonly participant: RoomParticipant; readonly sessionToken: string } {
    const sessionToken = this.sessionTokenFactory();
    return {
      participant: { playerId: this.playerIdFactory(), ...(accountId === undefined ? {} : { accountId }), name: playerName.trim(),
        sessionTokenHash: hashSessionToken(sessionToken), joinedAt: this.now(), connected: false },
      sessionToken,
    };
  }

  private reissueParticipantToken(participant: RoomParticipant): { readonly participant: RoomParticipant; readonly sessionToken: string } {
    const sessionToken = this.sessionTokenFactory();
    return { participant: { ...participant, sessionTokenHash: hashSessionToken(sessionToken) }, sessionToken };
  }

  private reserveRoomId(): string {
    let roomId = this.roomIdFactory();
    while (this.rooms.has(roomId) || this.pendingRoomIds.has(roomId)) roomId = this.roomIdFactory();
    this.pendingRoomIds.add(roomId);
    return roomId;
  }

  private context(): { readonly randomSource: RandomSource; readonly cardSource: CardSource; readonly timestamp: string } {
    return { randomSource: this.options.randomSource, cardSource: this.options.cardSource, timestamp: this.now() };
  }

  private failure(room: GameRoom, code: NetworkErrorCode | string, message: string): CommandFailure {
    return { accepted: false, code, message, revision: room.revision };
  }

  private async backfillFinishedMatches(): Promise<void> {
    for (const room of this.rooms.values()) if (room.status === "FINISHED") await this.archiveFinishedRoom(room);
  }

  private async archiveFinishedRoom(room: GameRoom): Promise<void> {
    if (room.status !== "FINISHED" || room.gameState?.phase !== GamePhase.Finished) return;
    const participants = [...room.participants.values()];
    if (participants.some((participant) => participant.accountId === undefined)) {
      this.options.logger?.("match_history_skipped", { roomId: room.roomId, reason: "missing_account_mapping" });
      return;
    }
    const summary = buildMatchSummary({ matchId: room.roomId, startedAt: room.musicStartedAt ?? room.createdAt, finishedAt: room.updatedAt,
      state: room.gameState, ...(room.matchTelemetry === undefined ? {} : { telemetry: room.matchTelemetry }),
      participants: participants.map((participant) => ({ accountId: participant.accountId!, playerId: participant.playerId, displayNameSnapshot: participant.name })) });
    if (summary === undefined) {
      this.options.logger?.("match_history_skipped", { roomId: room.roomId, reason: "incomplete_finished_state" });
      return;
    }
    try {
      await this.matchHistoryStore.save(summary);
      this.options.logger?.("match_history_archived", { roomId: room.roomId, matchId: summary.matchId });
    } catch {
      /* The completed room is already durable; startup backfill will retry this idempotent archive. */
      this.options.logger?.("match_history_save_failed", { roomId: room.roomId });
    }
  }
}

function toPersistedParticipant(participant: RoomParticipant): PersistedParticipant {
  return { playerId: participant.playerId, ...(participant.accountId === undefined ? {} : { accountId: participant.accountId }), name: participant.name,
    sessionTokenHash: participant.sessionTokenHash, joinedAt: participant.joinedAt };
}

function copyMap(map: GridMapConfig): GridMapConfig {
  return { width: map.width, height: map.height, ...(map.format === undefined ? {} : { format: map.format }) };
}

export function isMapConfigValid(map: GridMapConfig): boolean {
  return Number.isSafeInteger(map.width) && map.width > 0 && Number.isSafeInteger(map.height) && map.height > 0 &&
    map.width <= MAX_MAP_WIDTH && map.height <= MAX_MAP_HEIGHT && map.width * map.height <= MAX_MAP_CELLS &&
    (map.format === undefined || map.format === "A4" || map.format === "A5");
}

function mapConfigurationMessage(): string {
  return `Die Karte darf höchstens ${MAX_MAP_WIDTH} × ${MAX_MAP_HEIGHT} Zellen und insgesamt ${MAX_MAP_CELLS.toLocaleString("de-DE")} Zellen haben.`;
}
