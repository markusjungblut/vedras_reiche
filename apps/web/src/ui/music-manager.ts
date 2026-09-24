import type { PublicRoomState } from "@vedras/protocol";
import { elapsedAtSnapshot, elapsedFromAnchor, playlistForRoom, trackAtElapsed, type MusicManifest, type MusicTrack } from "./music-timeline.js";

const MUSIC_ENABLED_KEY = "vedras-reiche-music-enabled";
const MUSIC_VOLUME_KEY = "vedras-reiche-music-volume";
const DEFAULT_MUSIC_VOLUME = 0.28;
const DRIFT_CORRECTION_SECONDS = 1.25;
const RESYNC_INTERVAL_MS = 30_000;

export interface MusicPlaybackState {
  readonly enabled: boolean;
  readonly volume: number;
  readonly tracks: readonly MusicTrack[];
  readonly currentTrack?: MusicTrack;
  readonly requiresGesture: boolean;
}

interface TimelineAnchor {
  readonly roomId: string;
  readonly elapsedMs: number;
  readonly performanceMs: number;
}

export function loadMusicPreference(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): boolean {
  try {
    return storage?.getItem(MUSIC_ENABLED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveMusicPreference(enabled: boolean, storage: Pick<Storage, "setItem"> | undefined = browserStorage()): void {
  try {
    storage?.setItem(MUSIC_ENABLED_KEY, String(enabled));
  } catch { /* Local preferences are optional. */ }
}

export function loadMusicVolume(storage: Pick<Storage, "getItem"> | undefined = browserStorage()): number {
  try {
    const parsed = Number(storage?.getItem(MUSIC_VOLUME_KEY));
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_MUSIC_VOLUME;
  } catch {
    return DEFAULT_MUSIC_VOLUME;
  }
}

export function saveMusicVolume(volume: number, storage: Pick<Storage, "setItem"> | undefined = browserStorage()): void {
  try {
    storage?.setItem(MUSIC_VOLUME_KEY, String(clampVolume(volume)));
  } catch { /* Local preferences are optional. */ }
}

/** Presentation-only manager for the authoritative room music timeline. */
export class MusicManager {
  private audio: HTMLAudioElement | undefined;
  private readonly listeners = new Set<(state: MusicPlaybackState) => void>();
  private tracks: readonly MusicTrack[] = [];
  private anchor: TimelineAnchor | undefined;
  private enabled = loadMusicPreference();
  private volume = loadMusicVolume();
  private unlocked = false;
  private requiresGesture = false;
  private currentTrack: MusicTrack | undefined;
  private readonly failedTrackIds = new Set<string>();
  private loading: Promise<void> | undefined;
  private requestVersion = 0;
  private resyncTimer: number | undefined;

  getState(): MusicPlaybackState {
    return { enabled: this.enabled, volume: this.volume, tracks: this.tracks, ...(this.currentTrack === undefined ? {} : { currentTrack: this.currentTrack }), requiresGesture: this.requiresGesture };
  }

  subscribe(listener: (state: MusicPlaybackState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async loadManifest(): Promise<void> {
    if (this.loading !== undefined) return this.loading;
    this.loading = this.readManifest().finally(() => { this.loading = undefined; });
    return this.loading;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    saveMusicPreference(enabled);
    if (!enabled) {
      this.audio?.pause();
      this.requiresGesture = false;
      this.publish();
      return;
    }
    this.publish();
    void this.synchronize();
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    saveMusicVolume(this.volume);
    if (this.audio !== undefined) this.audio.volume = this.volume;
    this.publish();
  }

  /** Called only from a browser user gesture. It may start the current shared track. */
  async unlock(): Promise<void> {
    this.unlocked = true;
    this.requiresGesture = false;
    await this.synchronize();
  }

  updateRoom(room: PublicRoomState | undefined): void {
    const elapsedMs = room === undefined ? undefined : elapsedAtSnapshot(room.musicStartedAt, room.serverTime);
    if (room === undefined || elapsedMs === undefined || (room.status !== "RUNNING" && room.status !== "FINISHED")) {
      this.anchor = undefined;
      this.currentTrack = undefined;
      this.audio?.pause();
      this.stopResync();
      this.publish();
      return;
    }
    this.anchor = { roomId: room.roomId, elapsedMs, performanceMs: performanceNow() };
    void this.loadManifest().then(() => this.synchronize());
    this.startResync();
    this.publish();
  }

  dispose(): void {
    this.stopResync();
    this.requestVersion += 1;
    this.audio?.pause();
    this.audio?.removeAttribute("src");
    this.audio?.load();
    this.audio = undefined;
    this.listeners.clear();
  }

  private async readManifest(): Promise<void> {
    if (typeof fetch !== "function") return;
    try {
      const response = await fetch("/music/manifest.json", { cache: "no-store" });
      if (!response.ok) return;
      const manifest = await response.json() as MusicManifest;
      this.tracks = normalizeTracks(manifest);
      this.publish();
    } catch {
      // Background music is optional. A missing manifest leaves the game fully usable.
    }
  }

  private async synchronize(): Promise<void> {
    const anchor = this.anchor;
    if (!this.enabled || anchor === undefined || this.tracks.length === 0) return;
    const target = trackAtElapsed(playlistForRoom(this.tracks, anchor.roomId), elapsedFromAnchor(anchor.elapsedMs, anchor.performanceMs, performanceNow()));
    if (target === undefined || this.failedTrackIds.has(target.track.id)) {
      this.audio?.pause();
      this.currentTrack = undefined;
      this.publish();
      return;
    }
    this.currentTrack = target.track;
    const request = ++this.requestVersion;
    const audio = this.ensureAudio();
    const trackChanged = audio.dataset.musicTrackId !== target.track.id;
    if (trackChanged) {
      audio.dataset.musicTrackId = target.track.id;
      audio.dataset.musicTrackTitle = target.track.title;
      audio.src = target.track.file;
      audio.load();
      await metadataLoaded(audio);
      if (request !== this.requestVersion) return;
    }
    const targetSeconds = Math.min(Math.max(0, target.offsetMs / 1_000), Math.max(0, (audio.duration || target.track.durationMs / 1_000) - 0.02));
    if (trackChanged || !Number.isFinite(audio.currentTime) || Math.abs(audio.currentTime - targetSeconds) >= DRIFT_CORRECTION_SECONDS) {
      try { audio.currentTime = targetSeconds; } catch { /* The next metadata event or snapshot will retry. */ }
    }
    if (this.unlocked) {
      try {
        await audio.play();
        if (request !== this.requestVersion) return;
        this.requiresGesture = false;
      } catch {
        this.requiresGesture = true;
      }
    } else {
      this.requiresGesture = true;
    }
    this.publish();
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio !== undefined) return this.audio;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.volume = this.volume;
    audio.addEventListener("ended", () => { void this.synchronize(); });
    audio.addEventListener("error", () => {
      const failedId = audio.dataset.musicTrackId;
      if (failedId !== undefined) this.failedTrackIds.add(failedId);
      audio.pause();
      this.currentTrack = undefined;
      this.publish();
      console.warn(`[music] Der Track „${audio.dataset.musicTrackTitle ?? "unbekannt"}“ konnte nicht geladen werden.`);
    });
    this.audio = audio;
    return audio;
  }

  private startResync(): void {
    if (this.resyncTimer !== undefined || typeof window === "undefined") return;
    this.resyncTimer = window.setInterval(() => { void this.synchronize(); }, RESYNC_INTERVAL_MS);
  }

  private stopResync(): void {
    if (this.resyncTimer === undefined || typeof window === "undefined") return;
    window.clearInterval(this.resyncTimer);
    this.resyncTimer = undefined;
  }

  private publish(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}

function normalizeTracks(manifest: MusicManifest): readonly MusicTrack[] {
  if (!Array.isArray(manifest?.tracks)) return [];
  return manifest.tracks.filter((track): track is MusicTrack => typeof track?.id === "string" && track.id.length > 0 &&
    typeof track.title === "string" && typeof track.file === "string" && track.file.startsWith("/music/") &&
    Number.isFinite(track.durationMs) && track.durationMs > 0).sort((left, right) => left.id.localeCompare(right.id, "en", { sensitivity: "base" }));
}

function metadataLoaded(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve) => {
    const complete = () => {
      audio.removeEventListener("loadedmetadata", complete);
      audio.removeEventListener("error", complete);
      resolve();
    };
    audio.addEventListener("loadedmetadata", complete, { once: true });
    audio.addEventListener("error", complete, { once: true });
  });
}

function clampVolume(volume: number): number { return Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : DEFAULT_MUSIC_VOLUME)); }
function performanceNow(): number { return typeof performance === "undefined" ? 0 : performance.now(); }
function browserStorage(): Storage | undefined { return typeof localStorage === "undefined" ? undefined : localStorage; }

export const musicManager = new MusicManager();
