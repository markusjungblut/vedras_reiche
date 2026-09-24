import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { generateMusicManifest } from "../../../scripts/generate-music-manifest.mjs";

function tinyMp3(frameCount = 2) {
  const frameSize = 417; // MPEG-1 Layer III, 128 kbps, 44.1 kHz.
  const bytes = Buffer.alloc(frameSize * frameCount);
  for (let index = 0; index < frameCount; index += 1) {
    bytes[index * frameSize] = 0xff;
    bytes[index * frameSize + 1] = 0xfb;
    bytes[index * frameSize + 2] = 0x90;
  }
  return bytes;
}

test("music manifest discovers valid MP3s in a stable order and ignores other files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vedras-music-"));
  try {
    await writeFile(join(directory, "Second Coming - no percussion.mp3"), tinyMp3());
    await writeFile(join(directory, "Alpha Track.mp3"), tinyMp3(3));
    await writeFile(join(directory, "cover.png"), "not music");
    const manifest = await generateMusicManifest(directory);
    assert.deepEqual(manifest.tracks.map((track) => track.id), ["alpha-track", "second-coming-no-percussion"]);
    assert.deepEqual(manifest.tracks.map((track) => track.file), ["/music/Alpha%20Track.mp3", "/music/Second%20Coming%20-%20no%20percussion.mp3"]);
    assert.equal(manifest.tracks.every((track) => track.durationMs > 0), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
