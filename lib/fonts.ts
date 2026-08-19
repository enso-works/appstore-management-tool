import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Project } from "./config";
import { dirExists, fileExists, resolveWithin } from "./paths";
import { fontsLockSchema, formatZodError, type FontsLock } from "./schema";

/**
 * Fonts (plan §12): any Google Fonts family, downloaded ONCE into the app's
 * store/assets/fonts/<family>/ by `fonts add`. Rendering only ever loads local
 * files — never fonts.googleapis.com — so exports are deterministic and offline.
 *
 * Resolution order for a family: app store/assets/fonts/<slug>/ → the tool's
 * bundled assets/fonts/<slug>/ (Inter + Noto fallbacks) → missing.
 */

export const FONTS_LOCK = "fonts.lock.json";

export interface FontFile {
  path: string; // relative to the fonts dir of the lock it belongs to
  weight: number;
  style: string;
  sha256: string;
}

export interface ResolvedFont {
  family: string;
  /** Absolute directory holding the files. */
  dir: string;
  files: FontFile[];
  source: "app" | "bundled";
}

export function familySlug(family: string): string {
  return family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function bundledFontsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");
}

export function appFontsDir(project: Project): string {
  return path.join(project.paths.assets, "fonts");
}

function readLock(dir: string): FontsLock | undefined {
  const file = path.join(dir, FONTS_LOCK);
  if (!fileExists(file)) return undefined;
  const parsed = fontsLockSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`${file}: ${formatZodError(parsed.error).join("; ")}`);
  return parsed.data;
}

function writeLock(dir: string, lock: FontsLock) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, FONTS_LOCK), JSON.stringify(lock, null, 2) + "\n");
}

/** Find a family in the app's fonts dir, else in the bundled dir. */
export function resolveFont(project: Project | undefined, family: string): ResolvedFont | undefined {
  const candidates: { dir: string; source: "app" | "bundled" }[] = [];
  if (project) candidates.push({ dir: appFontsDir(project), source: "app" });
  candidates.push({ dir: bundledFontsDir(), source: "bundled" });
  for (const c of candidates) {
    const lock = safeLock(c.dir);
    const entry = lock?.fonts.find((f) => f.family.toLowerCase() === family.toLowerCase());
    if (entry) return { family: entry.family, dir: c.dir, files: entry.files, source: c.source };
  }
  return undefined;
}

function safeLock(dir: string): FontsLock | undefined {
  try {
    return readLock(dir);
  } catch {
    return undefined;
  }
}

/**
 * The ordered font stack for rendering: brand family, configured fallbacks,
 * then every bundled family not already listed. Missing configured families are
 * returned in `missing` so validate can report them; the brand family itself
 * missing is a hard error for the caller.
 */
/** Families whose absence is an error (not a fallback): body and headline faces. */
export function requiredFontFamilies(project: Project): string[] {
  const b = project.config.brand;
  return [b.font.family, ...(b.headlineFont ? [b.headlineFont.family] : [])];
}

export function resolveFontStack(project: Project): { stack: ResolvedFont[]; missing: string[] } {
  const b = project.config.brand;
  const wanted = [
    b.font.family,
    ...(b.headlineFont ? [b.headlineFont.family, ...b.headlineFont.fallbacks] : []),
    ...b.font.fallbacks,
  ];
  const stack: ResolvedFont[] = [];
  const missing: string[] = [];
  for (const family of wanted) {
    const f = resolveFont(project, family);
    if (f) stack.push(f);
    else missing.push(family);
  }
  for (const b of safeLock(bundledFontsDir())?.fonts ?? []) {
    if (!stack.some((s) => s.family.toLowerCase() === b.family.toLowerCase())) {
      stack.push({ family: b.family, dir: bundledFontsDir(), files: b.files, source: "bundled" });
    }
  }
  return { stack, missing };
}

/** CSS font-family value for a stack. */
export function fontFamilyCss(stack: ResolvedFont[]): string {
  return [...stack.map((f) => `"${f.family}"`), "system-ui", "sans-serif"].join(", ");
}

export function listFonts(project: Project): { app: FontsLock["fonts"]; bundled: FontsLock["fonts"] } {
  return { app: safeLock(appFontsDir(project))?.fonts ?? [], bundled: safeLock(bundledFontsDir())?.fonts ?? [] };
}

/** Verify every file in a resolved font exists and matches its checksum. */
export function checkFont(font: ResolvedFont): string[] {
  const problems: string[] = [];
  for (const f of font.files) {
    const abs = path.join(font.dir, f.path);
    if (!fileExists(abs)) {
      problems.push(`${f.path} missing`);
      continue;
    }
    if (sha256File(abs) !== f.sha256) problems.push(`${f.path} checksum mismatch`);
  }
  return problems;
}

