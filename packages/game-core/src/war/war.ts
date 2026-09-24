import type { ActionResult } from "../actions/action-result.js";
import type {
  SetWarSpadeChoiceAction, ProposeBorderAdvanceAction, ProposeWarCutAction,
  ChooseWarCutAction, ResolveDiamondCorrectionAction,
} from "../actions/game-action.js";
import { drawNewCard } from "../auctions/resolve-split.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import {
  applyTerritorySplitToMap, getGridCellTerritory, getSharedBorder, validateTerritorySplit,
  validateBorderAdvance, reconcileMapBoundFeatures,
  assessBorderAdvanceLimitation,
} from "../map/index.js";
import type { TerritoryId } from "../model/ids.js";
import { PointOfInterestType } from "../model/point-of-interest.js";
import { getBreakthroughThreshold } from "../rules/territory-size.js";
import { scaleGridDepth } from "../rules/grid-depth.js";
import { finishCurrentBasicAction } from "../state/action-phase.js";
import type { CombatResult, PendingWar } from "../state/action-phase-state.js";
import { GamePhase } from "../state/game-phase.js";
import type { GameState } from "../state/game-state.js";
import type { CardSource } from "../utils/card-source.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { RandomSource } from "../utils/random-source.js";

export type WarSpadeReadState = Pick<GameState, "map" | "spadeActivations">;

function append(state: GameState, next: GameState, timestamp: string, descriptions: EventDescription[]): ActionResult {
  const events = createEvents(state, timestamp, descriptions);
  return { state: { ...next, events: [...state.events, ...events] }, events };
}

function pending(state: GameState, id: string, stage: PendingWar["stage"]): PendingWar {
  if (state.phase !== GamePhase.ActionPhase || state.pendingWar?.id !== id || state.pendingWar.stage !== stage) {
    throw new DomainError(DomainErrorCode.PendingWarRequired);
  }
  return state.pendingWar;
}

function finish(state: GameState, timestamp: string, descriptions: EventDescription[]): ActionResult {
  const result = append(state, { ...state, pendingWar: undefined }, timestamp, descriptions);
  const completed = finishCurrentBasicAction(result.state, timestamp);
  return { state: completed.state, events: [...result.events, ...completed.events] };
}

export function getAvailableWarSpades(state: WarSpadeReadState, playerId: string, opponentTerritoryId: TerritoryId):
  { id: string; sourceTerritoryId: TerritoryId; bonus: 1 | 2 }[] {
  if (state.map === undefined) return [];
  return state.spadeActivations.filter((effect) => effect.playerId === playerId && effect.status === "AVAILABLE")
    .map((effect) => ({
      id: effect.id, sourceTerritoryId: effect.sourceTerritoryId,
      bonus: getSharedBorder(state.map!, effect.sourceTerritoryId, opponentTerritoryId).segments.length > 0 ? 2 : 1,
    }));
}

function roll(random: RandomSource): number {
  const value = random.nextInt(1, 6);
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new RangeError("Combat die must be 1–6.");
  return value;
}

function borderDepth(war: PendingWar, winnerId: TerritoryId, strong: boolean, map: NonNullable<GameState["map"]>): number {
  const base = strong ? 4 : 2;
  if (war.borderMark === undefined) return scaleGridDepth(base, map);
  const winnerPlayerId = winnerId === war.attackerTerritoryId ? war.attackerPlayerId : war.defenderPlayerId;
  return scaleGridDepth(base + (war.borderMark.playerId === winnerPlayerId ? 1 : -1), map);
}

