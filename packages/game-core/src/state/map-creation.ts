import type { ActionResult } from "../actions/action-result.js";
import type {
  BeginMapCreationAction,
  CreateSetupTerritoryAction,
  EditSetupBorderAction,
  FinalizeMapCreationAction,
  PlaceSetupPointOfInterestAction,
  SplitSetupTerritoryAction,
} from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import {
  applyTerritorySplitToMap,
  areCellsOrthogonallyConnected,
  createGridMap,
  getAdjacentTerritoryIds,
  getGridCellTerritory,
  getTerritoryArea,
  isCellInsideMap,
  isTerritoryConnected,
  toCellKey,
  validateTerritorySplit,
} from "../map/grid-map.js";
import type { GridCell, GridMapState } from "../map/grid-map.js";
import type { PlayerId, TerritoryId } from "../model/ids.js";
import { PointOfInterestType } from "../model/point-of-interest.js";
import { Suit } from "../model/territory-card.js";
import { getNextPlayer } from "../rules/player-order.js";
import { drawBalancedStartingTerritoryCards } from "../rules/territory-card-deck.js";
import { getMinimumTerritoryArea } from "../rules/territory-size.js";
import { GamePhase } from "./game-phase.js";
import type { GameState } from "./game-state.js";
import { MapCreationStage, type MapCreationState } from "./map-creation-state.js";
import { DomainError, DomainErrorCode } from "../utils/domain-error.js";
import type { RandomSource } from "../utils/random-source.js";

export interface MapValidationIssue {
  readonly territoryId: TerritoryId;
  readonly code: "BELOW_MINIMUM_AREA" | "DISCONNECTED" | "TOO_FEW_NEIGHBORS";
  readonly message: string;
}

const POI_PHASES: Readonly<Record<PointOfInterestType, MapCreationStage>> = {
  [PointOfInterestType.Landmark]: MapCreationStage.PlaceLandmarks,
  [PointOfInterestType.Junction]: MapCreationStage.PlaceJunctions,
  [PointOfInterestType.Fortress]: MapCreationStage.PlaceFortresses,
  [PointOfInterestType.Relic]: MapCreationStage.PlaceRelics,
};

const STAGE_POI_TYPES: Readonly<Partial<Record<MapCreationStage, PointOfInterestType>>> = {
  [MapCreationStage.PlaceLandmarks]: PointOfInterestType.Landmark,
  [MapCreationStage.PlaceJunctions]: PointOfInterestType.Junction,
  [MapCreationStage.PlaceFortresses]: PointOfInterestType.Fortress,
  [MapCreationStage.PlaceRelics]: PointOfInterestType.Relic,
};

export function getStartingTerritoryCount(playerCount: number): number {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) {
    throw new RangeError("Map creation requires two to six players.");
  }
  return 4 * playerCount + 4;
}

/** Rulebook POI table. Kept in the core so clients only display it. */
export function getSetupPoiRequirements(playerCount: number): Readonly<Record<PointOfInterestType, number>> {
  const requirements: Readonly<Record<number, readonly [number, number, number, number]>> = {
    2: [1, 1, 1, 2], 3: [2, 1, 1, 2], 4: [2, 1, 2, 3], 5: [3, 2, 2, 3], 6: [3, 2, 3, 4],
  };
  const values = requirements[playerCount];
  if (values === undefined) throw new RangeError("Map creation requires two to six players.");
  return {
    [PointOfInterestType.Landmark]: values[0],
    [PointOfInterestType.Junction]: values[1],
    [PointOfInterestType.Fortress]: values[2],
    [PointOfInterestType.Relic]: values[3],
  };
}

function emptyPoiCounts(): Record<PointOfInterestType, number> {
  return {
    [PointOfInterestType.Landmark]: 0,
    [PointOfInterestType.Junction]: 0,
    [PointOfInterestType.Fortress]: 0,
    [PointOfInterestType.Relic]: 0,
  };
}

function result(state: GameState, timestamp: string, descriptions: readonly EventDescription[]): ActionResult {
  const events = createEvents(state, timestamp, descriptions);
  return { state: { ...state, events: [...state.events, ...events] }, events };
}

