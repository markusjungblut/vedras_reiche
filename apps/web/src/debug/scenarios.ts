import {
  applyAction,
  beginScoring,
  createGameState,
  GameActionType,
  GamePhase,
  startRound,
  Suit,
  PointOfInterestType,
  SettlementKind,
  getStateAdjacentTerritoryIds,
  getTerritoryCells,
  getSharedBorder,
  getCellsWithinBorderDepth,
} from "@vedras/game-core";
import type { ActivationChoice, GameAction, GameState, Territory, RandomSource } from "@vedras/game-core";
import { createDemoGridMap, createDemoMap } from "./create-demo-map.js";
import { DemoCardSource } from "./demo-card-source.js";
import { SeededRandomSource } from "./seeded-random-source.js";

export type ScenarioKind = "START_AUCTIONS" | "ACTIVATION_PHASE" | "ACTION_PHASE" | "NORMAL_AUCTION" |
  "WAR_NORMAL" | "WAR_STRONG" | "WAR_TIE" | "WAR_WEAK" | "WAR_CONQUEST" | "WAR_CUT" |
  "WAR_DIAMOND" | "WAR_DIAMOND_CUT" | "WAR_SPADE_FORTRESS" | "DIAMOND_NEUTRAL" | "SCORING";

export interface DemoScenario {
  readonly state: GameState;
  readonly randomSource: RandomSource;
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
    map: createDemoGridMap(),
    pointsOfInterest: [
      { id: "poi-g01", type: PointOfInterestType.Landmark, position: { x: 3, y: 2 } },
      { id: "poi-g06", type: PointOfInterestType.Junction, position: { x: 11, y: 7 } },
      { id: "poi-g12", type: PointOfInterestType.Fortress, position: { x: 19, y: 12 } },
      { id: "poi-g16", type: PointOfInterestType.Relic, position: { x: 27, y: 17 } },
    ],
  };
}

function dispatch(state: GameState, action: GameAction, randomSource: RandomSource, cardSource: DemoCardSource): GameState {
  return applyAction(state, action, { randomSource, cardSource, timestamp: TIMESTAMP }).state;
}

function beginAuctions(seed: number): DemoScenario {
  const randomSource = new SeededRandomSource(seed);
  const cardSource = new DemoCardSource();
  let state = createDemoGame(seed);
  state = dispatch(state, { type: GameActionType.BeginStartAuctions, lastSetupPlayerId: "clara" }, randomSource, cardSource);
  return { state, randomSource, cardSource };
}

/** Each scripted auction has one clear winner. The core consumes every bid and rotates roles. */
function completeStartAuctions(scenario: DemoScenario): DemoScenario {
  let { state } = scenario;
  const { randomSource, cardSource } = scenario;
  let steps = 0;
  while (state.phase === GamePhase.StartAuctions) {
    if (++steps > 12) throw new Error("Der Startauktions-Debuglauf kam nicht zum Abschluss.");
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
      const target = state.territories.find((territory) => getStateAdjacentTerritoryIds(state, source.id).includes(territory.id) && territory.ownerId === null);
      if (target === undefined) throw new Error("Kein neutrales ♦-Ziel für das Debug-Skript.");
      return { type: "DIAMOND_NEUTRAL_BORDER", targetTerritoryId: target.id };
    }
    case Suit.Clubs:
      return {
        type: "CLUB_BUILD_SETTLEMENT",
        targetTerritoryId: source.id,
        ...(state.map && getTerritoryCells(state.map, source.id)[0]
          ? { position: getTerritoryCells(state.map, source.id)[0] } : {}),
      };
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
    const pendingDiamond = state.pendingDiamondBorderChanges[0];
    if (pendingDiamond) state = dispatch(state, { type: GameActionType.ResolveNeutralDiamond,
      effectId: pendingDiamond.id, playerId: pendingDiamond.playerId, claimedCells: [] }, randomSource, cardSource);
  }
  if (state.phase !== GamePhase.ActionPhase) throw new Error("Die Debug-Aktivierung erreichte keine Aktionsphase.");
  return { state, randomSource, cardSource };
}

class CombatRandomSource implements RandomSource {
  private index = 0;
  constructor(private readonly dice: readonly number[], private readonly fallback: RandomSource) {}
  nextInt(min: number, max: number): number {
    if (min === 1 && max === 6 && this.index < this.dice.length) return this.dice[this.index++]!;
    return this.fallback.nextInt(min, max);
  }
}