export function setWarSpadeChoice(
  state: GameState, action: SetWarSpadeChoiceAction, random: RandomSource, timestamp: string,
): ActionResult {
  const war = pending(state, action.warId, "AWAITING_COMBAT_CHOICES");
  if (action.playerId !== war.attackerPlayerId && action.playerId !== war.defenderPlayerId) {
    throw new DomainError(DomainErrorCode.InvalidSpadeActivation);
  }
  if (Object.hasOwn(war.spadeChoices, action.playerId)) throw new DomainError(DomainErrorCode.SpadeChoiceAlreadyLocked);
  const opponentId = action.playerId === war.attackerPlayerId ? war.defenderTerritoryId : war.attackerTerritoryId;
  const available = getAvailableWarSpades(state, action.playerId, opponentId);
  if (action.spadeActivationId !== null && !available.some((effect) => effect.id === action.spadeActivationId)) {
    throw new DomainError(DomainErrorCode.InvalidSpadeActivation);
  }
  const choices = { ...war.spadeChoices, [action.playerId]: action.spadeActivationId };
  const descriptions: EventDescription[] = [{
    type: GameEventType.WarSpadeChoiceLocked, actorId: action.playerId,
    payload: { warId: war.id, playerId: action.playerId },
  }];
  if (!Object.hasOwn(choices, war.attackerPlayerId) || !Object.hasOwn(choices, war.defenderPlayerId)) {
    return append(state, { ...state, pendingWar: { ...war, spadeChoices: choices } }, timestamp, descriptions);
  }
  if (state.map === undefined) throw new DomainError(DomainErrorCode.InvalidWarTarget);
  const attackerRoll = roll(random);
  const defenderRoll = roll(random);
  const attackerSpadeBonus = availableBonus(state, war.attackerPlayerId, war.defenderTerritoryId, choices[war.attackerPlayerId]);
  const defenderSpadeBonus = availableBonus(state, war.defenderPlayerId, war.attackerTerritoryId, choices[war.defenderPlayerId]);
  const defenderFortressBonus = state.pointsOfInterest.filter((poi) =>
    poi.type === PointOfInterestType.Fortress && getGridCellTerritory(state.map!, poi.position) === war.defenderTerritoryId).length;
  const attackerTotal = attackerRoll + attackerSpadeBonus;
  const defenderTotal = defenderRoll + defenderSpadeBonus + defenderFortressBonus;
  const difference = Math.abs(attackerTotal - defenderTotal);
  const winnerTerritoryId = attackerTotal > defenderTotal ? war.attackerTerritoryId : war.defenderTerritoryId;
  const loserTerritoryId = winnerTerritoryId === war.attackerTerritoryId ? war.defenderTerritoryId : war.attackerTerritoryId;
  const loser = state.territories.find((territory) => territory.id === loserTerritoryId)!;
  const winnerArea = winnerTerritoryId === war.attackerTerritoryId ? war.attackerArea : war.defenderArea;
  const loserArea = loserTerritoryId === war.attackerTerritoryId ? war.attackerArea : war.defenderArea;
  let outcome: CombatResult["outcome"] = "TIE";
  if (difference > 0) {
    if (loser.weakened) outcome = "CONQUEST";
    else if (difference <= 2) outcome = "BORDER_ADVANCE";
    else if (winnerArea * 2 < loserArea) outcome = "STRONG_ADVANCE";
    else outcome = loserArea >= getBreakthroughThreshold(state.map) ? "CUT_AND_CHOOSE" : "CONQUEST";
  }
  const combat: CombatResult = {
    attackerRoll, defenderRoll, attackerSpadeBonus, defenderSpadeBonus, defenderFortressBonus,
    attackerTotal, defenderTotal, difference, outcome,
    ...(difference === 0 ? {} : { winnerTerritoryId, loserTerritoryId }),
  };
  const used = new Set([choices[war.attackerPlayerId], choices[war.defenderPlayerId]].filter((id): id is string => !!id));
  const spadeActivations = state.spadeActivations.map((effect) => used.has(effect.id) ? { ...effect, status: "USED" as const } : effect);
  for (const id of used) descriptions.push({ type: GameEventType.SpadeActivationUsed, payload: { warId: war.id, activationId: id } });
  descriptions.push({ type: GameEventType.CombatRolled, payload: { warId: war.id, ...combat } });
  if (war.borderMark !== undefined) descriptions.push({
    type: GameEventType.DiamondBorderMarkConsumed, payload: { warId: war.id, markId: war.borderMark.id },
  });
  let territories = state.territories;
  if (difference > 0) {
    territories = territories.map((territory) => territory.id === winnerTerritoryId && territory.weakened
      ? { ...territory, weakened: false } : territory);
    if (state.territories.find((territory) => territory.id === winnerTerritoryId)?.weakened) {
      descriptions.push({ type: GameEventType.TerritoryWeakeningRemoved, payload: { territoryId: winnerTerritoryId } });
    }
  }
  const base = { ...state, territories, spadeActivations,
    lastWarResult: { round: state.round, attackerPlayerId: war.attackerPlayerId,
      defenderPlayerId: war.defenderPlayerId, attackerTerritoryId: war.attackerTerritoryId,
      defenderTerritoryId: war.defenderTerritoryId, combat } };
  if (outcome === "TIE") return finish(base, timestamp, [...descriptions, {
    type: GameEventType.WarResolved, payload: { warId: war.id, outcome },
  }]);
  if (outcome === "CONQUEST") {
    const winnerPlayerId = winnerTerritoryId === war.attackerTerritoryId ? war.attackerPlayerId : war.defenderPlayerId;
    return finish({ ...base, territories: territories.map((territory) => territory.id === loserTerritoryId
      ? { ...territory, ownerId: winnerPlayerId, weakened: false } : territory) }, timestamp, [
      ...descriptions,
      { type: GameEventType.TerritoryConquered, actorId: winnerPlayerId,
        payload: { warId: war.id, territoryId: loserTerritoryId, ownerId: winnerPlayerId, conqueredAreaCells: loserArea } },
      { type: GameEventType.TerritoryOwnerChanged, actorId: winnerPlayerId,
        payload: { territoryId: loserTerritoryId, previousOwnerId: loser.ownerId, ownerId: winnerPlayerId } },
      { type: GameEventType.WarResolved, payload: { warId: war.id, outcome } },
    ]);
  }
  if (outcome === "CUT_AND_CHOOSE") {
    const nextWar: PendingWar = { ...war, spadeChoices: choices, combat, stage: "AWAITING_CUT_DIVISION" };
    return append(state, { ...base, pendingWar: nextWar }, timestamp, [...descriptions, {
      type: GameEventType.WarCutRequired, payload: { warId: war.id, loserTerritoryId, dividerPlayerId: winnerTerritoryId === war.attackerTerritoryId ? war.attackerPlayerId : war.defenderPlayerId },
    }]);
  }
  const maximumDepth = borderDepth(war, winnerTerritoryId, outcome === "STRONG_ADVANCE", state.map);
  const nextWar: PendingWar = { ...war, spadeChoices: choices, combat, stage: "AWAITING_BORDER_ADVANCE", maximumDepth };
  return append(state, { ...base, pendingWar: nextWar }, timestamp, [...descriptions, {
    type: GameEventType.BorderAdvanceRequired, payload: { warId: war.id, winnerTerritoryId, loserTerritoryId, maximumDepth },
  }]);
}

