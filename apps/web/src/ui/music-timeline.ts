export interface MusicTrack {
  readonly id: string;
  readonly title: string;
  readonly file: string;
  readonly durationMs: number;
}

export interface MusicManifest {
  readonly tracks: readonly MusicTrack[];
}

export interface TimelineTrack {
  readonly track: MusicTrack;
  readonly offsetMs: number;
}

/** A small deterministic presentation shuffle; it deliberately has no relationship to game randomness. */
export function playlistForRoom(tracks: readonly MusicTrack[], roomId: string): readonly MusicTrack[] {
  const ordered = [...tracks].sort((left, right) => left.id.localeCompare(right.id, "en", { sensitivity: "base" }));
  let seed = hashRoomId(roomId);
  for (let index = ordered.length - 1; index > 0; index -= 1) {
    seed = nextSeed(seed);
    const swapIndex = seed % (index + 1);
    [ordered[index], ordered[swapIndex]] = [ordered[swapIndex]!, ordered[index]!];
  }
  return ordered;
}

export function trackAtElapsed(playlist: readonly MusicTrack[], elapsedMs: number): TimelineTrack | undefined {
  const playable = playlist.filter((track) => Number.isFinite(track.durationMs) && track.durationMs > 0);
  const totalDuration = playable.reduce((total, track) => total + track.durationMs, 0);
  if (playable.length === 0 || totalDuration <= 0) return undefined;
  let remaining = ((Math.max(0, elapsedMs) % totalDuration) + totalDuration) % totalDuration;
  for (const track of playable) {
    if (remaining < track.durationMs) return { track, offsetMs: remaining };
    remaining -= track.durationMs;
  }
  return { track: playable[0]!, offsetMs: 0 };
}

export function elapsedAtSnapshot(musicStartedAt: string | undefined, serverTime: string | undefined): number | undefined {
  if (musicStartedAt === undefined || serverTime === undefined) return undefined;
  const startedAt = Date.parse(musicStartedAt);
  const receivedAt = Date.parse(serverTime);
  if (!Number.isFinite(startedAt) || !Number.isFinite(receivedAt)) return undefined;
  return Math.max(0, receivedAt - startedAt);
}

export function elapsedFromAnchor(anchorElapsedMs: number, anchorPerformanceMs: number, currentPerformanceMs: number): number {
  return Math.max(0, anchorElapsedMs + Math.max(0, currentPerformanceMs - anchorPerformanceMs));
}

function hashRoomId(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function nextSeed(seed: number): number {
  let value = (seed + 0x6d2b79f5) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return (value ^ (value >>> 14)) >>> 0;
}
