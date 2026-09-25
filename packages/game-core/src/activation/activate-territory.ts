import type { ActionResult } from "../actions/action-result.js";
import { GameActionType, type ActivateTerritoryAction, type GameAction } from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import { GamePhase } from "../state/game-phase.js";
import type { GameState } from "../state/game-state.js";
import { finishCurrentBasicAction, forfeitCurrentBasicAction, startPendingWar } from "../state/action-phase.js";
import { beginStartAuctions, openNextStartAuction, submitStartAuctionBid } from "../auctions/start-auctions.js";
import { openNormalAuction, submitNormalAuctionBid } from "../auctions/normal-auctions.js";
import { chooseSplitPart, proposeTerritorySplit, resolveTerritorySplit } from "../auctions/resolve-split.js";
import type { CardSource } from "../utils/card-source.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { RandomSource } from "../utils/random-source.js";
import { applySymbolAbility } from "./apply-symbol-ability.js";
import { getSharedBorder, reconcileMapBoundFeatures, validateBorderAdvance } from "../map/index.js";
import { getNeutralDiamondDepth } from "../rules/grid-depth.js";
import type { ResolveNeutralDiamondAction } from "../actions/game-action.js";
import { getAvailableWarSpades, resolveDiamondCorrection, setWarSpadeChoice, proposeBorderAdvance, proposeWarCut, chooseWarCut } from "../war/war.js";
import { chooseLargestRealm } from "../scoring/scoring.js";
import {
  beginMapCreation,
  commitSetupBoundaryDraft,
  correctSetupBorders,
  finalizeMapCreation,
  getSetupMapValidationIssues,
  placeSetupPointOfInterest,
} from "../state/map-creation.js";
import { MapCreationStage } from "../state/map-creation-state.js";
import { completeActivationStep, getNextActivationResolverPlayer, rollNextActivationNumber, startRound } from "../state/start-round.js";

export interface ActivationContext {
  readonly randomSource: RandomSource;
  readonly cardSource?: CardSource;
  readonly timestamp: string;
}

/** Automatically records a pass when a player has no legal ♠ effect for this war. */
function startWarWithAutomaticSpadePasses(
  state: GameState,
  action: Extract<GameAction, { readonly type: GameActionType.StartWar }>,
  context: ActivationContext,
): ActionResult {
  let result = startPendingWar(state, action, context.timestamp);
  for (const playerId of [result.state.pendingWar?.attackerPlayerId, result.state.pendingWar?.defenderPlayerId]) {
    const war = result.state.pendingWar;
    if (playerId === undefined || war?.stage !== "AWAITING_COMBAT_CHOICES" || Object.hasOwn(war.spadeChoices, playerId)) continue;
    const opponentTerritoryId = playerId === war.attackerPlayerId ? war.defenderTerritoryId : war.attackerTerritoryId;
    if (getAvailableWarSpades(result.state, playerId, opponentTerritoryId).length > 0) continue;
    const locked = setWarSpadeChoice(result.state, {
      type: GameActionType.SetWarSpadeChoice,
      warId: war.id,
      playerId,
      spadeActivationId: null,
    }, context.randomSource, context.timestamp);
    result = { state: locked.state, events: [...result.events, ...locked.events] };
  }
  return result;
}

