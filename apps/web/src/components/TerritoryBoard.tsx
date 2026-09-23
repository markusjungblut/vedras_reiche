import { useEffect, useMemo, useRef, useState } from "react";
import {
  fromCellKey,
  formatScoreHundredths,
  getPointOfInterestTerritory,
  getSharedBorder,
  getStateTerritoryArea,
  mapScreenPointToLocal,
  Suit,
  type Territory,
  type GridCell,
  type SetupBorderEdge,
} from "@vedras/game-core";
import { suitClass, suitName, suitSymbol } from "../formatters/suit-label";
import type { MapEditor } from "./WarControls";
import { createPenStroke, setupBorderEdgeToSegment, type GridVertex } from "../map/setup-draft";
import { getCellLabelAnchor, getCellLabelAnchorAwayFromPoints } from "../map/territory-label-anchor";
import type { GameReadModel } from "../game-read-model";

export type MapViewMode = "TERRITORIES" | "MY_REALM" | "REALMS" | "BONUSES";

const TERRITORY_COLORS = ["#4b7197", "#806598", "#3d817a", "#9a7048", "#5d79a7", "#8a5e6f", "#4c8a62", "#936f92", "#63836f", "#826f4a", "#537f95", "#977e5a"];

function stableColor(id: string): string {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return TERRITORY_COLORS[(hash >>> 0) % TERRITORY_COLORS.length]!;
}

function poiDescription(state: GameReadModel, poi: GameReadModel["pointsOfInterest"][number], territoryId: string | undefined): string {
  if (poi.type === "LANDMARK") return "Wahrzeichen ★ · +25 % Wertung für dieses Gebiet.";
  if (poi.type === "FORTRESS") return "Festung ▲ · +1 Verteidigung im Kampf für dieses Gebiet.";
  if (poi.type === "JUNCTION") {
    const adjacent = territoryId === undefined || state.map === undefined ? 0
      : state.territories.filter((territory) => territory.id !== territoryId
        && getSharedBorder(state.map!, territoryId, territory.id).segments.length > 0).length;
    return `Knotenpunkt ◎ · aktuell +${Math.min(50, adjacent * 10)} % Wertung für dieses Gebiet (${adjacent} Nachbargebiete, höchstens +50 %).`;
  }
  const ownerId = territoryId === undefined ? undefined : state.territories.find((territory) => territory.id === territoryId)?.ownerId;
  const controlledRelics = ownerId === undefined || ownerId === null ? 0 : state.pointsOfInterest.filter((item) => {
    const itemTerritoryId = getPointOfInterestTerritory(state, item);
    return item.type === "RELIC" && state.territories.find((territory) => territory.id === itemTerritoryId)?.ownerId === ownerId;
  }).length;
  return `Relikt ◆ · ${controlledRelics >= 2 ? "+25 % Wertung für dieses Gebiet aktiv." : `noch nicht aktiv (${controlledRelics}/2 Relikte im eigenen Reich).`}`;
}

interface TerritoryBoardProps {
  state: GameReadModel;
  selectedId: string | undefined;
  onSelect: (territoryId: string) => void;
  onClearSelection: () => void;
  highlightedIds: readonly string[];
  changedCellKeys?: readonly string[] | undefined;
  viewerPlayerId?: string | undefined;
  focusTerritoryId?: string | undefined;
  partChoice?: {
    readonly territoryId: string;
    readonly partAKeys: readonly string[];
    readonly selectedPart?: "A" | "B" | undefined;
    readonly canChoose: boolean;
    readonly onChoose: (part: "A" | "B") => void;
  } | undefined;
  playerName: (id: string) => string;
  splitDraft?: { readonly splitId: string; readonly partAKeys: readonly string[] } | undefined;
  onToggleSplitCell: (cell: GridCell) => void;
  editor?: MapEditor | undefined;
  onToggleMapCell: (cell: GridCell) => void;
  realmHighlights?: readonly { readonly componentId: string; readonly territoryIds: readonly string[]; readonly selected: boolean }[] | undefined;
  scoreHundredthsByTerritoryId?: Readonly<Record<string, number>> | undefined;
  showScoreLabels?: boolean | undefined;
  setupEditor?: {
    readonly mode: "PEN" | "ERASER" | "CORRECTION" | "POI";
    readonly selectable: readonly GridCell[];
    readonly draftEdges: readonly SetupBorderEdge[];
    readonly previewRegions?: readonly { readonly id: string; readonly cells: readonly GridCell[] }[] | undefined;
    readonly editable: boolean;
  } | undefined;
  onSetupSelectCell?: (cell: GridCell) => void;
  onSetupStrokePreview?: (edges: readonly SetupBorderEdge[]) => void;
  onSetupStrokeCommit?: (edges: readonly SetupBorderEdge[]) => void;
  onSetupStrokeErase?: (edges: readonly SetupBorderEdge[]) => void;
}

interface TerritoryCardProps {
  territory: Territory;
  area: number;
  ownerIndex: number;
  ownerName: string;
  selected: boolean;
  highlighted: boolean;
  activated: boolean;
  borderMarked: boolean;
  onSelect: () => void;
  playerName: (id: string) => string;
}

type TerritoryFilter = "ALL" | "MINE" | "NEUTRAL" | `PLAYER:${string}`;
type TerritorySort = "TERRITORY" | "SUIT" | "AREA";

const SUIT_ORDER = [Suit.Diamonds, Suit.Clubs, Suit.Hearts, Suit.Spades] as const;

function territoryOrder(state: GameReadModel): ReadonlyMap<string, number> {
  return new Map(state.territories.map((territory, index) => [territory.id, index]));
}

function sortTerritories(state: GameReadModel, territories: readonly Territory[], sort: TerritorySort, areaDirection: "ASC" | "DESC"): Territory[] {
  const order = territoryOrder(state);
  const byCanonicalOrder = (left: Territory, right: Territory) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0);
  return [...territories].sort((left, right) => {
    if (sort === "SUIT") {
      const leftSuit = left.card === undefined ? SUIT_ORDER.length : SUIT_ORDER.indexOf(left.card.suit);
      const rightSuit = right.card === undefined ? SUIT_ORDER.length : SUIT_ORDER.indexOf(right.card.suit);
      return leftSuit - rightSuit || byCanonicalOrder(left, right);
    }
    if (sort === "AREA") {
      const difference = getStateTerritoryArea(state, left.id) - getStateTerritoryArea(state, right.id);
      return (areaDirection === "DESC" ? -difference : difference) || byCanonicalOrder(left, right);
    }
    return byCanonicalOrder(left, right);
  });
}

