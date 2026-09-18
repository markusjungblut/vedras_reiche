import type { ActionResult } from "../actions/action-result.js";
import type {
  ChooseSplitPartAction,
  ProposeTerritorySplitAction,
  ResolveTerritorySplitAction,
} from "../actions/game-action.js";
import { GameActionType } from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import type { PlayerId, TerritoryId } from "../model/ids.js";
import type { Player } from "../model/player.js";
import type { Territory } from "../model/territory.js";
import { Suit, type TerritoryCard } from "../model/territory-card.js";
import type { GridCell, TerritorySplitValidation } from "../map/grid-map.js";
import { getMinimumTerritoryArea } from "../rules/territory-size.js";
import { applyTerritorySplitToMap, getTerritoryCells, validateTerritorySplit } from "../map/grid-map.js";
import { GamePhase } from "../state/game-phase.js";
import type { GameState } from "../state/game-state.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { RandomSource } from "../utils/random-source.js";
import type { CardSource } from "../utils/card-source.js";
import type { NormalAuctionBid, PendingTerritorySplit } from "./auction-state.js";
import { completeStartAuctionAfterSplit } from "./start-auctions.js";

const BASIC_BIDS = [1, 2, 3] as const;

interface InternalLegalSplitResolution {
  readonly type: GameActionType.ResolveTerritorySplit;
  readonly splitId: string;
  readonly resolution: "LEGAL_SPLIT";
  readonly originalCardPart: Territory;
  readonly newCardPart: Territory;
  readonly dividerPlayerId: PlayerId;
  readonly firstChooserPlayerId: PlayerId;
}

type InternalSplitResolution = ResolveTerritorySplitAction | InternalLegalSplitResolution;

function invalid(): never {
  throw new DomainError(DomainErrorCode.InvalidSplitResolution);
}

function assertSplitPhase(state: GameState, split: PendingTerritorySplit): void {
  if ((split.auctionKind === "START" && state.phase !== GamePhase.StartAuctions) ||
      (split.auctionKind === "NORMAL" && state.phase !== GamePhase.ActionPhase)) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
}

function splitRoles(split: PendingTerritorySplit): {
  readonly dividerPlayerId: PlayerId;
  readonly firstChooserPlayerId: PlayerId;
} {
  return { dividerPlayerId: split.dividerPlayerId, firstChooserPlayerId: split.firstChooserPlayerId };
}

function splitValidation(state: GameState, split: PendingTerritorySplit, cells: readonly GridCell[]): TerritorySplitValidation {
  if (state.map === undefined) invalid();
  const minimum = getMinimumTerritoryArea(state.map.format);
  return validateTerritorySplit(state.map, split.originalTerritoryId, cells, minimum);
}

function sameCard(left: TerritoryCard | undefined, right: TerritoryCard | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.suit === right.suit &&
    left.activationNumber === right.activationNumber &&
    left.additionalSuit === right.additionalSuit &&
    left.additionalActivationNumber === right.additionalActivationNumber;
}

function printedCardKey(card: TerritoryCard): string {
  return `${card.suit}:${card.activationNumber}`;
}

function validateNewCard(state: GameState, original: Territory, newPart: Territory): void {
  const card = newPart.card;
  if (card === undefined || !Object.values(Suit).includes(card.suit) ||
      !Number.isInteger(card.activationNumber) ||
      card.activationNumber < 1 || card.activationNumber > 12) {
    invalid();
  }
  const usedCards = state.territories
    .map((territory) => territory.card)
    .filter((item): item is TerritoryCard => item !== undefined);
  const usedPrintedKeys = new Set(usedCards.map(printedCardKey));
  if (usedPrintedKeys.size === 48) {
    if (printedCardKey(card) !== printedCardKey(original.card!) ||
        card.additionalActivationNumber !== undefined || card.additionalSuit !== undefined) invalid();
  } else if (usedPrintedKeys.has(printedCardKey(card)) ||
      card.additionalActivationNumber !== undefined ||
      card.additionalSuit !== undefined) {
    invalid();
  }
}

