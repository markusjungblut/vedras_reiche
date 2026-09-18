import type { GameState, Territory } from "@vedras/game-core";
import { suitClass, suitName, suitSymbol } from "../formatters/suit-label";

interface TerritoryBoardProps {
  state: GameState;
  selectedId: string | undefined;
  onSelect: (territoryId: string) => void;
  highlightedIds: readonly string[];
  playerName: (id: string) => string;
}

interface TerritoryCardProps {
  territory: Territory;
  ownerIndex: number;
  ownerName: string;
  selected: boolean;
  highlighted: boolean;
  activated: boolean;
  borderMarked: boolean;
  onSelect: () => void;
  playerName: (id: string) => string;
}

function TerritoryCard({ territory, ownerIndex, ownerName, selected, highlighted, activated, borderMarked, onSelect, playerName }: TerritoryCardProps) {
  const card = territory.card;
  const localInfluence = Object.entries(territory.localInfluenceByPlayerId ?? {}).filter(([, amount]) => amount > 0);
  const classes = [
    "territory-card",
    territory.ownerId === null ? "owner-neutral" : `owner-${ownerIndex % 6}`,
    selected && "is-selected",
    highlighted && "is-neighbor",
    activated && "is-activated",
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
        <span>Fläche {territory.area}</span>
        <span className="territory-badges">
          {territory.settlement && <span title={territory.settlement === "CITY" ? "Stadt" : "Siedlung"}>{territory.settlement === "CITY" ? "Stadt" : "Siedlung"}</span>}
          {borderMarked && <span title="Markierte Grenze">♦</span>}
          {territory.weakened && <span title="Geschwächt">Geschwächt</span>}
        </span>
      </span>
      {localInfluence.length > 0 && <span className="territory-influence">Einfluss: {localInfluence.map(([id, amount]) => `${playerName(id)} ${amount}`).join(" · ")}</span>}
    </button>
  );
}

export function TerritoryBoard({ state, selectedId, onSelect, highlightedIds, playerName }: TerritoryBoardProps) {
  const highlighted = new Set(highlightedIds);
  const activated = new Set(state.activation?.pendingTerritoryIds ?? []);
  const marked = new Set(state.borderMarks.flatMap((mark) => mark.territoryIds));

  return (
    <section className="panel board-panel" aria-labelledby="board-title">
      <div className="panel-heading"><div><p className="eyebrow">Abstrakte Spielbrettansicht</p><h2 id="board-title">Gebietsübersicht</h2></div><span className="panel-count">{state.territories.length} Gebiete</span></div>
      <p className="panel-hint">Gebiet wählen, um Karte, Nachbarschaften und Merkmale zu sehen. Die Anordnung bildet keine Grenzen ab.</p>
      <div className="territory-grid">
        {state.territories.map((territory) => (
          <TerritoryCard
            key={territory.id}
            territory={territory}
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
