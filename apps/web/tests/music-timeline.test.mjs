import assert from "node:assert/strict";
import test from "node:test";
import { elapsedAtSnapshot, elapsedFromAnchor, playlistForRoom, trackAtElapsed } from "../.test-dist/ui/music-timeline.js";
import { MusicManager } from "../.test-dist/ui/music-manager.js";

const tracks = [
  { id: "a", title: "A", file: "/music/a.mp3", durationMs: 1_000 },
  { id: "b", title: "B", file: "/music/b.mp3", durationMs: 2_000 },
  { id: "c", title: "C", file: "/music/c.mp3", durationMs: 3_000 },
];

test("room playlists are deterministic and timeline boundaries wrap correctly", () => {
  const first = playlistForRoom(tracks, "ROOM-1");
  assert.deepEqual(first.map((track) => track.id), playlistForRoom([...tracks].reverse(), "ROOM-1").map((track) => track.id));
  assert.equal(trackAtElapsed(tracks, 0).track.id, "a");
  assert.equal(trackAtElapsed(tracks, 999).offsetMs, 999);
  assert.deepEqual(trackAtElapsed(tracks, 1_000), { track: tracks[1], offsetMs: 0 });
  assert.deepEqual(trackAtElapsed(tracks, 6_000), { track: tracks[0], offsetMs: 0 });
  assert.deepEqual(trackAtElapsed(tracks, 7_500), { track: tracks[1], offsetMs: 500 });
});

test("two clients use server time rather than local system time for the same room offset", () => {
  const elapsed = elapsedAtSnapshot("2026-09-24T10:00:00.000Z", "2026-09-24T10:02:14.000Z");
  assert.equal(elapsed, 134_000);
  const firstClient = trackAtElapsed(playlistForRoom(tracks, "SAME"), elapsedFromAnchor(elapsed, 100, 420));
  const reconnectingClient = trackAtElapsed(playlistForRoom(tracks, "SAME"), elapsedFromAnchor(elapsed, 1_000, 1_320));
  assert.deepEqual(firstClient, reconnectingClient);
});

test("enabling music resumes the current shared timeline instead of an old local pause", async () => {
  const originalAudio = globalThis.Audio;
  const originalMediaElement = globalThis.HTMLMediaElement;
  const originalFetch = globalThis.fetch;
  const created = [];
  class FakeAudio {
    constructor() { this.dataset = {}; this.readyState = 1; this.duration = 10; this.currentTime = 0; this.paused = true; created.push(this); }
    addEventListener() {}
    removeEventListener() {}
    load() {}
    pause() { this.paused = true; }
    async play() { this.paused = false; }
    removeAttribute() {}
  }
  globalThis.Audio = FakeAudio;
  globalThis.HTMLMediaElement = { HAVE_METADATA: 1 };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ tracks: tracks.slice(0, 2) }) });
  const manager = new MusicManager();
  try {
    manager.updateRoom({ roomId: "SYNC", status: "RUNNING", musicStartedAt: "2026-09-24T10:00:00.000Z", serverTime: "2026-09-24T10:00:00.500Z" });
    await manager.loadManifest();
    await manager.unlock();
    manager.setEnabled(false);
    assert.equal(created[0].paused, true);
    manager.updateRoom({ roomId: "SYNC", status: "RUNNING", musicStartedAt: "2026-09-24T10:00:00.000Z", serverTime: "2026-09-24T10:00:02.500Z" });
    manager.setEnabled(true);
    await new Promise((resolve) => setImmediate(resolve));
    const expected = trackAtElapsed(playlistForRoom(tracks.slice(0, 2), "SYNC"), 2_500);
    assert.equal(manager.getState().currentTrack.id, expected.track.id);
    assert.ok(Math.abs(created[0].currentTime - expected.offsetMs / 1_000) < 0.1,
      `expected ${expected.offsetMs / 1_000}s, received ${created[0].currentTime}s`);
  } finally {
    manager.dispose();
    globalThis.Audio = originalAudio;
    globalThis.HTMLMediaElement = originalMediaElement;
    globalThis.fetch = originalFetch;
  }
});