export function activateTerritory(
  state: GameState,
  action: ActivateTerritoryAction,
  context: ActivationContext,
): ActionResult {
  if (state.phase !== GamePhase.ActivationPhase || state.activation === undefined) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  if (state.pendingDiamondBorderChanges.length > 0) throw new DomainError(DomainErrorCode.InvalidPhase);
  if (state.activePlayerId !== action.playerId) {
    throw new DomainError(DomainErrorCode.NotActivePlayer);
  }

  const territory = state.territories.find((candidate) => candidate.id === action.territoryId);
  if (territory === undefined) {
    throw new DomainError(DomainErrorCode.TerritoryNotFound);
  }
  if (territory.ownerId !== action.playerId) {
    throw new DomainError(DomainErrorCode.TerritoryNotOwned);
  }
  const activatedTerritoryIds = state.activation.activatedTerritoryIdsThisRound ?? state.activation.resolvedTerritoryIds;
  if (activatedTerritoryIds.includes(action.territoryId)) {
    throw new DomainError(DomainErrorCode.TerritoryAlreadyActivated);
  }
  if (!state.activation.pendingTerritoryIds.includes(action.territoryId) || territory.card === undefined) {
    throw new DomainError(DomainErrorCode.TerritoryNotActivated);
  }
  const rolledNumbers = new Set(state.activation.currentActivationNumber === undefined
    ? state.activationNumbers
    : [state.activation.currentActivationNumber]);
  if (!rolledNumbers.has(territory.card.activationNumber) &&
      (territory.card.additionalActivationNumber === undefined ||
        !rolledNumbers.has(territory.card.additionalActivationNumber))) {
    throw new DomainError(DomainErrorCode.TerritoryNotActivated);
  }

  const { suit, additionalSuit } = territory.card;
  if (additionalSuit !== undefined && action.selectedSuit === undefined) {
    throw new DomainError(DomainErrorCode.InvalidSuitSelection);
  }
  const selectedSuit = action.selectedSuit ?? suit;
  if (selectedSuit !== suit && selectedSuit !== additionalSuit) {
    throw new DomainError(DomainErrorCode.InvalidSuitSelection);
  }

  const effectId = `${state.gameId}:event:${state.events.length + 2}`;
  const effect = applySymbolAbility(state, action, selectedSuit, {
    randomSource: context.randomSource,
    ...(context.cardSource === undefined ? {} : { cardSource: context.cardSource }),
    effectId,
  });
  if (action.choice.type === "DIAMOND_NEUTRAL_BORDER") {
    const descriptions: EventDescription[] = [
      { type: GameEventType.TerritoryActivationStarted, actorId: action.playerId,
        payload: { playerId: action.playerId, territoryId: action.territoryId, selectedSuit } },
      effect.event,
    ];
    const events = createEvents(state, context.timestamp, descriptions);
    return { state: { ...effect.state, events: [...state.events, ...events] }, events };
  }
  const pendingTerritoryIds = state.activation.pendingTerritoryIds.filter((id) => id !== action.territoryId);
  const resolvedTerritoryIds = [...state.activation.resolvedTerritoryIds, action.territoryId];
  const nextActivePlayerId = effect.state.territories.some((candidate) =>
    candidate.ownerId === action.playerId && pendingTerritoryIds.includes(candidate.id))
    ? action.playerId
    : getNextActivationResolverPlayer(effect.state, pendingTerritoryIds, action.playerId) ?? state.startPlayerId;
  const descriptions: EventDescription[] = [
    {
      type: GameEventType.TerritoryActivationStarted,
      actorId: action.playerId,
      payload: { playerId: action.playerId, territoryId: action.territoryId, selectedSuit },
    },
    effect.event,
    {
      type: GameEventType.TerritoryActivated,
      actorId: action.playerId,
      payload: { playerId: action.playerId, territoryId: action.territoryId, selectedSuit },
    },
  ];
  const newEvents = createEvents(state, context.timestamp, descriptions);
  const nextState: GameState = {
    ...effect.state,
    phase: GamePhase.ActivationPhase,
    activation: { ...state.activation, pendingTerritoryIds, resolvedTerritoryIds,
      activatedTerritoryIdsThisRound: [...activatedTerritoryIds, action.territoryId] },
    activePlayerId: nextActivePlayerId,
    events: [...state.events, ...newEvents],
  };
  if (pendingTerritoryIds.length === 0) {
    const completed = completeActivationStep(nextState, context.timestamp);
    return { state: completed.state, events: [...newEvents, ...completed.events] };
  }
  return { state: nextState, events: newEvents };
}