function requireMapCreation(state: GameState): MapCreationState {
  if (state.phase !== GamePhase.MapCreation || state.mapCreation === undefined || state.map === undefined) {
    throw new DomainError(DomainErrorCode.InvalidMapCreationState, "Map creation is not active.");
  }
  return state.mapCreation;
}

function assertActive(mapCreation: MapCreationState, playerId: PlayerId): void {
  if (mapCreation.activePlayerId !== playerId) throw new DomainError(DomainErrorCode.NotActivePlayer);
}

function nextPlayer(state: GameState, playerId: PlayerId): PlayerId {
  return getNextPlayer(state.players.map((player) => player.id), playerId);
}

function nextTerritoryId(state: GameState, mapCreation: MapCreationState): TerritoryId {
  let index = mapCreation.createdTerritoryCount + 1;
  while (state.territories.some((territory) => territory.id === `G${String(index).padStart(2, "0")}`)) index += 1;
  return `G${String(index).padStart(2, "0")}`;
}

function stageAfterTerritoryCount(playerCount: number, count: number, target: number): MapCreationStage {
  if (count >= target) return MapCreationStage.ReadyToFinalize;
  if (count === playerCount) return MapCreationStage.PlaceLandmarks;
  if (count === playerCount * 2) return MapCreationStage.PlaceJunctions;
  if (count === playerCount * 3) return MapCreationStage.PlaceFortresses;
  if (count === playerCount * 4) return MapCreationStage.PlaceRelics;
  return MapCreationStage.DrawTerritories;
}

function mapCreationAfterTerritory(
  state: GameState,
  mapCreation: MapCreationState,
  playerId: PlayerId,
): MapCreationState {
  const createdTerritoryCount = mapCreation.createdTerritoryCount + 1;
  return {
    ...mapCreation,
    createdTerritoryCount,
    activePlayerId: nextPlayer(state, playerId),
    stage: stageAfterTerritoryCount(state.players.length, createdTerritoryCount, mapCreation.targetTerritoryCount),
    lastSetupPlayerId: playerId,
  };
}

export function beginMapCreation(state: GameState, action: BeginMapCreationAction, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.Setup || state.map !== undefined || state.mapCreation !== undefined || state.territories.length > 0) {
    throw new DomainError(DomainErrorCode.InvalidPhase, "Map creation can begin only from an empty setup.");
  }
  if (!state.players.some((player) => player.id === action.firstPlayerId)) {
    throw new DomainError(DomainErrorCode.InvalidPlayerOrder, "The first map drawer is not seated.");
  }
  const map = createGridMap(action.map);
  const mapCreation: MapCreationState = {
    firstPlayerId: action.firstPlayerId,
    activePlayerId: action.firstPlayerId,
    targetTerritoryCount: getStartingTerritoryCount(state.players.length),
    createdTerritoryCount: 0,
    stage: MapCreationStage.DrawTerritories,
    placedPoiCounts: emptyPoiCounts(),
  };
  return result({ ...state, phase: GamePhase.MapCreation, map, mapCreation, activePlayerId: action.firstPlayerId }, timestamp, [{
    type: GameEventType.MapCreationStarted,
    actorId: action.firstPlayerId,
    payload: { firstPlayerId: action.firstPlayerId, width: map.width, height: map.height, format: map.format ?? "A4" },
  }]);
}

function validateNewSetupTerritory(map: GridMapState, cells: readonly GridCell[]): void {
  const keys = cells.map(toCellKey);
  if (cells.length === 0 || new Set(keys).size !== keys.length || cells.some((cell) => !isCellInsideMap(map, cell))) {
    throw new DomainError(DomainErrorCode.InvalidSetupTerritory, "Cells must be unique and lie on the map.");
  }
  if (cells.some((cell) => getGridCellTerritory(map, cell) !== null)) {
    throw new DomainError(DomainErrorCode.InvalidSetupTerritory, "A new territory may use only unassigned cells.");
  }
  if (!areCellsOrthogonallyConnected(cells)) {
    throw new DomainError(DomainErrorCode.InvalidSetupTerritory, "A new territory must be orthogonally connected.");
  }
  const minimum = getMinimumTerritoryArea(map.format);
  if (cells.length < minimum) {
    throw new DomainError(DomainErrorCode.MinimumTerritorySizeViolated, `Territory has ${cells.length} / ${minimum} required cells.`);
  }
}

