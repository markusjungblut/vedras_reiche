import type { ActionResult } from "../actions/action-result.js";
import type {
  BeginMapCreationAction,
  CommitSetupBoundaryDraftAction,
  CorrectSetupBordersAction,
  FinalizeMapCreationAction,
  PlaceSetupPointOfInterestAction,
} from "../actions/game-action.js";
import { createEvents, type EventDescription } from "../events/create-events.js";
import { GameEventType } from "../events/game-event.js";
import { createGridMap, getAdjacentTerritoryIds, getTerritoryArea, isCellInsideMap, isTerritoryConnected, toCellKey } from "../map/grid-map.js";
import type { GridMapState } from "../map/grid-map.js";
import {
  analyzeSetupPartitionChange,
  deriveSetupRegions,
  getActualSetupBoundaryKeys,
  materializeSetupRegionMap,
  normalizeSetupBorderEdges,
  type SetupBorderEdge,
  type SetupBorderEdgeKey,
  type SetupRegion,
} from "../map/setup-regions.js";
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
  readonly code: "UNASSIGNED_CELL" | "UNKNOWN_TERRITORY" | "BELOW_MINIMUM_AREA" | "DISCONNECTED" | "TOO_FEW_NEIGHBORS";
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
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 6) throw new RangeError("Map creation requires two to six players.");
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
    [PointOfInterestType.Landmark]: values[0], [PointOfInterestType.Junction]: values[1],
    [PointOfInterestType.Fortress]: values[2], [PointOfInterestType.Relic]: values[3],
  };
}

