import { paletteFrom } from "./color";
import { getTarget, isOptInTarget, type Orientation } from "./targets";
import { getTheme, type Theme } from "./themes";

/**
 * Applying a theme (lib/themes.ts) to an app's config and manifest, as plain
 * JSON in and out: the CLI writes the result, the editors apply it as one
 * undoable edit. Copy, captures, layers, screen ids and their order are never
 * touched; an official device frame the app picked is kept.
 */

type Json = Record<string, unknown>;

export interface ThemeChanges {
  config: Json;
  manifest: Json;
  /** Screens restyled as screenshots, and screens (header, search, events) that only took the colours. */
  restyled: string[];
  recoloured: string[];
}

export class ThemeError extends Error {}

export function requireTheme(id: string): Theme {
  const theme = getTheme(id);
  if (!theme) throw new ThemeError(`Unknown theme "${id}"`);
  return theme;
}

/** The orientation of the app's screenshot sets: landscape when its iPhone (or first) set is. */
export function orientationOf(targets: string[]): Orientation {
  const profiles = targets.map((t) => getTarget(t)).filter((t) => t && !isOptInTarget(t));
  const lead = profiles.find((t) => t!.family === "iphone") ?? profiles[0];
  return lead?.orientation === "landscape" ? "landscape" : "portrait";
}

/** The config and manifest with the theme applied. Inputs are not modified. */
export function themeChanges(config: Json, manifest: Json, themeId: string, accent: string): ThemeChanges {
  const theme = requireTheme(themeId);
  const palette = paletteFrom(accent);
  const b = theme.brand(palette);
  const brand = { ...((config.brand as Json | undefined) ?? {}) };
  brand.headlineFont = { family: theme.headlineFont.family, source: "google", weights: theme.headlineFont.weights };
  brand.primary = b.primary;
  brand.onPrimary = b.onPrimary;
  brand.accent = b.accent;
  brand.background = b.background;
  const nextConfig = { ...config, brand };

  const orientation = orientationOf((config.targets as string[] | undefined) ?? []);
  const screens = ((manifest.screens as Json[] | undefined) ?? []).map((s) => ({ ...s }));
  const restyled: string[] = [];
  const recoloured: string[] = [];
  const byOrder = [...screens].sort((a, b) => Number(a.order) - Number(b.order));
  let index = 0;
  for (const screen of byOrder) {
    const targets = screen.targets as string[] | undefined;
    const previous = (screen.overrides as Json | undefined) ?? {};
    const keptFrame = officialFrame(previous.shell);
    if (targets && targets.every((t) => isOptInTarget(t))) {
      // Header, search and event pictures keep their layout and take the first screen's colours.
      const look = theme.screen({ palette, index: 0, orientation }).overrides;
      const overrides: Json = { ...previous };
      for (const key of ["background", "backgroundImage", "patternColor", "patternScale", "textColor", "accentColor"]) {
        if (look[key] === undefined) delete overrides[key];
        else overrides[key] = look[key];
      }
      screen.overrides = overrides;
      recoloured.push(String(screen.id));
      continue;
    }
    const look = theme.screen({ palette, index: index++, orientation });
    screen.template = look.template;
    screen.overrides = { ...look.overrides, ...(keptFrame ? { shell: keptFrame } : {}) };
    restyled.push(String(screen.id));
  }
  return { config: nextConfig, manifest: { ...manifest, screens }, restyled, recoloured };
}

/** A shell value that names an official frame (or a per-family map holding one), else undefined. */
function officialFrame(shell: unknown): unknown {
  if (typeof shell === "string") return shell.startsWith("frame:") ? shell : undefined;
  if (shell && typeof shell === "object") {
    return Object.values(shell as Json).some((v) => typeof v === "string" && v.startsWith("frame:"))
      ? shell
      : undefined;
  }
  return undefined;
}
