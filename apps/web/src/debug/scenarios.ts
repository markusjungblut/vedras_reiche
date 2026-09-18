import {
  applyAction,
  createGameState,
  GameActionType,
  GamePhase,
  startRound,
  Suit,
} from "@vedras/game-core";
import type { ActivationChoice, GameAction, GameState, Territory } from "@vedras/game-core";
import { createDemoMap } from "./create-demo-map.js";
import { DemoCardSource } from "./demo-card-source.js";
import { SeededRandomSource } from "./seeded-random-source.js";

export type ScenarioKind = "START_AUCTIONS" | "ACTIVATION_PHASE" | "ACTION_PHASE" | "NORMAL_AUCTION";

export interface DemoScenario {
  readonly state: GameState;
  readonly randomSource: SeededRandomSource;
  readonly cardSource: DemoCardSource;
}

const TIMESTAMP = "2026-09-18T12:00:00.000Z";
const PLAYER_IDS = ["anna", "ben", "clara"] as const;

/** The only hand-authored GameState is the undrawn neutral debug map. */
export function createDemoGame(seed = 12_345): GameState {
  return {
    ...createGameState({
      gameId: `vedras-demo-${seed}`,
      players: [
        { id: "anna", name: "Anna" },
        { id: "ben", name: "Ben" },
        { id: "clara", name: "Clara" },
      ],
      startPlayerId: "anna",
    }),
    territories: createDemoMap(),
  };
}

function dispatch(state: GameState, action: GameAction, randomSource: SeededRandomSource, cardSource: DemoCardSource): GameState {
  return applyAction(state, action, { randomSource, cardSource, timestamp: TIMESTAMP }).state;
}

function beginAuctions(seed: number): DemoScenario {
  const randomSource = new SeededRandomSource(seed);
  const cardSource = new DemoCardSource();
  let state = createDemoGame(seed);
  state = dispatch(state, { type: GameActionType.BeginStartAuctions, lastSetupPlayerId: "clara" }, randomSource, cardSource);
  state = dispatch(state, { type: GameActionType.OpenNextStartAuction }, randomSource, cardSource);
  return { state, randomSource, cardSource };
}

/** Each scripted auction has one clear winner. The core consumes every bid and rotates roles. */
function completeStartAuctions(scenario: DemoScenario): DemoScenario {
  let { state } = scenario;
  const { randomSource, cardSource } = scenario;
  let steps = 0;
  while (state.phase === GamePhase.StartAuctions) {
    if (++steps > 12) throw new Error("Der Startauktions-Debuglauf kam nicht zum Abschluss.");
    if (state.auction === undefined) {
      state = dispatch(state, { type: GameActionType.OpenNextStartAuction }, randomSource, cardSource);
    }
    const auction = state.auction;
    const start = state.startAuctions;
    if (auction === undefined || start === undefined) throw new Error("Startauktion ohne Zustand.");
    const winner = PLAYER_IDS.find((id) => !start.awardedPlayerIds.includes(id));
    if (winner === undefined || !auction.eligiblePlayerIds.includes(winner)) throw new Error("Kein Startauktions-Gewinner verfügbar.");
    for (const playerId of auction.eligiblePlayerIds) {
      const available = state.startAuctions?.availableBidsByPlayerId[playerId];
      const value = playerId === winner ? 3 : available?.find((bid) => bid < 3);
      if (value === undefined) throw new Error("Kein skriptbares Startgebot verfügbar.");
      state = dispatch(state, {
        type: GameActionType.SubmitAuctionBid,
        playerId,
        auctionId: auction.id,
        bid: { kind: "START", value },
      }, randomSource, cardSource);
    }
    if (state.pendingSplit !== undefined) throw new Error("Das Debug-Skript erzeugte unerwartet eine Teilung.");
  }
  if (state.phase !== GamePhase.RoundReady) throw new Error("Die Startauktionen wurden nicht abgeschlossen.");
  return { state, randomSource, cardSource };
}

function ownedSuits(state: GameState): Set<Suit> {
  return new Set(state.territories.filter((territory) => territory.ownerId !== null)
    .map((territory) => territory.card?.suit)
    .filter((suit): suit is Suit => suit !== undefined));
}

function activationSuits(state: GameState): Set<Suit> {
  const pending = new Set(state.activation?.pendingTerritoryIds ?? []);
  return new Set(state.territories.filter((territory) => pending.has(territory.id))
    .map((territory) => territory.card?.suit)
    .filter((suit): suit is Suit => suit !== undefined));
}

