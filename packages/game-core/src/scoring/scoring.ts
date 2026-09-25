import type { ActionResult } from "../actions/action-result.js";
import type { ChooseLargestRealmAction } from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import type { PlayerId, TerritoryId } from "../model/ids.js";
import { PointOfInterestType } from "../model/point-of-interest.js";
import { SettlementKind, type SettlementFeature } from "../model/territory.js";
import { getFrontTerritoryThreshold } from "../rules/territory-size.js";
import { GamePhase } from "../state/game-phase.js";
import { getPointOfInterestTerritory, getSettlementTerritory, getStateAdjacentTerritoryIds, getStateTerritoryArea } from "../state/geometry-selectors.js";
import type { GameState } from "../state/game-state.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { GameResult, PlayerScore, RealmComponent, ScoringState, TerritoryScoreBreakdown } from "./scoring-state.js";

export const SECRET_FACTION_BONUS_PERCENT = 30;
export const JUNCTION_BONUS_PER_NEIGHBOR_PERCENT = 15;
export const JUNCTION_BONUS_CAP_PERCENT = 75;
export const FRONT_TERRITORY_BONUS_PER_ENEMY_PERCENT = 20;
export const GLOBAL_INFLUENCE_SCORE_POINTS = 10;

export function getLargestRealmBonusPercent(playerCount: number): number {
  if (playerCount === 2) return 10;
  if (playerCount === 3) return 15;
  return 20;
}

export function getJunctionBonusPercent(adjacentTerritoryCount: number): number {
  return Math.min(JUNCTION_BONUS_CAP_PERCENT, Math.max(0, adjacentTerritoryCount) * JUNCTION_BONUS_PER_NEIGHBOR_PERCENT);
}

/** Front bonuses have deliberately no cap; the small territory threshold limits their absolute value. */
export function getFrontTerritoryBonusPercent(enemyNeighborCount: number): number {
  return Math.max(0, enemyNeighborCount) * FRONT_TERRITORY_BONUS_PER_ENEMY_PERCENT;
}

/** A front territory is evaluated only at scoring time from the current authoritative map. */
export function isFrontTerritory(state: GameState, territoryId: TerritoryId): boolean {
  return state.map !== undefined && state.territories.some((territory) => territory.id === territoryId)
    && getStateTerritoryArea(state, territoryId) <= getFrontTerritoryThreshold(state.map);
}

/** Counts unique controlled enemy territories sharing at least one orthogonal border. */
export function getFrontTerritoryEnemyNeighborCount(state: GameState, territoryId: TerritoryId): number {
  const territory = state.territories.find((candidate) => candidate.id === territoryId);
  if (territory?.ownerId === undefined || territory.ownerId === null) return 0;
  return getStateAdjacentTerritoryIds(state, territoryId).filter((adjacentId) => {
    const adjacent = state.territories.find((candidate) => candidate.id === adjacentId);
    return adjacent?.ownerId !== undefined && adjacent.ownerId !== null && adjacent.ownerId !== territory.ownerId;
  }).length;
}

function componentId(playerId: PlayerId, territoryIds: readonly TerritoryId[]): string {
  return `realm:${playerId}:${[...territoryIds].sort().join("+")}`;
}

/** Finds realm components using current geometry, never diagonal contact. */
export function getRealmComponents(state: GameState, playerId: PlayerId): RealmComponent[] {
  const ownedIds = state.territories.filter((territory) => territory.ownerId === playerId)
    .map((territory) => territory.id).sort();
  const unvisited = new Set(ownedIds);
  const components: RealmComponent[] = [];
  while (unvisited.size > 0) {
    const first = [...unvisited].sort()[0]!;
    const pending = [first];
    const territoryIds: TerritoryId[] = [];
    unvisited.delete(first);
    while (pending.length > 0) {
      const current = pending.shift()!;
      territoryIds.push(current);
      for (const adjacentId of getStateAdjacentTerritoryIds(state, current)) {
        if (unvisited.delete(adjacentId)) pending.push(adjacentId);
      }
    }
    territoryIds.sort();
    components.push({
      id: componentId(playerId, territoryIds),
      playerId,
      territoryIds,
      area: territoryIds.reduce((total, territoryId) => total + getStateTerritoryArea(state, territoryId), 0),
    });
  }
  return components.sort((left, right) => left.id.localeCompare(right.id));
}

