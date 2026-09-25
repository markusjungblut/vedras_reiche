import {
  GameEventType,
  Suit,
  getActivatedTerritories,
  type GameEvent,
} from "@vedras/game-core";
import type { GameReadModel } from "../game-read-model";

export type PresentationEvent =
  | ActivationRollReveal
  | TerritoryPulse
  | TerritorySuitConfirmation
  | TerritoryGainWave
  | AuctionResultReveal
  | WarDiceReveal
  | GameFinishedPresentation;

export interface ActivationRollReveal {
  readonly type: "ACTIVATION_ROLL_REVEAL";
  readonly id: string;
  readonly numbers: readonly number[];
  /** Index of the freshly authoritative number; older entries were already visible. */
  readonly revealIndex: number;
  readonly territoryIdsByNumber: Readonly<Record<number, readonly string[]>>;
}

export interface TerritoryPulse {
  readonly type: "ACTIVATION_TERRITORY_PULSE";
  readonly id: string;
  readonly territoryId: string;
  readonly durationMs: number;
  readonly subtle?: boolean;
}

export interface TerritorySuitConfirmation {
  readonly type: "TERRITORY_SUIT_CONFIRM";
  readonly id: string;
  readonly territoryId: string;
  readonly suit: Suit;
}

export type TerritoryGainKind = "START_AUCTION" | "AUCTION" | "SPLIT" | "WAR" | "BORDER";

export interface TerritoryGainWave {
  readonly type: "TERRITORY_GAIN_WAVE";
  readonly id: string;
  readonly territoryId?: string;
  readonly cellKeys: readonly string[];
  readonly previousOwnerIdByCell: Readonly<Record<string, string | null>>;
  readonly ownerId: string | null;
  readonly kind: TerritoryGainKind;
  readonly delayMs: number;
}

export interface AuctionBidReveal {
  readonly playerId: string;
  readonly value: number;
}

export interface AuctionResultReveal {
  readonly type: "AUCTION_RESULT_REVEAL";
  readonly id: string;
  readonly territoryId?: string;
  readonly bids: readonly AuctionBidReveal[];
  readonly result: "WON" | "SPLIT" | "NEUTRAL" | "RESOLVED";
  readonly winnerId?: string;
}

export interface WarDiceReveal {
  readonly type: "WAR_DICE_REVEAL";
  readonly id: string;
  readonly attackerRoll: number;
  readonly defenderRoll: number;
  readonly attackerSpadeBonus: number;
  readonly defenderSpadeBonus: number;
  readonly defenderFortressBonus: number;
  readonly attackerTotal: number;
  readonly defenderTotal: number;
  readonly outcome: "TIE" | "BORDER_ADVANCE" | "STRONG_ADVANCE" | "CONQUEST" | "CUT_AND_CHOOSE";
}

export interface GameFinishedPresentation {
  readonly type: "GAME_FINISHED";
  readonly id: string;
}

export interface PresentationState {
  readonly activationReveal?: {
    readonly id: string;
    readonly numbers: readonly number[];
    readonly revealedCount: number;
  };
  readonly territoryPulses: readonly TerritoryPulse[];
  readonly suitConfirmations: readonly TerritorySuitConfirmation[];
  readonly gainWaves: readonly TerritoryGainWave[];
  readonly auctionResult?: AuctionResultReveal;
  readonly warDice?: WarDiceReveal & { readonly stage: 1 | 2 | 3 | 4 };
}

export const EMPTY_PRESENTATION_STATE: PresentationState = {
  territoryPulses: [],
  suitConfirmations: [],
  gainWaves: [],
};

