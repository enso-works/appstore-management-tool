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
  /** Screen cut-out: left/top offset and size in frame pixels (measured from the alpha channel; offsets.json is the fallback). */
  screenX: number;
  screenY: number;
  screenWidth: number;
  /** Cut-out height; absent when only offsets.json (which has no height) was available. */
  screenHeight?: number;
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
const cutoutCache = new Map<string, { x: number; y: number; width: number; height: number } | null>();

/**
 * Measure the screen cut-out directly from the frame PNG's alpha channel: the
 * transparent span through the image centre, horizontally and vertically.
 * offsets.json is fuzzy-matched by device name and is wrong for several iPad
 * frames (an entry written for an older file of a different size wins the
 * match), so the pixels are the authority and offsets.json only a fallback.
 */
export function measureScreenCutout(file: string): { x: number; y: number; width: number; height: number } | undefined {
  const hit = cutoutCache.get(file);
  if (hit !== undefined) return hit ?? undefined;
  let out: { x: number; y: number; width: number; height: number } | null = null;
  try {
    const info = readPngInfo(file);
    const png = decodeRgbaRows(file, info.height);
    if (png) {
      const alpha = (x: number, y: number) => png.rows[(y * png.width + x) * 4 + 3];
      const cx = Math.floor(png.width / 2);
      const cy = Math.floor(info.height / 2);
      /** Contiguous transparent span through (x, y) along one axis, or null. */
      const span = (x: number, y: number, dx: number, dy: number): [number, number] | null => {
        if (alpha(x, y) >= 16) return null;
        let a0 = dx ? x : y;
        while (a0 > 0 && alpha(dx ? a0 - 1 : x, dy ? a0 - 1 : y) < 16) a0--;
        let a1 = dx ? x : y;
        const max = (dx ? png.width : info.height) - 1;
        while (a1 < max && alpha(dx ? a1 + 1 : x, dy ? a1 + 1 : y) < 16) a1++;
        return [a0, a1];
      };
      const h0 = span(cx, cy, 1, 0);
      if (h0) {
        let [x0, x1] = h0;
        // The Dynamic Island / notch is opaque artwork INSIDE the cut-out, at
        // the top centre: a single centre-column scan stops at its bottom edge
        // and reports the screen ~150px too low. Sample several columns clear
        // of the island (and rows clear of nothing, symmetrically) and take
        // the union.
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const f of [0.2, 0.5, 0.8]) {
          const v = span(Math.round(x0 + (x1 - x0) * f), cy, 0, 1);
          if (v) {
            y0 = Math.min(y0, v[0]);
            y1 = Math.max(y1, v[1]);
          }
        }
        if (Number.isFinite(y0)) {
          for (const f of [0.2, 0.8]) {
            const hSpan = span(cx, Math.round(y0 + (y1 - y0) * f), 1, 0);
            if (hSpan) {
              x0 = Math.min(x0, hSpan[0]);
              x1 = Math.max(x1, hSpan[1]);
            }
          }
          // A sane cut-out sits inside the frame; a span reaching an edge means
          // the centre is part of the transparent background, not a cut-out.
          if (x0 > 0 && y0 > 0 && x1 < png.width - 1 && y1 < info.height - 1) {
            out = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
          }
        }
      }
    }
  } catch {
    out = null;
  }
  cutoutCache.set(file, out);
  return out ?? undefined;
}

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
  const info = readPngInfo(file);
  const measured = measureScreenCutout(file);
  if (measured) {
    return {
      name,
      file,
      frameWidth: info.width,
      frameHeight: info.height,
      screenX: measured.x,
      screenY: measured.y,
      screenWidth: measured.width,
      screenHeight: measured.height,
      screenRadius: measureScreenRadius(file, measured.x, measured.y),
    };
  }
  const off = offsetsFor(name);
  if (!off) return undefined;
  const m = /^\+?(\d+)\+(\d+)$/.exec(off.offset.trim());
  if (!m) return undefined;
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

/**
 * A shell override is either one value for every target ("dark" | "light" |
 * "none" | "frame:<name>") or a map keyed by target family ({ iphone, ipad,
 * ... }), so one screen can wear an iPhone frame on the iPhone target and an
 * iPad frame on the iPad target.
 */
export function resolveShell(shell: unknown, family: string): string | undefined {
  if (typeof shell === "string") return shell;
  if (shell && typeof shell === "object") {
    const v = (shell as Record<string, unknown>)[family];
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}

/** Every concrete shell value an override can resolve to (for validation). */
export function shellValues(shell: unknown): string[] {
  if (typeof shell === "string") return [shell];
  if (shell && typeof shell === "object") {
    return Object.values(shell as Record<string, unknown>).filter((v): v is string => typeof v === "string");
  }
  return [];
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
