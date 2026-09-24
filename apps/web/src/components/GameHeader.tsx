import type { PublicRoomState } from "@vedras/protocol";
import type { GameReadModel } from "../game-read-model";
import { phaseLabel } from "../formatters/phase-label";
import { ActivationNumberReveal } from "./PresentationFeedback";
import type { PresentationState } from "../presentation/game-presentation";

interface GameHeaderProps {
  readonly state: GameReadModel;
  readonly playerName: (id: string) => string;
  readonly mode?: "LOCAL" | "MULTIPLAYER";
  readonly viewerPlayerId?: string | undefined;
  readonly room?: PublicRoomState | undefined;
  readonly connectionStatus?: string | undefined;
  readonly onOpenHelp?: (() => void) | undefined;
  readonly onCopyRoomCode?: (() => void) | undefined;
  readonly onCopyInviteLink?: (() => void) | undefined;
  readonly activationReveal?: PresentationState["activationReveal"];
}

function connectionLabel(status: string | undefined): string | undefined {
  if (status === undefined) return undefined;
  if (status === "CONNECTED") return "● Verbunden";
  if (status === "RECONNECTING") return "◌ Verbindung wird wiederhergestellt";
  if (status === "CONNECTING") return "◌ Verbindung wird hergestellt";
  if (status === "SESSION_REPLACED") return "● Sitzung in anderem Fenster geöffnet";
  if (status === "PLAYER_REMOVED") return "● Aus Raum entfernt";
  if (status === "ROOM_NOT_FOUND") return "● Raum nicht gefunden";
  return "● Sitzung ungültig";
}

export function GameHeader({ state, playerName, mode = "LOCAL", viewerPlayerId, room, connectionStatus, onOpenHelp, onCopyRoomCode, onCopyInviteLink, activationReveal }: GameHeaderProps) {
  const viewer = viewerPlayerId === undefined ? undefined : state.players.find((player) => player.id === viewerPlayerId);
  const viewerIndex = viewer === undefined ? -1 : state.players.findIndex((player) => player.id === viewer.id);
  const activeText = state.auction !== undefined
    ? "Gebote werden verdeckt abgegeben"
    : state.activePlayerId === undefined ? "–"
      : state.activePlayerId === viewerPlayerId ? "Du bist am Zug" : `${playerName(state.activePlayerId)} ist am Zug`;
  const connection = connectionLabel(connectionStatus);
  return (
    <header className="game-header">
      <div className="brand-lockup">
        <div className="brand-emblem" aria-hidden="true">♜</div>
        <div><p className="eyebrow">{mode === "MULTIPLAYER" ? "Mehrspieler" : "Lokale Partie"}</p><h1>Vedras Reiche</h1></div>
      </div>
      <div className="game-status" aria-label="Spielstatus">
        {room && <div className="status-item room-status"><span>Raum</span><strong>{room.roomId}</strong></div>}
        {connection && <div className="status-item connection-status"><span>Verbindung</span><strong>{connection}</strong></div>}
        <div className="status-item"><span>Runde</span><strong>{state.round} / {state.maxRounds}</strong></div>
        <div className="status-item"><span>Phase</span><strong>{phaseLabel(state.phase)}</strong></div>
        <div className="status-item"><span>Startspieler</span><strong>{playerName(state.startPlayerId)}</strong></div>
        <div className={`status-item ${state.activePlayerId === viewerPlayerId ? "is-your-turn" : ""}`}><span>Aktiv</span><strong>{activeText}</strong></div>
        {viewer && <div className="status-item personal-status"><span>Deine Seite</span><strong className={`owner-${viewerIndex % 6}`}><i className="owner-dot" aria-hidden="true" />Du spielst als {viewer.name}</strong></div>}
      </div>
      <div className="game-header-actions">
        {room && <details className="party-menu"><summary>Partie</summary><div className="party-popover">
          <strong>Raum {room.roomId}</strong>
          <div className="button-row"><button type="button" className="secondary-button" onClick={onCopyRoomCode}>Raumcode kopieren</button>
            {onCopyInviteLink && <button type="button" className="secondary-button" onClick={onCopyInviteLink}>Einladungslink kopieren</button>}</div>
          <div className="party-player-list" aria-label="Spieler im Raum">{state.players.map((player) => {
            const participant = room.players.find((item) => item.playerId === player.id);
            return <span key={player.id}>{player.id === viewerPlayerId ? "Du" : playerName(player.id)} · {participant?.connected ? "● verbunden" : "○ getrennt"}</span>;
          })}</div>
        </div></details>}
        {onOpenHelp && <button type="button" className="help-button" onClick={onOpenHelp} aria-label="Regelhilfe öffnen">? Hilfe</button>}
      </div>
      <div className="game-substatus">
        {state.activationNumbers.length > 0 && <span><b>Aktivierungszahlen</b> <ActivationNumberReveal numbers={state.activationNumbers} reveal={activationReveal}/></span>}
        {state.startAuctions && <span><b>Startauktion</b> Runde {state.startAuctions.round}</span>}
        {state.auction && <span><b>Laufende Auktion</b> {state.auction.territoryId}</span>}
        {state.pendingSplit && <span className="status-alert"><b>Teilung ausstehend</b> {state.pendingSplit.originalTerritoryId}</span>}
        {state.pendingWar && <span className="status-alert"><b>Krieg ausstehend</b> {state.pendingWar.attackerTerritoryId} ↔ {state.pendingWar.defenderTerritoryId}</span>}
      </div>
    </header>
  );
}
