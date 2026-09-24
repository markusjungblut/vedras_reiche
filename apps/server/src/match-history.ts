import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GameEventType,
  GamePhase,
  getStateTerritoryArea,
  type GameEvent,
  type GameState,
} from "@vedras/game-core";
import type {
  AccountMatchRecordsDto,
  AccountStatisticsDto,
  MatchDetailDto,
  MatchFinalPlacementDto,
  MatchHistoryListItemDto,
  MatchPlayerStatsDto,
} from "@vedras/protocol";

export const MATCH_HISTORY_VERSION = 1 as const;

export interface MatchTelemetry {
  readonly maxTerritoryCountByPlayerId: Readonly<Record<string, number>>;
  readonly maxControlledAreaByPlayerId: Readonly<Record<string, number>>;
  readonly largestSingleBorderGainByPlayerId: Readonly<Record<string, number>>;
}

export interface MatchParticipantSnapshot {
  readonly accountId: string;
  readonly playerId: string;
  readonly displayNameSnapshot: string;
}

export interface StoredMatchPlayer {
  readonly accountId: string;
  readonly playerId: string;
  readonly displayNameSnapshot: string;
  /** Retained for the account's own faction aggregates; never emitted for another account. */
  readonly factionSuit?: string;
  readonly stats: MatchPlayerStatsDto;
}

/** A small immutable historical record; it deliberately contains no complete game or credential state. */
export interface MatchSummary {
  readonly schemaVersion: typeof MATCH_HISTORY_VERSION;
  readonly matchId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly playerCount: number;
  readonly rounds: number;
  readonly players: readonly StoredMatchPlayer[];
}

export interface MatchHistoryStore {
  save(summary: MatchSummary): Promise<void>;
  get(matchId: string): Promise<MatchSummary | undefined>;
  listForAccount(accountId: string, limit?: number): Promise<readonly MatchSummary[]>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown, max = 160): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function playerIdFrom(event: GameEvent): string | undefined {
  return event.actorId ?? (isRecord(event.payload) && isString(event.payload.playerId) ? event.payload.playerId : undefined);
}

function valueFrom(payload: object, name: string): number {
  return isRecord(payload) ? numberValue(payload[name]) ?? 0 : 0;
}

function stringFrom(payload: object, name: string): string | undefined {
  return isRecord(payload) && isString(payload[name]) ? payload[name] : undefined;
}

function stringArrayFrom(payload: object, name: string): readonly string[] {
  if (!isRecord(payload) || !Array.isArray(payload[name])) return [];
  return payload[name].filter((value): value is string => isString(value));
}

function eventCells(payload: object): number {
  if (!isRecord(payload)) return 0;
  const cells = ["directTransferCells", "annexedDisconnectedCells"].flatMap((name) => {
    const value = payload[name];
    return Array.isArray(value) ? value : [];
  });
  const keys = new Set<string>();
  for (const cell of cells) {
    if (!isRecord(cell) || !Number.isInteger(cell.x) || !Number.isInteger(cell.y)) continue;
    keys.add(`${cell.x},${cell.y}`);
  }
  return keys.size;
}

function emptyStats(): MatchPlayerStatsDto {
  return {
    finalScoreHundredths: 0, placement: 1,
    maxTerritoriesControlled: 0, maxControlledAreaCells: 0, finalTerritoriesControlled: 0, finalControlledAreaCells: 0, territoriesGained: 0,
    warsStarted: 0, warsWon: 0, warsLost: 0, warsTied: 0, territoriesConquered: 0, largestBorderGainCells: 0, totalWarCellsGained: 0,
    auctionsParticipated: 0, auctionsWon: 0, auctionTies: 0, bidsSubmitted: 0, totalBidAmount: 0, highestBid: 0,
    territoriesActivated: 0, diamondActivations: 0, clubActivations: 0, heartActivations: 0, spadeActivations: 0,
    diamondBorderMarksPlaced: 0, diamondNeutralBorderChanges: 0,
    settlementsBuilt: 0, citiesBuilt: 0, additionalActivationNumbersAdded: 0, additionalSuitsAdded: 0,
    globalInfluenceGained: 0, localInfluenceGained: 0, globalInfluenceSpent: 0, localInfluenceSpent: 0,
    spadeActivationsStored: 0, spadeActivationsUsed: 0, spadeBonusUsedInWars: 0,
  };
}

