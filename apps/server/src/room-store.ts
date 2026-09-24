import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GamePhase, type GameState, type GridMapConfig } from "@vedras/game-core";

export const PERSISTENCE_VERSION = 2 as const;
export const MAX_ACCEPTED_COMMANDS = 256;

export type PersistedRoomStatus = "WAITING" | "RUNNING" | "FINISHED";

export interface PersistedParticipant {
  readonly playerId: string;
  /** Optional only for snapshots created before account-backed rooms existed. */
  readonly accountId?: string;
  readonly name: string;
  readonly sessionTokenHash: string;
  readonly joinedAt: string;
}

export interface PersistedAcceptedCommand {
  readonly playerId: string;
  readonly commandId: string;
  readonly revision: number;
}

/** Complete server snapshot. Player views and WebSocket state deliberately never enter this shape. */
export interface PersistedRoom {
  readonly persistenceVersion: typeof PERSISTENCE_VERSION;
  readonly roomId: string;
  readonly status: PersistedRoomStatus;
  readonly hostPlayerId: string;
  readonly participants: readonly PersistedParticipant[];
  readonly map: GridMapConfig;
  readonly revision: number;
  readonly gameState?: GameState;
  readonly acceptedCommands: readonly PersistedAcceptedCommand[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Presentation-only shared music anchor. Older snapshots may not have one. */
  readonly musicStartedAt?: string;
  readonly rematchOfRoomId?: string;
}

export interface RoomStore {
  loadAll(): Promise<readonly PersistedRoom[]>;
  load(roomId: string): Promise<PersistedRoom | undefined>;
  save(room: PersistedRoom): Promise<void>;
  delete(roomId: string): Promise<void>;
}

export interface RoomStoreLogger {
  (event: "room_load_skipped", details: Readonly<Record<string, string>>): void;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, max = 1_000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMapConfig(value: unknown): value is GridMapConfig {
  if (!isRecord(value) || !isPositiveSafeInteger(value.width) || !isPositiveSafeInteger(value.height)) return false;
  return value.format === undefined || value.format === "A4" || value.format === "A5";
}

/** Central JSON boundary for the full Game Core state. The deep state remains plain JSON by design. */
export function serializeGameState(state: GameState): unknown {
  return JSON.parse(JSON.stringify(state)) as unknown;
}

export function deserializeGameState(value: unknown): GameState | undefined {
  if (!isRecord(value) || !isNonEmptyString(value.gameId, 80) ||
      !Object.values(GamePhase).includes(value.phase as GamePhase) ||
      !isNonNegativeSafeInteger(value.round) || !isNonNegativeSafeInteger(value.maxRounds) ||
      !Array.isArray(value.players) || !Array.isArray(value.territories) ||
      !Array.isArray(value.pointsOfInterest) || !Array.isArray(value.borderMarks) ||
      !Array.isArray(value.activationNumbers) || !Array.isArray(value.pendingDiamondBorderChanges) ||
      !Array.isArray(value.spadeActivations) || !Array.isArray(value.events) ||
      !isNonEmptyString(value.startPlayerId, 160)) return undefined;
  return value as unknown as GameState;
}

export function deserializePersistedRoom(value: unknown): { readonly room?: PersistedRoom; readonly reason?: string } {
  if (!isRecord(value)) return { reason: "root is not an object" };
  if (value.persistenceVersion !== 1 && value.persistenceVersion !== PERSISTENCE_VERSION) return { reason: "unsupported persistence version" };
  if (!isNonEmptyString(value.roomId, 32) || !/^[A-Z0-9]+$/.test(value.roomId)) return { reason: "invalid room id" };
  if (value.status !== "WAITING" && value.status !== "RUNNING" && value.status !== "FINISHED") return { reason: "invalid room status" };
  if (!isNonEmptyString(value.hostPlayerId, 160)) return { reason: "invalid host player id" };
  if (!Array.isArray(value.participants) || value.participants.length === 0 || value.participants.length > 6) return { reason: "invalid participants" };
  if (!isMapConfig(value.map)) return { reason: "invalid map configuration" };
  if (!isNonNegativeSafeInteger(value.revision)) return { reason: "invalid revision" };
  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) return { reason: "invalid timestamps" };
  if (value.musicStartedAt !== undefined && !isIsoTimestamp(value.musicStartedAt)) return { reason: "invalid music timestamp" };
  if (value.rematchOfRoomId !== undefined && (!isNonEmptyString(value.rematchOfRoomId, 32) || !/^[A-Z0-9]+$/.test(value.rematchOfRoomId))) {
    return { reason: "invalid rematch origin" };
  }
  if (!Array.isArray(value.acceptedCommands) || value.acceptedCommands.length > MAX_ACCEPTED_COMMANDS) return { reason: "invalid accepted commands" };