function appendEvents(
  state: GameState,
  timestamp: string,
  nextState: GameState,
  descriptions: readonly EventDescription[],
): ActionResult {
  const events = createEvents(state, timestamp, descriptions);
  return { state: { ...nextState, events: [...state.events, ...events] }, events };
}

function validateParts(
  state: GameState,
  split: PendingTerritorySplit,
  action: InternalLegalSplitResolution,
  original: Territory,
): void {
  if (state.map !== undefined && split.proposal === undefined) invalid();
  const { originalCardPart, newCardPart } = action;
  if (originalCardPart.id !== original.id ||
      newCardPart.id === original.id ||
      state.territories.some((territory) => territory.id === newCardPart.id) ||
      originalCardPart.ownerId === null || newCardPart.ownerId === null ||
      originalCardPart.ownerId === newCardPart.ownerId ||
      !split.tiedPlayerIds.includes(originalCardPart.ownerId) ||
      !split.tiedPlayerIds.includes(newCardPart.ownerId) ||
      action.dividerPlayerId === action.firstChooserPlayerId ||
      !split.tiedPlayerIds.includes(action.dividerPlayerId) ||
      !split.tiedPlayerIds.includes(action.firstChooserPlayerId)) {
    invalid();
  }
  // The original territory is the card-bearing part. The map resolver supplies
  // both parts and is responsible for legal areas, borders, and POI placement.
  if (original.card === undefined || originalCardPart.card === undefined ||
      !sameCard(originalCardPart.card, original.card)) {
    invalid();
  }
  validateNewCard(state, original, newCardPart);
  if (split.dividerPlayerId !== undefined && split.dividerPlayerId !== action.dividerPlayerId) {
    invalid();
  }
  if (split.firstChooserPlayerId !== undefined &&
      split.firstChooserPlayerId !== action.firstChooserPlayerId) {
    invalid();
  }
}

function validatedNormalBids(
  state: GameState,
  split: PendingTerritorySplit,
  original: Territory,
): Readonly<Record<PlayerId, NormalAuctionBid>> {
  const bids: Record<PlayerId, NormalAuctionBid> = {};
  for (const id of split.tiedPlayerIds) {
    const bid = split.bids[id];
    const player = state.players.find((item) => item.id === id);
    if (bid?.kind !== "NORMAL" || player === undefined ||
        !BASIC_BIDS.includes(bid.basicBid) ||
        !player.availableBasicBids?.includes(bid.basicBid) ||
        player.globalInfluence === undefined ||
        !Number.isSafeInteger(bid.globalInfluence) || bid.globalInfluence < 0 ||
        bid.globalInfluence > player.globalInfluence ||
        !Number.isSafeInteger(bid.localInfluence) || bid.localInfluence < 0 ||
        bid.localInfluence > (original.localInfluenceByPlayerId?.[id] ?? 0)) {
      invalid();
    }
    bids[id] = bid;
  }
  return bids;
}

function payWinningBid(
  player: Player,
  bid: NormalAuctionBid,
): { player: Player; refreshed: boolean } {
  const remaining = player.availableBasicBids!.filter((value) => value !== bid.basicBid);
  const refreshed = remaining.length === 0;
  return {
    player: {
      ...player,
      globalInfluence: player.globalInfluence! - bid.globalInfluence,
      availableBasicBids: refreshed ? [...BASIC_BIDS] : remaining,
    },
    refreshed,
  };
}

