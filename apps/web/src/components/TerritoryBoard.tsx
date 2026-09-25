import { useEffect, useMemo, useRef, useState } from "react";
import {
  fromCellKey,
  formatScoreHundredths,
  GamePhase,
  getPointOfInterestTerritory,
  getWarParticipationCount,
  getSharedBorder,
  getStateTerritoryArea,
  mapScreenPointToLocal,
  Suit,
  type Territory,
  type GridCell,
  type SetupBorderEdge,
  type TerritoryScoreBreakdown,
} from "@vedras/game-core";
import { suitClass, suitName, suitSymbol } from "../formatters/suit-label";
import type { MapEditor } from "./WarControls";
import { createPenStroke, setupBorderEdgeToSegment, type GridVertex } from "../map/setup-draft";
import { getCellLabelAnchor, getCellLabelAnchorAwayFromPoints } from "../map/territory-label-anchor";
import type { GameReadModel } from "../game-read-model";
import { getMapColorRegime } from "../ui/map-color-regime";
import { describePointOfInterest, getPointOfInterestPresentation } from "../ui/point-of-interest-presentation";
import { getSetupRegionColor } from "../ui/setup-region-colors";
import type { PresentationState, TerritoryGainWave } from "../presentation/game-presentation";

export type MapViewMode = "TERRITORIES" | "MY_REALM" | "BONUSES";

function ownerFillClass(ownerId: string | null, playerIndexById: ReadonlyMap<string, number>): string {
  return ownerId === null ? "map-cell-neutral" : `owner-map-${Math.max(0, playerIndexById.get(ownerId) ?? -1)}`;
}

function bonusLines(score: TerritoryScoreBreakdown): readonly string[] {
  const lines: string[] = [];
  if (score.developmentBonusPercent === 50) lines.push("Stadt +50 %");
  else if (score.developmentBonusPercent === 25) lines.push("Siedlung +25 %");
  if (score.landmarkBonusPercent > 0) lines.push(`Wahrzeichen +${score.landmarkBonusPercent} %`);
  if (score.hubBonusPercent > 0) lines.push(`Knotenpunkt +${score.hubBonusPercent} %`);
  if (score.relicBonusPercent > 0) lines.push(`Relikt +${score.relicBonusPercent} %`);
  if (score.largestRealmBonusPercent > 0) lines.push(`Reichsteil +${score.largestRealmBonusPercent} %`);
  if (score.frontTerritoryBonusPercent > 0) lines.push(`Frontgebiet +${score.frontTerritoryBonusPercent} %`);
  if (score.factionBonusPercent > 0) lines.push(`Fraktion +${score.factionBonusPercent} %`);
  return lines;
}

function waveCellDelay(wave: TerritoryGainWave, key: string): number {
  const cells = wave.cellKeys.map(fromCellKey);
  if (cells.length === 0) return wave.delayMs;
  const origin = cells.reduce((total, cell) => ({ x: total.x + cell.x, y: total.y + cell.y }), { x: 0, y: 0 });
  const current = fromCellKey(key);
  const distance = Math.abs(current.x - origin.x / cells.length) + Math.abs(current.y - origin.y / cells.length);
  return wave.delayMs + Math.min(460, Math.round(distance * 22));
}

interface TerritoryBoardProps {
  state: GameReadModel;
  selectedId: string | undefined;
  onSelect: (territoryId: string) => void;
  onClearSelection: () => void;
  highlightedIds: readonly string[];
  presentation?: Pick<PresentationState, "territoryPulses" | "suitConfirmations" | "gainWaves"> | undefined;
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
  bonusBreakdownsByTerritoryId?: Readonly<Record<string, TerritoryScoreBreakdown>> | undefined;
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
  warSplitBoundaryEditor?: {
    readonly targetId: string;
    readonly draftEdges: readonly SetupBorderEdge[];
    readonly editable: boolean;
  } | undefined;
  onWarSplitStrokePreview?: (edges: readonly SetupBorderEdge[]) => void;
  onWarSplitStrokeCommit?: (edges: readonly SetupBorderEdge[]) => void;
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
  const warParticipationCount = getWarParticipationCount(territory);
  const classes = [
    "territory-card",
    territory.ownerId === null ? "owner-neutral" : `owner-${ownerIndex % 6}`,
    selected && "is-selected",
    highlighted && "is-neighbor",
    activated && "is-activated",
    warParticipationCount > 0 && "is-war-locked",
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
          {warParticipationCount > 0 && <span title={`${warParticipationCount} Kriegsbeteiligung${warParticipationCount === 1 ? "" : "en"} in dieser Runde`}>Krieg {warParticipationCount}</span>}
        </span>
      </span>
      {localInfluence.length > 0 && <span className="territory-influence">Einfluss: {localInfluence.map(([id, amount]) => `${playerName(id)} ${amount}`).join(" · ")}</span>}
    </button>
  );
}