function availableBonus(state: GameState, playerId: string, opponentId: TerritoryId, selected: string | null | undefined): number {
  if (selected == null) return 0;
  const effect = getAvailableWarSpades(state, playerId, opponentId).find((item) => item.id === selected);
  if (effect === undefined) throw new DomainError(DomainErrorCode.InvalidSpadeActivation);
  return effect.bonus;
}

function assertWinner(state: GameState, war: PendingWar, playerId: string): void {
  const winner = state.territories.find((territory) => territory.id === war.combat?.winnerTerritoryId);
  if (winner?.ownerId !== playerId) throw new DomainError(DomainErrorCode.NotWarWinner);
}

function advanceError(reason: string | undefined): DomainError {
  switch (reason) {
    case "OUTSIDE_CORRIDOR": return new DomainError(DomainErrorCode.CellOutsideWarCorridor);
    case "BELOW_MINIMUM_AREA": return new DomainError(DomainErrorCode.MinimumTerritorySizeViolated);
    case "TERRITORY_DISCONNECTED": return new DomainError(DomainErrorCode.TerritoryDisconnected);
    default: return new DomainError(DomainErrorCode.InvalidBorderAdvance);
  }
}

export function proposeBorderAdvance(state: GameState, action: ProposeBorderAdvanceAction, timestamp: string): ActionResult {
  const war = pending(state, action.warId, "AWAITING_BORDER_ADVANCE");
  assertWinner(state, war, action.playerId);
  if (state.map === undefined || war.combat?.winnerTerritoryId === undefined ||
      war.combat.loserTerritoryId === undefined || war.maximumDepth === undefined) {
    throw new DomainError(DomainErrorCode.InvalidBorderAdvance);
  }
  const validation = validateBorderAdvance(state.map, war.combat.winnerTerritoryId,
    war.combat.loserTerritoryId, war.originalSharedBorder, war.maximumDepth, action.claimedCells);
  if (!validation.valid || validation.map === undefined) throw advanceError(validation.reason);
  const limitation = assessBorderAdvanceLimitation(state.map, war.combat.winnerTerritoryId,
    war.combat.loserTerritoryId, war.originalSharedBorder, war.maximumDepth, action.claimedCells);
  const next = reconcileMapBoundFeatures({ ...state, map: validation.map,
    territories: limitation.limitedByMinimumArea
      ? state.territories.map((territory) => territory.id === war.combat!.loserTerritoryId
        ? { ...territory, weakened: true } : territory)
      : state.territories,
  });
  const descriptions: EventDescription[] = [
    { type: GameEventType.BorderAdvanceResolved, actorId: action.playerId,
      payload: { warId: war.id, claimedCells: action.claimedCells,
        directTransferCells: validation.directTransferCells ?? action.claimedCells,
        annexedDisconnectedCells: validation.annexedDisconnectedCells ?? [], maximumDepth: war.maximumDepth,
        weakeningAssessment: limitation } },
    { type: GameEventType.WarResolved, payload: { warId: war.id, outcome: war.combat.outcome } },
  ];
  if (limitation.limitedByMinimumArea) {
    descriptions.splice(1, 0, { type: GameEventType.TerritoryWeakened,
      payload: { territoryId: war.combat.loserTerritoryId } });
  }
  return finish(next, timestamp, descriptions);
}