  const participants: PersistedParticipant[] = [];
  const playerIds = new Set<string>();
  const accountIds = new Set<string>();
  for (const candidate of value.participants) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.playerId, 160) || !isNonEmptyString(candidate.name, 80) ||
        typeof candidate.sessionTokenHash !== "string" || !/^[a-f0-9]{64}$/i.test(candidate.sessionTokenHash) ||
        !isIsoTimestamp(candidate.joinedAt) || playerIds.has(candidate.playerId) ||
        (candidate.accountId !== undefined && (!isNonEmptyString(candidate.accountId, 160) || accountIds.has(candidate.accountId)))) return { reason: "invalid participant" };
    playerIds.add(candidate.playerId);
    if (candidate.accountId !== undefined) accountIds.add(candidate.accountId);
    participants.push({ playerId: candidate.playerId, ...(candidate.accountId === undefined ? {} : { accountId: candidate.accountId }),
      name: candidate.name, sessionTokenHash: candidate.sessionTokenHash, joinedAt: candidate.joinedAt });
  }
  if (!playerIds.has(value.hostPlayerId)) return { reason: "host is not a participant" };

  const acceptedCommands: PersistedAcceptedCommand[] = [];
  for (const candidate of value.acceptedCommands) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.playerId, 160) || !playerIds.has(candidate.playerId) ||
        !isNonEmptyString(candidate.commandId, 160) || !isNonNegativeSafeInteger(candidate.revision)) {
      return { reason: "invalid accepted command" };
    }
    acceptedCommands.push({ playerId: candidate.playerId, commandId: candidate.commandId, revision: candidate.revision });
  }

  const gameState = value.gameState === undefined ? undefined : deserializeGameState(value.gameState);
  if ((value.status === "RUNNING" || value.status === "FINISHED") && gameState === undefined) return { reason: "running room has no valid game state" };
  if (value.status === "WAITING" && value.gameState !== undefined) return { reason: "waiting room contains a game state" };
  if (gameState !== undefined && gameState.gameId !== value.roomId) return { reason: "game state belongs to another room" };

  return {
    room: {
      persistenceVersion: PERSISTENCE_VERSION,
      roomId: value.roomId,
      status: value.status,
      hostPlayerId: value.hostPlayerId,
      participants,
      map: { width: value.map.width, height: value.map.height, ...(value.map.format === undefined ? {} : { format: value.map.format }) },
      revision: value.revision,
      ...(gameState === undefined ? {} : { gameState }),
      acceptedCommands,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      ...(value.musicStartedAt === undefined ? {} : { musicStartedAt: value.musicStartedAt }),
      ...(value.rematchOfRoomId === undefined ? {} : { rematchOfRoomId: value.rematchOfRoomId }),
    },
  };
}

export class FileRoomStore implements RoomStore {
  private lastLoadSkipped = 0;

  constructor(private readonly directory: string, private readonly logger?: RoomStoreLogger) {}

  /** Verifies that the configured persistent directory can be created and written before serving rooms. */
  async ensureReady(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const probe = join(this.directory, `.vedras-storage-probe-${process.pid}-${randomUUID()}.tmp`);
    try {
      await writeFile(probe, "", { encoding: "utf8", flag: "wx" });
    } finally {
      await unlink(probe).catch(() => undefined);
    }
  }

  async loadAll(): Promise<readonly PersistedRoom[]> {
    await mkdir(this.directory, { recursive: true });
    this.lastLoadSkipped = 0;
    const files = await readdir(this.directory, { withFileTypes: true });
    const rooms: PersistedRoom[] = [];
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const loaded = await this.loadFile(file.name);
      if (loaded !== undefined) rooms.push(loaded);
    }
    return rooms;
  }

  getLastLoadSkipped(): number { return this.lastLoadSkipped; }

  async load(roomId: string): Promise<PersistedRoom | undefined> {
    return this.loadFile(this.fileName(roomId));
  }

  async save(room: PersistedRoom): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const target = join(this.directory, this.fileName(room.roomId));
    const temporary = join(this.directory, `.${room.roomId}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(room), "utf8");
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async delete(roomId: string): Promise<void> {
    await unlink(join(this.directory, this.fileName(roomId))).catch((error: unknown) => {
      if (isRecord(error) && error.code === "ENOENT") return;
      throw error;
    });
  }

  private async loadFile(fileName: string): Promise<PersistedRoom | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.directory, fileName), "utf8"));
      const result = deserializePersistedRoom(parsed);
      if (result.room !== undefined) return result.room;
      this.lastLoadSkipped += 1;
      this.logger?.("room_load_skipped", { file: fileName, reason: result.reason ?? "invalid persisted room" });
      return undefined;
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") return undefined;
      this.lastLoadSkipped += 1;
      this.logger?.("room_load_skipped", { file: fileName, reason: "unreadable or invalid JSON" });
      return undefined;
    }
  }

  private fileName(roomId: string): string {
    if (!/^[A-Z0-9]+$/.test(roomId)) throw new Error("Invalid room ID for file storage.");
    return `${roomId}.json`;
  }
}