export function TerritoryBoard({ state, selectedId, onSelect, onClearSelection, highlightedIds, presentation, viewerPlayerId, focusTerritoryId, partChoice, playerName, splitDraft, onToggleSplitCell, editor, onToggleMapCell,
  bonusBreakdownsByTerritoryId, setupEditor, onSetupSelectCell, onSetupStrokePreview, onSetupStrokeCommit, onSetupStrokeErase,
  warSplitBoundaryEditor, onWarSplitStrokePreview, onWarSplitStrokeCommit }: TerritoryBoardProps) {
  const [viewMode, setViewMode] = useState<MapViewMode>("TERRITORIES");
  const map = state.map;
  const selectedTerritory = selectedId && state.territories.find((item) => item.id === selectedId);
  const neighborIds = selectedTerritory && map
    ? state.territories.filter((item) => getSharedBorder(map, selectedTerritory.id, item.id).segments.length > 0).map((item) => item.id)
    : [];
  const contextualHint = setupEditor ? setupEditor.mode === "POI"
    ? "Strategischen Punkt platzieren: Wähle die in der Aktionsleiste beschriebene freie Rasterzelle."
    : setupEditor.mode === "ERASER" ? "Radiergummi: Ziehe über lokale Entwurfskanten, um sie zu entfernen."
      : "Kartenbau: Ziehe von Rastervertex zu Rastervertex."
    : editor ? editor.mode === "CUT"
      ? "Teilung: Klicke die Kästchen des Verlierergebiets, um Teil A zu formen."
      : editor.annexedDisconnectedCells.length > 0
        ? "Ocker zeigt den direkten Vorstoß, türkis automatisch annektierte Kästchen."
        : "Klicke markierte Korridorzellen, um sie zu übertragen."
    : state.pendingSplit ? "Teilungsmodus: Wähle die markierten Gebietsteile auf der Karte oder im Entscheidungsbereich."
      : undefined;
  return <section className="panel board-panel" aria-labelledby="board-title">
    {map ? <RasterMap state={state} selectedId={selectedId} onSelect={onSelect} onClearSelection={onClearSelection} neighborIds={neighborIds} highlightedIds={highlightedIds}
      presentation={presentation} viewerPlayerId={viewerPlayerId} focusTerritoryId={focusTerritoryId} partChoice={partChoice} playerName={playerName}
      splitDraft={splitDraft} onToggleSplitCell={onToggleSplitCell} editor={editor} onToggleMapCell={onToggleMapCell}
      bonusBreakdownsByTerritoryId={bonusBreakdownsByTerritoryId} viewMode={viewMode} onViewModeChange={setViewMode}
      setupEditor={setupEditor} onSetupSelectCell={onSetupSelectCell} onSetupStrokePreview={onSetupStrokePreview}
      onSetupStrokeCommit={onSetupStrokeCommit} onSetupStrokeErase={onSetupStrokeErase}
      warSplitBoundaryEditor={warSplitBoundaryEditor} onWarSplitStrokePreview={onWarSplitStrokePreview}
      onWarSplitStrokeCommit={onWarSplitStrokeCommit} /> : <p className="panel-hint">Keine Karte im Setup.</p>}
    {contextualHint && <p className="panel-hint">{contextualHint}</p>}
  </section>;
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
  readonly presentation?: TerritoryBoardProps["presentation"];
  readonly viewerPlayerId?: string | undefined;
  readonly focusTerritoryId?: string | undefined;
  readonly partChoice?: TerritoryBoardProps["partChoice"];
  readonly playerName: (id: string) => string;
  readonly splitDraft?: { readonly splitId: string; readonly partAKeys: readonly string[] } | undefined;
  readonly onToggleSplitCell: (cell: GridCell) => void;
  readonly editor?: MapEditor | undefined;
  readonly onToggleMapCell: (cell: GridCell) => void;
  readonly bonusBreakdownsByTerritoryId?: Readonly<Record<string, TerritoryScoreBreakdown>> | undefined;
  readonly viewMode: MapViewMode;
  readonly onViewModeChange: (mode: MapViewMode) => void;
  readonly setupEditor?: TerritoryBoardProps["setupEditor"];
  readonly onSetupSelectCell?: TerritoryBoardProps["onSetupSelectCell"];
  readonly onSetupStrokePreview?: TerritoryBoardProps["onSetupStrokePreview"];
  readonly onSetupStrokeCommit?: TerritoryBoardProps["onSetupStrokeCommit"];
  readonly onSetupStrokeErase?: TerritoryBoardProps["onSetupStrokeErase"];
  readonly warSplitBoundaryEditor?: TerritoryBoardProps["warSplitBoundaryEditor"];
  readonly onWarSplitStrokePreview?: TerritoryBoardProps["onWarSplitStrokePreview"];
  readonly onWarSplitStrokeCommit?: TerritoryBoardProps["onWarSplitStrokeCommit"];
}

