import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const musicDirectory = join(repositoryRoot, "apps", "web", "public", "music");
const manifestPath = join(musicDirectory, "manifest.json");

const BIT_RATES = {
  mpeg1: {
    3: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  },
  mpeg2: {
    3: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    1: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  },
};

const SAMPLE_RATES = {
  3: [44_100, 48_000, 32_000],
  2: [22_050, 24_000, 16_000],
  0: [11_025, 12_000, 8_000],
};

function readSynchsafeInt(buffer, offset) {
  return ((buffer[offset] & 0x7f) << 21) | ((buffer[offset + 1] & 0x7f) << 14) | ((buffer[offset + 2] & 0x7f) << 7) | (buffer[offset + 3] & 0x7f);
}

function audioOffset(buffer) {
  if (buffer.subarray(0, 3).toString("ascii") !== "ID3" || buffer.length < 10) return 0;
  return Math.min(buffer.length, 10 + readSynchsafeInt(buffer, 6));
}

function parseFrame(buffer, offset) {
  if (offset + 4 > buffer.length || buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) return undefined;
  const version = (buffer[offset + 1] >> 3) & 0x03;
  const layer = (buffer[offset + 1] >> 1) & 0x03;
  const bitRateIndex = buffer[offset + 2] >> 4;
  const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03;
  const padding = (buffer[offset + 2] >> 1) & 0x01;
  if (version === 1 || layer === 0 || bitRateIndex === 0 || bitRateIndex === 15 || sampleRateIndex === 3) return undefined;
  const sampleRate = SAMPLE_RATES[version][sampleRateIndex];
  const bitRateKbps = (version === 3 ? BIT_RATES.mpeg1 : BIT_RATES.mpeg2)[layer][bitRateIndex];
  if (sampleRate === undefined || bitRateKbps === undefined || bitRateKbps === 0) return undefined;
  const layerOne = layer === 3;
  const mpegOneLayerThree = version === 3 && layer === 1;
  const samples = layerOne ? 384 : mpegOneLayerThree || layer === 2 ? 1_152 : 576;
  const base = layerOne ? 12 : mpegOneLayerThree || layer === 2 ? 144 : 72;
  const size = Math.floor((base * bitRateKbps * 1_000) / sampleRate + padding) * (layerOne ? 4 : 1);
  return size > 4 ? { size, durationMs: (samples / sampleRate) * 1_000 } : undefined;
}

/** Determine duration from MPEG audio frames, so no runtime decoder or manual duration list is required. */
export function mp3DurationMs(buffer) {
  let offset = audioOffset(buffer);
  let durationMs = 0;
  let frames = 0;
  while (offset + 4 <= buffer.length) {
    const frame = parseFrame(buffer, offset);
    if (frame === undefined || offset + frame.size > buffer.length) {
      offset += 1;
      continue;
    }
    durationMs += frame.durationMs;
    frames += 1;
    offset += frame.size;
  }
  if (frames === 0 || !Number.isFinite(durationMs) || durationMs <= 0) throw new Error("keine gültigen MPEG-Audioframes gefunden");
  return Math.max(1, Math.round(durationMs));
}

export function stableTrackId(fileName, usedIds = new Set()) {
  const base = fileName.normalize("NFKD").replace(/\p{M}/gu, "").replace(/\.mp3$/iu, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "track";
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) id = `${base}-${suffix++}`;
  usedIds.add(id);
  return id;
}

export function titleFromFileName(fileName) {
  return fileName.replace(/\.mp3$/iu, "").replace(/[ _]+/g, " ").trim();
}

export async function generateMusicManifest(directory = musicDirectory, output = join(directory, "manifest.json")) {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".mp3")
    .map((entry) => entry.name).sort((left, right) => left.localeCompare(right, "en", { sensitivity: "base" }));
  const usedIds = new Set();
  const tracks = [];
  for (const fileName of files) {
    try {
      const durationMs = mp3DurationMs(await readFile(join(directory, fileName)));
      tracks.push({ id: stableTrackId(fileName, usedIds), title: titleFromFileName(fileName), file: `/music/${encodeURIComponent(fileName)}`, durationMs });
    } catch (error) {
      console.warn(`[music] Überspringe ${fileName}: ${error instanceof Error ? error.message : "ungültige MP3-Datei"}`);
    }
  }
  const manifest = { tracks };
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[music] Manifest erzeugt: ${tracks.length} Track${tracks.length === 1 ? "" : "s"}.`);
  return manifest;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await generateMusicManifest();
}
