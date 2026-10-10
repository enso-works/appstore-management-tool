import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { formatJson, jsonStyleFor } from "../json-style";
import { type Project, validateConfigSemantics } from "../config";
import { contentFileFor, loadContent, loadManifest } from "../content";
import { fileExists, resolveWithin } from "../paths";
import { listProjects } from "../registry";
import { buildJob } from "../render-plan";
import { isOptInTarget, targetProfiles } from "../targets";
import { readImageInfo } from "../image";
import {
  backgroundValuesSchema,
  formatZodError,
  localeContentSchema,
  manifestSchema,
  projectConfigSchema,
  type BackgroundValues,
  type LocaleContent,
  type Manifest,
} from "../schema";

/** Look a project up by its workspace-relative directory name (e.g. "breathe"). */
export function findProject(name: string): Project | undefined {
  return listProjects().find((p) => p.name === name)?.project;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function requireProject(name: string): Project {
  const p = findProject(decodeURIComponent(name));
  if (!p) throw new HttpError(404, `No project "${name}"`);
  return p;
}

/** Weak validator for optimistic concurrency: sha256 of the file's bytes, or "missing". */
export function etagOf(file: string): string {
  if (!fileExists(file)) return "missing";
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Write JSON atomically (temp + rename), formatted the way the app formats it. */
export function writeJsonAtomic(file: string, value: unknown): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  fs.writeFileSync(tmp, formatJson(value, jsonStyleFor(file)), "utf8");
  fs.renameSync(tmp, file);
  return etagOf(file);
}

export interface SaveResult {
  etag: string;
}

/**
 * Save a locale's content. Validates the schema, refuses unknown locales,
 * checks the caller's etag against disk, writes atomically.
 */
export function saveContent(project: Project, locale: string, body: unknown, ifMatch: string | undefined): SaveResult {
  if (!project.config.locales.includes(locale))
    throw new HttpError(400, `Locale "${locale}" is not configured for this project`);
  const parsed = localeContentSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(422, "Invalid content", formatZodError(parsed.error));
  if (parsed.data.locale !== locale)
    throw new HttpError(422, `Body locale "${parsed.data.locale}" does not match ${locale}`);
  const file = contentFileFor(project, locale);
  const current = etagOf(file);
  if (ifMatch !== undefined && ifMatch !== current) {
    throw new HttpError(409, `${path.basename(file)} changed on disk since it was loaded; reload before saving`);
  }
  const out: LocaleContent & { $schema?: string } = { ...parsed.data };
  // Keep the $schema pointer the scaffold wrote, if any.
  if (!out.$schema && fileExists(file)) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, "utf8")) as { $schema?: string };
      if (prev.$schema) out.$schema = prev.$schema;
    } catch {
      // unreadable previous file: just overwrite
    }
  }
  return { etag: writeJsonAtomic(file, orderContent(out)) };
}

function orderContent(c: LocaleContent & { $schema?: string }) {
  const { $schema, locale, direction, screens, sets } = c;
  return {
    ...($schema ? { $schema } : {}),
    locale,
    ...(direction ? { direction } : {}),
    screens,
    ...(sets && Object.keys(sets).length ? { sets } : {}),
  };
}

export function saveManifest(project: Project, body: unknown, ifMatch: string | undefined): SaveResult {
  const parsed = manifestSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(422, "Invalid manifest", formatZodError(parsed.error));
  const file = project.paths.manifest;
  const current = etagOf(file);
  if (ifMatch !== undefined && ifMatch !== current) {
    throw new HttpError(409, "manifest.json changed on disk since it was loaded; reload before saving");
  }
  const out: Manifest & { $schema?: string } = { ...parsed.data };
  if (fileExists(file)) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest & { $schema?: string };
      if (!out.$schema && prev.$schema) out.$schema = prev.$schema;
      // `asc push` stores App Store Connect's id in the file; an editor that loaded the
      // manifest before that must not drop it, or the next push would make a second page.
      // An empty ascId is an explicit unlink and leaves the file without one.
      out.sets = out.sets?.map((set) => {
        if (set.ascId === "") {
          const unlinked = { ...set };
          delete unlinked.ascId;
          return unlinked;
        }
        const stored = set.ascId ? undefined : prev.sets?.find((p) => p.id === set.id && p.kind === set.kind)?.ascId;
        return stored ? { ...set, ascId: stored } : set;
      });
    } catch {
      // ignore
    }
  }
  // Named sets (custom product pages, treatments) follow the screens; a manifest without any keeps no key.
  const ordered = {
    ...(out.$schema ? { $schema: out.$schema } : {}),
    screens: out.screens,
    ...(out.sets?.length ? { sets: out.sets } : {}),
  };
  return { etag: writeJsonAtomic(file, ordered) };
}