function mapWithNewTerritory(map: GridMapState, territoryId: TerritoryId, cells: readonly GridCell[]): GridMapState {
  const next = { ...map.cells };
  for (const cell of cells) next[toCellKey(cell)] = territoryId;
  return { ...map, cells: next };
}

export function createSetupTerritory(
  state: GameState, action: CreateSetupTerritoryAction, timestamp: string,
): ActionResult {
  const mapCreation = requireMapCreation(state);
  assertActive(mapCreation, action.playerId);
  if (mapCreation.stage !== MapCreationStage.DrawTerritories ||
      mapCreation.createdTerritoryCount >= mapCreation.targetTerritoryCount) {
    throw new DomainError(DomainErrorCode.InvalidMapCreationState, "The next step is not drawing a territory.");
  }
  validateNewSetupTerritory(state.map!, action.cells);
  const territoryId = nextTerritoryId(state, mapCreation);
  const nextMapCreation = mapCreationAfterTerritory(state, mapCreation, action.playerId);
  const descriptions: EventDescription[] = [{
    type: GameEventType.SetupTerritoryCreated,
    actorId: action.playerId,
    payload: { territoryId, area: action.cells.length, createdTerritoryCount: nextMapCreation.createdTerritoryCount },
  }];
  const poiType = STAGE_POI_TYPES[nextMapCreation.stage];
  if (poiType !== undefined) descriptions.push({ type: GameEventType.PoiPlacementStarted,
    payload: { poiType, requiredCount: getSetupPoiRequirements(state.players.length)[poiType] } });
  return result({ ...state, map: mapWithNewTerritory(state.map!, territoryId, action.cells),
    territories: [...state.territories, { id: territoryId, ownerId: null }],
    activePlayerId: nextMapCreation.activePlayerId, mapCreation: nextMapCreation,
    lastSetupPlayerId: action.playerId }, timestamp, descriptions);
}

export function splitSetupTerritory(
  state: GameState, action: SplitSetupTerritoryAction, timestamp: string,
): ActionResult {
  const mapCreation = requireMapCreation(state);
  assertActive(mapCreation, action.playerId);
  if (mapCreation.stage !== MapCreationStage.DrawTerritories ||
      mapCreation.createdTerritoryCount >= mapCreation.targetTerritoryCount) {
    throw new DomainError(DomainErrorCode.InvalidMapCreationState, "The next step is not drawing a territory.");
  }
  if (!state.territories.some((territory) => territory.id === action.territoryId)) {
    throw new DomainError(DomainErrorCode.TerritoryNotFound);
  }
  const validation = validateTerritorySplit(state.map!, action.territoryId, action.partACells);
  if (!validation.valid) {
    throw new DomainError(DomainErrorCode.InvalidSetupSplit, `Split is invalid: ${validation.reason ?? "UNKNOWN"}.`);
  }
  const territoryId = nextTerritoryId(state, mapCreation);
  const nextMapCreation = mapCreationAfterTerritory(state, mapCreation, action.playerId);
  const descriptions: EventDescription[] = [{
    type: GameEventType.SetupTerritorySplit,
    actorId: action.playerId,
    payload: { originalTerritoryId: action.territoryId, territoryId, createdTerritoryCount: nextMapCreation.createdTerritoryCount },
  }];
  const poiType = STAGE_POI_TYPES[nextMapCreation.stage];
  if (poiType !== undefined) descriptions.push({ type: GameEventType.PoiPlacementStarted,
    payload: { poiType, requiredCount: getSetupPoiRequirements(state.players.length)[poiType] } });
  return result({ ...state,
    map: applyTerritorySplitToMap(state.map!, action.territoryId, territoryId, action.partACells),
    territories: [...state.territories, { id: territoryId, ownerId: null }],
    activePlayerId: nextMapCreation.activePlayerId, mapCreation: nextMapCreation,
    lastSetupPlayerId: action.playerId,
  }, timestamp, descriptions);
}