/** Shared bookkeeping; legal parts are only supplied by the internal chooser workflow. */
function resolveTerritorySplitInternal(
  state: GameState,
  action: InternalSplitResolution,
  random: RandomSource,
  timestamp: string,
  internallyValidated = false,
): ActionResult {
  const split = state.pendingSplit;
  if (split === undefined || split.id !== action.splitId) {
    throw new DomainError(DomainErrorCode.PendingSplitRequired);
  }
  assertSplitPhase(state, split);
  const original = state.territories.find((territory) => territory.id === split.originalTerritoryId);
  if (original === undefined || original.ownerId !== null) {
    invalid();
  }
  if (action.resolution === "SPLIT_NOT_POSSIBLE") {
    if (state.map === undefined) invalid();
    const minimum = getMinimumTerritoryArea(state.map.format);
    const area = getTerritoryCells(state.map, split.originalTerritoryId).length;
    if (area >= 2 * minimum) {
      throw new DomainError(DomainErrorCode.InvalidSplitResolution,
        "A split cannot be declared impossible solely from a non-minimal map area.");
    }
    const resolved = appendEvents(state, timestamp, state, [{
      type: GameEventType.TerritorySplitResolved,
      payload: { splitId: split.id, auctionId: split.auctionId, resolution: "SPLIT_NOT_POSSIBLE" },
    }]);
    if (split.auctionKind === "START") {
      const finished = completeStartAuctionAfterSplit(resolved.state, [], random, timestamp);
      return { state: finished.state, events: [...resolved.events, ...finished.events] };
    }
    return {
      state: { ...resolved.state, pendingSplit: undefined },
      events: resolved.events,
    };
  }

  if (!internallyValidated || state.map === undefined) invalid();
  validateParts(state, split, action, original);
  const clearedInfluence = original.localInfluenceByPlayerId ?? {};
  const originalPart = { ...action.originalCardPart, localInfluenceByPlayerId: {} };
  const newPart = { ...action.newCardPart, localInfluenceByPlayerId: {} };
  const territories = [
    ...state.territories.map((territory) => territory.id === original.id ? originalPart : territory),
    newPart,
  ];
  const descriptions: EventDescription[] = [
    {
      type: GameEventType.TerritorySplitResolved,
      payload: {
        splitId: split.id, auctionId: split.auctionId, resolution: "LEGAL_SPLIT",
        originalCardPartId: originalPart.id, newCardPartId: newPart.id,
        dividerPlayerId: action.dividerPlayerId,
        firstChooserPlayerId: action.firstChooserPlayerId,
      },
    },
    {
      type: GameEventType.TerritoryOwnerChanged,
      actorId: originalPart.ownerId!,
      payload: { territoryId: originalPart.id, previousOwnerId: null, ownerId: originalPart.ownerId },
    },
    {
      type: GameEventType.TerritoryOwnerChanged,
      actorId: newPart.ownerId!,
      payload: { territoryId: newPart.id, previousOwnerId: null, ownerId: newPart.ownerId },
    },
  ];

  if (split.auctionKind === "START") {
    const resolved = appendEvents(state, timestamp, { ...state, territories }, descriptions);
    const finished = completeStartAuctionAfterSplit(
      resolved.state, [...split.tiedPlayerIds], random, timestamp,
    );
    return { state: finished.state, events: [...resolved.events, ...finished.events] };
  }

  const bids = validatedNormalBids(state, split, original);
  const refreshedPlayerIds: PlayerId[] = [];
  const players = state.players.map((player) => {
    if (!split.tiedPlayerIds.includes(player.id)) return player;
    const paid = payWinningBid(player, bids[player.id]!);
    if (paid.refreshed) refreshedPlayerIds.push(player.id);
    return paid.player;
  });
  for (const playerId of split.tiedPlayerIds) {
    const bid = bids[playerId]!;
    descriptions.push(
      { type: GameEventType.BasicBidExhausted, actorId: playerId,
        payload: { auctionId: split.auctionId, playerId, basicBid: bid.basicBid } },
      { type: GameEventType.GlobalInfluenceSpent, actorId: playerId,
        payload: { auctionId: split.auctionId, playerId, amount: bid.globalInfluence } },
      { type: GameEventType.LocalInfluenceSpent, actorId: playerId,
        payload: { auctionId: split.auctionId, territoryId: original.id, playerId, amount: bid.localInfluence } },
    );
    if (refreshedPlayerIds.includes(playerId)) {
      descriptions.push({ type: GameEventType.BasicBidsRefreshed, actorId: playerId,
        payload: { playerId, availableBasicBids: BASIC_BIDS } });
    }
  }
  descriptions.push(
    { type: GameEventType.LocalInfluenceCleared,
      payload: { territoryId: original.id, influenceByPlayerId: clearedInfluence } },
    { type: GameEventType.AuctionResolved,
      payload: { auctionId: split.auctionId, result: "SPLIT_WON", winnerIds: split.tiedPlayerIds } },
  );
  return appendEvents(state, timestamp, {
    ...state,
    territories,
    players,
    pendingSplit: undefined,
  }, descriptions);
}