/** Everything the editor needs on load. */
export function projectSnapshot(project: Project) {
  const { manifest, issues: manifestIssues } = loadManifest(project);
  const { byLocale, issues: contentIssues } = loadContent(project);
  const content: Record<string, LocaleContent> = {};
  const contentEtags: Record<string, string> = {};
  for (const locale of project.config.locales) {
    const lc = byLocale.get(locale);
    if (lc) content[locale] = lc;
    contentEtags[locale] = etagOf(contentFileFor(project, locale));
  }
  return {
    manifest,
    manifestEtag: etagOf(project.paths.manifest),
    content,
    contentEtags,
    loadIssues: [...manifestIssues.items, ...contentIssues.items],
  };
}

/** Update only the `presets` block of store-shots.config.json (etag-checked, atomic). */
export function savePresets(
  project: Project,
  presets: Record<string, Record<string, unknown>>,
  ifMatch?: string,
): SaveResult {
  const file = project.configPath;
  const current = etagOf(file);
  if (ifMatch !== undefined && ifMatch !== current) {
    throw new HttpError(409, "store-shots.config.json changed on disk since it was loaded; reload before saving");
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  raw.presets = presets;
  const parsed = projectConfigSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "Invalid presets", formatZodError(parsed.error));
  return { etag: writeJsonAtomic(file, raw) };
}

/**
 * Duplicate a screen: new id, next free order, same template/source/overrides,
 * and the copy of every locale that has content for it. One atomic pass over
 * the manifest + content files (etag-checked like the other saves).
 */
export function duplicateScreen(
  project: Project,
  sourceId: string,
  newId: string,
  ifMatch: { manifest?: string; content?: Record<string, string> } = {},
): { manifestEtag: string; contentEtags: Record<string, string> } {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(newId)) throw new HttpError(422, "new id must be lowercase letters, digits, dashes");
  const manifestRaw = JSON.parse(fs.readFileSync(project.paths.manifest, "utf8")) as {
    screens: Record<string, unknown>[];
  };
  const screens = manifestRaw.screens as ({ id: string; order: number; panorama?: { slices: number } } & Record<
    string,
    unknown
  >)[];
  const src = screens.find((s) => s.id === sourceId);
  if (!src) throw new HttpError(404, `No screen "${sourceId}"`);
  if (screens.some((s) => s.id === newId)) throw new HttpError(409, `Screen "${newId}" already exists`);
  if (ifMatch.manifest !== undefined && ifMatch.manifest !== etagOf(project.paths.manifest)) {
    throw new HttpError(409, "manifest.json changed on disk since it was loaded; reload before saving");
  }
  const maxOrder = Math.max(0, ...screens.map((s) => s.order + ((s.panorama?.slices ?? 1) - 1)));
  const copy = structuredClone(src);
  copy.id = newId;
  copy.order = maxOrder + 1;
  screens.push(copy);
  const manifestEtag = writeJsonAtomic(project.paths.manifest, manifestRaw);

  const contentEtags: Record<string, string> = {};
  for (const locale of project.config.locales) {
    const file = contentFileFor(project, locale);
    if (!fileExists(file)) continue;
    if (ifMatch.content?.[locale] !== undefined && ifMatch.content[locale] !== etagOf(file)) {
      throw new HttpError(409, `${locale}.json changed on disk since it was loaded; reload before saving`);
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { screens?: Record<string, unknown> };
    if (raw.screens && raw.screens[sourceId] !== undefined && raw.screens[newId] === undefined) {
      raw.screens[newId] = structuredClone(raw.screens[sourceId]);
      contentEtags[locale] = writeJsonAtomic(file, raw);
    } else {
      contentEtags[locale] = etagOf(file);
    }
  }
  return { manifestEtag, contentEtags };
}

const ASSET_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
const ASSET_MAX_BYTES = 8 * 1024 * 1024;