export function proposeWarCut(state: GameState, action: ProposeWarCutAction, timestamp: string): ActionResult {
  const war = pending(state, action.warId, "AWAITING_CUT_DIVISION");
  assertWinner(state, war, action.playerId);
  if (state.map === undefined || war.combat?.loserTerritoryId === undefined) throw new DomainError(DomainErrorCode.InvalidWarSplit);
  const validation = validateTerritorySplit(state.map, war.combat.loserTerritoryId, action.partACells);
  if (!validation.valid) throw new DomainError(DomainErrorCode.InvalidWarSplit, validation.reason);
  return append(state, { ...state, pendingWar: { ...war, stage: "AWAITING_CUT_CHOICE", proposal: {
    partACells: validation.partACells, partBCells: validation.partBCells,
  } } }, timestamp, [{ type: GameEventType.WarCutProposed, actorId: action.playerId,
    payload: { warId: war.id, partACellCount: validation.partACells.length, partBCellCount: validation.partBCells.length } }]);
}

export function chooseWarCut(
  state: GameState, action: ChooseWarCutAction, random: RandomSource, timestamp: string, cardSource?: CardSource,
): ActionResult {
  const war = pending(state, action.warId, "AWAITING_CUT_CHOICE");
  if (state.map === undefined || war.proposal === undefined || war.combat?.loserTerritoryId === undefined ||
      war.combat.winnerTerritoryId === undefined || (action.chosenPart !== "A" && action.chosenPart !== "B")) {
    throw new DomainError(DomainErrorCode.InvalidWarSplit);
  }
  const loser = state.territories.find((territory) => territory.id === war.combat!.loserTerritoryId)!;
  if (loser.ownerId !== action.playerId) throw new DomainError(DomainErrorCode.NotFirstChooser);
  const winnerPlayerId = state.territories.find((territory) => territory.id === war.combat!.winnerTerritoryId)!.ownerId!;
  const originalCells = action.chosenPart === "A" ? war.proposal.partACells : war.proposal.partBCells;
  const validation = validateTerritorySplit(state.map, loser.id, originalCells);
  if (!validation.valid || loser.card === undefined) throw new DomainError(DomainErrorCode.InvalidWarSplit);
  const newId = `${loser.id}:war:${state.events.length + 1}`;
  if (state.territories.some((territory) => territory.id === newId)) throw new DomainError(DomainErrorCode.InvalidWarSplit);
  const newCard = drawNewCard(state, loser.card, random, cardSource);
  const map = applyTerritorySplitToMap(state.map, loser.id, newId, originalCells);
  const { area: _area, adjacentTerritoryIds: _adjacency, ...withoutCached } = loser;
  const next = reconcileMapBoundFeatures({
    ...state, map,
    territories: [
      ...state.territories.map((territory) => territory.id === loser.id
        ? { ...withoutCached, participatedInWarThisRound: true } : territory),
      { id: newId, ownerId: winnerPlayerId, card: newCard, participatedInWarThisRound: true },
    ],
  });
  const descriptions: EventDescription[] = [{ type: GameEventType.WarCutChoiceMade, actorId: action.playerId,
    payload: { warId: war.id, chosenPart: action.chosenPart, originalTerritoryId: loser.id, newTerritoryId: newId } }];
  if (war.borderMark !== undefined) {
    return append(state, { ...next, pendingWar: { ...war, stage: "AWAITING_DIAMOND_CORRECTION",
      cutTerritoryIds: [loser.id, newId] } }, timestamp, [...descriptions,
      { type: GameEventType.DiamondCutCorrectionRequired, actorId: war.borderMark.playerId,
        payload: { warId: war.id, playerId: war.borderMark.playerId, maximumDepth: scaleGridDepth(1, state.map) } },
    ]);
  }
  const gainedCells = action.chosenPart === "A" ? validation.partBCells : validation.partACells;
  return finish(next, timestamp, [...descriptions,
    { type: GameEventType.MapGeometryChanged, actorId: winnerPlayerId,
      payload: { warId: war.id, originalTerritoryId: loser.id, newTerritoryId: newId,
        directTransferCells: gainedCells, annexedDisconnectedCells: [] } },
    { type: GameEventType.WarResolved, payload: { warId: war.id, outcome: "CUT_AND_CHOOSE" } }]);
}

