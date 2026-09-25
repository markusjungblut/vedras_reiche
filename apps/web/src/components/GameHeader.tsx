import { useEffect, useState } from "react";
import type { PublicRoomState } from "@vedras/protocol";
import { GamePhase, type Suit } from "@vedras/game-core";
import type { GameReadModel } from "../game-read-model";
import { phaseLabel } from "../formatters/phase-label";
import { suitName, suitSymbol } from "../formatters/suit-label";
import { ActivationNumberReveal } from "./PresentationFeedback";
import { MusicControls } from "./MusicControls";
import type { PresentationState } from "../presentation/game-presentation";
import type { MusicPlaybackState } from "../ui/music-manager";

interface GameHeaderProps {
  readonly state: GameReadModel;
  readonly playerName: (id: string) => string;
  readonly mode?: "LOCAL" | "MULTIPLAYER";
  readonly viewerPlayerId?: string | undefined;
  readonly room?: PublicRoomState | undefined;
  readonly connectionStatus?: string | undefined;
  readonly onOpenHelp?: (() => void) | undefined;
  readonly helpOpen?: boolean;
  readonly onCloseHelp?: (() => void) | undefined;
  readonly onCopyRoomCode?: (() => void) | undefined;
  readonly onCopyInviteLink?: (() => void) | undefined;
  readonly activationReveal?: PresentationState["activationReveal"];
  readonly factionSuit?: Suit | undefined;
  readonly factionVisible?: boolean;
  readonly onFactionVisibleChange?: ((visible: boolean) => void) | undefined;
  readonly localPassAndPlay?: boolean;
  readonly onFactionPlayerChange?: ((playerId: string) => void) | undefined;
  readonly soundEnabled: boolean;
  readonly onToggleSound: () => void;
  readonly musicState: MusicPlaybackState;
  readonly onMusicEnabledChange: (enabled: boolean) => void;
  readonly onMusicVolumeChange: (volume: number) => void;
  readonly onStartMusic: () => void;
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

export function GameHeader({ state, playerName, mode = "LOCAL", viewerPlayerId, room, connectionStatus, onOpenHelp, onCopyRoomCode, onCopyInviteLink,
  activationReveal, factionSuit, factionVisible = false, onFactionVisibleChange, localPassAndPlay = false, onFactionPlayerChange,
  soundEnabled, onToggleSound, musicState, onMusicEnabledChange, onMusicVolumeChange, onStartMusic,
  helpOpen = false, onCloseHelp }: GameHeaderProps) {
  const [openPanel, setOpenPanel] = useState<"FACTION" | "MUSIC" | "PARTY" | null>(null);
  useEffect(() => { if (helpOpen) setOpenPanel(null); }, [helpOpen]);
  const togglePanel = (panel: "FACTION" | "MUSIC" | "PARTY", open: boolean) => {
    if (open) {
      setOpenPanel(panel);
      onCloseHelp?.();
    } else {
      setOpenPanel((current) => current === panel ? null : current);
    }
  };
  const viewer = viewerPlayerId === undefined ? undefined : state.players.find((player) => player.id === viewerPlayerId);
  const viewerIndex = viewer === undefined ? -1 : state.players.findIndex((player) => player.id === viewer.id);
  const activeText = state.auction !== undefined
    ? "Gebote werden verdeckt abgegeben"
    : state.activePlayerId === undefined ? "–"
      : state.activePlayerId === viewerPlayerId ? "Du bist an der Reihe" : `${playerName(state.activePlayerId)} ist an der Reihe`;
  const connection = connectionLabel(connectionStatus);
  const canShowFaction = state.phase !== GamePhase.Finished && viewer !== undefined && factionSuit !== undefined;
  const showStartAuction = state.phase === GamePhase.StartAuctions && state.startAuctions !== undefined;
  const showSubstatus = state.activationNumbers.length > 0 || showStartAuction ||
    (state.auction !== undefined && state.auction.kind !== "START") || state.pendingSplit !== undefined || state.pendingWar !== undefined;
  return <header className="game-header">
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
      {canShowFaction && <details className="faction-menu" open={openPanel === "FACTION"} onToggle={(event) => togglePanel("FACTION", event.currentTarget.open)}><summary>Fraktion</summary><div className="faction-popover">
        {localPassAndPlay && <label className="field">Bildschirm für<select value={viewer?.id} onChange={(event) => { onFactionPlayerChange?.(event.target.value); onFactionVisibleChange?.(false); }}>
          {state.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select></label>}
        {!factionVisible ? <><p>Nur {viewer?.name} kann diese Information sehen.</p><button type="button" className="primary-button" onClick={() => onFactionVisibleChange?.(true)}>Fraktion anzeigen</button></>
          : <><strong className="faction-suit">{suitSymbol(factionSuit!)} {suitName(factionSuit!).toUpperCase()}</strong><button type="button" className="secondary-button" onClick={() => onFactionVisibleChange?.(false)}>Fraktion verbergen</button></>}
      </div></details>}
      <button type="button" className="sound-toggle" aria-pressed={soundEnabled} onClick={onToggleSound}>{soundEnabled ? "🔊 Sound an" : "🔇 Sound aus"}</button>
      <MusicControls state={musicState} open={openPanel === "MUSIC"} onOpenChange={(open) => togglePanel("MUSIC", open)} onEnabledChange={onMusicEnabledChange} onVolumeChange={onMusicVolumeChange} onStart={onStartMusic} />
      {room && <details className="party-menu" open={openPanel === "PARTY"} onToggle={(event) => togglePanel("PARTY", event.currentTarget.open)}><summary>Partie</summary><div className="party-popover">
        <strong>Raum {room.roomId}</strong>
        <div className="button-row"><button type="button" className="secondary-button" onClick={onCopyRoomCode}>Raumcode kopieren</button>
          {onCopyInviteLink && <button type="button" className="secondary-button" onClick={onCopyInviteLink}>Einladungslink kopieren</button>}</div>
        <div className="party-player-list" aria-label="Spieler im Raum">{state.players.map((player) => {
          const participant = room.players.find((item) => item.playerId === player.id);
          return <span key={player.id}>{player.id === viewerPlayerId ? "Du" : playerName(player.id)} · {participant?.connected ? "● verbunden" : "○ getrennt"}</span>;
        })}</div>
      </div></details>}
      {onOpenHelp && <button type="button" className="help-button" aria-expanded={helpOpen} onClick={() => {
        setOpenPanel(null);
        if (helpOpen) onCloseHelp?.(); else onOpenHelp();
      }} aria-label={helpOpen ? "Regelhilfe schließen" : "Regelhilfe öffnen"}>? Hilfe</button>}
    </div>
    {showSubstatus && <div className="game-substatus">
      {state.activationNumbers.length > 0 && <span><b>Aktivierung {state.activationNumbers.length}/3</b> · Zahl {state.activation?.currentActivationNumber ?? state.activationNumbers.at(-1)} · <ActivationNumberReveal numbers={state.activationNumbers} reveal={activationReveal}/></span>}
      {showStartAuction && <div className="start-auction-overview" aria-label={`Startauktion Runde ${state.startAuctions!.round}`}>
        <div className="start-auction-heading"><b>Startauktion Runde {state.startAuctions!.round}</b><span>Auslage</span></div>
        <div className="start-auction-display" role="list" aria-label="Gebiete der aktuellen Startauslage">{state.startAuctions!.displayTerritoryIds.map((territoryId) => {
          const current = state.auction?.kind === "START" && state.auction.territoryId === territoryId;
          const done = !current && (state.startAuctions!.resolvedDisplayTerritoryIds?.includes(territoryId) === true ||
            state.territories.find((territory) => territory.id === territoryId)?.ownerId !== null);
          const status = current ? "aktuell" : done ? "erledigt" : "kommend";
          return <span key={territoryId} role="listitem" className={`start-auction-chip ${current ? "is-current" : done ? "is-done" : "is-upcoming"}`}
            aria-label={`${territoryId}, ${status}`}>{territoryId}{done ? " ✓" : current ? " ←" : ""}</span>;
        })}</div>
        {state.auction?.kind === "START" && <div className="start-auction-current">Aktuell: <b>{state.auction.territoryId}</b></div>}
      </div>}
      {state.auction && state.auction.kind !== "START" && <span><b>Laufende Auktion</b> {state.auction.territoryId}</span>}
      {state.pendingSplit && <span className="status-alert"><b>Teilung ausstehend</b> {state.pendingSplit.originalTerritoryId}</span>}
      {state.pendingWar && <span className="status-alert"><b>Krieg ausstehend</b> {state.pendingWar.attackerTerritoryId} ↔ {state.pendingWar.defenderTerritoryId}</span>}
    </div>}
  </header>;
}
