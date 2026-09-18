import type { ActionResult } from "../actions/action-result.js";
import type { ResolveTerritorySplitAction } from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import type { PlayerId } from "../model/ids.js";
import type { Player } from "../model/player.js";
import type { Territory } from "../model/territory.js";
import { Suit, type TerritoryCard } from "../model/territory-card.js";
import { GamePhase } from "../state/game-phase.js";
import type { GameState } from "../state/game-state.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { RandomSource } from "../utils/random-source.js";
import type { NormalAuctionBid, PendingTerritorySplit } from "./auction-state.js";
import { completeStartAuctionAfterSplit } from "./start-auctions.js";

const BASIC_BIDS = [1, 2, 3] as const;

function invalid(): never {
  throw new DomainError(DomainErrorCode.InvalidSplitResolution);
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
    if (!sameCard(card, original.card)) invalid();
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
  action: Extract<ResolveTerritorySplitAction, { resolution: "LEGAL_SPLIT" }>,
  original: Territory,
): void {
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

/** Resolves a two-way tie from externally supplied, already validated map parts. */
export function resolveTerritorySplit(
  state: GameState,
  action: ResolveTerritorySplitAction,
  random: RandomSource,
  timestamp: string,
): ActionResult {
  const split = state.pendingSplit;
  if (split === undefined || split.id !== action.splitId) {
    throw new DomainError(DomainErrorCode.PendingSplitRequired);
  }
  if ((split.auctionKind === "START" && state.phase !== GamePhase.StartAuctions) ||
      (split.auctionKind === "NORMAL" && state.phase !== GamePhase.ActionPhase)) {
    throw new DomainError(DomainErrorCode.InvalidPhase);
  }
  const original = state.territories.find((territory) => territory.id === split.originalTerritoryId);
  if (original === undefined || original.ownerId !== null) {
    invalid();
  }
  if (action.resolution === "SPLIT_NOT_POSSIBLE") {
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
