import type { GameState } from "@vedras/game-core";
import { phaseLabel } from "../formatters/phase-label";

interface GameHeaderProps {
  state: GameState;
  playerName: (id: string) => string;
  mode?: "LOCAL" | "MULTIPLAYER";
  viewerPlayerId?: string | undefined;
  onOpenHelp?: (() => void) | undefined;
}

export function GameHeader({ state, playerName, mode = "LOCAL", viewerPlayerId, onOpenHelp }: GameHeaderProps) {
  const viewer = viewerPlayerId === undefined ? undefined : state.players.find((player) => player.id === viewerPlayerId);
  const viewerIndex = viewer === undefined ? -1 : state.players.findIndex((player) => player.id === viewer.id);
  const activeText = state.activePlayerId === undefined ? "–"
    : state.activePlayerId === viewerPlayerId ? "Du bist am Zug" : `${playerName(state.activePlayerId)} ist am Zug`;
  return (
    <header className="game-header">
      <div className="brand-lockup">
        <div className="brand-emblem" aria-hidden="true">♜</div>
        <div>
          <p className="eyebrow">{mode === "MULTIPLAYER" ? "Mehrspieler" : "Lokale Partie"}</p>
          <h1>Vedras Reiche</h1>
        </div>
      </div>
      <div className="game-status" aria-label="Spielstatus">
        <div className="status-item"><span>Phase</span><strong>{phaseLabel(state.phase)}</strong></div>
        <div className="status-item"><span>Runde</span><strong>{state.round} / {state.maxRounds}</strong></div>
        <div className="status-item"><span>Startspieler</span><strong>{playerName(state.startPlayerId)}</strong></div>
        <div className={`status-item ${state.activePlayerId === viewerPlayerId ? "is-your-turn" : ""}`}><span>Aktiv</span><strong>{activeText}</strong></div>
        {viewer && <div className="status-item personal-status"><span>Deine Seite</span><strong className={`owner-${viewerIndex % 6}`}><i className="owner-dot" aria-hidden="true" />Du spielst als {viewer.name}</strong></div>}
      </div>
      <div className="game-substatus">
        {state.activationNumbers.length > 0 && <span><b>Aktivierungszahlen</b> {state.activationNumbers.join(" · ")}</span>}
        {state.startAuctions && <span><b>Startauktion</b> Runde {state.startAuctions.round}</span>}
        {state.auction && <span><b>Laufende Auktion</b> {state.auction.territoryId}</span>}
        {state.pendingSplit && <span className="status-alert"><b>Teilung ausstehend</b> {state.pendingSplit.originalTerritoryId}</span>}
        {state.pendingWar && <span className="status-alert"><b>Krieg ausstehend</b> {state.pendingWar.attackerTerritoryId} ↔ {state.pendingWar.defenderTerritoryId}</span>}
      </div>
      {onOpenHelp && <button type="button" className="help-button" onClick={onOpenHelp} aria-label="Regelhilfe öffnen">? Hilfe</button>}
    </header>
  );
}