function change(stats: MatchPlayerStatsDto, key: keyof MatchPlayerStatsDto, by = 1): MatchPlayerStatsDto {
  return { ...stats, [key]: (stats[key] as number) + by } as MatchPlayerStatsDto;
}

function setLargest(stats: MatchPlayerStatsDto, key: "largestBorderGainCells" | "highestBid", candidate: number): MatchPlayerStatsDto {
  return { ...stats, [key]: Math.max(stats[key], candidate) };
}

function normalBidAmount(value: unknown): number | undefined {
  if (!isRecord(value) || !isString(value.kind, 20)) return undefined;
  if (value.kind === "START") return numberValue(value.value);
  if (value.kind === "NORMAL") {
    const basicBid = numberValue(value.basicBid);
    const globalInfluence = numberValue(value.globalInfluence);
    const localInfluence = numberValue(value.localInfluence);
    return basicBid === undefined || globalInfluence === undefined || localInfluence === undefined
      ? undefined : basicBid + globalInfluence + localInfluence;
  }
  return undefined;
}

function participantTelemetry(state: GameState): Pick<MatchTelemetry, "maxTerritoryCountByPlayerId" | "maxControlledAreaByPlayerId"> {
  const maxTerritoryCountByPlayerId: Record<string, number> = {};
  const maxControlledAreaByPlayerId: Record<string, number> = {};
  for (const player of state.players) {
    const territories = state.territories.filter((territory) => territory.ownerId === player.id);
    maxTerritoryCountByPlayerId[player.id] = territories.length;
    maxControlledAreaByPlayerId[player.id] = territories.reduce((total, territory) => total + getStateTerritoryArea(state, territory.id), 0);
  }
  return { maxTerritoryCountByPlayerId, maxControlledAreaByPlayerId };
}

/** Initializes small historical maxima when a production room starts. */
export function createMatchTelemetry(state: GameState): MatchTelemetry {
  return { ...participantTelemetry(state), largestSingleBorderGainByPlayerId: {} };
}

/** Updates only telemetry after an accepted transition; game state and rules remain untouched. */
export function updateMatchTelemetry(previous: MatchTelemetry | undefined, state: GameState, newEvents: readonly GameEvent[]): MatchTelemetry {
  const current = participantTelemetry(state);
  const maxTerritoryCountByPlayerId: Record<string, number> = { ...(previous?.maxTerritoryCountByPlayerId ?? {}) };
  const maxControlledAreaByPlayerId: Record<string, number> = { ...(previous?.maxControlledAreaByPlayerId ?? {}) };
  const largestSingleBorderGainByPlayerId: Record<string, number> = { ...(previous?.largestSingleBorderGainByPlayerId ?? {}) };
  for (const player of state.players) {
    maxTerritoryCountByPlayerId[player.id] = Math.max(maxTerritoryCountByPlayerId[player.id] ?? 0, current.maxTerritoryCountByPlayerId[player.id] ?? 0);
    maxControlledAreaByPlayerId[player.id] = Math.max(maxControlledAreaByPlayerId[player.id] ?? 0, current.maxControlledAreaByPlayerId[player.id] ?? 0);
  }
  for (const event of newEvents) {
    if (event.type !== GameEventType.BorderAdvanceResolved) continue;
    const playerId = playerIdFrom(event);
    if (playerId !== undefined) largestSingleBorderGainByPlayerId[playerId] = Math.max(largestSingleBorderGainByPlayerId[playerId] ?? 0, eventCells(event.payload));
  }
  return { maxTerritoryCountByPlayerId, maxControlledAreaByPlayerId, largestSingleBorderGainByPlayerId };
}