export interface BackgroundAsset {
  /** Path relative to store/assets, e.g. "backgrounds/waves.png" (what backgroundImage "asset:" expects). */
  rel: string;
  name: string;
  bytes: number;
}

/** All images under store/assets (backgrounds/, logos/, images/, ... — fonts excluded), rel to store/assets. */
export function listBackgroundAssets(project: Project, subdir?: string): BackgroundAsset[] {
  const root = project.paths.assets;
  const out: BackgroundAsset[] = [];
  const walk = (dir: string, rel: string, depth: number) => {
    if (!fs.existsSync(dir) || depth > 2) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "fonts") continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r, depth + 1);
      else if (ASSET_EXTENSIONS.has(path.extname(e.name).toLowerCase())) {
        out.push({ rel: r, name: e.name, bytes: fs.statSync(abs).size });
      }
    }
  };
  if (subdir) walk(path.join(root, subdir), subdir, 1);
  else walk(root, "", 0);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

/**
 * Save an uploaded background image into store/assets/backgrounds/. The name is
 * sanitised, the extension whitelisted, size capped; existing files are never
 * overwritten (a numeric suffix is added instead).
 */
export function saveBackgroundAsset(
  project: Project,
  fileName: string,
  data: Buffer,
  subdir = "backgrounds",
): BackgroundAsset {
  if (!/^[a-z0-9-]+$/.test(subdir)) throw new HttpError(422, "Invalid asset directory");
  const rawExt = path.extname(fileName);
  const ext = rawExt.toLowerCase();
  if (!ASSET_EXTENSIONS.has(ext)) throw new HttpError(422, `Unsupported image type "${ext}" (png, jpg, webp, svg)`);
  if (data.length === 0) throw new HttpError(422, "Empty file");
  if (data.length > ASSET_MAX_BYTES)
    throw new HttpError(422, `File too large (${Math.round(data.length / 1e6)} MB, max 8 MB)`);
  const base = path
    .basename(fileName, rawExt)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (!base) throw new HttpError(422, "File name has no usable characters");
  const dir = resolveWithin(project.paths.assets, subdir);
  fs.mkdirSync(dir, { recursive: true });
  let name = `${base}${ext}`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${base}-${i}${ext}`;
  const abs = path.join(dir, name);
  const tmp = path.join(dir, `.${name}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, abs);
  return { rel: `${subdir}/${name}`, name, bytes: data.length };
}

/** Update only brand.background in store-shots.config.json (etag-checked, atomic). Empty values remove the default. */
export function saveBrandBackground(project: Project, values: BackgroundValues | null, ifMatch?: string): SaveResult {
  const file = project.configPath;
  const current = etagOf(file);
  if (ifMatch !== undefined && ifMatch !== current) {
    throw new HttpError(409, "store-shots.config.json changed on disk since it was loaded; reload before saving");
  }
  const cleaned = values
    ? (Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== "")) as BackgroundValues)
    : null;
  if (cleaned) {
    const parsed = backgroundValuesSchema.safeParse(cleaned);
    if (!parsed.success) throw new HttpError(422, "Invalid background", formatZodError(parsed.error));
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { brand?: Record<string, unknown> };
  raw.brand = { ...(raw.brand ?? {}) };
  if (cleaned && Object.keys(cleaned).length) raw.brand.background = cleaned;
  else delete raw.brand.background;
  const parsed = projectConfigSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "Invalid config", formatZodError(parsed.error));
  return { etag: writeJsonAtomic(file, raw) };
}

/** The config settings the Mac app edits directly; everything else in the file stays as it is. */
export interface ConfigPatch {
  targets?: string[];
  locales?: string[];
  defaultLocale?: string;
  /** Brand colours (#rrggbb); null removes the optional accent. */
  brand?: { primary?: string; onPrimary?: string; accent?: string | null };
}

