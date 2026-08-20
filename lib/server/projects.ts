import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Project } from "../config";
import { contentFileFor, loadContent, loadManifest } from "../content";
import { fileExists, resolveWithin } from "../paths";
import { discoverProjects } from "../registry";
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
  return discoverProjects().find((p) => p.name === name)?.project;
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

/** Write JSON atomically (temp + rename), one canonical formatting. */
export function writeJsonAtomic(file: string, value: unknown): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
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
  const { $schema, locale, direction, screens } = c;
  return { ...($schema ? { $schema } : {}), locale, ...(direction ? { direction } : {}), screens };
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
  if (!out.$schema && fileExists(file)) {
    try {
      const prev = JSON.parse(fs.readFileSync(file, "utf8")) as { $schema?: string };
      if (prev.$schema) out.$schema = prev.$schema;
    } catch {
      // ignore
    }
  }
  const ordered = { ...(out.$schema ? { $schema: out.$schema } : {}), screens: out.screens };
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