function getAllSettlementFeatures(state: GameState): readonly SettlementFeature[] {
  return state.territories.flatMap((territory) => territory.settlementFeatures
    ?? (territory.settlementFeature ? [territory.settlementFeature] : []));
}

function getDevelopmentBonusPercent(state: GameState, territoryId: TerritoryId): number {
  const currentFeatures = getAllSettlementFeatures(state).filter((feature) => {
    if (state.map) return getSettlementTerritory(state, feature) === territoryId;
    return state.territories.some((territory) => territory.id === territoryId &&
      (territory.settlementFeatures?.some((candidate) => candidate.id === feature.id) || territory.settlementFeature?.id === feature.id));
  });
  if (currentFeatures.some((feature) => feature.kind === SettlementKind.City)) return 50;
  if (currentFeatures.some((feature) => feature.kind === SettlementKind.Settlement)) return 25;
  return 0;
}

function countPointsOfInterest(state: GameState, territoryId: TerritoryId, type: PointOfInterestType): number {
  return state.pointsOfInterest.filter((poi) => poi.type === type && getPointOfInterestTerritory(state, poi) === territoryId).length;
}

function getActiveRelicCounts(state: GameState): Readonly<Record<PlayerId, number>> {
  const counts: Record<PlayerId, number> = {};
  for (const relic of state.pointsOfInterest.filter((poi) => poi.type === PointOfInterestType.Relic)) {
    const territoryId = getPointOfInterestTerritory(state, relic);
    const ownerId = territoryId === undefined ? undefined : state.territories.find((territory) => territory.id === territoryId)?.ownerId;
    if (ownerId !== null && ownerId !== undefined) counts[ownerId] = (counts[ownerId] ?? 0) + 1;
  }
  return counts;
}

function selectionForComponents(
  state: GameState,
  realmComponents: readonly RealmComponent[],
): Pick<ScoringState, "largestRealmCandidateIdsByPlayerId" | "selectedLargestRealmComponentIdByPlayerId" | "pendingLargestRealmPlayerIds"> {
  const largestRealmCandidateIdsByPlayerId: Partial<Record<PlayerId, readonly string[]>> = {};
  const selectedLargestRealmComponentIdByPlayerId: Partial<Record<PlayerId, string>> = {};
  const pendingLargestRealmPlayerIds: PlayerId[] = [];
  for (const player of state.players) {
    const playerComponents = realmComponents.filter((component) => component.playerId === player.id);
    const largestArea = Math.max(0, ...playerComponents.map((component) => component.area));
    if (largestArea === 0) continue;
    const candidates = playerComponents.filter((component) => component.area === largestArea).map((component) => component.id).sort();
    largestRealmCandidateIdsByPlayerId[player.id] = candidates;
    if (candidates.length === 1) selectedLargestRealmComponentIdByPlayerId[player.id] = candidates[0]!;
    else pendingLargestRealmPlayerIds.push(player.id);
  }
  return { largestRealmCandidateIdsByPlayerId, selectedLargestRealmComponentIdByPlayerId, pendingLargestRealmPlayerIds };
}

function createScoringState(state: GameState): ScoringState {
  const realmComponents = state.players.flatMap((player) => getRealmComponents(state, player.id));
  return { realmComponents, ...selectionForComponents(state, realmComponents) };
}