function warScenario(scenario: DemoScenario, kind: ScenarioKind): DemoScenario {
  const base = scenario.state;
  const attacker = base.territories.find((territory) => territory.ownerId === base.activePlayerId &&
    base.territories.some((target) => target.ownerId === null && getStateAdjacentTerritoryIds(base, territory.id).includes(target.id)));
  if (!attacker || !base.map || !base.activePlayerId) throw new Error("Kein Angriffspaar im Debug-Szenario.");
  const defender = base.territories.find((territory) => territory.ownerId === null &&
    getStateAdjacentTerritoryIds(base, attacker.id).includes(territory.id))!;
  const defenderPlayer = base.players.find((player) => player.id !== base.activePlayerId)!;
  let map = base.map;
  if (kind === "WAR_CONQUEST") {
    const border = getSharedBorder(map, attacker.id, defender.id);
    const cell = getCellsWithinBorderDepth(map, defender.id, border, 1)[0]!;
    map = { ...map, cells: { ...map.cells, [`${cell.x},${cell.y}`]: attacker.id } };
  }
  if (kind === "WAR_DIAMOND_CUT") {
    const neutral = base.territories.find((territory) => territory.ownerId === null && territory.id !== defender.id &&
      getStateAdjacentTerritoryIds(base, defender.id).includes(territory.id));
    if (!neutral) throw new Error("Kein angrenzendes neutrales Gebiet für die ♦-Teilung.");
    const border = getSharedBorder(map, defender.id, neutral.id);
    const cells = { ...map.cells };
    for (const cell of getCellsWithinBorderDepth(map, neutral.id, border, 2).slice(0, 8)) {
      cells[`${cell.x},${cell.y}`] = defender.id;
    }
    map = { ...map, cells };
  }
  if (kind === "WAR_STRONG") {
    const border = getSharedBorder(map, attacker.id, defender.id);
    const keep = new Set(getCellsWithinBorderDepth(map, attacker.id, border, 8).slice(0, 19).map((cell) => `${cell.x},${cell.y}`));
    const cells = { ...map.cells };
    for (const cell of getTerritoryCells(map, attacker.id)) if (!keep.has(`${cell.x},${cell.y}`)) cells[`${cell.x},${cell.y}`] = null;
    map = { ...map, format: "A5", cells };
  }
  const defenderCells = getTerritoryCells(map, defender.id);
  const state: GameState = {
    ...base, map,
    territories: base.territories.map((territory) => territory.id === defender.id
      ? { ...territory, ownerId: defenderPlayer.id, ...(kind === "WAR_WEAK" ? { weakened: true } : {}) } : territory),
    ...(kind === "WAR_DIAMOND" || kind === "WAR_DIAMOND_CUT" ? { borderMarks: [{ id: `debug-mark:${attacker.id}:${defender.id}`,
      territoryIds: [attacker.id, defender.id], playerId: base.activePlayerId }] } : {}),
    ...(kind === "WAR_SPADE_FORTRESS" ? {
      spadeActivations: [{ id: "debug-spade", playerId: base.activePlayerId,
        sourceTerritoryId: attacker.id, status: "AVAILABLE" as const }],
      pointsOfInterest: [...base.pointsOfInterest, { id: "debug-fortress", type: PointOfInterestType.Fortress,
        position: defenderCells[0]! }],
    } : {}),
  };
  const dice = kind === "WAR_TIE" ? [3, 3] : kind === "WAR_WEAK" ? [5, 4]
    : kind === "WAR_NORMAL" || kind === "WAR_DIAMOND" ? [5, 3]
      : kind === "WAR_SPADE_FORTRESS" ? [4, 4] : [6, 1];
  const randomSource = new CombatRandomSource(dice, scenario.randomSource);
  return { state: dispatch(state, { type: GameActionType.StartWar, playerId: base.activePlayerId,
    attackerTerritoryId: attacker.id, defenderTerritoryId: defender.id }, randomSource, scenario.cardSource),
    randomSource, cardSource: scenario.cardSource };
}