/** A scenario may choose a deterministic round stream that exposes both ♥ and ♣. */
function beginDemonstrationRound(scenario: DemoScenario, seed: number): DemoScenario {
  const suits = ownedSuits(scenario.state);
  const seekHeartAndClub = suits.has(Suit.Hearts) && suits.has(Suit.Clubs);
  let fallback: DemoScenario | undefined;
  for (let attempt = 0; attempt < 1_024; attempt += 1) {
    const randomSource = new SeededRandomSource((seed + Math.imul(attempt, 1_048_583)) >>> 0);
    const state = startRound(scenario.state, randomSource, TIMESTAMP).state;
    const candidate = { state, randomSource, cardSource: scenario.cardSource };
    if (state.phase === GamePhase.ActivationPhase) {
      fallback ??= candidate;
      const activated = activationSuits(state);
      if (!seekHeartAndClub || (activated.has(Suit.Hearts) && activated.has(Suit.Clubs))) return candidate;
    }
  }
  if (fallback !== undefined) return fallback;
  throw new Error("Für diesen Debug-Seed konnte keine Aktivierung erzeugt werden.");
}

function activationChoice(state: GameState, source: Territory): ActivationChoice {
  if (source.card === undefined || source.ownerId === null) throw new Error("Ungültiges Debug-Aktivierungsgebiet.");
  switch (source.card.suit) {
    case Suit.Diamonds: {
      const target = state.territories.find((territory) => source.adjacentTerritoryIds.includes(territory.id) && territory.ownerId === null);
      if (target === undefined) throw new Error("Kein neutrales ♦-Ziel für das Debug-Skript.");
      return { type: "DIAMOND_NEUTRAL_BORDER", targetTerritoryId: target.id };
    }
    case Suit.Clubs:
      return { type: "CLUB_BUILD_SETTLEMENT", targetTerritoryId: source.id };
    case Suit.Hearts:
      return { type: "HEART_GLOBAL_INFLUENCE" };
    case Suit.Spades:
      return { type: "SPADE_STORE" };
  }
}

function completeActivations(scenario: DemoScenario): DemoScenario {
  let { state } = scenario;
  const { randomSource, cardSource } = scenario;
  let steps = 0;
  while (state.phase === GamePhase.ActivationPhase) {
    if (++steps > 16) throw new Error("Der Aktivierungs-Debuglauf kam nicht zum Abschluss.");
    const source = state.territories.find((territory) =>
      territory.ownerId === state.activePlayerId && state.activation?.pendingTerritoryIds.includes(territory.id));
    if (source === undefined || source.ownerId === null) throw new Error("Aktivierung ohne aktiven Spieler.");
    state = dispatch(state, {
      type: GameActionType.ActivateTerritory,
      playerId: source.ownerId,
      territoryId: source.id,
      choice: activationChoice(state, source),
    }, randomSource, cardSource);
  }
  if (state.phase !== GamePhase.ActionPhase) throw new Error("Die Debug-Aktivierung erreichte keine Aktionsphase.");
  return { state, randomSource, cardSource };
}

function openDemonstrationAuction(scenario: DemoScenario): DemoScenario {
  const { state, randomSource, cardSource } = scenario;
  const playerId = state.activePlayerId;
  if (playerId === undefined) throw new Error("Kein aktiver Spieler für die normale Debug-Auktion.");
  const target = state.territories.find((territory) => territory.ownerId === null &&
    state.territories.some((owned) => owned.ownerId === playerId &&
      (owned.adjacentTerritoryIds.includes(territory.id) || territory.adjacentTerritoryIds.includes(owned.id))));
  if (target === undefined) throw new Error("Kein neutrales Ziel für die normale Debug-Auktion.");
  return {
    state: dispatch(state, { type: GameActionType.OpenAuction, playerId, territoryId: target.id }, randomSource, cardSource),
    randomSource,
    cardSource,
  };
}

/** Scenarios are scripted, valid core transitions from one neutral setup fixture. */
export function createScenario(kind: ScenarioKind, seed = 12_345): DemoScenario {
  const start = beginAuctions(seed);
  if (kind === "START_AUCTIONS") return start;
  const auctions = completeStartAuctions(start);
  const activation = beginDemonstrationRound(auctions, seed);
  if (kind === "ACTIVATION_PHASE") return activation;
  const action = completeActivations(activation);
  if (kind === "ACTION_PHASE") return action;
  if (kind === "NORMAL_AUCTION") return openDemonstrationAuction(action);
  throw new Error(`Unbekanntes Debug-Szenario: ${kind satisfies never}`);
}
