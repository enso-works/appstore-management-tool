import fs from "node:fs";
import { themeChanges, ThemeError } from "../apply-theme";
import { isHexColor } from "../color";
import { validateConfigSemantics, type Project } from "../config";
import { ExportRenderer } from "../render/export";
import { formatZodError, manifestSchema, projectConfigSchema } from "../schema";
import { getTheme } from "../themes";
import { etagOf, HttpError, writeJsonAtomic } from "./projects";

/** One Chromium for every theme preview the editors ask for, started on the first. */
let renderer: ExportRenderer | undefined;
let starting: Promise<ExportRenderer> | undefined;
export function previewRenderer(): Promise<ExportRenderer> {
  if (renderer) return Promise.resolve(renderer);
  starting ??= (async () => {
    const r = new ExportRenderer();
    await r.start();
    renderer = r;
    return r;
  })();
  return starting;
}

/** A theme id and accent from a request, checked. */
export function themeChoice(theme: unknown, accent: unknown): { theme: string; accent: string } {
  if (typeof theme !== "string" || !getTheme(theme)) throw new HttpError(400, `Unknown theme "${String(theme)}"`);
  if (typeof accent !== "string" || !isHexColor(accent)) throw new HttpError(400, "accent must be a hex colour");
  return { theme, accent: accent.startsWith("#") ? accent : `#${accent}` };
}

type Json = Record<string, unknown>;

/**
 * Apply a theme to the app's config and manifest. Returns both as they were, so
 * an editor can offer the whole change as one undo (`restoreTheme`).
 */
export function applyThemeToProject(project: Project, theme: string, accent: string) {
  const previous = { config: readJson(project.configPath), manifest: readJson(project.paths.manifest) };
  let changes;
  try {
    changes = themeChanges(previous.config, previous.manifest, theme, accent);
  } catch (err) {
    if (err instanceof ThemeError) throw new HttpError(400, err.message);
    throw err;
  }
  const etags = write(project, changes.config, changes.manifest);
  return { previous, restyled: changes.restyled, recoloured: changes.recoloured, etags };
}

/** Put back a config and manifest an editor kept from before a theme (undo). */
export function restoreTheme(project: Project, config: unknown, manifest: unknown) {
  if (!config || typeof config !== "object" || !manifest || typeof manifest !== "object") {
    throw new HttpError(400, "config and manifest are required");
  }
  return write(project, config as Json, manifest as Json);
}

function write(project: Project, config: Json, manifest: Json) {
  const c = projectConfigSchema.safeParse(config);
  if (!c.success) throw new HttpError(422, "Invalid config", formatZodError(c.error));
  const semantic = validateConfigSemantics(c.data).items.filter((i) => i.level === "error");
  if (semantic.length)
    throw new HttpError(
      422,
      "Invalid config",
      semantic.map((i) => i.message),
    );
  const m = manifestSchema.safeParse(manifest);
  if (!m.success) throw new HttpError(422, "Invalid manifest", formatZodError(m.error));
  writeJsonAtomic(project.configPath, config);
  writeJsonAtomic(project.paths.manifest, manifest);
  return { config: etagOf(project.configPath), manifest: etagOf(project.paths.manifest) };
}

function readJson(file: string): Json {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Json;
}