/** Change the devices, languages or brand colours (etag-checked, validated, atomic). */
export function saveConfigPatch(
  project: Project,
  patch: ConfigPatch,
  ifMatch?: string,
): SaveResult & { config: unknown } {
  const file = project.configPath;
  const current = etagOf(file);
  if (ifMatch !== undefined && ifMatch !== current) {
    throw new HttpError(409, "store-shots.config.json changed on disk since it was loaded; reload before saving");
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown> & {
    brand?: Record<string, unknown>;
  };
  if (patch.targets) raw.targets = patch.targets;
  if (patch.locales) raw.locales = patch.locales;
  if (patch.defaultLocale) raw.defaultLocale = patch.defaultLocale;
  if (patch.brand) {
    raw.brand = { ...(raw.brand ?? {}) };
    for (const key of ["primary", "onPrimary", "accent"] as const) {
      const v = patch.brand[key];
      if (v === null) delete raw.brand[key];
      else if (v !== undefined) raw.brand[key] = v;
    }
  }
  const parsed = projectConfigSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "Invalid settings", formatZodError(parsed.error));
  const issues = validateConfigSemantics(parsed.data);
  const errors = issues.items.filter((i) => i.level === "error");
  if (errors.length)
    throw new HttpError(
      422,
      "Invalid settings",
      errors.map((i) => i.message),
    );
  return { etag: writeJsonAtomic(file, raw), config: parsed.data };
}

/**
 * Update the brand font families in store-shots.config.json (etag-checked,
 * atomic). Only `family` changes; weights/fallbacks of an existing entry are
 * kept. `headlineFont: null` removes the headline face (headlines fall back to
 * the body font).
 */