function TerritoryCard({ territory, area, ownerIndex, ownerName, selected, highlighted, activated, borderMarked, onSelect, playerName }: TerritoryCardProps) {
  const card = territory.card;
  const localInfluence = Object.entries(territory.localInfluenceByPlayerId ?? {}).filter(([, amount]) => amount > 0);
  const classes = [
    "territory-card",
    territory.ownerId === null ? "owner-neutral" : `owner-${ownerIndex % 6}`,
    selected && "is-selected",
    highlighted && "is-neighbor",
    activated && "is-activated",
    territory.participatedInWarThisRound && "is-war-locked",
  ].filter(Boolean).join(" ");

  return (
    <button type="button" className={classes} onClick={onSelect} aria-pressed={selected} data-territory-id={territory.id} data-territory-area={area}
      data-territory-owner={territory.ownerId ?? "NEUTRAL"} data-territory-suit={card?.suit ?? "NONE"}
      aria-label={`${territory.id}, ${ownerName}${card ? `, ${suitName(card.suit)} ${card.activationNumber}` : ""}`}>
      <span className="territory-card-top"><strong>{territory.id}</strong><span>{activated ? "● Aktiviert" : "Gebiet"}</span></span>
      <span className="territory-card-center">
        {card ? <>
          <span className={`territory-suits ${suitClass(card.suit)}`} aria-label={suitName(card.suit)}>{suitSymbol(card.suit)}</span>
          {card.additionalSuit && <span className={`territory-suits ${suitClass(card.additionalSuit)}`} aria-label={suitName(card.additionalSuit)}>{suitSymbol(card.additionalSuit)}</span>}
          <span className="territory-number">{card.activationNumber}{card.additionalActivationNumber !== undefined && <small> / {card.additionalActivationNumber}</small>}</span>
        </> : <span className="muted">Keine Karte</span>}
      </span>
      <span className="territory-owner"><span className="owner-dot" aria-hidden="true" />{ownerName}</span>
      <span className="territory-card-foot">
        <span>Fläche {area}</span>
        <span className="territory-badges">
          {territory.settlement && <span title={territory.settlement === "CITY" ? "Stadt" : "Siedlung"}>{territory.settlement === "CITY" ? "Stadt" : "Siedlung"}{(territory.settlementFeatures?.length ?? 0) > 1 ? ` ×${territory.settlementFeatures!.length}` : ""}</span>}
          {borderMarked && <span title="Markierte Grenze">♦</span>}
          {territory.weakened && <span title="Geschwächt">Geschwächt</span>}
          {territory.participatedInWarThisRound && <span title="Krieg diese Runde bereits ausgeführt">Kriegssperre</span>}
        </span>
      </span>
      {localInfluence.length > 0 && <span className="territory-influence">Einfluss: {localInfluence.map(([id, amount]) => `${playerName(id)} ${amount}`).join(" · ")}</span>}
    </button>
  );
}

export function TerritoryBoard({ state, selectedId, onSelect, onClearSelection, highlightedIds, changedCellKeys, viewerPlayerId, focusTerritoryId, partChoice, playerName, splitDraft, onToggleSplitCell, editor, onToggleMapCell,
  realmHighlights, scoreHundredthsByTerritoryId, showScoreLabels, setupEditor, onSetupSelectCell, onSetupStrokePreview, onSetupStrokeCommit, onSetupStrokeErase }: TerritoryBoardProps) {
  const [viewMode, setViewMode] = useState<MapViewMode>("TERRITORIES");

  const map = state.map;
  const selectedTerritory = selectedId && state.territories.find((item) => item.id === selectedId);
  const neighborIds = selectedTerritory && map
    ? state.territories.filter((item) => getSharedBorder(map, selectedTerritory.id, item.id).segments.length > 0).map((item) => item.id)
    : [];
  return (
    <section className="panel board-panel" aria-labelledby="board-title">
      <div className="panel-heading"><div><p className="eyebrow">Rasterkarte{state.map ? ` · ${state.map.width} × ${state.map.height}` : ""}</p><h2 id="board-title">Karte</h2></div><span className="panel-count">{state.mapCreation ? state.mapCreation.regionCount : state.territories.length} {state.mapCreation ? "Regionen" : "Gebiete"}</span></div>
      {!state.mapCreation && <div className="map-view-modes" aria-label="Kartenansicht">
        {(["TERRITORIES", "MY_REALM", "REALMS", "BONUSES"] as const).map((mode) => <button key={mode} type="button"
          className={viewMode === mode ? "selected-button" : "secondary-button"} onClick={() => setViewMode(mode)}>
          {mode === "TERRITORIES" ? "Gebiete" : mode === "MY_REALM" ? "Mein Reich" : mode === "REALMS" ? "Reiche" : "Boni"}
        </button>)}
      </div>}
      {map ? <RasterMap state={state} selectedId={selectedId} onSelect={onSelect} onClearSelection={onClearSelection} neighborIds={neighborIds} highlightedIds={highlightedIds}
        changedCellKeys={changedCellKeys}
        viewerPlayerId={viewerPlayerId} focusTerritoryId={focusTerritoryId} partChoice={partChoice} playerName={playerName}
        splitDraft={splitDraft} onToggleSplitCell={onToggleSplitCell} editor={editor} onToggleMapCell={onToggleMapCell}
        realmHighlights={realmHighlights} scoreHundredthsByTerritoryId={scoreHundredthsByTerritoryId} showScoreLabels={showScoreLabels}
        viewMode={viewMode}
        setupEditor={setupEditor} onSetupSelectCell={onSetupSelectCell} onSetupStrokePreview={onSetupStrokePreview}
        onSetupStrokeCommit={onSetupStrokeCommit} onSetupStrokeErase={onSetupStrokeErase} /> : <p className="panel-hint">Keine Karte im Setup.</p>}
      <p className="panel-hint">{setupEditor ? setupEditor.mode === "POI"
        ? "Strategischen Punkt platzieren: Klicke ein beliebiges Kästchen an."
        : setupEditor.mode === "ERASER" ? "Radiergummi: Ziehe über lokale Entwurfskanten, um sie zu entfernen."
          : "Kartenbau: Ziehe von Rastervertex zu Rastervertex. Es entstehen ausschließlich Grenzkanten zwischen Zellen."
        : editor ? editor.mode === "CUT"
        ? editor.selectable.length > 0 ? "Teilung: Klicke Zellen des Verlierergebiets, um Teil A zu formen."
          : "Die vorgeschlagenen Teile A und B sind auf der Karte markiert. Wähle den gewünschten Teil direkt auf der Karte oder im Aktionsbereich."
        : editor.annexedDisconnectedCells.length > 0
        ? "Grenzeditor: Ocker zeigt den direkten Vorstoß, türkis abgeschnittenes Land, das automatisch annektiert wird."
        : "Grenzeditor: Klicke markierte Korridorzellen, um sie zu übertragen."
        : state.pendingSplit ? state.pendingSplit.stage === "AWAITING_CHOICE"
        ? "Teil A (ocker) und Teil B (blau) sind bestätigt. Die zuerst wählende Person entscheidet im Aktionsbereich."
        : "Teilungsmodus: Klicke die Kästchen des umkämpften Gebiets direkt auf der Karte an, um zwischen A und B zu wechseln."
        : "Klicke auf ein Kästchen, um sein Gebiet auszuwählen. Gebietsgrenzen entstehen aus gemeinsamen Rasterkanten."}</p>
    </section>
  );
}