export function resolveNeutralDiamond(
  state: GameState, action: ResolveNeutralDiamondAction, timestamp: string,
): ActionResult {
  const effect = state.pendingDiamondBorderChanges[0];
  if (state.phase !== GamePhase.ActivationPhase || state.activation === undefined || effect === undefined ||
      effect.id !== action.effectId || effect.playerId !== action.playerId || state.map === undefined) {
    throw new DomainError(DomainErrorCode.InvalidDiamondNeutralChange);
  }
  const source = state.territories.find((territory) => territory.id === effect.sourceTerritoryId);
  const target = state.territories.find((territory) => territory.id === effect.neutralTerritoryId);
  if (source?.ownerId !== action.playerId || target?.ownerId !== null) {
    throw new DomainError(DomainErrorCode.InvalidDiamondNeutralChange);
  }
  const border = getSharedBorder(state.map, source.id, target.id);
  const validation = validateBorderAdvance(state.map, source.id, target.id, border, getNeutralDiamondDepth(state.map), action.claimedCells);
  if (!validation.valid || validation.map === undefined) {
    throw new DomainError(DomainErrorCode.InvalidDiamondNeutralChange, validation.reason);
  }
  const pendingTerritoryIds = state.activation.pendingTerritoryIds.filter((id) => id !== source.id);
  const resolvedTerritoryIds = [...state.activation.resolvedTerritoryIds, source.id];
  const activatedTerritoryIds = state.activation.activatedTerritoryIdsThisRound ?? state.activation.resolvedTerritoryIds;
  const base = reconcileMapBoundFeatures({ ...state, map: validation.map,
    pendingDiamondBorderChanges: state.pendingDiamondBorderChanges.filter((item) => item.id !== effect.id),
  });
  const nextActivePlayerId = base.territories.some((candidate) =>
    candidate.ownerId === action.playerId && pendingTerritoryIds.includes(candidate.id))
    ? action.playerId
    : getNextActivationResolverPlayer(base, pendingTerritoryIds, action.playerId) ?? state.startPlayerId;
  const descriptions: EventDescription[] = [
    { type: GameEventType.DiamondNeutralBorderChanged, actorId: action.playerId,
      payload: { effectId: effect.id, sourceTerritoryId: source.id, neutralTerritoryId: target.id,
        directTransferCells: validation.directTransferCells ?? action.claimedCells,
        annexedDisconnectedCells: validation.annexedDisconnectedCells ?? [],
        claimedCells: action.claimedCells } },
    { type: GameEventType.TerritoryActivated, actorId: action.playerId,
      payload: { playerId: action.playerId, territoryId: source.id, selectedSuit: effect.selectedSuit } },
  ];
  const events = createEvents(state, timestamp, descriptions);
  const nextState: GameState = { ...base, activation: { ...state.activation, pendingTerritoryIds, resolvedTerritoryIds,
      activatedTerritoryIdsThisRound: [...activatedTerritoryIds, source.id] },
    activePlayerId: nextActivePlayerId, events: [...state.events, ...events] };
  if (pendingTerritoryIds.length === 0) {
    const completed = completeActivationStep(nextState, timestamp);
    return { state: completed.state, events: [...events, ...completed.events] };
  }
  return { state: nextState, events };
}