/** Legal splits are completed exclusively through ChooseSplitPart. */
export function resolveTerritorySplit(
  state: GameState,
  action: ResolveTerritorySplitAction,
  random: RandomSource,
  timestamp: string,
): ActionResult {
  return resolveTerritorySplitInternal(state, action, random, timestamp);
}

/**
 * Records the divider's cell selection. The second part is always derived
 * from the original territory, so the UI cannot drop or invent cells.
 */
export function proposeTerritorySplit(
  state: GameState,
  action: ProposeTerritorySplitAction,
  timestamp: string,
): ActionResult {
  const split = state.pendingSplit;
  if (split === undefined || split.id !== action.splitId || split.stage !== "AWAITING_DIVISION") {
    throw new DomainError(DomainErrorCode.PendingSplitRequired);
  }
  assertSplitPhase(state, split);
  if (action.originalCardPart !== "A" && action.originalCardPart !== "B") invalid();
  if (state.map === undefined) throw new DomainError(DomainErrorCode.InvalidSplitResolution);
  const roles = splitRoles(split);
  if (roles.dividerPlayerId !== action.playerId) throw new DomainError(DomainErrorCode.InvalidSplitResolution);
  const validation = splitValidation(state, split, action.partACells);
  if (!validation.valid) throw new DomainError(DomainErrorCode.InvalidSplitResolution);
  const nextSplit: PendingTerritorySplit = {
    ...split,
    ...roles,
    stage: "AWAITING_CHOICE",
    proposal: {
      partACells: validation.partACells,
      partBCells: validation.partBCells,
      originalCardPart: action.originalCardPart,
    },
  };
  const events = createEvents(state, timestamp, [{
    type: GameEventType.TerritorySplitProposed,
    actorId: action.playerId,
    payload: {
      splitId: split.id,
      auctionId: split.auctionId,
      originalTerritoryId: split.originalTerritoryId,
      partACellCount: validation.partACells.length,
      partBCellCount: validation.partBCells.length,
      originalCardPart: action.originalCardPart,
    },
  }]);
  return { state: { ...state, pendingSplit: nextSplit, events: [...state.events, ...events] }, events };
}

function printedKey(card: TerritoryCard): string {
  return `${card.suit}:${card.activationNumber}`;
}

function drawNewCard(
  state: GameState,
  originalCard: TerritoryCard,
  random: RandomSource,
  cardSource?: CardSource,
): TerritoryCard {
  const used = new Set(state.territories.map((territory) => territory.card)
    .filter((card): card is TerritoryCard => card !== undefined).map(printedKey));
  if (used.size >= 48) return { suit: originalCard.suit, activationNumber: originalCard.activationNumber };
  if (cardSource !== undefined) {
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const candidate = cardSource.drawAndReplace(random);
      if (!used.has(printedKey(candidate))) return candidate;
    }
  }
  for (const suit of Object.values(Suit)) {
    for (let number = 1; number <= 12; number += 1) {
      const candidate = { suit, activationNumber: number } as TerritoryCard;
      if (!used.has(printedKey(candidate))) return candidate;
    }
  }
  return originalCard;
}

function mapAfterProposal(
  state: GameState,
  split: PendingTerritorySplit,
  newTerritoryId: TerritoryId,
): { map: NonNullable<GameState["map"]>; originalCells: readonly GridCell[]; newCells: readonly GridCell[] } {
  if (state.map === undefined || split.proposal === undefined) invalid();
  const { partACells, partBCells, originalCardPart } = split.proposal;
  const originalCells = originalCardPart === "A" ? partACells : partBCells;
  const newCells = originalCardPart === "A" ? partBCells : partACells;
  return {
    map: applyTerritorySplitToMap(state.map, split.originalTerritoryId, newTerritoryId, originalCells),
    originalCells,
    newCells,
  };
}

