import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fastlaneBinary } from "./fastlane";
import { fileExists } from "./paths";
import { decodeRgbaRows, readPngInfo } from "./png";

/**
 * Official device frames via fastlane frameit (roadmap #9). The tool never
 * ships Apple artwork; it reads the frames the user downloaded with
 * `fastlane frameit download_frames` into ~/.fastlane/frameit/latest and the
 * accompanying offsets.json (screen cut-out position + width per device).
 */
export function framesDir(): string {
  return process.env.STORE_SHOTS_FRAMES_DIR ?? path.join(os.homedir(), ".fastlane", "frameit", "latest");
}

export interface DeviceFrame {
  /** Full name as in the file name, e.g. "Apple iPhone 16 Pro Max Black Titanium". */
  name: string;
  file: string;
  frameWidth: number;
  frameHeight: number;
  /** Screen cut-out (from offsets.json): left/top offset and width in frame pixels. */
  screenX: number;
  screenY: number;
  screenWidth: number;
  /** Corner radius of the screen cut-out in frame pixels (0 = square corners). */
  screenRadius: number;
}

interface OffsetsJson {
  portrait: Record<string, { offset: string; width: number }>;
}

let offsetsCache: OffsetsJson | undefined;

function readOffsets(): OffsetsJson | undefined {
  if (offsetsCache) return offsetsCache;
  const file = path.join(framesDir(), "offsets.json");
  if (!fileExists(file)) return undefined;
  offsetsCache = JSON.parse(fs.readFileSync(file, "utf8")) as OffsetsJson;
  return offsetsCache;
}

export function framesAvailable(): boolean {
  return readOffsets() !== undefined;
}

/**
 * offsets.json keys are device names without vendor/colour ("iPhone 16 Pro Max");
 * frame files are "Apple iPhone 16 Pro Max Black Titanium.png". Match the longest
 * offsets key contained in the file name.
 */
function offsetsFor(fileName: string): { offset: string; width: number } | undefined {
  const offsets = readOffsets();
  if (!offsets) return undefined;
  let best: { key: string; value: { offset: string; width: number } } | undefined;
  for (const [key, value] of Object.entries(offsets.portrait)) {
    if (fileName.includes(key) && (!best || key.length > best.key.length)) best = { key, value };
  }
  return best?.value;
}

const radiusCache = new Map<string, number>();

/**
 * Corner radius of the frame's screen cut-out, measured from the alpha
 * channel: walk each row of the top-left corner arc inward to the cut-out
 * edge, then fit a circle through the arc points. Rectangular screens
 * (iPads, home-button iPhones) measure 0. Cached per file.
 */
function measureScreenRadius(file: string, screenX: number, screenY: number): number {
  const hit = radiusCache.get(file);
  if (hit !== undefined) return hit;
  let radius = 0;
  try {
    const maxDy = 400;
    const png = decodeRgbaRows(file, screenY + maxDy);
    if (png) {
      const alpha = (x: number, y: number) => png.rows[(y * png.width + x) * 4 + 3];
      const fits: number[] = [];
      for (let dy = 2; dy < maxDy; dy++) {
        const y = screenY + dy;
        if (y * png.width * 4 >= png.rows.length) break;
        let x = Math.min(png.width - 1, screenX + maxDy);
        while (x > 0 && alpha(x, y) < 16) x--;
        const o = x + 1 - screenX;
        if (o <= 1) break;
        // circle through (o, dy): r = (o + dy) + sqrt(2 * o * dy)
        fits.push(o + dy + Math.sqrt(2 * o * dy));
      }
      if (fits.length >= 3) {
        fits.sort((a, b) => a - b);
        radius = Math.round(fits[Math.floor(fits.length / 2)]);
      }
    }
  } catch {
    radius = 0;
  }
  radiusCache.set(file, radius);
  return radius;
}

/** Resolve one frame by its full name (file name without .png), reading sizes from the PNG header. */
export function getFrame(name: string): DeviceFrame | undefined {
  const file = path.join(framesDir(), `${name}.png`);
  if (!fileExists(file)) return undefined;
  const off = offsetsFor(name);
  if (!off) return undefined;
  const m = /^\+?(\d+)\+(\d+)$/.exec(off.offset.trim());
  if (!m) return undefined;
  const info = readPngInfo(file);
  return {
    name,
    file,
    frameWidth: info.width,
    frameHeight: info.height,
    screenX: Number(m[1]),
    screenY: Number(m[2]),
    screenWidth: off.width,
    screenRadius: measureScreenRadius(file, Number(m[1]), Number(m[2])),
  };
}

/** Every frame on disk that has offsets (portrait). */
export function listFrames(filter?: string): DeviceFrame[] {
  const dir = framesDir();
  if (!fs.existsSync(dir)) return [];
  const out: DeviceFrame[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".png")) continue;
    const name = f.slice(0, -4);
    if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
    const frame = getFrame(name);
    if (frame) out.push(frame);
  }
  return out;
}

/** `shell: "frame:<name>"` -> name, else undefined. */
export function frameNameFromShell(shell: unknown): string | undefined {
  return typeof shell === "string" && shell.startsWith("frame:") ? shell.slice("frame:".length).trim() : undefined;
}

/** Run `fastlane frameit download_frames` (the only network step; explicit user action). */
export function downloadFrames(log: (line: string) => void = () => {}): number {
  const bin = fastlaneBinary();
  const r = spawnSync(bin!, ["frameit", "download_frames"], {
    cwd: os.tmpdir(),
    env: { ...process.env, FASTLANE_SKIP_UPDATE_CHECK: "1", FASTLANE_DISABLE_COLORS: "1", FASTLANE_OPT_OUT_USAGE: "1" },
    encoding: "utf8",
  });
  for (const line of `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n")) if (line.trim()) log(line);
  offsetsCache = undefined;
  return r.status ?? 1;
}
