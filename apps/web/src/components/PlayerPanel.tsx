import type { GameReadModel } from "../game-read-model";
import type { PublicRoomState } from "@vedras/protocol";

interface PlayerPanelProps {
  state: GameReadModel;
  playerName: (id: string) => string;
  viewerPlayerId?: string | undefined;
  room?: PublicRoomState | undefined;
}

export function PlayerPanel({ state, playerName, viewerPlayerId, room }: PlayerPanelProps) {
  return (
    <section className="panel player-panel" aria-labelledby="players-title">
      <div className="panel-heading"><div><p className="eyebrow">Am Tisch</p><h2 id="players-title">Spieler</h2></div><span className="panel-count">{state.players.length}</span></div>
      <div className="player-list">
        {state.players.map((player, index) => {
          const controlled = state.territories.filter((territory) => territory.ownerId === player.id).length;
          const spadeCount = state.spadeActivations.filter((effect) => effect.playerId === player.id && effect.status === "AVAILABLE").length;
          const connected = room?.players.find((participant) => participant.playerId === player.id)?.connected;
          return (
            <article key={player.id} className={`player-card owner-${index % 6} ${state.activePlayerId === player.id ? "is-active" : ""} ${viewerPlayerId === player.id ? "is-viewer" : ""}`}>
              <div className="player-card-top">
                <div className="player-name"><span className="owner-dot" aria-hidden="true" /><strong>{viewerPlayerId === player.id ? "Du" : playerName(player.id)}</strong>{viewerPlayerId === player.id && <span className="role-chip">Deine Seite</span>}</div>
                <div className="player-roles">
                  {state.startPlayerId === player.id && <span className="role-chip">Startspieler</span>}
                  {state.activePlayerId === player.id && <span className="role-chip role-active">● Aktiv</span>}
                  {connected !== undefined && <span className="role-chip">{connected ? "● Verbunden" : "○ Getrennt"}</span>}
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