function createFinalResult(state: GameState, scoring: ScoringState): GameResult {
  const activeRelicCounts = getActiveRelicCounts(state);
  const componentsById = new Map(scoring.realmComponents.map((component) => [component.id, component]));
  const playerResults: PlayerScore[] = state.players.map((player) => {
    const selectedRealm = scoring.selectedLargestRealmComponentIdByPlayerId[player.id];
    const selectedRealmTerritoryIds = selectedRealm === undefined ? [] : componentsById.get(selectedRealm)?.territoryIds ?? [];
    const selectedRealmIds = new Set(selectedRealmTerritoryIds);
    const territoryScores: TerritoryScoreBreakdown[] = state.territories
      .filter((territory) => territory.ownerId === player.id)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((territory) => {
        const isCurrentFrontTerritory = isFrontTerritory(state, territory.id);
        const frontTerritoryEnemyNeighborCount = isCurrentFrontTerritory
          ? getFrontTerritoryEnemyNeighborCount(state, territory.id) : 0;
        const frontTerritoryBonusPercent = getFrontTerritoryBonusPercent(frontTerritoryEnemyNeighborCount);
        const factionBonusPercent = territory.card !== undefined && player.secretFactionSuit !== undefined &&
          territory.card.suit === player.secretFactionSuit ? SECRET_FACTION_BONUS_PERCENT : 0;
        const largestRealmBonusPercent = selectedRealmIds.has(territory.id) ? getLargestRealmBonusPercent(state.players.length) : 0;
        const developmentBonusPercent = getDevelopmentBonusPercent(state, territory.id);
        const landmarkBonusPercent = countPointsOfInterest(state, territory.id, PointOfInterestType.Landmark) * 25;
        const hubBonusPercent = countPointsOfInterest(state, territory.id, PointOfInterestType.Junction)
          * getJunctionBonusPercent(getStateAdjacentTerritoryIds(state, territory.id).length);
        const relicBonusPercent = (activeRelicCounts[player.id] ?? 0) >= 2
          ? countPointsOfInterest(state, territory.id, PointOfInterestType.Relic) * 25 : 0;
        const totalBonusPercent = frontTerritoryBonusPercent + factionBonusPercent + largestRealmBonusPercent + developmentBonusPercent
          + landmarkBonusPercent + hubBonusPercent + relicBonusPercent;
        const baseArea = getStateTerritoryArea(state, territory.id);
        return { territoryId: territory.id, baseArea, isFrontTerritory: isCurrentFrontTerritory,
          frontTerritoryEnemyNeighborCount, frontTerritoryBonusPercent, factionBonusPercent, largestRealmBonusPercent,
          developmentBonusPercent, landmarkBonusPercent, hubBonusPercent, relicBonusPercent, totalBonusPercent,
          scoreHundredths: baseArea * (100 + totalBonusPercent) };
      });
    const territoryScoreHundredths = territoryScores.reduce((total, score) => total + score.scoreHundredths, 0);
    const remainingGlobalInfluence = player.globalInfluence ?? 0;
    const remainingGlobalInfluenceScoreHundredths = remainingGlobalInfluence * GLOBAL_INFLUENCE_SCORE_POINTS * 100;
    return {
      playerId: player.id,
      territoryScores,
      territoryScoreHundredths,
      remainingGlobalInfluence,
      remainingGlobalInfluenceScoreHundredths,
      totalScoreHundredths: territoryScoreHundredths + remainingGlobalInfluenceScoreHundredths,
      controlledTerritoryCount: territoryScores.length,
      controlledArea: territoryScores.reduce((total, score) => total + score.baseArea, 0),
      activeRelicCount: activeRelicCounts[player.id] ?? 0,
      largestRealmTerritoryIds: selectedRealmTerritoryIds,
    };
  });
  const highest = Math.max(0, ...playerResults.map((result) => result.totalScoreHundredths));
  return { playerResults, winnerPlayerIds: playerResults.filter((result) => result.totalScoreHundredths === highest).map((result) => result.playerId) };
}

/**
 * Computes current territory scoring with the same rules as final scoring.
 * Tied largest realms stay unresolved, exactly as they would before their owner chooses one.
 */