export function saveBrandFonts(
  project: Project,
  update: { font?: { family: string }; headlineFont?: { family: string } | null },
  ifMatch?: string,
): SaveResult {
  const file = project.configPath;
  const current = etagOf(file);
  if (ifMatch !== undefined && ifMatch !== current) {
    throw new HttpError(409, "store-shots.config.json changed on disk since it was loaded; reload before saving");
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { brand?: Record<string, unknown> };
  raw.brand = { ...(raw.brand ?? {}) };
  if (update.font) {
    raw.brand.font = { ...((raw.brand.font as Record<string, unknown>) ?? {}), family: update.font.family };
  }
  if (update.headlineFont === null) delete raw.brand.headlineFont;
  else if (update.headlineFont) {
    raw.brand.headlineFont = {
      ...((raw.brand.headlineFont as Record<string, unknown>) ?? {}),
      family: update.headlineFont.family,
    };
  }
  const parsed = projectConfigSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(422, "Invalid config", formatZodError(parsed.error));
  return { etag: writeJsonAtomic(file, raw) };
}

/**
 * Create content files for every configured locale that lacks one, prefilled
 * with the default locale's copy as translation drafts. Existing files are
 * never touched.
 */
export function bootstrapLocaleContent(project: Project): { created: string[] } {
  const defaultFile = contentFileFor(project, project.config.defaultLocale);
  let seed: LocaleContent | undefined;
  if (fileExists(defaultFile)) {
    const parsed = localeContentSchema.safeParse(JSON.parse(fs.readFileSync(defaultFile, "utf8")));
    if (parsed.success) seed = parsed.data;
  }
  const created: string[] = [];
  for (const locale of project.config.locales) {
    if (locale === project.config.defaultLocale) continue;
    const file = contentFileFor(project, locale);
    if (fileExists(file)) continue;
    const out: Record<string, unknown> = {
      locale,
      screens: seed ? structuredClone(seed.screens) : {},
    };
    writeJsonAtomic(file, out);
    created.push(path.relative(project.root, file).split(path.sep).join("/"));
  }
  return { created };
}

const CAPTURE_MAX_BYTES = 40 * 1024 * 1024;

export interface CaptureTarget {
  /** App-relative path of the capture file. */
  path: string;
  /** A capture is there now (it would be replaced). */
  exists: boolean;
  /** What else reads the same file: other languages, other devices. Empty when only this one. */
  sharedWith: string[];
  /**
   * Why replacing it needs a yes: the file belongs to another device (an iPhone capture
   * seen from a Duo, header or event size) or to the default language (a screen with
   * one capture for every language, seen in another). Absent when the drop is plainly
   * this screen's own capture.
   */
  confirm?: string;
}

/** Where a screen reads its capture for a device and locale, and what else reads that file. */
export function captureTarget(project: Project, screenId: string, targetId: string, locale: string) {
  const { manifest } = loadManifest(project);
  const screen = manifest?.screens.find((s) => s.id === screenId);
  if (!screen) throw new HttpError(404, `No screen "${screenId}"`);
  if (!project.config.locales.includes(locale)) throw new HttpError(400, `Unknown locale "${locale}"`);
  // Whichever devices the screen renders for, the capture goes where this device reads it.
  const job = buildJob(project, { ...screen, targets: [targetId] }, targetId, locale);
  if (!job) throw new HttpError(400, `Unknown target "${targetId}"`);
  if (job.sourceError) throw new HttpError(422, job.sourceError);
  const sharedWith: string[] = [];
  // Only the devices this screen renders for read its captures.
  const renders = screen.targets ?? project.config.targets.filter((t) => !isOptInTarget(t));
  for (const t of renders.filter((t) => t !== targetId && project.config.targets.includes(t))) {
    const other = buildJob(project, { ...screen, targets: [t] }, t, locale);
    if (other?.sourcePath === job.sourcePath) sharedWith.push(other.target.id);
  }
  if (!screen.source.localized && project.config.locales.length > 1) sharedWith.unshift("every language");
  const shown = job.target;
  const ownDevice = shown.family === job.sourceDevice && !shown.id.startsWith("iphone-duo-");
  const confirm = !ownDevice
    ? `it is the ${job.sourceDevice} capture, read by every size that shows the ${job.sourceDevice} captures`
    : !screen.source.localized && locale !== project.config.defaultLocale
      ? `this screen has one capture for every language: it is the ${project.config.defaultLocale} file`
      : undefined;
  const info: CaptureTarget = {
    path: path.relative(project.root, job.sourcePath).split(path.sep).join("/"),
    exists: fs.existsSync(job.sourcePath),
    sharedWith,
    ...(confirm ? { confirm } : {}),
  };
  return { job, info };
}

/**
 * Put a capture where a screen reads it for a device and locale (the path its
 * render job names under store/raw). PNG or JPEG only, checked before anything
 * is replaced; a replaced capture is kept under store/generated/replaced-captures/. Reports
 * the image size and whether its shape fits the device that reads it.
 */
export function saveCapture(
  project: Project,
  screenId: string,
  targetId: string,
  locale: string,
  data: Buffer,
): CaptureTarget & { width: number; height: number; aspectFits: boolean; backup?: string } {
  const { job, info: where } = captureTarget(project, screenId, targetId, locale);
  if (data.length > CAPTURE_MAX_BYTES) throw new HttpError(422, "Capture too large (max 40 MB)");
  const abs = job.sourcePath;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.tmp`);
  fs.writeFileSync(tmp, data);
  let size: { width: number; height: number };
  try {
    size = readImageInfo(tmp);
    if (!(size.width > 0 && size.height > 0)) throw new Error("no size");
  } catch {
    fs.rmSync(tmp, { force: true });
    throw new HttpError(422, "A capture is a readable PNG or JPEG");
  }
  let backup: string | undefined;
  if (fs.existsSync(abs)) {
    const rel = path.relative(project.paths.raw, abs);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // Under the generated folder, which apps keep out of git.
    const keep = path.join(project.paths.generated, "replaced-captures", `${rel}.${stamp}${path.extname(abs)}`);
    fs.mkdirSync(path.dirname(keep), { recursive: true });
    fs.copyFileSync(abs, keep);
    backup = path.relative(project.root, keep).split(path.sep).join("/");
  }
  fs.renameSync(tmp, abs);
  // The shape the device that reads this file expects: its own, or the iPhone sets' for
  // targets that show the iPhone captures (Duo, header, events), in the same orientation.
  const shown = job.target;
  let expected = shown.width / shown.height;
  if (job.sourceDevice === "iphone" && !(shown.family === "iphone" && !shown.id.startsWith("iphone-duo-"))) {
    const iphone =
      project.config.targets
        .map((t) => targetProfiles[t as keyof typeof targetProfiles])
        .find(
          (t) => t && t.family === "iphone" && !t.id.startsWith("iphone-duo-") && t.orientation === shown.orientation,
        ) ??
      project.config.targets
        .map((t) => targetProfiles[t as keyof typeof targetProfiles])
        .find((t) => t && t.family === "iphone" && !t.id.startsWith("iphone-duo-"));
    expected = iphone ? iphone.width / iphone.height : 1320 / 2868;
  }
  return {
    ...where,
    exists: true,
    width: size.width,
    height: size.height,
    aspectFits: Math.abs(size.width / size.height - expected) < 0.02,
    backup,
  };
}
