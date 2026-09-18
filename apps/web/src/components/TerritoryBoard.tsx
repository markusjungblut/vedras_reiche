import { useState } from "react";
import {
  fromCellKey,
  getPointOfInterestTerritory,
  getSharedBorder,
  getStateTerritoryArea,
  getTerritoryCells,
  type GameState,
  type Territory,
  type GridCell,
} from "@vedras/game-core";
import { suitClass, suitName, suitSymbol } from "../formatters/suit-label";
import type { MapEditor } from "./WarControls";

interface TerritoryBoardProps {
  state: GameState;
  selectedId: string | undefined;
  onSelect: (territoryId: string) => void;
  highlightedIds: readonly string[];
  playerName: (id: string) => string;
  splitDraft?: { readonly splitId: string; readonly partAKeys: readonly string[] } | undefined;
  onToggleSplitCell: (cell: GridCell) => void;
  editor?: MapEditor | undefined;
  onToggleMapCell: (cell: GridCell) => void;
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
    <button type="button" className={classes} onClick={onSelect} aria-pressed={selected} aria-label={`${territory.id}, ${ownerName}${card ? `, ${suitName(card.suit)} ${card.activationNumber}` : ""}`}>
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

export function TerritoryBoard({ state, selectedId, onSelect, highlightedIds, playerName, splitDraft, onToggleSplitCell, editor, onToggleMapCell }: TerritoryBoardProps) {
  const highlighted = new Set(highlightedIds);
  const activated = new Set(state.activation?.pendingTerritoryIds ?? []);
  const marked = new Set(state.borderMarks.flatMap((mark) => mark.territoryIds));

  const map = state.map;
  const selectedTerritory = selectedId && state.territories.find((item) => item.id === selectedId);
  const neighborIds = selectedTerritory && map
    ? state.territories.filter((item) => getSharedBorder(map, selectedTerritory.id, item.id).segments.length > 0).map((item) => item.id)
    : [];
  return (
    <section className="panel board-panel" aria-labelledby="board-title">
      <div className="panel-heading"><div><p className="eyebrow">Rasterkarte · 32 × 20</p><h2 id="board-title">Gebietsübersicht</h2></div><span className="panel-count">{state.territories.length} Gebiete</span></div>
      {map ? <RasterMap state={state} selectedId={selectedId} onSelect={onSelect} neighborIds={neighborIds} playerName={playerName}
        splitDraft={splitDraft} onToggleSplitCell={onToggleSplitCell} editor={editor} onToggleMapCell={onToggleMapCell} /> : <p className="panel-hint">Keine Karte im Setup.</p>}
      <p className="panel-hint">{editor ? editor.mode === "CUT"
        ? editor.selectable.length > 0 ? "Teilung: Klicke Zellen des Verlierergebiets, um Teil A zu formen."
          : "Die vorgeschlagenen Teile A und B sind auf der Karte markiert. Der Verlierer wählt im Aktionsbereich."
        : "Grenzeditor: Klicke markierte Korridorzellen, um sie zu übertragen."
        : state.pendingSplit ? state.pendingSplit.stage === "AWAITING_CHOICE"
        ? "Teil A (ocker) und Teil B (blau) sind bestätigt. Die zuerst wählende Person entscheidet im Aktionsbereich."
        : "Teilungsmodus: Klicke die Kästchen des umkämpften Gebiets direkt auf der Karte an, um zwischen A und B zu wechseln."
        : "Klicke auf ein Kästchen, um sein Gebiet auszuwählen. Gebietsgrenzen entstehen aus gemeinsamen Rasterkanten."}</p>
      <div className="territory-grid">
        {state.territories.map((territory) => (
          <TerritoryCard
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
          />
        ))}
      </div>
    </section>
  );
}

interface RasterMapProps {
  readonly state: GameState;
  readonly selectedId: string | undefined;
  readonly onSelect: (territoryId: string) => void;
  readonly neighborIds: readonly string[];
  readonly playerName: (id: string) => string;
  readonly splitDraft?: { readonly splitId: string; readonly partAKeys: readonly string[] } | undefined;
  readonly onToggleSplitCell: (cell: GridCell) => void;
  readonly editor?: MapEditor | undefined;
  readonly onToggleMapCell: (cell: GridCell) => void;
}

function RasterMap({ state, selectedId, onSelect, neighborIds, playerName, splitDraft, onToggleSplitCell, editor, onToggleMapCell }: RasterMapProps) {
  const map = state.map!;
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<string>();
  const activeId = hovered ?? selectedId;
  const width = map.width;
  const height = map.height;
  const cellEntries = Object.entries(map.cells).map(([key, territoryId]) => ({ key, cell: fromCellKey(key), territoryId }));
  const activeBorders = activeId === undefined ? [] : state.territories.flatMap((territory) => {
    if (territory.id === activeId) return [];
    return getSharedBorder(map, activeId, territory.id).segments;
  });
  const boundarySegments = cellEntries.flatMap(({ cell, territoryId }) => {
    if (territoryId === null) return [];
    return [
      { x: cell.x, y: cell.y, dx: 0, dy: 1, neighbor: map.cells[`${cell.x - 1},${cell.y}`] },
      { x: cell.x, y: cell.y, dx: 1, dy: 0, neighbor: map.cells[`${cell.x},${cell.y - 1}`] },
      { x: cell.x + 1, y: cell.y, dx: 0, dy: 1, neighbor: map.cells[`${cell.x + 1},${cell.y}`] },
      { x: cell.x, y: cell.y + 1, dx: 1, dy: 0, neighbor: map.cells[`${cell.x},${cell.y + 1}`] },
    ].filter((edge) => edge.neighbor !== territoryId);
  });
  const split = state.pendingSplit;
  const splitA = new Set(split?.proposal?.partACells.map((cell) => `${cell.x},${cell.y}`) ?? splitDraft?.partAKeys ?? []);
  const splitId = split?.originalTerritoryId;
  const hasSplitOverlay = split !== undefined && (split.proposal !== undefined || splitDraft?.splitId === split.id);
  const splitBoundary = hasSplitOverlay ? cellEntries.flatMap(({ cell, key, territoryId }) => {
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
  }) : [];
  const editorAllowed = new Set(editor?.selectable.map((cell) => `${cell.x},${cell.y}`) ?? []);
  const editorSelected = new Set(editor?.selected.map((cell) => `${cell.x},${cell.y}`) ?? []);
  const poiEntries = state.pointsOfInterest.map((poi) => ({ poi, territoryId: getPointOfInterestTerritory(state, poi) }));
  return <div className="raster-map-wrap">
    <div className="map-controls" aria-label="Kartensteuerung">
      <button type="button" className="secondary-button" onClick={() => setZoom((value) => Math.min(2, value + .2))}>+</button>
      <button type="button" className="secondary-button" onClick={() => setZoom((value) => Math.max(.8, value - .2))}>−</button>
      <button type="button" className="secondary-button" onClick={() => setZoom(1)}>Auf Karte einpassen</button>
      <span className="map-legend">{activeId ? `${activeId}${hovered ? " · Hover" : " · ausgewählt"}` : "Karte"}</span>
    </div>
    <svg className={`raster-map ${split || editor ? "is-splitting" : ""}`}
      viewBox={`${(width - width / zoom) / 2} ${(height - height / zoom) / 2} ${width / zoom} ${height / zoom}`}
      role="img" aria-label="Vedras Rasterkarte">
      <rect x="0" y="0" width={width} height={height} className="map-background" />
      {cellEntries.map(({ key, cell, territoryId }) => {
        const territory = territoryId ? state.territories.find((item) => item.id === territoryId) : undefined;
        const selected = territoryId === selectedId;
        const neighbor = territoryId !== null && neighborIds.includes(territoryId);
        const ownerClass = territory?.ownerId === null || territory === undefined
          ? "map-cell-neutral" : `owner-map-${Math.max(0, state.players.findIndex((player) => player.id === territory.ownerId))}`;
        const splitPart = hasSplitOverlay && territoryId === splitId
          ? splitA.has(key) ? "map-cell-part-a" : "map-cell-part-b" : "";
        const editPart = editor && territoryId === editor.targetId
          ? editorSelected.has(key) ? "map-cell-part-a" : editorAllowed.has(key) ? "map-cell-corridor" : editor.mode === "CUT" ? "map-cell-part-b" : "" : "";
        return <rect key={key} x={cell.x} y={cell.y} width="1" height="1"
          className={`map-cell ${ownerClass} ${selected ? "map-cell-selected" : ""} ${neighbor ? "map-cell-neighbor" : ""} ${splitPart} ${editPart} ${territoryId === state.pendingWar?.attackerTerritoryId ? "map-cell-war-attacker" : ""} ${territoryId === state.pendingWar?.defenderTerritoryId ? "map-cell-war-defender" : ""}`}
          onClick={() => editorAllowed.has(key) ? onToggleMapCell(cell) : territoryId === splitId && split?.stage !== "AWAITING_CHOICE"
            ? onToggleSplitCell(cell) : territoryId !== null && onSelect(territoryId)}
          onMouseEnter={() => setHovered(territoryId ?? undefined)} onMouseLeave={() => setHovered(undefined)}
          aria-label={territory ? `${territory.id}, ${territory.ownerId ? playerName(territory.ownerId) : "neutral"}${splitPart ? `, Teil ${splitPart.endsWith("-a") ? "A" : "B"}` : ""}` : "unbelegte Fläche"} />;
      })}
      {Array.from({ length: width + 1 }, (_, x) => <line key={`vx-${x}`} x1={x} y1="0" x2={x} y2={height} className="map-grid-line" />)}
      {Array.from({ length: height + 1 }, (_, y) => <line key={`hy-${y}`} x1="0" y1={y} x2={width} y2={y} className="map-grid-line" />)}
      {boundarySegments.map((edge, index) => <line key={`outline-${index}`} x1={edge.x} y1={edge.y}
        x2={edge.x + edge.dx} y2={edge.y + edge.dy} className="map-territory-border" />)}
      {splitBoundary.map((edge, index) => <line key={`split-${index}`} x1={edge.x} y1={edge.y}
        x2={edge.x + edge.dx} y2={edge.y + edge.dy} className="map-split-border" />)}
      {activeBorders.map((edge, index) => {
        const vertical = edge.orientation === "VERTICAL";
        const edgeX = edge.cell.x + (vertical && edge.neighbor.x > edge.cell.x ? 1 : 0);
        const edgeY = edge.cell.y + (!vertical && edge.neighbor.y > edge.cell.y ? 1 : 0);
        return <line key={`border-${index}`} x1={edgeX} y1={edgeY} x2={edgeX + (vertical ? 0 : 1)} y2={edgeY + (vertical ? 1 : 0)} className="map-shared-border" />;
      })}
      {poiEntries.map(({ poi, territoryId }) => <text key={poi.id} x={poi.position.x + .5} y={poi.position.y + .72} className={`map-poi ${territoryId === selectedId ? "map-poi-selected" : ""}`}>◆</text>)}
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
      {state.territories.map((territory) => {
        const cells = getTerritoryCells(map, territory.id);
        if (cells.length === 0) return null;
        const minX = Math.min(...cells.map((cell) => cell.x));
        const minY = Math.min(...cells.map((cell) => cell.y));
        return <g key={`label-${territory.id}`} className="map-territory-label">
          <text x={minX + .2} y={minY + .42}>{territory.id}</text>
          {territory.card && <text x={minX + .2} y={minY + .88}>
            {suitSymbol(territory.card.suit)} {territory.card.activationNumber}
          </text>}
        </g>;
      })}
    </svg>
    <div className="map-summary">{selectedId ? `Gebiet ${selectedId}: ${getStateTerritoryArea(state, selectedId)} Kästchen` : "Gebiet auswählen"}</div>
  </div>;
}