/** Builds the match archive once from the authoritative final state and its complete, stable event log. */
export function buildMatchSummary(input: {
  readonly matchId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly state: GameState;
  readonly participants: readonly MatchParticipantSnapshot[];
  readonly telemetry?: MatchTelemetry;
}): MatchSummary | undefined {
  const { state } = input;
  if (state.phase !== GamePhase.Finished || state.result === undefined || !isDate(input.startedAt) || !isDate(input.finishedAt)) return undefined;
  const participants = new Map(input.participants.map((participant) => [participant.playerId, participant]));
  if (participants.size !== state.players.length || state.players.some((player) => !participants.has(player.id))) return undefined;
  const playerIds = new Set(state.players.map((player) => player.id));
  const stats = new Map(state.players.map((player) => [player.id, emptyStats()]));
  const update = (playerId: string | undefined, key: keyof MatchPlayerStatsDto, by = 1) => {
    if (playerId === undefined || !playerIds.has(playerId)) return;
    stats.set(playerId, change(stats.get(playerId)!, key, by));
  };
  const largest = (playerId: string | undefined, key: "largestBorderGainCells" | "highestBid", candidate: number) => {
    if (playerId === undefined || !playerIds.has(playerId)) return;
    stats.set(playerId, setLargest(stats.get(playerId)!, key, candidate));
  };
  const warStarts = new Map<string, { attackerId: string; defenderId: string; attackerTerritoryId: string; defenderTerritoryId: string }>();
  const spades = new Map<string, string>();
  const bidAuctionIds = new Map<string, Set<string>>();
  const uniqueIds = new Set<string>();
  let inStartAuctions = false;

  for (const event of state.events) {
    if (uniqueIds.has(event.id)) continue;
    uniqueIds.add(event.id);
    const actorId = playerIdFrom(event);
    const payload = event.payload;
    if (event.type === GameEventType.StartAuctionRoundStarted) inStartAuctions = true;
    if (event.type === GameEventType.ActionPhaseStarted) inStartAuctions = false;
    switch (event.type) {
      case GameEventType.AuctionBidSubmitted: {
        update(actorId, "bidsSubmitted");
        const auctionId = stringFrom(payload, "auctionId");
        if (actorId !== undefined && auctionId !== undefined) {
          const auctions = bidAuctionIds.get(actorId) ?? new Set<string>();
          auctions.add(auctionId);
          bidAuctionIds.set(actorId, auctions);
        }
        break;
      }
      case GameEventType.AuctionBidsRevealed: {
        if (!isRecord(payload) || !isRecord(payload.bids)) break;
        for (const [playerId, bid] of Object.entries(payload.bids)) {
          const amount = normalBidAmount(bid);
          if (amount === undefined || !playerIds.has(playerId)) continue;
          update(playerId, "totalBidAmount", amount);
          largest(playerId, "highestBid", amount);
        }
        break;
      }
      case GameEventType.AuctionWon:
        update(actorId ?? stringFrom(payload, "winnerId") ?? stringFrom(payload, "playerId"), "auctionsWon");
        break;
      case GameEventType.AuctionTiedTwoPlayers:
      case GameEventType.AuctionTiedMultiplePlayers:
        for (const playerId of [...stringArrayFrom(payload, "tiedPlayerIds"), ...stringArrayFrom(payload, "playerIds")]) update(playerId, "auctionTies");
        break;
      case GameEventType.TerritoryOwnerChanged: {
        if (inStartAuctions) break;
        const nextOwner = stringFrom(payload, "ownerId");
        const priorOwner = stringFrom(payload, "previousOwnerId");
        if (nextOwner !== undefined && nextOwner !== priorOwner) update(nextOwner, "territoriesGained");
        break;
      }
      case GameEventType.WarStarted: {
        const warId = stringFrom(payload, "warId");
        const attackerId = stringFrom(payload, "playerId") ?? actorId;
        const attackerTerritoryId = stringFrom(payload, "attackerTerritoryId");
        const defenderTerritoryId = stringFrom(payload, "defenderTerritoryId");
        const defenderId = stringFrom(payload, "defenderPlayerId");
        if (attackerId !== undefined) update(attackerId, "warsStarted");
        if (warId !== undefined && attackerId !== undefined && attackerTerritoryId !== undefined && defenderTerritoryId !== undefined) {
          /* The defender is read from combat/ownership context below; the event itself intentionally contains only public action data. */
          warStarts.set(warId, { attackerId, defenderId: defenderId ?? "", attackerTerritoryId, defenderTerritoryId });
        }
        break;
      }
      case GameEventType.CombatRolled: {
        const warId = stringFrom(payload, "warId");
        const war = warId === undefined ? undefined : warStarts.get(warId);
        const winnerTerritoryId = stringFrom(payload, "winnerTerritoryId");
        const outcome = stringFrom(payload, "outcome");
        if (war !== undefined) {
          const winnerId = winnerTerritoryId === war.attackerTerritoryId ? war.attackerId : winnerTerritoryId === war.defenderTerritoryId ? war.defenderId : undefined;
          const defenderId = winnerId === war.attackerId ? war.defenderId : war.attackerId;
          if (outcome === "TIE") { update(war.attackerId, "warsTied"); if (war.defenderId) update(war.defenderId, "warsTied"); }
          else if (winnerId !== undefined) { update(winnerId, "warsWon"); if (defenderId) update(defenderId, "warsLost"); }
          update(war.attackerId, "spadeBonusUsedInWars", valueFrom(payload, "attackerSpadeBonus"));
          if (war.defenderId) update(war.defenderId, "spadeBonusUsedInWars", valueFrom(payload, "defenderSpadeBonus"));
        }
        break;
      }
      case GameEventType.TerritoryConquered:
        update(actorId, "territoriesConquered");
        update(actorId, "totalWarCellsGained", valueFrom(payload, "conqueredAreaCells"));
        break;
      case GameEventType.BorderAdvanceResolved: {
        const gain = eventCells(payload);
        update(actorId, "totalWarCellsGained", gain);
        largest(actorId, "largestBorderGainCells", gain);
        break;
      }
      case GameEventType.MapGeometryChanged: {
        if (stringFrom(payload, "warId") === undefined) break;
        const gain = eventCells(payload);
        update(actorId, "totalWarCellsGained", gain);
        largest(actorId, "largestBorderGainCells", gain);
        update(actorId, "territoriesGained");
        break;
      }
      case GameEventType.DiamondCutCorrectionResolved: {
        const gain = eventCells(payload);
        update(actorId, "totalWarCellsGained", gain);
        largest(actorId, "largestBorderGainCells", gain);
        break;
      }
      case GameEventType.TerritoryActivated: {
        update(actorId, "territoriesActivated");
        const selectedSuit = stringFrom(payload, "selectedSuit");
        if (selectedSuit === "DIAMONDS") update(actorId, "diamondActivations");
        if (selectedSuit === "CLUBS") update(actorId, "clubActivations");
        if (selectedSuit === "HEARTS") update(actorId, "heartActivations");
        if (selectedSuit === "SPADES") update(actorId, "spadeActivations");
        break;
      }
      case GameEventType.DiamondBorderMarked: update(actorId, "diamondBorderMarksPlaced"); break;
      case GameEventType.DiamondNeutralBorderChanged: update(actorId, "diamondNeutralBorderChanges"); break;
      case GameEventType.ClubSettlementCreated: update(actorId, "settlementsBuilt"); break;
      case GameEventType.ClubCityCreated: update(actorId, "citiesBuilt"); break;
      case GameEventType.ClubActivationNumberAdded: update(actorId, "additionalActivationNumbersAdded"); break;
      case GameEventType.ClubSecondSuitAdded: update(actorId, "additionalSuitsAdded"); break;
      case GameEventType.HeartGlobalInfluenceGained: update(actorId, "globalInfluenceGained", valueFrom(payload, "amount")); break;
      case GameEventType.HeartLocalInfluenceAdded: update(actorId, "localInfluenceGained", valueFrom(payload, "amount")); break;
      case GameEventType.GlobalInfluenceSpent: update(actorId, "globalInfluenceSpent", valueFrom(payload, "amount")); break;
      case GameEventType.LocalInfluenceSpent: update(actorId, "localInfluenceSpent", valueFrom(payload, "amount")); break;
      case GameEventType.SpadeActivationStored: {
        update(actorId, "spadeActivationsStored");
        const activationId = stringFrom(payload, "effectId");
        if (activationId !== undefined && actorId !== undefined) spades.set(activationId, actorId);
        break;
      }
      case GameEventType.SpadeActivationUsed: update(spades.get(stringFrom(payload, "activationId") ?? ""), "spadeActivationsUsed"); break;
    }
  }
  for (const [playerId, auctions] of bidAuctionIds) update(playerId, "auctionsParticipated", auctions.size);

  const resultByPlayer = new Map(state.result.playerResults.map((result) => [result.playerId, result]));
  const placements = new Map<string, number>();
  const sorted = [...state.result.playerResults].sort((left, right) => right.totalScoreHundredths - left.totalScoreHundredths || left.playerId.localeCompare(right.playerId));
  let index = 0;
  while (index < sorted.length) {
    const score = sorted[index]!.totalScoreHundredths;
    const group = sorted.slice(index).filter((result) => result.totalScoreHundredths === score);
    for (const result of group) placements.set(result.playerId, index + 1);
    index += group.length;
  }
  const telemetry = input.telemetry ?? createMatchTelemetry(state);
  const players = state.players.map((player) => {
    const final = resultByPlayer.get(player.id);
    const base = stats.get(player.id)!;
    const finalStats: MatchPlayerStatsDto = {
      ...base,
      finalScoreHundredths: final?.totalScoreHundredths ?? 0,
      placement: placements.get(player.id) ?? state.players.length,
      maxTerritoriesControlled: Math.max(base.maxTerritoriesControlled, telemetry.maxTerritoryCountByPlayerId[player.id] ?? 0),
      maxControlledAreaCells: Math.max(base.maxControlledAreaCells, telemetry.maxControlledAreaByPlayerId[player.id] ?? 0),
      finalTerritoriesControlled: final?.controlledTerritoryCount ?? 0,
      finalControlledAreaCells: final?.controlledArea ?? 0,
      largestBorderGainCells: Math.max(base.largestBorderGainCells, telemetry.largestSingleBorderGainByPlayerId[player.id] ?? 0),
    };
    const participant = participants.get(player.id)!;
    return { accountId: participant.accountId, playerId: player.id, displayNameSnapshot: participant.displayNameSnapshot,
      ...(player.secretFactionSuit === undefined ? {} : { factionSuit: player.secretFactionSuit }), stats: finalStats };
  });
  return { schemaVersion: MATCH_HISTORY_VERSION, matchId: input.matchId, startedAt: input.startedAt, finishedAt: input.finishedAt,
    playerCount: players.length, rounds: state.round, players };
}