/** Completes the chooser's half of a proposed, internally validated split. */
export function chooseSplitPart(
  state: GameState,
  action: ChooseSplitPartAction,
  random: RandomSource,
  timestamp: string,
  cardSource?: CardSource,
): ActionResult {
  const split = state.pendingSplit;
  if (split === undefined || split.id !== action.splitId || split.proposal === undefined ||
      split.stage !== "AWAITING_CHOICE") {
    throw new DomainError(DomainErrorCode.PendingSplitRequired);
  }
  assertSplitPhase(state, split);
  if (action.chosenPart !== "A" && action.chosenPart !== "B") invalid();
  const roles = splitRoles(split);
  if (roles.firstChooserPlayerId !== action.playerId) {
    throw new DomainError(DomainErrorCode.InvalidSplitResolution);
  }
  const revalidated = splitValidation(state, split, split.proposal.partACells);
  if (!revalidated.valid ||
      revalidated.partBCells.length !== split.proposal.partBCells.length ||
      revalidated.partBCells.some((cell, index) =>
        cell.x !== split.proposal!.partBCells[index]?.x || cell.y !== split.proposal!.partBCells[index]?.y)) {
    invalid();
  }
  const original = state.territories.find((territory) => territory.id === split.originalTerritoryId);
  if (original === undefined || original.ownerId !== null || original.card === undefined) invalid();
  const newTerritoryId = `${original.id}:split:${state.events.length + 1}`;
  if (state.territories.some((territory) => territory.id === newTerritoryId)) invalid();
  const chooserGetsOriginal = action.chosenPart === split.proposal.originalCardPart;
  const originalOwnerId = chooserGetsOriginal ? roles.firstChooserPlayerId : roles.dividerPlayerId;
  const newOwnerId = chooserGetsOriginal ? roles.dividerPlayerId : roles.firstChooserPlayerId;
  const newCard = drawNewCard(state, original.card, random, cardSource);
  const mapResult = mapAfterProposal(state, split, newTerritoryId);
  const development = original.settlementFeature;
  const developmentOnNewPart = development !== undefined && mapResult.newCells.some((cell) =>
    cell.x === development.position.x && cell.y === development.position.y);
  const originalWithoutMovedDevelopment = developmentOnNewPart
    ? (() => { const { settlement: _settlement, settlementFeature: _feature, ...rest } = original; return rest; })()
    : original;
  const { area: _area, adjacentTerritoryIds: _adjacency, ...originalWithoutCachedGeometry } = originalWithoutMovedDevelopment;
  const originalPart: Territory = {
    ...originalWithoutCachedGeometry,
    ownerId: originalOwnerId,
    localInfluenceByPlayerId: {},
  };
  const newPart: Territory = {
    id: newTerritoryId,
    ownerId: newOwnerId,
    card: newCard,
    localInfluenceByPlayerId: {},
    ...(developmentOnNewPart && development !== undefined
      ? { settlement: development.kind, settlementFeature: development } : {}),
  };
  // Only this internally validated path may supply parts to the shared auction bookkeeping.
  const resolved = resolveTerritorySplitInternal(state, {
    type: GameActionType.ResolveTerritorySplit,
    splitId: split.id,
    resolution: "LEGAL_SPLIT",
    originalCardPart: originalPart,
    newCardPart: newPart,
    dividerPlayerId: roles.dividerPlayerId,
    firstChooserPlayerId: roles.firstChooserPlayerId,
  }, random, timestamp, true);
  const events = createEvents(resolved.state, timestamp, [{
    type: GameEventType.TerritorySplitChoiceMade,
    actorId: action.playerId,
    payload: { splitId: split.id, chosenPart: action.chosenPart, originalCardPart: split.proposal.originalCardPart },
  }, {
    type: GameEventType.MapGeometryChanged,
    payload: { splitId: split.id, originalTerritoryId: split.originalTerritoryId, newTerritoryId },
  }]);
  return {
    state: { ...resolved.state, map: mapResult.map, events: [...resolved.state.events, ...events] },
    events: [...resolved.events, ...events],
  };
}