function neutralDiamondScenario(scenario: DemoScenario): DemoScenario {
  const base = scenario.state;
  const source = base.territories.find((territory) => territory.ownerId !== null &&
    base.territories.some((target) => target.ownerId === null && getStateAdjacentTerritoryIds(base, territory.id).includes(target.id)));
  if (!source || !source.ownerId || !source.card) throw new Error("Kein neutrales ♦-Ziel.");
  const target = base.territories.find((territory) => territory.ownerId === null &&
    getStateAdjacentTerritoryIds(base, source.id).includes(territory.id))!;
  const state: GameState = { ...base, phase: GamePhase.ActivationPhase, activePlayerId: source.ownerId,
    activation: { pendingTerritoryIds: [source.id], resolvedTerritoryIds: [] },
    territories: base.territories.map((territory) => territory.id === source.id
      ? { ...territory, card: { ...source.card!, suit: Suit.Diamonds } } : territory) };
  return { ...scenario, state: dispatch(state, { type: GameActionType.ActivateTerritory,
    playerId: source.ownerId, territoryId: source.id,
    choice: { type: "DIAMOND_NEUTRAL_BORDER", targetTerritoryId: target.id } },
  scenario.randomSource, scenario.cardSource) };
}

function openDemonstrationAuction(scenario: DemoScenario): DemoScenario {
  const { state, randomSource, cardSource } = scenario;
  const playerId = state.activePlayerId;
  if (playerId === undefined) throw new Error("Kein aktiver Spieler für die normale Debug-Auktion.");
  const target = state.territories.find((territory) => territory.ownerId === null &&
    state.territories.some((owned) => owned.ownerId === playerId && getStateAdjacentTerritoryIds(state, owned.id).includes(territory.id)));
  if (target === undefined) throw new Error("Kein neutrales Ziel für die normale Debug-Auktion.");
  return {
    state: dispatch(state, { type: GameActionType.OpenAuction, playerId, territoryId: target.id }, randomSource, cardSource),
    randomSource,
    cardSource,
  };
}

/** A direct, core-started endgame fixture exposing every scoring category. */
function scoringScenario(seed: number): DemoScenario {
  const base = createDemoGame(seed);
  const owners: Readonly<Record<string, string | null>> = {
    G01: "anna", G02: "anna", G09: "anna", G10: "anna",
    G03: "ben", G04: "ben", G14: "clara",
  };
  const territories = base.territories.map((territory) => {
    const ownerId = owners[territory.id] ?? null;
    if (territory.id === "G01") return { ...territory, ownerId, settlement: SettlementKind.City,
      settlementFeature: { id: "score-city", kind: SettlementKind.City, position: { x: 0, y: 0 } },
      settlementFeatures: [{ id: "score-city", kind: SettlementKind.City, position: { x: 0, y: 0 } }] };
    if (territory.id === "G09") return { ...territory, ownerId, settlement: SettlementKind.Settlement,
      settlementFeature: { id: "score-settlement", kind: SettlementKind.Settlement, position: { x: 0, y: 10 } },
      settlementFeatures: [{ id: "score-settlement", kind: SettlementKind.Settlement, position: { x: 0, y: 10 } }] };
    return { ...territory, ownerId };
  });
  const state: GameState = {
    ...base,
    phase: GamePhase.Scoring,
    players: base.players.map((player) => ({ ...player, globalInfluence: player.id === "anna" ? 3
      : player.id === "ben" ? 1 : 0, secretFactionSuit: player.id === "anna" ? Suit.Diamonds
        : player.id === "ben" ? Suit.Clubs : Suit.Spades })),
    territories,
    pointsOfInterest: [
      { id: "score-landmark", type: PointOfInterestType.Landmark, position: { x: 11, y: 2 } },
      { id: "score-hub", type: PointOfInterestType.Junction, position: { x: 11, y: 12 } },
      { id: "score-relic-a", type: PointOfInterestType.Relic, position: { x: 19, y: 2 } },
      { id: "score-relic-b", type: PointOfInterestType.Relic, position: { x: 27, y: 2 } },
    ],
  };
  return { state: beginScoring(state, TIMESTAMP).state, randomSource: new SeededRandomSource(seed), cardSource: new DemoCardSource() };
}

/** Scenarios are scripted, valid core transitions from one neutral setup fixture. */
export function createScenario(kind: ScenarioKind, seed = 12_345): DemoScenario {
  if (kind === "SCORING") return scoringScenario(seed);
  const start = beginAuctions(seed);
  if (kind === "START_AUCTIONS") return start;
  const auctions = completeStartAuctions(start);
  const activation = beginDemonstrationRound(auctions, seed);
  if (kind === "ACTIVATION_PHASE") return activation;
  const action = completeActivations(activation);
  if (kind === "ACTION_PHASE") return action;
  if (kind === "NORMAL_AUCTION") return openDemonstrationAuction(action);
  if (kind === "DIAMOND_NEUTRAL") return neutralDiamondScenario(action);
  if (kind.startsWith("WAR_")) return warScenario(action, kind);
  throw new Error(`Unbekanntes Debug-Szenario: ${kind}`);
}