function isStats(value: unknown): value is MatchPlayerStatsDto {
  if (!isRecord(value)) return false;
  return Object.values(emptyStats()).length === Object.keys(emptyStats()).length && Object.keys(emptyStats()).every((key) => numberValue(value[key]) !== undefined);
}

export function deserializeMatchSummary(value: unknown): MatchSummary | undefined {
  if (!isRecord(value) || value.schemaVersion !== MATCH_HISTORY_VERSION || !isString(value.matchId, 80) || !isDate(value.startedAt) || !isDate(value.finishedAt) ||
      numberValue(value.playerCount) === undefined || numberValue(value.rounds) === undefined || !Array.isArray(value.players) || value.players.length < 2 || value.players.length > 6) return undefined;
  const playerCount = numberValue(value.playerCount)!;
  const rounds = numberValue(value.rounds)!;
  const accountIds = new Set<string>();
  const playerIds = new Set<string>();
  const players: StoredMatchPlayer[] = [];
  for (const candidate of value.players) {
    if (!isRecord(candidate) || !isString(candidate.accountId) || !isString(candidate.playerId) || !isString(candidate.displayNameSnapshot, 80) ||
        (candidate.factionSuit !== undefined && !isString(candidate.factionSuit, 20)) || !isStats(candidate.stats) || accountIds.has(candidate.accountId) || playerIds.has(candidate.playerId)) return undefined;
    accountIds.add(candidate.accountId); playerIds.add(candidate.playerId);
    players.push({ accountId: candidate.accountId, playerId: candidate.playerId, displayNameSnapshot: candidate.displayNameSnapshot,
      ...(candidate.factionSuit === undefined ? {} : { factionSuit: candidate.factionSuit }), stats: candidate.stats });
  }
  if (playerCount !== players.length) return undefined;
  return { schemaVersion: MATCH_HISTORY_VERSION, matchId: value.matchId, startedAt: value.startedAt, finishedAt: value.finishedAt,
    playerCount, rounds, players };
}