export function TerritoryOverview({ state, selectedId, viewerPlayerId, highlightedIds, onSelect, playerName }: {
  readonly state: GameReadModel;
  readonly selectedId?: string | undefined;
  readonly viewerPlayerId?: string | undefined;
  readonly highlightedIds: readonly string[];
  readonly onSelect: (territoryId: string) => void;
  readonly playerName: (id: string) => string;
}) {
  const [filter, setFilter] = useState<TerritoryFilter>("ALL");
  const [sort, setSort] = useState<TerritorySort>("TERRITORY");
  const [areaDirection, setAreaDirection] = useState<"ASC" | "DESC">("DESC");
  const highlighted = useMemo(() => new Set(highlightedIds), [highlightedIds]);
  const activated = useMemo(() => new Set(state.activation?.pendingTerritoryIds ?? []), [state.activation?.pendingTerritoryIds]);
  const marked = useMemo(() => new Set(state.borderMarks.flatMap((mark) => mark.territoryIds)), [state.borderMarks]);
  const hasNeutralTerritories = state.territories.some((territory) => territory.ownerId === null);

  const filteredTerritories = useMemo(() => {
    const matching = state.territories.filter((territory) => {
      if (filter === "MINE") return viewerPlayerId !== undefined && territory.ownerId === viewerPlayerId;
      if (filter === "NEUTRAL") return territory.ownerId === null;
      if (filter.startsWith("PLAYER:")) return territory.ownerId === filter.slice("PLAYER:".length);
      return true;
    });
    return sortTerritories(state, matching, sort, areaDirection);
  }, [areaDirection, filter, sort, state, viewerPlayerId]);

  const chooseAreaSort = () => {
    if (sort === "AREA") setAreaDirection((direction) => direction === "DESC" ? "ASC" : "DESC");
    else {
      setSort("AREA");
      setAreaDirection("DESC");
    }
  };

  return <section className="panel territory-overview" aria-labelledby="territory-overview-title">
    <div className="panel-heading"><div><p className="eyebrow">Analyse</p><h2 id="territory-overview-title">Gebietsübersicht</h2></div><span className="panel-count">{filteredTerritories.length} von {state.territories.length} Gebieten</span></div>
    <div className="territory-overview-controls">
      <div className="territory-filter-tabs" aria-label="Besitzerfilter">
        <button type="button" className={filter === "ALL" ? "selected-button" : "secondary-button"} aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")}>Alle</button>
        {viewerPlayerId !== undefined && <button type="button" className={filter === "MINE" ? "selected-button" : "secondary-button"} aria-pressed={filter === "MINE"} onClick={() => setFilter("MINE")}>Meine</button>}
        {state.players.filter((player) => player.id !== viewerPlayerId).map((player) => {
          const key = `PLAYER:${player.id}` as TerritoryFilter;
          return <button type="button" key={player.id} className={filter === key ? "selected-button" : "secondary-button"} aria-pressed={filter === key} onClick={() => setFilter(key)}>{playerName(player.id)}</button>;
        })}
        {hasNeutralTerritories && <button type="button" className={filter === "NEUTRAL" ? "selected-button" : "secondary-button"} aria-pressed={filter === "NEUTRAL"} onClick={() => setFilter("NEUTRAL")}>Neutral</button>}
      </div>
      <div className="territory-sort-tabs" aria-label="Sortierung">
        <span className="eyebrow">Sortierung</span>
        <button type="button" className={sort === "TERRITORY" ? "selected-button" : "secondary-button"} aria-pressed={sort === "TERRITORY"} onClick={() => setSort("TERRITORY")}>Gebiet</button>
        <button type="button" className={sort === "SUIT" ? "selected-button" : "secondary-button"} aria-pressed={sort === "SUIT"} onClick={() => setSort("SUIT")}>Symbol</button>
        <button type="button" className={sort === "AREA" ? "selected-button" : "secondary-button"} aria-pressed={sort === "AREA"} onClick={chooseAreaSort}>Größe {areaDirection === "DESC" ? "↓" : "↑"}</button>
      </div>
    </div>
    <div className="territory-grid">
      {filteredTerritories.map((territory) => <TerritoryCard
        key={territory.id}
        territory={territory}
        area={state.map ? getStateTerritoryArea(state, territory.id) : territory.area ?? 0}
        ownerIndex={state.players.findIndex((player) => player.id === territory.ownerId)}
        ownerName={territory.ownerId === null ? "Neutral" : playerName(territory.ownerId)}
        selected={selectedId === territory.id}
        highlighted={highlighted.has(territory.id)}
        activated={activated.has(territory.id)}
        borderMarked={marked.has(territory.id)}
        onSelect={() => onSelect(territory.id)}
        playerName={playerName}
      />)}
    </div>
  </section>;
}