function RasterMap({ state, selectedId, onSelect, onClearSelection, neighborIds, highlightedIds, presentation, viewerPlayerId, focusTerritoryId, partChoice, playerName, splitDraft, onToggleSplitCell, editor, onToggleMapCell,
  bonusBreakdownsByTerritoryId, viewMode, onViewModeChange, setupEditor, onSetupSelectCell, onSetupStrokePreview, onSetupStrokeCommit, onSetupStrokeErase,
  warSplitBoundaryEditor, onWarSplitStrokePreview, onWarSplitStrokeCommit }: RasterMapProps) {
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
  const pulsesByTerritoryId = useMemo(() => {
    const pulses = new Map<string, NonNullable<typeof presentation>["territoryPulses"][number]>();
    presentation?.territoryPulses.forEach((pulse) => pulses.set(pulse.territoryId, pulse));
    return pulses;
  }, [presentation?.territoryPulses]);
  const wavesByCellKey = useMemo(() => {
    const waves = new Map<string, TerritoryGainWave>();
    presentation?.gainWaves.forEach((wave) => wave.cellKeys.forEach((key) => waves.set(key, wave)));
    return waves;
  }, [presentation?.gainWaves]);
  const waveTerritoryIds = useMemo(() => new Set(presentation?.gainWaves.flatMap((wave) =>
    wave.territoryId === undefined ? [] : [wave.territoryId]) ?? []), [presentation?.gainWaves]);
  const overlayTerritoryId = partChoice?.territoryId ?? split?.originalTerritoryId ?? (editor?.mode === "CUT" ? editor.targetId : undefined);
  const splitAKeys = useMemo(() => partChoice?.partAKeys ?? split?.proposal?.partACells.map((cell) => `${cell.x},${cell.y}`) ?? splitDraft?.partAKeys ??
    (editor?.mode === "CUT" ? editor.selected.map((cell) => `${cell.x},${cell.y}`) : []), [editor, partChoice, split, splitDraft]);
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
  const warSplitDraftSegments = warSplitBoundaryEditor?.draftEdges.map(setupBorderEdgeToSegment) ?? [];
  const colorRegime = getMapColorRegime(state);
  const setupCanDraw = setupEditor !== undefined && setupEditor.mode !== "POI" && setupEditor.editable && setupAllowed.size > 0;
  const warSplitCanDraw = warSplitBoundaryEditor !== undefined && warSplitBoundaryEditor.editable;
  const boundaryCanDraw = setupCanDraw || warSplitCanDraw;
  const canPan = !boundaryCanDraw;
  const interactionOwnsMap = setupEditor !== undefined || warSplitBoundaryEditor !== undefined || editor !== undefined || (split !== undefined && split.stage !== "AWAITING_CHOICE") || partChoice?.canChoose === true;
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
  const boundaryStroke = (points: readonly GridVertex[]): SetupBorderEdge[] => {
    const stroke = strokeForPointerPoints(points);
    if (warSplitBoundaryEditor === undefined) return stroke;
    return stroke.filter((edge) => map.cells[`${edge.from.x},${edge.from.y}`] === warSplitBoundaryEditor.targetId &&
      map.cells[`${edge.to.x},${edge.to.y}`] === warSplitBoundaryEditor.targetId);
  };
  const previewPointerStroke = (points: readonly GridVertex[]) => {
    const stroke = boundaryStroke(points);
    if (warSplitBoundaryEditor !== undefined) onWarSplitStrokePreview?.(stroke);
    else onSetupStrokePreview?.(stroke);
  };
  const finishPointerStroke = () => {
    const drawing = setupPointer.current;
    if (drawing === undefined) return;
    setupPointer.current = undefined;
    const stroke = boundaryStroke(drawing.points);
    if (warSplitBoundaryEditor !== undefined) {
      if (stroke.length > 0) onWarSplitStrokeCommit?.(stroke);
      else onWarSplitStrokePreview?.([]);
      return;
    }
    if (stroke.length > 0 && setupEditor?.mode === "ERASER") onSetupStrokeErase?.(stroke);
    else if (stroke.length > 0) onSetupStrokeCommit?.(stroke);
    else onSetupStrokePreview?.([]);
  };
  const poiEntries = useMemo(() => state.pointsOfInterest.map((poi) => ({ poi, territoryId: getPointOfInterestTerritory(state, poi) })), [state]);

  const currentActivation = state.phase === GamePhase.ActivationPhase ? state.activation?.currentActivationNumber : undefined;
  return <div className="raster-map-wrap">
    <div className="map-controls" aria-label="Kartensteuerung">
      <h2 id="board-title" className="sr-only">Rasterkarte</h2>
      <div className="map-view-modes" aria-label="Kartenansicht">
        {!state.mapCreation && (["TERRITORIES", "MY_REALM", "BONUSES"] as const).map((mode) => <button key={mode} type="button"
          className={viewMode === mode ? "selected-button" : "secondary-button"} onClick={() => onViewModeChange(mode)}>
          {mode === "TERRITORIES" ? "Gebiete" : mode === "MY_REALM" ? "Mein Reich" : "Boni"}
        </button>)}
        {state.mapCreation && <span className="map-setup-title">Kartenbau · {map.width} × {map.height}</span>}
      </div>
      {currentActivation !== undefined && <div className="map-activation-status" aria-live="polite"><span>Aktivierung {state.activationNumbers.length}/3</span><strong>{currentActivation}</strong></div>}
      <div className="map-nav-controls"><span>{Math.round(zoom * 100)} %{activeId ? ` · ${activeId}${hovered ? " Hover" : " ausgewählt"}` : ""}</span>
        <button type="button" className="secondary-button" aria-label="Karte vergrößern" onClick={() => setZoomAround(zoom + .2)}>+</button>
        <button type="button" className="secondary-button" aria-label="Karte verkleinern" onClick={() => setZoomAround(zoom - .2)}>−</button>
        <button type="button" className="secondary-button" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Einpassen</button>
      </div>
    </div>
    <svg ref={svgRef} className={`raster-map map-colors-${colorRegime.toLowerCase()} map-view-${viewMode.toLowerCase()} ${split || editor || setupEditor || warSplitBoundaryEditor ? "is-splitting" : ""} ${boundaryCanDraw ? "is-boundary-drawing" : ""} ${zoom <= 1.1 ? "is-zoomed-out" : ""} ${canPan ? "can-pan" : ""} ${isPanning ? "is-panning" : ""}`}
      data-map-color-regime={colorRegime}
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
        if (!boundaryCanDraw) return;
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
        const setupRegionIndex = colorRegime === "SETUP_TERRITORIES" && state.mapCreation
          ? previewRegionIndexByCell.get(key) : undefined;
        const ownerClass = colorRegime === "SETUP_TERRITORIES" ? "map-cell-setup-region"
          : territory?.ownerId === null || territory === undefined
              ? "map-cell-neutral" : `owner-map-${Math.max(0, playerIndexById.get(territory.ownerId) ?? -1)}`;
        const setupRegionFill = colorRegime !== "SETUP_TERRITORIES" ? undefined
          : setupRegionIndex !== undefined ? getSetupRegionColor(setupRegionIndex)
            : territoryId !== null ? getSetupRegionColor(territoryId) : undefined;
        const currentStartAuction = state.auction?.kind === "START" && state.auction.territoryId === territoryId;
        const splitPart = hasSplitOverlay && territoryId === splitId
          ? splitA.has(key) ? "map-cell-part-a" : "map-cell-part-b" : "";
        const editPart = editor && territoryId === editor.targetId
          ? editor.mode === "CUT"
            ? warSplitBoundaryEditor === undefined ? editorSelected.has(key) ? "map-cell-part-a" : "map-cell-part-b" : ""
            : editorSelected.has(key) ? "map-cell-part-a" : editorAllowed.has(key) ? "map-cell-corridor" : ""
          : "";
        const annexedPart = editor && territoryId === editor.targetId && editorAnnexed.has(key) ? "map-cell-annexed" : "";
        const setupPart = setupEditor && setupAllowed.has(key)
          ? setupEditor.editable ? "map-cell-setup-available" : "map-cell-setup-locked" : "";
        const pulse = territoryId === null ? undefined : pulsesByTerritoryId.get(territoryId);
        const wave = wavesByCellKey.get(key);
        const presentationKey = (wave?.id ?? "") + ":" + (pulse?.id ?? "");
        return <rect key={key + ":" + presentationKey} x={cell.x} y={cell.y} width="1" height="1"
          style={setupRegionFill === undefined ? undefined : { fill: setupRegionFill }}
          data-territory-id={territoryId ?? ""} data-owner-id={territory?.ownerId ?? ""}
          className={`map-cell ${ownerClass} ${currentStartAuction ? "map-cell-current-auction" : ""} ${viewMode === "MY_REALM" && !ownedByViewer ? "map-cell-not-own" : ""} ${ownedByViewer ? "map-cell-own" : ""} ${selected ? "map-cell-selected" : ""} ${neighbor ? "map-cell-neighbor" : ""} ${isHighlighted ? "map-cell-activated" : ""} ${pulse ? `map-cell-activation-pulse ${pulse.subtle ? "is-subtle" : ""}` : ""} ${splitPart} ${editPart} ${annexedPart} ${setupPart} ${territoryId === state.pendingWar?.attackerTerritoryId ? "map-cell-war-attacker" : ""} ${territoryId === state.pendingWar?.defenderTerritoryId ? "map-cell-war-defender" : ""} ${partChoice?.selectedPart === (splitA.has(key) ? "A" : "B") && territoryId === partChoice.territoryId ? "map-cell-part-selected" : ""}`}
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
      {cellEntries.flatMap(({ key, cell }) => {
        const wave = wavesByCellKey.get(key);
        if (wave === undefined) return [];
        const overlayOwnerId = wave.kind === "START_AUCTION" ? wave.ownerId : wave.previousOwnerIdByCell[key] ?? null;
        return <rect key={"gain:" + wave.id + ":" + key} x={cell.x} y={cell.y} width="1" height="1"
          className={`map-gain-overlay ${ownerFillClass(overlayOwnerId, playerIndexById)} map-gain-${wave.kind.toLowerCase()}`}
          style={{ animationDelay: String(waveCellDelay(wave, key)) + "ms" }} aria-hidden="true" />;
      })}
      {Array.from({ length: width + 1 }, (_, x) => <line key={`vx-${x}`} x1={x} y1="0" x2={x} y2={height} className="map-grid-line" />)}
      {Array.from({ length: height + 1 }, (_, y) => <line key={`hy-${y}`} x1="0" y1={y} x2={width} y2={y} className="map-grid-line" />)}
      {boundarySegments.map((edge, index) => <line key={`outline-${index}`} x1={edge.x} y1={edge.y}
        x2={edge.x + edge.dx} y2={edge.y + edge.dy} className="map-territory-border" />)}
      {setupDraftSegments.map((edge, index) => <line key={`setup-draft-${index}`} x1={edge.x} y1={edge.y}
        x2={edge.x + edge.dx} y2={edge.y + edge.dy} className="map-setup-draft-border" />)}
      {warSplitDraftSegments.map((edge, index) => <line key={`war-split-draft-${index}`} x1={edge.x} y1={edge.y}
        x2={edge.x + edge.dx} y2={edge.y + edge.dy} className="map-split-border" />)}
      {splitBoundary.map((edge, index) => <line key={`split-${index}`} x1={edge.x} y1={edge.y}
        x2={edge.x + edge.dx} y2={edge.y + edge.dy} className="map-split-border" />)}
      {activeBorders.map((edge, index) => {
        const vertical = edge.orientation === "VERTICAL";
        const edgeX = edge.cell.x + (vertical && edge.neighbor.x > edge.cell.x ? 1 : 0);
        const edgeY = edge.cell.y + (!vertical && edge.neighbor.y > edge.cell.y ? 1 : 0);
        return <line key={`border-${index}`} x1={edgeX} y1={edgeY} x2={edgeX + (vertical ? 0 : 1)} y2={edgeY + (vertical ? 1 : 0)} className="map-shared-border" />;
      })}
      {poiEntries.map(({ poi, territoryId }) => {
        const presentation = getPointOfInterestPresentation(poi.type);
        return <text key={poi.id} x={poi.position.x + .5} y={poi.position.y + .72}
          tabIndex={0} role="button" onMouseEnter={() => setActivePoiId(poi.id)} onFocus={() => setActivePoiId(poi.id)}
          onClick={(event) => { event.stopPropagation(); setActivePoiId(poi.id); }}
          aria-label={`${presentation.name} ${presentation.symbol} · ${presentation.shortEffect}`} className={`map-poi map-poi-${poi.type.toLowerCase()} ${territoryId === selectedId ? "map-poi-selected" : ""}`}>
          <title>{describePointOfInterest(state, poi, territoryId)}</title>{presentation.symbol}</text>;
      })}
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
        const currentStartAuction = state.auction?.kind === "START" && state.auction.territoryId === territory.id;
        return <g key={`label-${territory.id}`} className={`map-territory-label ${compact ? "is-compact" : ""} ${currentStartAuction ? "is-current-auction" : ""} ${waveTerritoryIds.has(territory.id) ? "map-territory-label-gain" : ""}`}>
          <text x={anchor.x} y={anchor.y - (compact ? 0 : .17)}>{territory.id}</text>
          {territory.card && <text x={anchor.x} y={anchor.y + (compact ? .18 : .28)}>
            {suitSymbol(territory.card.suit)} {territory.card.activationNumber}
          </text>}

        </g>;
      })}
      {viewMode === "BONUSES" && territoryLabels.map(({ territory, anchor }) => {
        const score = bonusBreakdownsByTerritoryId?.[territory.id];
        if (anchor === undefined || score === undefined) return null;
        const lines = bonusLines(score);
        if (lines.length === 0) return null;
        return <g key={`bonus-${territory.id}`} className="map-bonus-label" aria-label={`${territory.id}: ${lines.join(", ")}`}>
          <text x={anchor.x} y={anchor.y - .52}>{lines.map((line, index) => <tspan key={line} x={anchor.x} dy={index === 0 ? 0 : .25}>{line}</tspan>)}</text>
          <text x={anchor.x} y={anchor.y + .36}>Basis {score.baseArea} · +{score.totalBonusPercent} % · {formatScoreHundredths(score.scoreHundredths)}</text>
        </g>;
      })}
      {presentation?.suitConfirmations.map((confirmation) => {
        const anchor = territoryLabels.find(({ territory }) => territory.id === confirmation.territoryId)?.anchor;
        if (anchor === undefined) return null;
        return <text key={"suit-confirmation:" + confirmation.id} x={anchor.x} y={anchor.y - .62}
          className="map-suit-confirmation" aria-label={"Aktiviert: " + suitName(confirmation.suit)}>
          {suitSymbol(confirmation.suit)}
        </text>;
      })}
    </svg>
    {selectedId && <div className="map-summary">{state.mapCreation ? "Region" : "Gebiet"} {selectedId}: {cellsByTerritoryId.get(selectedId)?.length ?? getStateTerritoryArea(state, selectedId)} Kästchen</div>}
    {activePoiId !== undefined && (() => {
      const entry = poiEntries.find(({ poi }) => poi.id === activePoiId);
      if (entry === undefined) return null;
      const presentation = getPointOfInterestPresentation(entry.poi.type);
      return <div className="map-poi-tooltip" role="status"><strong>{presentation.symbol} {presentation.name}</strong><span>{describePointOfInterest(state, entry.poi, entry.territoryId)}</span></div>;
    })()}
  </div>;
}