/** File-per-match storage makes duplicate saves naturally idempotent and keeps one immutable archive per match ID. */
export class FileMatchHistoryStore implements MatchHistoryStore {
  constructor(private readonly directory: string) {}

  async ensureReady(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const probe = join(this.directory, `.vedras-match-probe-${process.pid}-${randomUUID()}.tmp`);
    try { await writeFile(probe, "", { encoding: "utf8", flag: "wx" }); } finally { await unlink(probe).catch(() => undefined); }
  }

  async save(summary: MatchSummary): Promise<void> {
    const checked = deserializeMatchSummary(summary);
    if (checked === undefined) throw new Error("Invalid match summary.");
    await mkdir(this.directory, { recursive: true });
    const target = this.fileName(summary.matchId);
    try {
      const existing = deserializeMatchSummary(JSON.parse(await readFile(target, "utf8")) as unknown);
      if (existing === undefined || JSON.stringify(existing) !== JSON.stringify(checked)) throw new Error("Match summary is immutable.");
      return;
    } catch (error) {
      if (isRecord(error) && error.code !== "ENOENT") throw error;
      if (error instanceof Error && error.message === "Match summary is immutable.") throw error;
    }
    const temporary = join(this.directory, `.${summary.matchId}.${process.pid}.${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(checked), "utf8"); await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  }

  async get(matchId: string): Promise<MatchSummary | undefined> {
    if (!/^[A-Z0-9]+$/.test(matchId)) return undefined;
    try { return deserializeMatchSummary(JSON.parse(await readFile(this.fileName(matchId), "utf8")) as unknown); }
    catch (error) { if (isRecord(error) && error.code === "ENOENT") return undefined; throw error; }
  }

  async listForAccount(accountId: string, limit?: number): Promise<readonly MatchSummary[]> {
    if (!isString(accountId)) return [];
    const files = await readdir(this.directory, { withFileTypes: true }).catch((error: unknown) => isRecord(error) && error.code === "ENOENT" ? [] : Promise.reject(error));
    const matches: MatchSummary[] = [];
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const summary = await this.get(file.name.slice(0, -5));
      if (summary?.players.some((player) => player.accountId === accountId)) matches.push(summary);
    }
    const maximum = limit === undefined ? matches.length : Math.max(1, Math.min(100, limit));
    return matches.sort((left, right) => right.finishedAt.localeCompare(left.finishedAt)).slice(0, maximum);
  }

  private fileName(matchId: string): string { return join(this.directory, `${matchId}.json`); }
}

export class MemoryMatchHistoryStore implements MatchHistoryStore {
  private readonly summaries = new Map<string, MatchSummary>();
  async save(summary: MatchSummary): Promise<void> {
    const existing = this.summaries.get(summary.matchId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(summary)) throw new Error("Match summary is immutable.");
    this.summaries.set(summary.matchId, summary);
  }
  async get(matchId: string): Promise<MatchSummary | undefined> { return this.summaries.get(matchId); }
  async listForAccount(accountId: string, limit?: number): Promise<readonly MatchSummary[]> {
    const maximum = limit === undefined ? Number.POSITIVE_INFINITY : Math.max(1, Math.min(100, limit));
    return [...this.summaries.values()].filter((summary) => summary.players.some((player) => player.accountId === accountId))
      .sort((left, right) => right.finishedAt.localeCompare(left.finishedAt)).slice(0, maximum);
  }
}

function accountPlayer(summary: MatchSummary, accountId: string): StoredMatchPlayer | undefined {
  return summary.players.find((player) => player.accountId === accountId);
}

export function listItemsForAccount(summaries: readonly MatchSummary[], accountId: string): readonly MatchHistoryListItemDto[] {
  return summaries.flatMap((summary) => {
    const player = accountPlayer(summary, accountId);
    return player === undefined ? [] : [{ matchId: summary.matchId, finishedAt: summary.finishedAt, playerCount: summary.playerCount,
      rounds: summary.rounds, placement: player.stats.placement, finalScoreHundredths: player.stats.finalScoreHundredths }];
  });
}

export function detailForAccount(summary: MatchSummary, accountId: string): MatchDetailDto | undefined {
  const own = accountPlayer(summary, accountId);
  if (own === undefined) return undefined;
  const placements: MatchFinalPlacementDto[] = summary.players.map((player) => ({ displayName: player.displayNameSnapshot,
    placement: player.stats.placement, finalScoreHundredths: player.stats.finalScoreHundredths,
    finalTerritoriesControlled: player.stats.finalTerritoriesControlled, finalControlledAreaCells: player.stats.finalControlledAreaCells }))
    .sort((left, right) => left.placement - right.placement || right.finalScoreHundredths - left.finalScoreHundredths || left.displayName.localeCompare(right.displayName));
  return { matchId: summary.matchId, startedAt: summary.startedAt, finishedAt: summary.finishedAt, playerCount: summary.playerCount,
    rounds: summary.rounds, placements, ownStats: own.stats, highlights: matchHighlights(own.stats),
    ...(own.factionSuit === undefined ? {} : { ownFactionSuit: own.factionSuit }) };
}

export function aggregateAccountStats(summaries: readonly MatchSummary[], accountId: string): AccountStatisticsDto {
  const ownMatches = summaries.flatMap((summary) => {
    const player = accountPlayer(summary, accountId);
    return player === undefined ? [] : [{ player, summary }];
  });
  const count = ownMatches.length;
  const records: { -readonly [K in keyof AccountMatchRecordsDto]: number } = { maxControlledAreaCells: 0, maxTerritoriesControlled: 0, mostWarsWonInMatch: 0, largestBorderGainCells: 0, mostAuctionsWonInMatch: 0 };
  const activationsBySuit: Record<string, number> = { DIAMONDS: 0, CLUBS: 0, HEARTS: 0, SPADES: 0 };
  const matchesByFactionSuit: Record<string, number> = {};
  const winsByFactionSuit: Record<string, number> = {};
  let wins = 0; let scoreTotal = 0; let placementTotal = 0; let highScore = 0; let bestPlacement = 0;
  for (const { player } of ownMatches) {
    const { stats } = player;
    wins += stats.placement === 1 ? 1 : 0;
    scoreTotal += stats.finalScoreHundredths; placementTotal += stats.placement;
    highScore = Math.max(highScore, stats.finalScoreHundredths);
    bestPlacement = bestPlacement === 0 ? stats.placement : Math.min(bestPlacement, stats.placement);
    records.maxControlledAreaCells = Math.max(records.maxControlledAreaCells, stats.maxControlledAreaCells);
    records.maxTerritoriesControlled = Math.max(records.maxTerritoriesControlled, stats.maxTerritoriesControlled);
    records.mostWarsWonInMatch = Math.max(records.mostWarsWonInMatch, stats.warsWon);
    records.largestBorderGainCells = Math.max(records.largestBorderGainCells, stats.largestBorderGainCells);
    records.mostAuctionsWonInMatch = Math.max(records.mostAuctionsWonInMatch, stats.auctionsWon);
    activationsBySuit.DIAMONDS = (activationsBySuit.DIAMONDS ?? 0) + stats.diamondActivations;
    activationsBySuit.CLUBS = (activationsBySuit.CLUBS ?? 0) + stats.clubActivations;
    activationsBySuit.HEARTS = (activationsBySuit.HEARTS ?? 0) + stats.heartActivations;
    activationsBySuit.SPADES = (activationsBySuit.SPADES ?? 0) + stats.spadeActivations;
    if (player.factionSuit !== undefined) {
      matchesByFactionSuit[player.factionSuit] = (matchesByFactionSuit[player.factionSuit] ?? 0) + 1;
      if (stats.placement === 1) winsByFactionSuit[player.factionSuit] = (winsByFactionSuit[player.factionSuit] ?? 0) + 1;
    }
  }
  return { matchesPlayed: count, wins, winRate: count === 0 ? 0 : wins / count, averagePlacement: count === 0 ? 0 : placementTotal / count,
    averageFinalScoreHundredths: count === 0 ? 0 : Math.round(scoreTotal / count), highestFinalScoreHundredths: highScore, bestPlacement,
    records, activationsBySuit, matchesByFactionSuit, winsByFactionSuit };
}

/** Deterministic, non-comparative highlights for a player's post-game result card. */
export function matchHighlights(stats: MatchPlayerStatsDto): readonly string[] {
  const candidates: readonly [number, string][] = [
    [stats.warsWon, `${stats.warsWon} Kriege gewonnen`],
    [stats.maxControlledAreaCells, `größtes Reich: ${stats.maxControlledAreaCells} Zellen`],
    [stats.auctionsWon, `${stats.auctionsWon} Auktionen gewonnen`],
    [stats.citiesBuilt, `${stats.citiesBuilt} Städte errichtet`],
    [stats.territoriesActivated, `${stats.territoriesActivated} Gebiete aktiviert`],
  ];
  return candidates.filter(([value]) => value > 0).slice(0, 5).map(([, label]) => label);
}