interface RasterMapProps {
  readonly state: GameReadModel;
  readonly selectedId: string | undefined;
  readonly onSelect: (territoryId: string) => void;
  readonly onClearSelection: () => void;
  readonly neighborIds: readonly string[];
  readonly highlightedIds: readonly string[];
  readonly changedCellKeys?: readonly string[] | undefined;
  readonly viewerPlayerId?: string | undefined;
  readonly focusTerritoryId?: string | undefined;
  readonly partChoice?: TerritoryBoardProps["partChoice"];
  readonly playerName: (id: string) => string;
  readonly splitDraft?: { readonly splitId: string; readonly partAKeys: readonly string[] } | undefined;
  readonly onToggleSplitCell: (cell: GridCell) => void;
  readonly editor?: MapEditor | undefined;
  readonly onToggleMapCell: (cell: GridCell) => void;
  readonly realmHighlights?: readonly { readonly componentId: string; readonly territoryIds: readonly string[]; readonly selected: boolean }[] | undefined;
  readonly scoreHundredthsByTerritoryId?: Readonly<Record<string, number>> | undefined;
  readonly showScoreLabels?: boolean | undefined;
  readonly viewMode: MapViewMode;
  readonly setupEditor?: TerritoryBoardProps["setupEditor"];
  readonly onSetupSelectCell?: TerritoryBoardProps["onSetupSelectCell"];
  readonly onSetupStrokePreview?: TerritoryBoardProps["onSetupStrokePreview"];
  readonly onSetupStrokeCommit?: TerritoryBoardProps["onSetupStrokeCommit"];
  readonly onSetupStrokeErase?: TerritoryBoardProps["onSetupStrokeErase"];
}

