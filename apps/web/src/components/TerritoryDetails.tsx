import { getPointOfInterestTerritory, getStateAdjacentTerritoryIds, getStateTerritoryArea, type GameState } from "@vedras/game-core";
import { suitClass, suitName, suitSymbol } from "../formatters/suit-label";

interface TerritoryDetailsProps {
  state: GameState;
  territoryId: string | undefined;
  playerName: (id: string) => string;
}

export function TerritoryDetails({ state, territoryId, playerName }: TerritoryDetailsProps) {
  const territory = state.territories.find((item) => item.id === territoryId);
  if (!territory) {
    return <section className="panel details-panel" aria-label="Gebietsdetails"><p className="empty-state">Wähle ein Gebiet, um seine Details zu sehen.</p></section>;
  }
  const marks = state.borderMarks.filter((mark) => mark.territoryIds.includes(territory.id));
  const pendingBorders = state.pendingDiamondBorderChanges.filter((change) => change.sourceTerritoryId === territory.id || change.neutralTerritoryId === territory.id);
  const pois = state.pointsOfInterest.filter((poi) => territory.pointOfInterestIds?.includes(poi.id) || getPointOfInterestTerritory(state, poi) === territory.id);
  const localInfluence = Object.entries(territory.localInfluenceByPlayerId ?? {}).filter(([, amount]) => amount > 0);
  const card = territory.card;
  return (
    <section className="panel details-panel" aria-labelledby="details-title">
      <div className="panel-heading"><div><p className="eyebrow">Ausgewähltes Gebiet</p><h2 id="details-title">{territory.id}</h2></div><span className="panel-count">{territory.ownerId === null ? "Neutral" : playerName(territory.ownerId)}</span></div>
      <div className="details-grid">
        {card && <div className="detail-card-face">
          <span className="eyebrow">Gebietskarte</span>
          <div className="detail-card-symbols"><span className={suitClass(card.suit)}>{suitSymbol(card.suit)}</span>{card.additionalSuit && <span className={suitClass(card.additionalSuit)}>{suitSymbol(card.additionalSuit)}</span>}</div>
          <strong>{card.activationNumber}{card.additionalActivationNumber !== undefined ? ` / ${card.additionalActivationNumber}` : ""}</strong>
          <small>{suitName(card.suit)}{card.additionalSuit ? ` + ${suitName(card.additionalSuit)}` : ""}</small>
        </div>}
        <dl className="details-list">
          <div><dt>Besitzer</dt><dd>{territory.ownerId === null ? "Neutral" : playerName(territory.ownerId)}</dd></div>
          <div><dt>Fläche</dt><dd>{getStateTerritoryArea(state, territory.id)}</dd></div>
          <div><dt>Nachbarn</dt><dd>{getStateAdjacentTerritoryIds(state, territory.id).join(", ") || "Keine"}</dd></div>
          {territory.settlement && <div><dt>Entwicklung</dt><dd>{territory.settlement === "CITY" ? "Stadt" : "Siedlung"}</dd></div>}
          {territory.weakened !== undefined && <div><dt>Schwächung</dt><dd>{territory.weakened ? "Ja" : "Nein"}</dd></div>}
          {territory.participatedInWarThisRound !== undefined && <div><dt>Krieg diese Runde</dt><dd>{territory.participatedInWarThisRound ? "Ja" : "Nein"}</dd></div>}
          {card?.additionalActivationNumber !== undefined && <div><dt>Zusätzliche Zahl</dt><dd>{card.additionalActivationNumber}</dd></div>}
          {card?.additionalSuit && <div><dt>Zusätzliches Symbol</dt><dd>{suitSymbol(card.additionalSuit)} {suitName(card.additionalSuit)}</dd></div>}
          {localInfluence.length > 0 && <div><dt>Lokaler Einfluss</dt><dd>{localInfluence.map(([id, amount]) => `${playerName(id)} ${amount}`).join(" · ")}</dd></div>}
          {pois.length > 0 && <div><dt>Besondere Orte</dt><dd>{pois.map((poi) => `${poi.type} (${poi.id})`).join(", ")}</dd></div>}
          {marks.length > 0 && <div><dt>♦ Markierte Grenzen</dt><dd>{marks.map((mark) => `${mark.territoryIds.join(" ↔ ")} (${playerName(mark.playerId)})`).join(", ")}</dd></div>}
          {pendingBorders.length > 0 && <div><dt>♦ Ausstehende Grenzänderung</dt><dd>{pendingBorders.map((change) => `${change.sourceTerritoryId} ↔ ${change.neutralTerritoryId}`).join(", ")}</dd></div>}
        </dl>
      </div>
    </section>
  );
}