function emptyPoiCounts(): Record<PointOfInterestType, number> {
  return { [PointOfInterestType.Landmark]: 0, [PointOfInterestType.Junction]: 0,
    [PointOfInterestType.Fortress]: 0, [PointOfInterestType.Relic]: 0 };
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

function stageAfterDrawingTurn(playerCount: number, regionCount: number, target: number): MapCreationStage {
  if (regionCount >= target) return MapCreationStage.ReadyToFinalize;
  // The first region exists before anyone draws. A successful drawing turn adds exactly one region.
  const completedDrawingTurns = regionCount - 1;
  if (completedDrawingTurns === playerCount) return MapCreationStage.PlaceLandmarks;
  if (completedDrawingTurns === playerCount * 2) return MapCreationStage.PlaceJunctions;
  if (completedDrawingTurns === playerCount * 3) return MapCreationStage.PlaceFortresses;
  if (completedDrawingTurns === playerCount * 4) return MapCreationStage.PlaceRelics;
  return MapCreationStage.DrawTerritories;
}

function setupRegions(state: GameState, mapCreation = requireMapCreation(state)): SetupRegion[] {
  return deriveSetupRegions(state.map!, mapCreation.borders);
}

function setupMap(state: GameState, regions: readonly SetupRegion[]): GridMapState {
  return materializeSetupRegionMap(state.map!, regions);
}

function assertMinimumSetupAreas(map: GridMapState, regions: readonly SetupRegion[]): void {
  const minimum = getMinimumTerritoryArea(map);
  const tooSmall = regions.find((region) => region.cells.length < minimum);
  if (tooSmall !== undefined) {
    throw new DomainError(DomainErrorCode.MinimumTerritorySizeViolated,
      `${tooSmall.id}: ${tooSmall.cells.length} / ${minimum} required cells.`);
  }
}

function changedBorderKeys(map: GridMapState, edges: readonly SetupBorderEdge[]): SetupBorderEdgeKey[] {
  try {
    return normalizeSetupBorderEdges(map, edges);
  } catch (error) {
    throw new DomainError(DomainErrorCode.InvalidSetupBoundaryDraft, error instanceof Error ? error.message : "Invalid setup boundary.");
  }
}

function poiPhaseDescription(state: GameState, stage: MapCreationStage): EventDescription | undefined {
  const poiType = STAGE_POI_TYPES[stage];
  return poiType === undefined ? undefined : { type: GameEventType.PoiPlacementStarted,
    payload: { poiType, requiredCount: getSetupPoiRequirements(state.players.length)[poiType] } };
}

export function beginMapCreation(state: GameState, action: BeginMapCreationAction, timestamp: string): ActionResult {
  if (state.phase !== GamePhase.Setup || state.map !== undefined || state.mapCreation !== undefined || state.territories.length > 0) {
    throw new DomainError(DomainErrorCode.InvalidPhase, "Map creation can begin only from an empty setup.");
  }
  if (!state.players.some((player) => player.id === action.firstPlayerId)) {
    throw new DomainError(DomainErrorCode.InvalidPlayerOrder, "The first map drawer is not seated.");
  }
  const emptyMap = createGridMap(action.map);
  const borders = { edgeKeys: [] as const };
  const regions = deriveSetupRegions(emptyMap, borders);
  const map = materializeSetupRegionMap(emptyMap, regions);
  const mapCreation: MapCreationState = {
    firstPlayerId: action.firstPlayerId, activePlayerId: action.firstPlayerId,
    targetTerritoryCount: getStartingTerritoryCount(state.players.length), regionCount: regions.length, borders,
    stage: MapCreationStage.DrawTerritories, placedPoiCounts: emptyPoiCounts(),
  };
  return result({ ...state, phase: GamePhase.MapCreation, map, mapCreation, activePlayerId: action.firstPlayerId }, timestamp, [{
    type: GameEventType.MapCreationStarted, actorId: action.firstPlayerId,
    payload: { firstPlayerId: action.firstPlayerId, width: map.width, height: map.height,
      profile: map.format === undefined ? "DIGITAL" : "PAPER", ...(map.format === undefined ? {} : { format: map.format }) },
  }]);
}

/** Commits a normal turn: exactly one current region must become exactly two. */
export function commitSetupBoundaryDraft(state: GameState, action: CommitSetupBoundaryDraftAction, timestamp: string): ActionResult {
  const mapCreation = requireMapCreation(state);
  assertActive(mapCreation, action.playerId);
  if (mapCreation.stage !== MapCreationStage.DrawTerritories || mapCreation.regionCount >= mapCreation.targetTerritoryCount) {
    throw new DomainError(DomainErrorCode.InvalidMapCreationState, "The next step is not drawing a boundary.");
  }
  const keys = changedBorderKeys(state.map!, action.edges);
  const oldKeys = new Set(mapCreation.borders.edgeKeys);
  const addedKeys = keys.filter((key) => !oldKeys.has(key));
  if (addedKeys.length === 0) throw new DomainError(DomainErrorCode.InvalidSetupBoundaryDraft, "The draft contains no new boundary segment.");
  const before = setupRegions(state, mapCreation);
  const previewBorders = { edgeKeys: [...new Set([...mapCreation.borders.edgeKeys, ...addedKeys])].sort() as SetupBorderEdgeKey[] };
  const previewRegions = deriveSetupRegions(state.map!, previewBorders);
  const previewChange = analyzeSetupPartitionChange(before, previewRegions);
  if (!previewChange.validSingleSplit) {
    throw new DomainError(DomainErrorCode.InvalidSetupBoundaryDraft,
      previewChange.regionCountDelta > 1 ? "Dieser Zug würde mehr als ein neues Gebiet erzeugen." : "Ein Zeichenzug muss genau eine bestehende Region in zwei Regionen teilen.");
  }
  const actualAddedKeys = getActualSetupBoundaryKeys(addedKeys, previewRegions);
  const borders = { edgeKeys: [...new Set([...mapCreation.borders.edgeKeys, ...actualAddedKeys])].sort() as SetupBorderEdgeKey[] };
  const after = deriveSetupRegions(state.map!, borders);
  const change = analyzeSetupPartitionChange(before, after);
  if (!change.validSingleSplit) {
    throw new DomainError(DomainErrorCode.InvalidSetupBoundaryDraft,
      change.regionCountDelta > 1 ? "Dieser Zug würde mehr als ein neues Gebiet erzeugen." : "Ein Zeichenzug muss genau eine bestehende Region in zwei Regionen teilen.");
  }
  assertMinimumSetupAreas(state.map!, after);
  const regionCount = after.length;
  const stage = stageAfterDrawingTurn(state.players.length, regionCount, mapCreation.targetTerritoryCount);
  const nextMapCreation: MapCreationState = { ...mapCreation, borders, regionCount, stage,
    activePlayerId: nextPlayer(state, action.playerId), lastSetupPlayerId: action.playerId };
  const descriptions: EventDescription[] = [{ type: GameEventType.SetupBoundaryCommitted, actorId: action.playerId,
    payload: { regionCount, segmentCount: actualAddedKeys.length, splitSourceRegionId: change.splitSourceRegionId } }];
  const poiDescription = poiPhaseDescription(state, stage);
  if (poiDescription !== undefined) descriptions.push(poiDescription);
  return result({ ...state, map: setupMap(state, after), mapCreation: nextMapCreation,
    activePlayerId: nextMapCreation.activePlayerId, lastSetupPlayerId: action.playerId }, timestamp, descriptions);
}

/** Applies a shape correction only. It deliberately does not consume a drawing turn. */
export function correctSetupBorders(state: GameState, action: CorrectSetupBordersAction, timestamp: string): ActionResult {
  const mapCreation = requireMapCreation(state);
  assertActive(mapCreation, action.playerId);
  if (mapCreation.stage !== MapCreationStage.ReadyToFinalize) {
    throw new DomainError(DomainErrorCode.InvalidMapCreationState, "Borders can be corrected only before finalizing the map.");
  }
  const add = changedBorderKeys(state.map!, action.addEdges ?? []);
  const remove = changedBorderKeys(state.map!, action.removeEdges ?? []);
  if (add.length + remove.length === 0) throw new DomainError(DomainErrorCode.InvalidSetupBorder, "Select at least one boundary segment.");
  const keys = new Set(mapCreation.borders.edgeKeys);
  if (remove.some((key) => !keys.has(key))) throw new DomainError(DomainErrorCode.InvalidSetupBorder, "Only existing setup boundaries can be removed.");
  for (const key of remove) keys.delete(key);
  for (const key of add) keys.add(key);
  const borders = { edgeKeys: [...keys].sort() as SetupBorderEdgeKey[] };
  const after = deriveSetupRegions(state.map!, borders);
  if (after.length !== mapCreation.regionCount) throw new DomainError(DomainErrorCode.InvalidSetupBorder, "Eine Korrektur darf die Gebietszahl nicht ändern.");
  assertMinimumSetupAreas(state.map!, after);
  return result({ ...state, map: setupMap(state, after), mapCreation: { ...mapCreation, borders } }, timestamp, [{
    type: GameEventType.SetupBordersCorrected, actorId: action.playerId,
    payload: { addedSegmentCount: add.length, removedSegmentCount: remove.length, regionCount: after.length },
  }]);
}

export function placeSetupPointOfInterest(state: GameState, action: PlaceSetupPointOfInterestAction, timestamp: string): ActionResult {
  const mapCreation = requireMapCreation(state);
  assertActive(mapCreation, action.playerId);
  if (POI_PHASES[action.poiType] !== mapCreation.stage) throw new DomainError(DomainErrorCode.InvalidPoiPlacement, "This point of interest is not due yet.");
  if (!isCellInsideMap(state.map!, action.position)) throw new DomainError(DomainErrorCode.InvalidPoiPlacement, "The point of interest must lie on the map.");
  const requirements = getSetupPoiRequirements(state.players.length);
  const placed = mapCreation.placedPoiCounts[action.poiType];
  if (placed >= requirements[action.poiType]) throw new DomainError(DomainErrorCode.InvalidPoiPlacement, "The required number is already placed.");
  if (state.pointsOfInterest.some((poi) => poi.position.x === action.position.x && poi.position.y === action.position.y)) {
    throw new DomainError(DomainErrorCode.InvalidPoiPlacement, "Only one point of interest may occupy a cell.");
  }
  const nextCounts = { ...mapCreation.placedPoiCounts, [action.poiType]: placed + 1 };
  const complete = nextCounts[action.poiType] === requirements[action.poiType];
  const nextMapCreation: MapCreationState = { ...mapCreation, placedPoiCounts: nextCounts,
    activePlayerId: nextPlayer(state, action.playerId), stage: complete ? MapCreationStage.DrawTerritories : mapCreation.stage };
  const id = `${state.gameId}:poi:${action.poiType.toLowerCase()}:${placed + 1}`;
  const setupRegionId = state.map!.cells[toCellKey(action.position)];
  return result({ ...state, pointsOfInterest: [...state.pointsOfInterest, { id, type: action.poiType, position: action.position }],
    activePlayerId: nextMapCreation.activePlayerId, mapCreation: nextMapCreation }, timestamp, [{
      type: GameEventType.PoiPlaced, actorId: action.playerId, payload: { poiId: id, poiType: action.poiType, position: action.position, setupRegionId },
    }]);
}

export type MapValidationReadState = Pick<GameState, "map" | "mapCreation" | "territories">;

function setupValidationIssues(state: MapValidationReadState, mapCreation: MapCreationState): MapValidationIssue[] {
  const regions = deriveSetupRegions(state.map!, mapCreation.borders);
  const map = materializeSetupRegionMap(state.map!, regions);
  const minimum = getMinimumTerritoryArea(map);
  const issues: MapValidationIssue[] = [];
  const covered = regions.reduce((count, region) => count + region.cells.length, 0);
  if (covered !== map.width * map.height) issues.push({ territoryId: "KARTE", code: "UNASSIGNED_CELL", message: "Karte: Setup-Regionen bedecken nicht jede Zelle." });
  for (const region of regions) {
    const id = region.id as TerritoryId;
    if (region.cells.length < minimum) issues.push({ territoryId: id, code: "BELOW_MINIMUM_AREA", message: `${region.id}: ${region.cells.length} / ${minimum} Mindestkästchen.` });
    if (!isTerritoryConnected(map, id)) issues.push({ territoryId: id, code: "DISCONNECTED", message: `${region.id}: Region ist nicht orthogonal zusammenhängend.` });
    const neighbors = getAdjacentTerritoryIds(map, id);
    if (neighbors.length < 2) issues.push({ territoryId: id, code: "TOO_FEW_NEIGHBORS", message: `${region.id}: nur ${neighbors.length} Nachbarregion${neighbors.length === 1 ? "" : "en"}.` });
  }
  return issues;
}

export function getSetupMapValidationIssues(state: MapValidationReadState): MapValidationIssue[] {
  if (state.map === undefined) return [{ territoryId: "KARTE", code: "DISCONNECTED", message: "Keine Rasterkarte vorhanden." }];
  if (state.mapCreation !== undefined && state.territories.length === 0) return setupValidationIssues(state, state.mapCreation);
  const minimum = getMinimumTerritoryArea(state.map);
  const issues: MapValidationIssue[] = [];
  const unassignedCount = Object.values(state.map.cells).filter((territoryId) => territoryId === null).length;
  if (unassignedCount > 0) issues.push({ territoryId: "KARTE", code: "UNASSIGNED_CELL", message: `Karte: ${unassignedCount} freie Rasterzelle${unassignedCount === 1 ? "" : "n"}.` });
  const territoryIds = new Set(state.territories.map((territory) => territory.id));
  const unknownCellCount = Object.values(state.map.cells).filter((territoryId) => territoryId !== null && !territoryIds.has(territoryId)).length;
  if (unknownCellCount > 0) issues.push({ territoryId: "KARTE", code: "UNKNOWN_TERRITORY", message: `Karte: ${unknownCellCount} Zelle${unknownCellCount === 1 ? "" : "n"} ohne bestehendes Gebiet.` });
  for (const territory of state.territories) {
    const area = getTerritoryArea(state.map, territory.id);
    if (area < minimum) issues.push({ territoryId: territory.id, code: "BELOW_MINIMUM_AREA", message: `${territory.id}: ${area} / ${minimum} Mindestkästchen.` });
    if (!isTerritoryConnected(state.map, territory.id)) issues.push({ territoryId: territory.id, code: "DISCONNECTED", message: `${territory.id}: Gebiet ist nicht orthogonal zusammenhängend.` });
    const neighbors = getAdjacentTerritoryIds(state.map, territory.id);
    if (neighbors.length < 2) issues.push({ territoryId: territory.id, code: "TOO_FEW_NEIGHBORS", message: `${territory.id}: nur ${neighbors.length} Nachbargebiet${neighbors.length === 1 ? "" : "e"}.` });
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
  const suits = state.players.length <= 4 ? first.slice(0, state.players.length) : [...first, ...shuffledSuits(random).slice(0, state.players.length - 4)];
  return state.players.map((player, index) => ({ ...player, secretFactionSuit: suits[index]! }));
}

function finalMapFromRegions(map: GridMapState, regions: readonly SetupRegion[]): GridMapState {
  const cells: Record<string, TerritoryId> = {};
  for (const [index, region] of regions.entries()) {
    const id = `G${String(index + 1).padStart(2, "0")}` as TerritoryId;
    for (const cell of region.cells) cells[toCellKey(cell)] = id;
  }
  return { ...map, cells } as GridMapState;
}

export function finalizeMapCreation(state: GameState, action: FinalizeMapCreationAction, random: RandomSource, timestamp: string): ActionResult {
  const mapCreation = requireMapCreation(state);
  if (!state.players.some((player) => player.id === action.playerId)) throw new DomainError(DomainErrorCode.InvalidPlayerOrder);
  const requirements = getSetupPoiRequirements(state.players.length);
  if (mapCreation.regionCount !== mapCreation.targetTerritoryCount || state.territories.length !== 0 ||
      Object.entries(requirements).some(([type, count]) => mapCreation.placedPoiCounts[type as PointOfInterestType] !== count)) {
    throw new DomainError(DomainErrorCode.InvalidMapCreationState, "All boundaries and required points of interest must be created first.");
  }
  const issues = getSetupMapValidationIssues(state);
  if (issues.length > 0) throw new DomainError(DomainErrorCode.InvalidMapCreation, issues.map((issue) => issue.message).join(" "));
  const regions = setupRegions(state, mapCreation);
  const map = finalMapFromRegions(state.map!, regions);
  const cards = drawBalancedStartingTerritoryCards(state.players.length, random);
  const territories = regions.map((_, index) => ({ id: `G${String(index + 1).padStart(2, "0")}` as TerritoryId, ownerId: null, card: cards[index]! }));
  const lastSetupPlayerId = mapCreation.lastSetupPlayerId ?? state.lastSetupPlayerId;
  if (lastSetupPlayerId === undefined) throw new DomainError(DomainErrorCode.InvalidMapCreationState, "No map drawing turn was recorded.");
  return result({ ...state, phase: GamePhase.Setup, map, territories, players: assignSecretFactions(state, random),
    nextTerritoryDisplayNumber: territories.length + 1, mapCreation: undefined, activePlayerId: undefined, lastSetupPlayerId }, timestamp, [
    { type: GameEventType.MapCreationCompleted, actorId: action.playerId, payload: { territoryCount: territories.length, lastSetupPlayerId } },
    { type: GameEventType.TerritoryCardsAssigned, payload: { territoryCount: territories.length } },
    { type: GameEventType.SecretFactionsAssigned, payload: { playerCount: state.players.length } },
    { type: GameEventType.SetupCompleted, payload: { lastSetupPlayerId } },
  ]);
}