/** Routes game actions through the headless domain workflows. */
export function applyAction(
  state: GameState,
  action: GameAction,
  context: ActivationContext,
): ActionResult {
  if (state.phase === GamePhase.Finished) {
    throw new DomainError(DomainErrorCode.GameAlreadyFinished);
  }
  switch (action.type) {
    case GameActionType.BeginMapCreation:
      return beginMapCreation(state, action, context.timestamp);
    case GameActionType.CommitSetupBoundaryDraft: {
      const committed = commitSetupBoundaryDraft(state, action, context.timestamp);
      if (committed.state.mapCreation?.stage !== MapCreationStage.ReadyToFinalize ||
          getSetupMapValidationIssues(committed.state).length > 0) return committed;
      const finalized = finalizeMapCreation(committed.state, {
        type: GameActionType.FinalizeMapCreation,
        playerId: action.playerId,
      }, context.randomSource, context.timestamp);
      const started = beginStartAuctions(finalized.state, finalized.state.lastSetupPlayerId,
        context.randomSource, context.timestamp);
      return { state: started.state, events: [...committed.events, ...finalized.events, ...started.events] };
    }
    case GameActionType.CorrectSetupBorders:
      return correctSetupBorders(state, action, context.timestamp);
    case GameActionType.PlaceSetupPointOfInterest:
      return placeSetupPointOfInterest(state, action, context.timestamp);
    case GameActionType.FinalizeMapCreation: {
      const finalized = finalizeMapCreation(state, action, context.randomSource, context.timestamp);
      const started = beginStartAuctions(finalized.state, finalized.state.lastSetupPlayerId,
        context.randomSource, context.timestamp);
      return { state: started.state, events: [...finalized.events, ...started.events] };
    }
    case GameActionType.ActivateTerritory:
      return activateTerritory(state, action, context);
    case GameActionType.RollNextActivationNumber:
      return rollNextActivationNumber(state, action, context.randomSource, context.timestamp);
    case GameActionType.BeginStartAuctions:
      return beginStartAuctions(state, action.lastSetupPlayerId, context.randomSource, context.timestamp);
    case GameActionType.OpenNextStartAuction:
      return openNextStartAuction(state, context.timestamp);
    case GameActionType.OpenAuction:
      return openNormalAuction(state, action, context.timestamp);
    case GameActionType.SubmitAuctionBid: {
      if (state.auction?.kind === "START") {
        return submitStartAuctionBid(state, action, context.randomSource, context.timestamp);
      }
      const submitted = submitNormalAuctionBid(state, action, context.timestamp);
      if (submitted.state.auction !== undefined || submitted.state.pendingSplit !== undefined ||
          submitted.state.actionPhase?.secondAuctionAvailable) {
        return submitted;
      }
      const completed = finishCurrentBasicAction(submitted.state, context.timestamp);
      return { state: completed.state, events: [...submitted.events, ...completed.events] };
    }
    case GameActionType.ResolveTerritorySplit: {
      const resolved = resolveTerritorySplit(state, action, context.randomSource, context.timestamp);
      if (state.pendingSplit?.auctionKind !== "NORMAL") {
        return resolved;
      }
      const completed = finishCurrentBasicAction(resolved.state, context.timestamp);
      return { state: completed.state, events: [...resolved.events, ...completed.events] };
    }
    case GameActionType.ProposeTerritorySplit:
      return proposeTerritorySplit(state, action, context.timestamp);
    case GameActionType.ChooseSplitPart: {
      const chosen = chooseSplitPart(state, action, context.randomSource, context.timestamp, context.cardSource);
      if (chosen.state.pendingSplit !== undefined || state.pendingSplit?.auctionKind !== "NORMAL") return chosen;
      const completed = finishCurrentBasicAction(chosen.state, context.timestamp);
      return { state: completed.state, events: [...chosen.events, ...completed.events] };
    }
    case GameActionType.EndActionTurn:
      if (state.activePlayerId !== action.playerId) {
        throw new DomainError(DomainErrorCode.NotActivePlayer);
      }
      if (!state.actionPhase?.secondAuctionAvailable) {
        throw new DomainError(DomainErrorCode.SecondAuctionUnavailable);
      }
      return finishCurrentBasicAction(state, context.timestamp);
    case GameActionType.ForfeitAction:
      if (state.activePlayerId !== action.playerId) {
        throw new DomainError(DomainErrorCode.NotActivePlayer);
      }
      return forfeitCurrentBasicAction(state, context.timestamp);
    case GameActionType.StartWar:
      return startWarWithAutomaticSpadePasses(state, action, context);
    case GameActionType.SetWarSpadeChoice:
      return setWarSpadeChoice(state, action, context.randomSource, context.timestamp);
    case GameActionType.ProposeBorderAdvance:
      return proposeBorderAdvance(state, action, context.timestamp);
    case GameActionType.ProposeWarCut:
      return proposeWarCut(state, action, context.timestamp);
    case GameActionType.ChooseWarCut:
      return chooseWarCut(state, action, context.randomSource, context.timestamp, context.cardSource);
    case GameActionType.ResolveDiamondCorrection:
      return resolveDiamondCorrection(state, action, context.timestamp);
    case GameActionType.ResolveNeutralDiamond:
      return resolveNeutralDiamond(state, action, context.timestamp);
    case GameActionType.ChooseLargestRealm:
      return chooseLargestRealm(state, action, context.timestamp);
    case GameActionType.StartRound:
      return startRound(state, context.randomSource, context.timestamp);
  }
}