export function createScoringPreview(state: GameState): GameResult {
  return createFinalResult(state, createScoringState(state));
}

function completeScoring(state: GameState, scoring: ScoringState, timestamp: string): ActionResult {
  const result = createFinalResult(state, scoring);
  const descriptions: EventDescription[] = [
    { type: GameEventType.ScoringCompleted, payload: { winnerPlayerIds: result.winnerPlayerIds } },
    { type: GameEventType.GameFinished, payload: { winnerPlayerIds: result.winnerPlayerIds,
      finalScores: result.playerResults.map((player) => ({ playerId: player.playerId, scoreHundredths: player.totalScoreHundredths })) } },
  ];
  const events = createEvents(state, timestamp, descriptions);
  return { state: { ...state, phase: GamePhase.Finished, scoring, result, events: [...state.events, ...events] }, events };
}

/** Starts the end-of-game workflow after the action phase entered SCORING. */
export function beginScoring(state: GameState, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.Scoring || state.scoring !== undefined || state.result !== undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const scoring = createScoringState(state);
  if (scoring.pendingLargestRealmPlayerIds.length === 0) return completeScoring(state, scoring, timestamp);
  const descriptions: EventDescription[] = scoring.pendingLargestRealmPlayerIds.map((playerId) => ({
    type: GameEventType.LargestRealmChoiceRequired,
    actorId: playerId,
    payload: { playerId, componentIds: scoring.largestRealmCandidateIdsByPlayerId[playerId] ?? [] },
  }));
  const events = createEvents(state, timestamp, descriptions);
  return { state: { ...state, scoring, events: [...state.events, ...events] }, events };
}

/** Records a required largest-realm choice and completes scoring after the final choice. */
export function chooseLargestRealm(state: GameState, action: ChooseLargestRealmAction, timestamp: string): ActionResult {
  const scoring = state.scoring;
  if (state.phase !== GamePhase.Scoring || scoring === undefined || !scoring.pendingLargestRealmPlayerIds.includes(action.playerId)) {
    throw new DomainError(DomainErrorCode.InvalidLargestRealmChoice);
  }
  const candidates = scoring.largestRealmCandidateIdsByPlayerId[action.playerId] ?? [];
  if (!candidates.includes(action.componentId)) throw new DomainError(DomainErrorCode.InvalidLargestRealmChoice);
  const pendingLargestRealmPlayerIds = scoring.pendingLargestRealmPlayerIds.filter((playerId) => playerId !== action.playerId);
  const nextScoring: ScoringState = {
    ...scoring,
    selectedLargestRealmComponentIdByPlayerId: { ...scoring.selectedLargestRealmComponentIdByPlayerId, [action.playerId]: action.componentId },
    pendingLargestRealmPlayerIds,
  };
  const events = createEvents(state, timestamp, [{ type: GameEventType.LargestRealmSelected, actorId: action.playerId,
    payload: { playerId: action.playerId, componentId: action.componentId } }]);
  const selectedState: GameState = { ...state, scoring: nextScoring, events: [...state.events, ...events] };
  if (pendingLargestRealmPlayerIds.length === 0) {
    const completed = completeScoring(selectedState, nextScoring, timestamp);
    return { state: completed.state, events: [...events, ...completed.events] };
  }
  return { state: selectedState, events };
}

/** German display formatting for exact hundredths, without rounding. */
export function formatScoreHundredths(scoreHundredths: number): string {
  const sign = scoreHundredths < 0 ? "−" : "";
  const absolute = Math.abs(scoreHundredths);
  const whole = Math.floor(absolute / 100);
  const fraction = absolute % 100;
  return fraction === 0 ? `${sign}${whole}` : `${sign}${whole},${String(fraction).padStart(2, "0")}`;
}

/** Normal player-facing final scores round exact hundredths to whole points. */
export function formatRoundedScoreHundredths(scoreHundredths: number): string {
  return String(Math.floor((scoreHundredths + 50) / 100));
}