export function editSetupBorder(state: GameState, action: EditSetupBorderAction, timestamp: string): ActionResult {
  const mapCreation = requireMapCreation(state);
  assertActive(mapCreation, action.playerId);
  if (action.donorTerritoryId === action.recipientTerritoryId ||
      !state.territories.some((territory) => territory.id === action.donorTerritoryId) ||
      !state.territories.some((territory) => territory.id === action.recipientTerritoryId)) {
    throw new DomainError(DomainErrorCode.InvalidSetupBorder, "Two different existing territories are required.");
  }
  const keys = action.claimedCells.map(toCellKey);
  if (keys.length === 0 || new Set(keys).size !== keys.length ||
      action.claimedCells.some((cell) => getGridCellTerritory(state.map!, cell) !== action.donorTerritoryId)) {
    throw new DomainError(DomainErrorCode.InvalidSetupBorder, "Selected cells must belong to the donor territory.");
  }
  const cells = { ...state.map!.cells };
  for (const key of keys) cells[key] = action.recipientTerritoryId;
  const map = { ...state.map!, cells };
  const minimum = getMinimumTerritoryArea(map.format);
  for (const id of [action.donorTerritoryId, action.recipientTerritoryId]) {
    if (getTerritoryArea(map, id) < minimum) {
      throw new DomainError(DomainErrorCode.MinimumTerritorySizeViolated, `${id}: ${getTerritoryArea(map, id)} / ${minimum} required cells.`);
    }
    if (!isTerritoryConnected(map, id)) {
      throw new DomainError(DomainErrorCode.TerritoryDisconnected, `${id} must remain orthogonally connected.`);
    }
  }
  return result({ ...state, map }, timestamp, [{
    type: GameEventType.SetupBorderChanged,
    actorId: action.playerId,
    payload: { donorTerritoryId: action.donorTerritoryId, recipientTerritoryId: action.recipientTerritoryId, cellCount: keys.length },
  }]);
}

export function placeSetupPointOfInterest(
  state: GameState, action: PlaceSetupPointOfInterestAction, timestamp: string,
): ActionResult {
  const mapCreation = requireMapCreation(state);
  assertActive(mapCreation, action.playerId);
  if (POI_PHASES[action.poiType] !== mapCreation.stage) {
    throw new DomainError(DomainErrorCode.InvalidPoiPlacement, "This point of interest is not due yet.");
  }
  const territoryId = getGridCellTerritory(state.map!, action.position);
  if (territoryId === undefined || territoryId === null) {
    throw new DomainError(DomainErrorCode.InvalidPoiPlacement, "A point of interest must be placed in an existing territory.");
  }
  const requirements = getSetupPoiRequirements(state.players.length);
  const placed = mapCreation.placedPoiCounts[action.poiType];
  if (placed >= requirements[action.poiType]) {
    throw new DomainError(DomainErrorCode.InvalidPoiPlacement, "The required number is already placed.");
  }
  const nextCounts = { ...mapCreation.placedPoiCounts, [action.poiType]: placed + 1 };
  const complete = nextCounts[action.poiType] === requirements[action.poiType];
  const nextMapCreation: MapCreationState = {
    ...mapCreation,
    placedPoiCounts: nextCounts,
    activePlayerId: nextPlayer(state, action.playerId),
    stage: complete ? MapCreationStage.DrawTerritories : mapCreation.stage,
  };
  const id = `${state.gameId}:poi:${action.poiType.toLowerCase()}:${placed + 1}`;
  const descriptions: EventDescription[] = [{ type: GameEventType.PoiPlaced, actorId: action.playerId,
    payload: { poiId: id, poiType: action.poiType, position: action.position, territoryId } }];
  return result({ ...state,
    pointsOfInterest: [...state.pointsOfInterest, { id, type: action.poiType, position: action.position }],
    activePlayerId: nextMapCreation.activePlayerId, mapCreation: nextMapCreation,
  }, timestamp, descriptions);
}