function stringField(event: GameEvent, key: string): string | undefined {
  const value = event.payload[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(event: GameEvent, key: string): number | undefined {
  const value = event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function suitField(event: GameEvent, key: string): Suit | undefined {
  const value = event.payload[key];
  return value === Suit.Diamonds || value === Suit.Clubs || value === Suit.Hearts || value === Suit.Spades
    ? value
    : undefined;
}

function cellsFromPayload(event: GameEvent): string[] {
  const keys = new Set<string>();
  for (const field of ["directTransferCells", "annexedDisconnectedCells", "claimedCells"]) {
    const cells = event.payload[field];
    if (!Array.isArray(cells)) continue;
    for (const cell of cells) {
      if (cell === null || typeof cell !== "object") continue;
      const candidate = cell as { x?: unknown; y?: unknown };
      if (typeof candidate.x === "number" && Number.isInteger(candidate.x) &&
          typeof candidate.y === "number" && Number.isInteger(candidate.y)) {
        keys.add(String(candidate.x) + "," + String(candidate.y));
      }
    }
  }
  return [...keys];
}

function ownerForTerritory(state: GameReadModel, territoryId: string | null | undefined): string | null {
  if (territoryId === null || territoryId === undefined) return null;
  return state.territories.find((territory) => territory.id === territoryId)?.ownerId ?? null;
}

function previousOwnersByCell(previous: GameReadModel, cellKeys: readonly string[]): Readonly<Record<string, string | null>> {
  return Object.fromEntries(cellKeys.map((key) => [
    key,
    ownerForTerritory(previous, previous.map?.cells[key]),
  ]));
}

function eventCellsForTerritory(state: GameReadModel, territoryId: string): string[] {
  return Object.entries(state.map?.cells ?? {})
    .flatMap(([key, value]) => value === territoryId ? [key] : []);
}

function isStartAuction(previous: GameReadModel, current: GameReadModel, events: readonly GameEvent[]): boolean {
  const reveal = events.find((event) => event.type === GameEventType.AuctionBidsRevealed);
  const bids = reveal?.payload.bids;
  if (bids !== null && typeof bids === "object" && !Array.isArray(bids)) {
    return Object.values(bids as Readonly<Record<string, unknown>>).some((bid) =>
      bid !== null && typeof bid === "object" && (bid as { kind?: unknown }).kind === "START");
  }
  return previous.phase === "START_AUCTIONS" || current.phase === "START_AUCTIONS" ||
    previous.pendingSplit?.auctionKind === "START";
}

function auctionReveal(event: GameEvent, events: readonly GameEvent[], previous: GameReadModel): AuctionResultReveal {
  const rawBids = event.payload.bids;
  const bids = rawBids !== null && typeof rawBids === "object" && !Array.isArray(rawBids)
    ? Object.entries(rawBids as Readonly<Record<string, unknown>>).flatMap(([playerId, bid]) => {
      if (bid === null || typeof bid !== "object") return [];
      const entry = bid as { kind?: unknown; value?: unknown; basicBid?: unknown; globalInfluence?: unknown; localInfluence?: unknown };
      const value = entry.kind === "START" && typeof entry.value === "number"
        ? entry.value
        : entry.kind === "NORMAL" && typeof entry.basicBid === "number" &&
          typeof entry.globalInfluence === "number" && typeof entry.localInfluence === "number"
          ? entry.basicBid + entry.globalInfluence + entry.localInfluence
          : undefined;
      return value === undefined ? [] : [{ playerId, value }];
    })
    : [];
  const won = events.find((candidate) => candidate.type === GameEventType.AuctionWon);
  const split = events.some((candidate) =>
    candidate.type === GameEventType.AuctionTiedTwoPlayers || candidate.type === GameEventType.TerritorySplitRequired);
  const neutral = events.some((candidate) => candidate.type === GameEventType.AuctionTiedMultiplePlayers) ||
    events.some((candidate) => candidate.type === GameEventType.AuctionResolved && candidate.payload.result !== "WON");
  const territoryId = stringField(event, "territoryId") ?? previous.auction?.territoryId;
  const winnerId = won === undefined ? undefined : stringField(won, "winnerId") ?? stringField(won, "playerId");
  return {
    type: "AUCTION_RESULT_REVEAL",
    id: event.id,
    ...(territoryId === undefined ? {} : { territoryId }),
    bids,
    result: won ? "WON" : split ? "SPLIT" : neutral ? "NEUTRAL" : "RESOLVED",
    ...(winnerId === undefined ? {} : { winnerId }),
  };
}

function warDiceReveal(event: GameEvent): WarDiceReveal | undefined {
  const attackerRoll = numberField(event, "attackerRoll");
  const defenderRoll = numberField(event, "defenderRoll");
  const attackerSpadeBonus = numberField(event, "attackerSpadeBonus");
  const defenderSpadeBonus = numberField(event, "defenderSpadeBonus");
  const defenderFortressBonus = numberField(event, "defenderFortressBonus");
  const attackerTotal = numberField(event, "attackerTotal");
  const defenderTotal = numberField(event, "defenderTotal");
  const outcome = event.payload.outcome;
  if (attackerRoll === undefined || defenderRoll === undefined || attackerSpadeBonus === undefined ||
      defenderSpadeBonus === undefined || defenderFortressBonus === undefined || attackerTotal === undefined ||
      defenderTotal === undefined ||
      (outcome !== "TIE" && outcome !== "BORDER_ADVANCE" && outcome !== "STRONG_ADVANCE" &&
        outcome !== "CONQUEST" && outcome !== "CUT_AND_CHOOSE")) {
    return undefined;
  }
  return {
    type: "WAR_DICE_REVEAL",
    id: event.id,
    attackerRoll,
    defenderRoll,
    attackerSpadeBonus,
    defenderSpadeBonus,
    defenderFortressBonus,
    attackerTotal,
    defenderTotal,
    outcome,
  };
}

/**
 * Translates only new authoritative events. Callers baseline a freshly mounted
 * or reconnected view, so this function never needs to replay event history.
 */
export function derivePresentationEvents(
  previous: GameReadModel,
  current: GameReadModel,
  events: readonly GameEvent[],
): readonly PresentationEvent[] {
  const result: PresentationEvent[] = [];
  const startAuction = isStartAuction(previous, current, events);
  const combatOccurred = events.some((event) => event.type === GameEventType.CombatRolled);
  const auction = events.find((event) => event.type === GameEventType.AuctionBidsRevealed);
  if (auction !== undefined) result.push(auctionReveal(auction, events, previous));

  for (const event of events) {
    if (event.type === GameEventType.ActivationNumbersRolled) {
      const values = event.payload.activationNumbers;
      if (!Array.isArray(values) || values.length === 0 || !values.every((value) => typeof value === "number")) continue;
      const numbers = values as readonly number[];
      const territoryIdsByNumber = Object.fromEntries(numbers.map((number) => [
        number,
        getActivatedTerritories(current, [number]),
      ]));
      result.push({ type: "ACTIVATION_ROLL_REVEAL", id: event.id, numbers, revealIndex: 0, territoryIdsByNumber });
      continue;
    }
    if (event.type === GameEventType.ActivationNumberRolled) {
      const number = event.payload.activationNumber;
      const index = event.payload.index;
      const values = event.payload.activationNumbers;
      if (typeof number !== "number" || typeof index !== "number") continue;
      const numbers = Array.isArray(values) && values.every((value) => typeof value === "number")
        ? values as readonly number[] : [number];
      const pending = Array.isArray(event.payload.pendingTerritoryIds)
        ? event.payload.pendingTerritoryIds.filter((value): value is string => typeof value === "string") : [];
      result.push({ type: "ACTIVATION_ROLL_REVEAL", id: event.id, numbers, revealIndex: index,
        territoryIdsByNumber: { [number]: pending } });
      continue;
    }
    if (event.type === GameEventType.TerritoryActivated) {
      const territoryId = stringField(event, "territoryId");
      const suit = suitField(event, "selectedSuit");
      if (territoryId !== undefined && suit !== undefined) {
        result.push({ type: "TERRITORY_SUIT_CONFIRM", id: event.id, territoryId, suit });
        result.push({ type: "ACTIVATION_TERRITORY_PULSE", id: event.id + ":confirm", territoryId, durationMs: 440, subtle: true });
      }
      continue;
    }
    if (event.type === GameEventType.CombatRolled) {
      const reveal = warDiceReveal(event);
      if (reveal !== undefined) result.push(reveal);
      continue;
    }
    if (event.type === GameEventType.GameFinished) {
      result.push({ type: "GAME_FINISHED", id: event.id });
      continue;
    }
    if (event.type === GameEventType.TerritoryOwnerChanged) {
      const territoryId = stringField(event, "territoryId");
      const ownerId = stringField(event, "ownerId") ?? null;
      if (territoryId === undefined) continue;
      const cellKeys = eventCellsForTerritory(current, territoryId);
      if (cellKeys.length === 0) continue;
      const isWar = events.some((candidate) =>
        candidate.type === GameEventType.TerritoryConquered || candidate.type === GameEventType.CombatRolled);
      result.push({
        type: "TERRITORY_GAIN_WAVE",
        id: event.id,
        territoryId,
        cellKeys,
        previousOwnerIdByCell: previousOwnersByCell(previous, cellKeys),
        ownerId,
        kind: startAuction ? "START_AUCTION" : isWar ? "WAR" : events.some((candidate) =>
          candidate.type === GameEventType.TerritorySplitResolved) ? "SPLIT" : "AUCTION",
        delayMs: combatOccurred ? 900 : 0,
      });
      continue;
    }
    if (event.type === GameEventType.BorderAdvanceResolved ||
        event.type === GameEventType.DiamondCutCorrectionResolved ||
        event.type === GameEventType.DiamondNeutralBorderChanged ||
        event.type === GameEventType.MapGeometryChanged) {
      const cellKeys = cellsFromPayload(event);
      if (cellKeys.length === 0) continue;
      const territoryId = cellKeys.map((key) => current.map?.cells[key]).find((id): id is string => typeof id === "string");
      result.push({
        type: "TERRITORY_GAIN_WAVE",
        id: event.id,
        ...(territoryId === undefined ? {} : { territoryId }),
        cellKeys,
        previousOwnerIdByCell: previousOwnersByCell(previous, cellKeys),
        ownerId: territoryId === undefined ? null : ownerForTerritory(current, territoryId),
        kind: event.type === GameEventType.MapGeometryChanged ? "SPLIT" : "BORDER",
        delayMs: combatOccurred ? 900 : 0,
      });
    }
  }
  return result;
}
