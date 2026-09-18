import type { GameState } from "@vedras/game-core";

interface PlayerPanelProps {
  state: GameState;
  playerName: (id: string) => string;
}

export function PlayerPanel({ state, playerName }: PlayerPanelProps) {
  return (
    <section className="panel player-panel" aria-labelledby="players-title">
      <div className="panel-heading"><div><p className="eyebrow">Am Tisch</p><h2 id="players-title">Spieler</h2></div><span className="panel-count">{state.players.length}</span></div>
      <div className="player-list">
        {state.players.map((player, index) => {
          const controlled = state.territories.filter((territory) => territory.ownerId === player.id).length;
          const spadeCount = state.spadeActivations.filter((effect) => effect.playerId === player.id && effect.status === "AVAILABLE").length;
          return (
            <article key={player.id} className={`player-card owner-${index % 6} ${state.activePlayerId === player.id ? "is-active" : ""}`}>
              <div className="player-card-top">
                <div className="player-name"><span className="owner-dot" aria-hidden="true" /><strong>{playerName(player.id)}</strong></div>
                <div className="player-roles">
                  {state.startPlayerId === player.id && <span className="role-chip">Startspieler</span>}
                  {state.activePlayerId === player.id && <span className="role-chip role-active">● Aktiv</span>}
                </div>
              </div>
              <div className="player-stats">
                <div><span>Gebiete</span><strong>{controlled}</strong></div>
                <div><span>Globaler Einfluss</span><strong>{player.globalInfluence ?? "–"}</strong></div>
                <div><span>Grundgebote</span><strong>{player.availableBasicBids?.join(", ") || "–"}</strong></div>
                {spadeCount > 0 && <div><span>♠ verfügbar</span><strong>{spadeCount}</strong></div>}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
