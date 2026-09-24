import type { MusicPlaybackState } from "../ui/music-manager";

interface MusicControlsProps {
  readonly state: MusicPlaybackState;
  readonly onEnabledChange: (enabled: boolean) => void;
  readonly onVolumeChange: (volume: number) => void;
  readonly onStart: () => void;
}

/** Local controls and credits for the room-synchronised presentation music. */
export function MusicControls({ state, onEnabledChange, onVolumeChange, onStart }: MusicControlsProps) {
  return <details className="music-menu">
    <summary>♫ Musik</summary>
    <div className="music-menu-content">
      <label className="music-switch"><input type="checkbox" checked={state.enabled} onChange={(event) => onEnabledChange(event.target.checked)} /> Hintergrundmusik</label>
      <label className="music-volume">Lautstärke <input type="range" min="0" max="100" value={Math.round(state.volume * 100)}
        onChange={(event) => onVolumeChange(Number(event.target.value) / 100)} aria-label="Musiklautstärke" /> <output>{Math.round(state.volume * 100)} %</output></label>
      {state.currentTrack !== undefined && <small>Synchron im Raum: {state.currentTrack.title}</small>}
      {state.enabled && state.requiresGesture && <button type="button" className="secondary-button" onClick={onStart}>Musik starten</button>}
      {state.tracks.length === 0 ? <small>Keine Musikdateien verfügbar.</small> : <details className="music-credits"><summary>Musik-Credits · {state.tracks.length} Titel</summary>
        <p>Music by Kevin MacLeod (incompetech.com)<br />Licensed under CC BY 4.0</p>
        <ul>{state.tracks.map((track) => <li key={track.id}>{track.title}</li>)}</ul>
        <a href="https://incompetech.com/music/royalty-free/music.html" target="_blank" rel="noreferrer">Quelle und Lizenz</a>
      </details>}
    </div>
  </details>;
}
