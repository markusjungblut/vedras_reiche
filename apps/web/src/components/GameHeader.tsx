import type { GameState } from "@vedras/game-core";
import { phaseLabel } from "../formatters/phase-label";

interface GameHeaderProps {
  state: GameState;
  playerName: (id: string) => string;
  mode?: "LOCAL" | "MULTIPLAYER";
}

export function GameHeader({ state, playerName, mode = "LOCAL" }: GameHeaderProps) {
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
        <div className="status-item"><span>Aktiv</span><strong>{state.activePlayerId ? playerName(state.activePlayerId) : "–"}</strong></div>
      </div>
      <div className="game-substatus">
        {state.activationNumbers.length > 0 && <span><b>Aktivierungszahlen</b> {state.activationNumbers.join(" · ")}</span>}
        {state.startAuctions && <span><b>Startauktion</b> Runde {state.startAuctions.round}</span>}
        {state.auction && <span><b>Laufende Auktion</b> {state.auction.territoryId}</span>}
        {state.pendingSplit && <span className="status-alert"><b>Teilung ausstehend</b> {state.pendingSplit.originalTerritoryId}</span>}
        {state.pendingWar && <span className="status-alert"><b>Krieg ausstehend</b> {state.pendingWar.attackerTerritoryId} ↔ {state.pendingWar.defenderTerritoryId}</span>}
      </div>
    </header>
  );
}