export function resolveDiamondCorrection(state: GameState, action: ResolveDiamondCorrectionAction, timestamp: string): ActionResult {
  const war = pending(state, action.warId, "AWAITING_DIAMOND_CORRECTION");
  if (war.borderMark?.playerId !== action.playerId || war.cutTerritoryIds === undefined || state.map === undefined) {
    throw new DomainError(DomainErrorCode.DiamondCorrectionUnavailable);
  }
  const [firstId, secondId] = war.cutTerritoryIds;
  const recipientId = state.territories.find((territory) => territory.id === firstId)?.ownerId === action.playerId ? firstId : secondId;
  const donorId = recipientId === firstId ? secondId : firstId;
  const border = getSharedBorder(state.map, recipientId, donorId);
  const validation = validateBorderAdvance(state.map, recipientId, donorId, border, scaleGridDepth(1, state.map), action.claimedCells);
  if (!validation.valid || validation.map === undefined) throw advanceError(validation.reason);
  const next = reconcileMapBoundFeatures({ ...state, map: validation.map });
  return finish(next, timestamp, [
    { type: GameEventType.DiamondCutCorrectionResolved, actorId: action.playerId,
      payload: { warId: war.id, claimedCells: action.claimedCells,
        directTransferCells: validation.directTransferCells ?? action.claimedCells,
        annexedDisconnectedCells: validation.annexedDisconnectedCells ?? [] } },
    { type: GameEventType.WarResolved, payload: { warId: war.id, outcome: "CUT_AND_CHOOSE" } },
  ]);
}