function RasterMap({ state, selectedId, onSelect, onClearSelection, neighborIds, highlightedIds, changedCellKeys, viewerPlayerId, focusTerritoryId, partChoice, playerName, splitDraft, onToggleSplitCell, editor, onToggleMapCell,
  realmHighlights, scoreHundredthsByTerritoryId, showScoreLabels, viewMode, setupEditor, onSetupSelectCell, onSetupStrokePreview, onSetupStrokeCommit, onSetupStrokeErase }: RasterMapProps) {
  const map = state.map!;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [hovered, setHovered] = useState<string>();
  const [activePoiId, setActivePoiId] = useState<string>();
  const svgRef = useRef<SVGSVGElement>(null);
  const panPointer = useRef<{ readonly pointerId: number; readonly clientX: number; readonly clientY: number; readonly pan: { readonly x: number; readonly y: number }; readonly dragging: boolean } | undefined>(undefined);
  const mousePan = useRef<{ readonly clientX: number; readonly clientY: number; readonly pan: { readonly x: number; readonly y: number }; readonly dragging: boolean } | undefined>(undefined);
  const setupPointer = useRef<{ readonly pointerId: number; readonly points: GridVertex[] } | undefined>(undefined);
  const suppressNextClick = useRef(false);
  const activeId = hovered ?? selectedId;
  const width = map.width;
  const height = map.height;
  const viewportWidth = width / zoom;
  const viewportHeight = height / zoom;
  const baseX = (width - viewportWidth) / 2;
  const baseY = (height - viewportHeight) / 2;
  const clampPan = (next: { readonly x: number; readonly y: number }) => ({
    x: Math.min(baseX, Math.max(-baseX, next.x)),
    y: Math.min(baseY, Math.max(-baseY, next.y)),
  });
  const viewX = baseX + pan.x;
  const viewY = baseY + pan.y;
  const cellEntries = useMemo(() => Object.entries(map.cells).map(([key, territoryId]) => ({ key, cell: fromCellKey(key), territoryId })), [map.cells]);
  const territoryById = useMemo(() => new Map(state.territories.map((territory) => [territory.id, territory])), [state.territories]);
  const playerIndexById = useMemo(() => new Map(state.players.map((player, index) => [player.id, index])), [state.players]);
  const cellsByTerritoryId = useMemo(() => {
    const cells = new Map<string, GridCell[]>();
    for (const { cell, territoryId } of cellEntries) {
      if (territoryId === null) continue;
      const territoryCells = cells.get(territoryId) ?? [];
      territoryCells.push(cell);
      cells.set(territoryId, territoryCells);
    }
    return cells;
  }, [cellEntries]);
  const territoryLabels = useMemo(() => state.territories.map((territory) => {
    const cells = cellsByTerritoryId.get(territory.id) ?? [];
    const points = state.pointsOfInterest.filter((poi) => getPointOfInterestTerritory(state, poi) === territory.id).map((poi) => poi.position);
    return { territory, cells, anchor: getCellLabelAnchorAwayFromPoints(cells, points) };
  }), [cellsByTerritoryId, state]);
  const activeBorders = useMemo(() => activeId === undefined ? [] : state.territories.flatMap((territory) => {
    if (territory.id === activeId) return [];
    return getSharedBorder(map, activeId, territory.id).segments;
  }), [activeId, map, state.territories]);
  const boundarySegments = useMemo(() => cellEntries.flatMap(({ cell, territoryId }) => {
    if (territoryId === null) return [];
    return [
      { x: cell.x, y: cell.y, dx: 0, dy: 1, neighbor: map.cells[`${cell.x - 1},${cell.y}`] },
      { x: cell.x, y: cell.y, dx: 1, dy: 0, neighbor: map.cells[`${cell.x},${cell.y - 1}`] },
      { x: cell.x + 1, y: cell.y, dx: 0, dy: 1, neighbor: map.cells[`${cell.x + 1},${cell.y}`] },
      { x: cell.x, y: cell.y + 1, dx: 1, dy: 0, neighbor: map.cells[`${cell.x},${cell.y + 1}`] },
    ].filter((edge) => edge.neighbor !== territoryId);
  }), [cellEntries, map.cells]);
  const split = state.pendingSplit;
  const changedCells = useMemo(() => new Set(changedCellKeys ?? []), [changedCellKeys]);
  const overlayTerritoryId = partChoice?.territoryId ?? split?.originalTerritoryId;
  const splitAKeys = useMemo(() => partChoice?.partAKeys ?? split?.proposal?.partACells.map((cell) => `${cell.x},${cell.y}`) ?? splitDraft?.partAKeys ?? [], [partChoice, split, splitDraft]);
  const splitA = useMemo(() => new Set(splitAKeys), [splitAKeys]);
  const splitId = overlayTerritoryId;
  const hasSplitOverlay = overlayTerritoryId !== undefined && splitA.size > 0;
  const splitBoundary = useMemo(() => hasSplitOverlay ? cellEntries.flatMap(({ cell, key, territoryId }) => {
    if (territoryId !== splitId || !splitA.has(key)) return [];
    const right = `${cell.x + 1},${cell.y}`;
    const below = `${cell.x},${cell.y + 1}`;
    const left = `${cell.x - 1},${cell.y}`;
    const above = `${cell.x},${cell.y - 1}`;
    const lines = [];
    if (map.cells[right] === splitId && !splitA.has(right)) lines.push({ x: cell.x + 1, y: cell.y, dx: 0, dy: 1 });
    if (map.cells[below] === splitId && !splitA.has(below)) lines.push({ x: cell.x, y: cell.y + 1, dx: 1, dy: 0 });
    if (map.cells[left] === splitId && !splitA.has(left)) lines.push({ x: cell.x, y: cell.y, dx: 0, dy: 1 });
    if (map.cells[above] === splitId && !splitA.has(above)) lines.push({ x: cell.x, y: cell.y, dx: 1, dy: 0 });
    return lines;
  }) : [], [cellEntries, hasSplitOverlay, map.cells, splitA, splitId]);
  const editorAllowed = useMemo(() => new Set(editor?.selectable.map((cell) => `${cell.x},${cell.y}`) ?? []), [editor]);
  const editorSelected = useMemo(() => new Set(editor?.selected.map((cell) => `${cell.x},${cell.y}`) ?? []), [editor]);
  const editorAnnexed = useMemo(() => new Set(editor?.annexedDisconnectedCells.map((cell) => `${cell.x},${cell.y}`) ?? []), [editor]);
  const setupAllowed = useMemo(() => new Set(setupEditor?.selectable.map((cell) => `${cell.x},${cell.y}`) ?? []), [setupEditor]);
  const previewRegionIndexByCell = useMemo(() => {
    const regions = new Map<string, number>();
    setupEditor?.previewRegions?.forEach((region, index) => region.cells.forEach((cell) => regions.set(`${cell.x},${cell.y}`, index)));
    return regions;
  }, [setupEditor]);
  const setupDraftSegments = setupEditor?.draftEdges.map(setupBorderEdgeToSegment) ?? [];
  const setupCanDraw = setupEditor !== undefined && setupEditor.mode !== "POI" && setupEditor.editable && setupAllowed.size > 0;
  const canPan = !setupCanDraw;
  const interactionOwnsMap = setupEditor !== undefined || editor !== undefined || (split !== undefined && split.stage !== "AWAITING_CHOICE") || partChoice?.canChoose === true;
  const pointerToGridPoint = (event: { readonly currentTarget: SVGSVGElement; readonly clientX: number; readonly clientY: number }): GridVertex | undefined => {
    const transform = event.currentTarget.getScreenCTM();
    if (transform === null) return undefined;
    const local = mapScreenPointToLocal(new DOMPoint(event.clientX, event.clientY), transform);
    return { x: local.x, y: local.y };
  };
  const setZoomAround = (nextZoom: number, event?: { readonly currentTarget: SVGSVGElement; readonly clientX: number; readonly clientY: number }) => {
    const normalizedZoom = Math.min(2.5, Math.max(1, nextZoom));
    if (normalizedZoom === zoom) return;
    const nextWidth = width / normalizedZoom;
    const nextHeight = height / normalizedZoom;
    const nextBaseX = (width - nextWidth) / 2;
    const nextBaseY = (height - nextHeight) / 2;
    const point = event === undefined ? undefined : pointerToGridPoint(event);
    const ratioX = point === undefined ? .5 : (point.x - viewX) / viewportWidth;
    const ratioY = point === undefined ? .5 : (point.y - viewY) / viewportHeight;
    const nextViewX = point === undefined ? nextBaseX : point.x - ratioX * nextWidth;
    const nextViewY = point === undefined ? nextBaseY : point.y - ratioY * nextHeight;
    setZoom(normalizedZoom);
    setPan({
      x: Math.min(nextBaseX, Math.max(-nextBaseX, nextViewX - nextBaseX)),
      y: Math.min(nextBaseY, Math.max(-nextBaseY, nextViewY - nextBaseY)),
    });
  };
  useEffect(() => {
    const element = svgRef.current;
    if (element === null) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoomAround(zoom + (event.deltaY < 0 ? .16 : -.16), {
        currentTarget: element, clientX: event.clientX, clientY: event.clientY,
      });
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [zoom, pan, viewX, viewY, viewportWidth, viewportHeight, width, height]);
  useEffect(() => {
    if (focusTerritoryId === undefined) return;
    const anchor = territoryLabels.find(({ territory }) => territory.id === focusTerritoryId)?.anchor;
    if (anchor === undefined) return;
    const nextZoom = 1.65;
    const nextWidth = width / nextZoom;
    const nextHeight = height / nextZoom;
    const nextBaseX = (width - nextWidth) / 2;
    const nextBaseY = (height - nextHeight) / 2;
    setZoom(nextZoom);
    setPan({
      x: Math.min(nextBaseX, Math.max(-nextBaseX, anchor.x - nextWidth / 2 - nextBaseX)),
      y: Math.min(nextBaseY, Math.max(-nextBaseY, anchor.y - nextHeight / 2 - nextBaseY)),
    });
  }, [focusTerritoryId, height, territoryLabels, width]);
  const strokeForPointerPoints = (points: readonly GridVertex[]): SetupBorderEdge[] => createPenStroke(points, width, height);
  const previewPointerStroke = (points: readonly GridVertex[]) => onSetupStrokePreview?.(strokeForPointerPoints(points));
  const finishPointerStroke = () => {
    const drawing = setupPointer.current;
    if (drawing === undefined) return;
    setupPointer.current = undefined;
    const stroke = strokeForPointerPoints(drawing.points);
    if (stroke.length > 0 && setupEditor?.mode === "ERASER") onSetupStrokeErase?.(stroke);
    else if (stroke.length > 0) onSetupStrokeCommit?.(stroke);
    else onSetupStrokePreview?.([]);
  };
  const poiEntries = useMemo(() => state.pointsOfInterest.map((poi) => ({ poi, territoryId: getPointOfInterestTerritory(state, poi) })), [state]);
  const realmByTerritoryId = useMemo(() => {
    const realms = new Map<string, { readonly index: number; readonly selected: boolean }>();
    realmHighlights?.forEach((component, index) => component.territoryIds.forEach((territoryId) =>
      realms.set(territoryId, { index, selected: component.selected })));
    return realms;
  }, [realmHighlights]);
  return <div className="raster-map-wrap">
    <div className="map-controls" aria-label="Kartensteuerung">
      <button type="button" className="secondary-button" onClick={() => setZoomAround(zoom + .2)}>+</button>
      <button type="button" className="secondary-button" onClick={() => setZoomAround(zoom - .2)}>−</button>
      <button type="button" className="secondary-button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Auf Karte einpassen</button>
      <span className="map-legend">{Math.round(zoom * 100)} % · {canPan ? "ziehen zum Verschieben" : "Zeichenwerkzeug aktiv"}{activeId ? ` · ${activeId}${hovered ? " Hover" : " ausgewählt"}` : ""}</span>
    </div>
    <svg ref={svgRef} className={`raster-map map-view-${viewMode.toLowerCase()} ${split || editor || setupEditor ? "is-splitting" : ""} ${zoom <= 1.1 ? "is-zoomed-out" : ""} ${canPan ? "can-pan" : ""} ${isPanning ? "is-panning" : ""}`}
      viewBox={`${viewX} ${viewY} ${viewportWidth} ${viewportHeight}`}
      preserveAspectRatio="xMidYMid meet"
      role="img" aria-label="Vedras Rasterkarte"
      onPointerDown={(event) => {
        if (event.button === 1) {
          const dragging = event.button === 1;
          if (dragging) event.preventDefault();
          panPointer.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, pan, dragging };
          if (dragging) {
            event.currentTarget.setPointerCapture(event.pointerId);
            setIsPanning(true);
          }
          return;
        }
        if (!setupCanDraw) return;
        if (event.button !== 0) return;
        event.preventDefault();
        const point = pointerToGridPoint(event);
        if (point === undefined) return;
        setupPointer.current = { pointerId: event.pointerId, points: [point] };
        event.currentTarget.setPointerCapture(event.pointerId);
        if (setupEditor?.mode !== "ERASER") previewPointerStroke([point]);
      }}
      onPointerMove={(event) => {
        const panning = panPointer.current;
        if (panning?.pointerId === event.pointerId) {
          const moved = Math.hypot(event.clientX - panning.clientX, event.clientY - panning.clientY);
          if (!panning.dragging && moved < 6) return;
          const transform = event.currentTarget.getScreenCTM();
          if (transform === null) return;
          if (!panning.dragging) {
            panPointer.current = { ...panning, dragging: true };
            event.currentTarget.setPointerCapture(event.pointerId);
            setIsPanning(true);
          }
          const start = mapScreenPointToLocal(new DOMPoint(panning.clientX, panning.clientY), transform);
          const current = mapScreenPointToLocal(new DOMPoint(event.clientX, event.clientY), transform);
          setPan(clampPan({
            x: panning.pan.x - (current.x - start.x),
            y: panning.pan.y - (current.y - start.y),
          }));
          return;
        }
        const drawing = setupPointer.current;
        if (drawing === undefined || drawing.pointerId !== event.pointerId) return;
        const point = pointerToGridPoint(event);
        if (point === undefined) return;
        const previous = drawing.points[drawing.points.length - 1]!;
        if (Math.abs(point.x - previous.x) < .08 && Math.abs(point.y - previous.y) < .08) return;
        const points = [...drawing.points, point];
        setupPointer.current = { ...drawing, points };
        if (setupEditor?.mode === "ERASER") onSetupStrokeErase?.(strokeForPointerPoints(points));
        else previewPointerStroke(points);
      }}
      onPointerUp={(event) => {
        const panning = panPointer.current;
        if (panning?.pointerId === event.pointerId) {
          panPointer.current = undefined;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          const moved = Math.hypot(event.clientX - panning.clientX, event.clientY - panning.clientY);
          const didDrag = panning.dragging || moved >= 6;
          if (didDrag && !panning.dragging) {
            const transform = event.currentTarget.getScreenCTM();
            if (transform !== null) {
              const start = mapScreenPointToLocal(new DOMPoint(panning.clientX, panning.clientY), transform);
              const current = mapScreenPointToLocal(new DOMPoint(event.clientX, event.clientY), transform);
              setPan(clampPan({
                x: panning.pan.x - (current.x - start.x),
                y: panning.pan.y - (current.y - start.y),
              }));
            }
          }
          if (didDrag) suppressNextClick.current = true;
          setIsPanning(false);
          return;
        }
        if (setupPointer.current?.pointerId !== event.pointerId) return;
        finishPointerStroke();
      }}
      onPointerCancel={() => { panPointer.current = undefined; setIsPanning(false); finishPointerStroke(); }}
      onMouseDown={(event) => {
        if (!canPan || event.button !== 0) return;
        mousePan.current = { clientX: event.clientX, clientY: event.clientY, pan, dragging: false };
      }}
      onMouseMove={(event) => {
        const panning = mousePan.current;
        if (panning === undefined) return;
        const moved = Math.hypot(event.clientX - panning.clientX, event.clientY - panning.clientY);
        if (!panning.dragging && moved < 6) return;
        const transform = event.currentTarget.getScreenCTM();
        if (transform === null) return;
        if (!panning.dragging) {
          mousePan.current = { ...panning, dragging: true };
          setIsPanning(true);
        }
        const start = mapScreenPointToLocal(new DOMPoint(panning.clientX, panning.clientY), transform);
        const current = mapScreenPointToLocal(new DOMPoint(event.clientX, event.clientY), transform);
        setPan(clampPan({
          x: panning.pan.x - (current.x - start.x),
          y: panning.pan.y - (current.y - start.y),
        }));
      }}
      onMouseUp={(event) => {
        const panning = mousePan.current;
        if (panning === undefined) return;
        mousePan.current = undefined;
        const moved = Math.hypot(event.clientX - panning.clientX, event.clientY - panning.clientY);
        const didDrag = panning.dragging || moved >= 6;
        if (didDrag && !panning.dragging) {
          const transform = event.currentTarget.getScreenCTM();
          if (transform !== null) {
            const start = mapScreenPointToLocal(new DOMPoint(panning.clientX, panning.clientY), transform);
            const current = mapScreenPointToLocal(new DOMPoint(event.clientX, event.clientY), transform);
            setPan(clampPan({
              x: panning.pan.x - (current.x - start.x),
              y: panning.pan.y - (current.y - start.y),
            }));
          }
        }
        if (didDrag) suppressNextClick.current = true;
        setIsPanning(false);
      }}
      onClickCapture={(event) => {
        if (!suppressNextClick.current) return;
        suppressNextClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        if ((event.target === event.currentTarget || (event.target as Element).classList.contains("map-background")) && !interactionOwnsMap) onClearSelection();
      }}>
      <rect x="0" y="0" width={width} height={height} className="map-background" />
      {cellEntries.map(({ key, cell, territoryId }) => {
        const territory = territoryId ? territoryById.get(territoryId) : undefined;
        const selected = territoryId === selectedId;
        const neighbor = territoryId !== null && neighborIds.includes(territoryId);
        const isHighlighted = territoryId !== null && highlightedIds.includes(territoryId);
        const ownedByViewer = territory?.ownerId !== null && territory?.ownerId === viewerPlayerId;
        const setupRegionIndex = state.mapCreation ? previewRegionIndexByCell.get(key) : undefined;
        const ownerClass = setupRegionIndex !== undefined ? `map-cell-setup-region-${setupRegionIndex}`
          : viewMode === "TERRITORIES"
            ? territory?.ownerId === null || territory === undefined ? "map-cell-neutral" : "map-cell-territory"
            : territory?.ownerId === null || territory === undefined
              ? "map-cell-neutral" : `owner-map-${Math.max(0, playerIndexById.get(territory.ownerId) ?? -1)}`;
        const territoryFill = setupRegionIndex === undefined && viewMode === "TERRITORIES" && territoryId !== null
          ? stableColor(territoryId) : undefined;
        const splitPart = hasSplitOverlay && territoryId === splitId
          ? splitA.has(key) ? "map-cell-part-a" : "map-cell-part-b" : "";
        const editPart = editor && territoryId === editor.targetId
          ? editorSelected.has(key) ? "map-cell-part-a" : editorAllowed.has(key) ? "map-cell-corridor" : editor.mode === "CUT" ? "map-cell-part-b" : "" : "";
        const annexedPart = editor && territoryId === editor.targetId && editorAnnexed.has(key) ? "map-cell-annexed" : "";
        const setupPart = setupEditor && setupAllowed.has(key)
          ? setupEditor.editable ? "map-cell-setup-available" : "map-cell-setup-locked" : "";
        const realm = territoryId === null ? undefined : realmByTerritoryId.get(territoryId);
        const realmClass = realm === undefined ? "" : realm.selected ? "map-cell-largest-realm" : `map-cell-realm-candidate-${realm.index % 4}`;
        return <rect key={key} x={cell.x} y={cell.y} width="1" height="1"
          style={territoryFill === undefined ? undefined : { fill: territoryFill }}
          className={`map-cell ${ownerClass} ${viewMode === "MY_REALM" && !ownedByViewer ? "map-cell-not-own" : ""} ${ownedByViewer ? "map-cell-own" : ""} ${selected ? "map-cell-selected" : ""} ${neighbor ? "map-cell-neighbor" : ""} ${isHighlighted ? "map-cell-activated" : ""} ${changedCells.has(key) ? "map-cell-war-changed" : ""} ${splitPart} ${editPart} ${annexedPart} ${setupPart} ${realmClass} ${territoryId === state.pendingWar?.attackerTerritoryId ? "map-cell-war-attacker" : ""} ${territoryId === state.pendingWar?.defenderTerritoryId ? "map-cell-war-defender" : ""} ${partChoice?.selectedPart === (splitA.has(key) ? "A" : "B") && territoryId === partChoice.territoryId ? "map-cell-part-selected" : ""}`}
          onClick={() => {
            if (setupEditor !== undefined) {
              if (setupEditor.mode === "POI" && setupEditor.editable && setupAllowed.has(key)) onSetupSelectCell?.(cell);
              return;
            }
            if (editorAllowed.has(key)) onToggleMapCell(cell);
            else if (partChoice?.canChoose && territoryId === partChoice.territoryId) partChoice.onChoose(splitA.has(key) ? "A" : "B");
            else if (territoryId === splitId && split?.stage !== "AWAITING_CHOICE") onToggleSplitCell(cell);
            else if (territoryId !== null) onSelect(territoryId);
          }}
          onMouseEnter={() => setHovered(territoryId ?? undefined)}
          onMouseLeave={() => setHovered(undefined)}
          aria-label={territory ? `${territory.id}, ${territory.ownerId ? playerName(territory.ownerId) : "neutral"}${splitPart ? `, Teil ${splitPart.endsWith("-a") ? "A" : "B"}` : ""}` : "unbelegte Fläche"} />;
      })}
      {Array.from({ length: width + 1 }, (_, x) => <line key={`vx-${x}`} x1={x} y1="0" x2={x} y2={height} className="map-grid-line" />)}
      {Array.from({ length: height + 1 }, (_, y) => <line key={`hy-${y}`} x1="0" y1={y} x2={width} y2={y} className="map-grid-line" />)}
      {boundarySegments.map((edge, index) => <line key={`outline-${index}`} x1={edge.x} y1={edge.y}
        x2={edge.x + edge.dx} y2={edge.y + edge.dy} className="map-territory-border" />)}
      {setupDraftSegments.map((edge, index) => <line key={`setup-draft-${index}`} x1={edge.x} y1={edge.y}
        x2={edge.x + edge.dx} y2={edge.y + edge.dy} className="map-setup-draft-border" />)}
      {splitBoundary.map((edge, index) => <line key={`split-${index}`} x1={edge.x} y1={edge.y}
        x2={edge.x + edge.dx} y2={edge.y + edge.dy} className="map-split-border" />)}
      {activeBorders.map((edge, index) => {
        const vertical = edge.orientation === "VERTICAL";
        const edgeX = edge.cell.x + (vertical && edge.neighbor.x > edge.cell.x ? 1 : 0);
        const edgeY = edge.cell.y + (!vertical && edge.neighbor.y > edge.cell.y ? 1 : 0);
        return <line key={`border-${index}`} x1={edgeX} y1={edgeY} x2={edgeX + (vertical ? 0 : 1)} y2={edgeY + (vertical ? 1 : 0)} className="map-shared-border" />;
      })}
      {poiEntries.map(({ poi, territoryId }) => <text key={poi.id} x={poi.position.x + .5} y={poi.position.y + .72}
        tabIndex={0} role="button" onMouseEnter={() => setActivePoiId(poi.id)} onFocus={() => setActivePoiId(poi.id)}
        onClick={(event) => { event.stopPropagation(); setActivePoiId(poi.id); }}
        aria-label={poiDescription(state, poi, territoryId)} className={`map-poi map-poi-${poi.type.toLowerCase()} ${territoryId === selectedId ? "map-poi-selected" : ""}`}>
        <title>{poiDescription(state, poi, territoryId)}</title>{poi.type === "LANDMARK" ? "★" : poi.type === "JUNCTION" ? "◎" : poi.type === "FORTRESS" ? "▲" : "◆"}</text>)}
      {state.territories.flatMap((territory) => territory.settlementFeatures ?? (territory.settlementFeature ? [territory.settlementFeature] : [])).map((feature) => <text key={`settlement-${feature.id}`}
        x={feature.position.x + .5} y={feature.position.y + .75}
        className="map-settlement">{feature.kind === "CITY" ? "♜" : "⌂"}</text>)}
      {state.borderMarks.flatMap((mark, index) => {
        const segments = getSharedBorder(map, mark.territoryIds[0]!, mark.territoryIds[1]!).segments;
        const edge = segments[Math.floor(segments.length / 2)];
        if (!edge) return [];
        return <text key={`mark-${index}`} x={(edge.cell.x + edge.neighbor.x) / 2 + .5}
          y={(edge.cell.y + edge.neighbor.y) / 2 + .72} className="map-border-mark">♦</text>;
      })}
      {state.mapCreation && setupEditor?.previewRegions?.map((region) => {
        const anchor = getCellLabelAnchor(region.cells);
        if (anchor === undefined) return null;
        return <g key={`setup-label-${region.id}`} className="map-territory-label map-setup-region-label">
          <text x={anchor.x} y={anchor.y - .17}>{region.id}</text>
          <text x={anchor.x} y={anchor.y + .28}>{region.cells.length}</text>
        </g>;
      })}
      {hasSplitOverlay && (() => {
        const partACells = cellEntries.filter((entry) => entry.territoryId === splitId && splitA.has(entry.key)).map((entry) => entry.cell);
        const partBCells = cellEntries.filter((entry) => entry.territoryId === splitId && !splitA.has(entry.key)).map((entry) => entry.cell);
        const partAAnchor = getCellLabelAnchor(partACells);
        const partBAnchor = getCellLabelAnchor(partBCells);
        return <>
          {partAAnchor && <text x={partAAnchor.x} y={partAAnchor.y} className={`map-part-label map-part-label-a ${partChoice?.selectedPart === "A" ? "is-selected" : ""}`}>A{partChoice?.selectedPart === "A" ? " ✓" : ""}</text>}
          {partBAnchor && <text x={partBAnchor.x} y={partBAnchor.y} className={`map-part-label map-part-label-b ${partChoice?.selectedPart === "B" ? "is-selected" : ""}`}>B{partChoice?.selectedPart === "B" ? " ✓" : ""}</text>}
        </>;
      })()}
      {!state.mapCreation && territoryLabels.map(({ territory, cells, anchor }) => {
        if (hasSplitOverlay && territory.id === splitId) return null;
        if (anchor === undefined) return null;
        const compact = cells.length < 3 || anchor.boundaryDistance === 0;
        return <g key={`label-${territory.id}`} className={`map-territory-label ${compact ? "is-compact" : ""}`}>
          <text x={anchor.x} y={anchor.y - (compact ? 0 : .17)}>{territory.id}</text>
          {territory.card && <text x={anchor.x} y={anchor.y + (compact ? .18 : .28)}>
            {suitSymbol(territory.card.suit)} {territory.card.activationNumber}
          </text>}
          {showScoreLabels && scoreHundredthsByTerritoryId?.[territory.id] !== undefined && <text x={anchor.x} y={anchor.y + (compact ? .2 : .66)}>
            {formatScoreHundredths(scoreHundredthsByTerritoryId[territory.id]!)}
          </text>}
        </g>;
      })}
    </svg>
    <div className="map-summary">{selectedId ? `${state.mapCreation ? "Region" : "Gebiet"} ${selectedId}: ${cellsByTerritoryId.get(selectedId)?.length ?? getStateTerritoryArea(state, selectedId)} Kästchen` : state.mapCreation ? "Region auswählen" : "Gebiet auswählen"}</div>
    {activePoiId !== undefined && (() => {
      const entry = poiEntries.find(({ poi }) => poi.id === activePoiId);
      return entry === undefined ? null : <div className="map-poi-tooltip" role="status"><strong>{entry.poi.type === "LANDMARK" ? "Wahrzeichen ★" : entry.poi.type === "JUNCTION" ? "Knotenpunkt ◎" : entry.poi.type === "FORTRESS" ? "Festung ▲" : "Relikt ◆"}</strong><span>{poiDescription(state, entry.poi, entry.territoryId)}</span></div>;
    })()}
  </div>;
}