export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * CSS @font-face rules for a resolved font. `urlFor` maps an absolute file
 * path to the URL the page will use (file:// for export, /api/... for the UI).
 */
export function fontFaceCss(
  font: ResolvedFont,
  urlFor: (absPath: string) => string = (p) => pathToFileURL(p).href,
): string {
  return font.files
    .map((f) => {
      const format = f.path.endsWith(".woff2")
        ? "woff2"
        : f.path.endsWith(".woff")
          ? "woff"
          : f.path.endsWith(".otf")
            ? "opentype"
            : "truetype";
      return `@font-face{font-family:"${font.family}";font-style:${f.style};font-weight:${f.weight};font-display:block;src:url("${urlFor(path.join(font.dir, f.path))}") format("${format}");}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Google Fonts download

const GOOGLE_CSS = "https://fonts.googleapis.com/css2";

export interface AddFontOptions {
  family: string;
  weights?: number[];
  /** Destination fonts dir (app store/assets/fonts or the bundled dir). */
  destDir: string;
  fetchImpl?: typeof fetch;
}

export interface AddFontResult {
  family: string;
  dir: string;
  files: FontFile[];
  license?: string;
}

/**
 * Download static TTFs for a family from Google Fonts into destDir/<slug>/ and
 * record them in destDir/fonts.lock.json. An empty User-Agent makes the CSS API
 * return one TTF per weight instead of many woff2 unicode-range subsets.
 */
export async function addGoogleFont(opts: AddFontOptions): Promise<AddFontResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const weights = [...new Set(opts.weights ?? [400, 600, 700])].sort((a, b) => a - b);
  const family = opts.family.trim();
  if (!family) throw new Error("font family is required");
  const url = `${GOOGLE_CSS}?family=${encodeURIComponent(family).replaceAll("%20", "+")}:wght@${weights.join(";")}&display=block`;
  const res = await fetchFn(url, { headers: { "User-Agent": "" } });
  if (!res.ok) {
    throw new Error(
      `Google Fonts returned ${res.status} for "${family}" (weights ${weights.join(",")}) — check the family name at fonts.google.com`,
    );
  }
  const css = await res.text();
  const faces = parseFontFaces(css);
  if (faces.length === 0) throw new Error(`Google Fonts returned no @font-face rules for "${family}"`);

  const slug = familySlug(family);
  const dir = resolveWithin(opts.destDir, slug);
  fs.mkdirSync(dir, { recursive: true });
  const files: FontFile[] = [];
  for (const face of faces) {
    const ext = path.extname(new URL(face.url).pathname) || ".ttf";
    const name = `${slug}-${face.weight}${face.style === "italic" ? "-italic" : ""}${ext}`;
    const abs = path.join(dir, name);
    const r = await fetchFn(face.url);
    if (!r.ok) throw new Error(`download failed (${r.status}): ${face.url}`);
    fs.writeFileSync(abs, Buffer.from(await r.arrayBuffer()));
    files.push({ path: `${slug}/${name}`, weight: face.weight, style: face.style, sha256: sha256File(abs) });
  }
  const missing = weights.filter((w) => !files.some((f) => f.weight === w));
  if (missing.length) {
    // Google silently drops weights a family does not have; say so rather than render with the wrong weight.
    throw new Error(
      `"${family}" has no weight(s) ${missing.join(", ")} on Google Fonts; available: ${[...new Set(files.map((f) => f.weight))].join(", ")}`,
    );
  }

  const license =
    "Fonts downloaded from Google Fonts; licensed under the SIL Open Font License 1.1 (or the family's stated license — see fonts.google.com/specimen/" +
    encodeURIComponent(family) +
    "/license).";
  fs.writeFileSync(path.join(dir, "LICENSE.txt"), license + "\n");

  const lock = readLock(opts.destDir) ?? { version: 1 as const, fonts: [] };
  lock.fonts = lock.fonts.filter((f) => f.family.toLowerCase() !== family.toLowerCase());
  lock.fonts.push({ family, source: "google", files, license: `${slug}/LICENSE.txt` });
  lock.fonts.sort((a, b) => a.family.localeCompare(b.family));
  writeLock(opts.destDir, lock);
  return { family, dir, files, license };
}

export function parseFontFaces(css: string): { url: string; weight: number; style: string }[] {
  const out: { url: string; weight: number; style: string }[] = [];
  const blocks = css.match(/@font-face\s*{[^}]*}/g) ?? [];
  for (const b of blocks) {
    const url = /src:\s*url\(([^)]+)\)/.exec(b)?.[1]?.replace(/^['"]|['"]$/g, "");
    const weight = Number(/font-weight:\s*(\d+)/.exec(b)?.[1] ?? "400");
    const style = /font-style:\s*(\w+)/.exec(b)?.[1] ?? "normal";
    if (url) out.push({ url, weight, style });
  }
  return out;
}

/** Ensure the bundled default font exists (used by tests and the first run). */
export function bundledFontAvailable(family = "Inter"): boolean {
  return dirExists(bundledFontsDir()) && resolveFont(undefined, family) !== undefined;
}