export function getSetupMapValidationIssues(state: GameState): MapValidationIssue[] {
  if (state.map === undefined) return [{ territoryId: "KARTE", code: "DISCONNECTED", message: "Keine Rasterkarte vorhanden." }];
  const minimum = getMinimumTerritoryArea(state.map.format);
  const issues: MapValidationIssue[] = [];
  for (const territory of state.territories) {
    const area = getTerritoryArea(state.map, territory.id);
    if (area < minimum) issues.push({ territoryId: territory.id, code: "BELOW_MINIMUM_AREA",
      message: `${territory.id}: ${area} / ${minimum} Mindestkästchen.` });
    if (!isTerritoryConnected(state.map, territory.id)) issues.push({ territoryId: territory.id, code: "DISCONNECTED",
      message: `${territory.id}: Gebiet ist nicht orthogonal zusammenhängend.` });
    const neighbors = getAdjacentTerritoryIds(state.map, territory.id);
    if (neighbors.length < 2) issues.push({ territoryId: territory.id, code: "TOO_FEW_NEIGHBORS",
      message: `${territory.id}: nur ${neighbors.length} Nachbargebiet${neighbors.length === 1 ? "" : "e"}.` });
  }
  return issues;
}

function shuffledSuits(random: RandomSource): Suit[] {
  const suits = [Suit.Diamonds, Suit.Clubs, Suit.Hearts, Suit.Spades];
  for (let index = suits.length - 1; index > 0; index -= 1) {
    const picked = random.nextInt(0, index);
    if (!Number.isInteger(picked) || picked < 0 || picked > index) throw new RangeError("Random source returned an invalid suit index.");
    [suits[index], suits[picked]] = [suits[picked]!, suits[index]!];
  }
  return suits;
}

function assignSecretFactions(state: GameState, random: RandomSource): GameState["players"] {
  const first = shuffledSuits(random);
  const suits = state.players.length <= 4 ? first.slice(0, state.players.length) : [
    ...first,
    ...shuffledSuits(random).slice(0, state.players.length - 4),
  ];
  return state.players.map((player, index) => ({ ...player, secretFactionSuit: suits[index]! }));
}

export function finalizeMapCreation(
  state: GameState, action: FinalizeMapCreationAction, random: RandomSource, timestamp: string,
): ActionResult {
  const mapCreation = requireMapCreation(state);
  if (!state.players.some((player) => player.id === action.playerId)) throw new DomainError(DomainErrorCode.InvalidPlayerOrder);
  const requirements = getSetupPoiRequirements(state.players.length);
  if (mapCreation.createdTerritoryCount !== mapCreation.targetTerritoryCount ||
      state.territories.length !== mapCreation.targetTerritoryCount ||
      Object.entries(requirements).some(([type, count]) => mapCreation.placedPoiCounts[type as PointOfInterestType] !== count)) {
    throw new DomainError(DomainErrorCode.InvalidMapCreationState, "All territories and required points of interest must be created first.");
  }
  const issues = getSetupMapValidationIssues(state);
  if (issues.length > 0) {
    throw new DomainError(DomainErrorCode.InvalidMapCreation, issues.map((issue) => issue.message).join(" "));
  }
  const cards = drawBalancedStartingTerritoryCards(state.players.length, random);
  const territories = state.territories.map((territory, index) => ({ ...territory, ownerId: null, card: cards[index]! }));
  const lastSetupPlayerId = mapCreation.lastSetupPlayerId ?? state.lastSetupPlayerId;
  if (lastSetupPlayerId === undefined) throw new DomainError(DomainErrorCode.InvalidMapCreationState, "No map drawing turn was recorded.");
  return result({ ...state, phase: GamePhase.Setup, territories,
    players: assignSecretFactions(state, random), mapCreation: undefined,
    activePlayerId: undefined, lastSetupPlayerId,
  }, timestamp, [
    { type: GameEventType.MapCreationCompleted, actorId: action.playerId,
      payload: { territoryCount: territories.length, lastSetupPlayerId } },
    { type: GameEventType.TerritoryCardsAssigned, payload: { territoryCount: territories.length } },
    { type: GameEventType.SecretFactionsAssigned, payload: { playerCount: state.players.length } },
    { type: GameEventType.SetupCompleted, payload: { lastSetupPlayerId } },
  ]);
}
