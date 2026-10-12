import { paletteFrom } from "./color";
import { padOrder } from "./render-plan";
import { getTarget, isOptInTarget, type Orientation } from "./targets";
import { getTheme, type Theme } from "./themes";

/**
 * Applying a theme (lib/themes.ts) to an app's config and manifest, as plain
 * JSON in and out: the CLI writes the result, the editors apply it as one
 * undoable edit. Copy, captures, layers, screen ids and their order are never
 * touched; an official device frame and a panorama the app has are kept. A
 * theme whose first screen is a panorama makes it one when the pages have
 * room, and moves the screens after it along by the screenshots it adds.
 */

type Json = Record<string, unknown>;

export interface ThemeChanges {
  config: Json;
  manifest: Json;
  /** Screens restyled as screenshots, and screens (header, search, events) that only took the colours. */
  restyled: string[];
  recoloured: string[];
  /** The screen the theme made a panorama, whose later slides want their own copy (headline2, ...). */
  panorama?: string;
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
  let panorama: string | undefined;
  const hero = byOrder.find((s) => s.enabled !== false && !isOptInOnly(s));
  if (hero && theme.heroPanorama && !hero.panorama && roomFor(config, manifest, hero, theme.heroPanorama)) {
    hero.panorama = { slices: theme.heroPanorama };
    makeRoom(byOrder);
    panorama = String(hero.id);
  }
  let index = 0;
  for (const screen of byOrder) {
    const targets = screen.targets as string[] | undefined;
    const previous = (screen.overrides as Json | undefined) ?? {};
    const keptFrame = officialFrame(previous.shell);
    if (targets && targets.every((t) => isOptInTarget(t))) {
      // Header, search and event pictures keep their layout and take the first screen's colours.
      const look = theme.screen({ palette, index: 0, orientation, slices: 1 }).overrides;
      const overrides: Json = { ...previous };
      for (const key of ["background", "backgroundImage", "patternColor", "patternScale", "textColor", "accentColor"]) {
        if (look[key] === undefined) delete overrides[key];
        else overrides[key] = look[key];
      }
      screen.overrides = overrides;
      recoloured.push(String(screen.id));
      continue;
    }
    const slices = (screen.panorama as { slices?: number } | undefined)?.slices ?? 1;
    const look = theme.screen({ palette, index: index++, orientation, slices });
    screen.template = look.template;
    screen.overrides = { ...look.overrides, ...(keptFrame ? { shell: keptFrame } : {}) };
    restyled.push(String(screen.id));
  }
  return { config: nextConfig, manifest: { ...manifest, screens }, restyled, recoloured, panorama };
}

const isOptInOnly = (screen: Json) => {
  const targets = screen.targets as string[] | undefined;
  return !!targets && targets.every((t) => isOptInTarget(t));
};

/** Screenshots a screen makes on a page: its slices, none for a header or event picture. */
const screenshotsOf = (screen: Json) =>
  isOptInOnly(screen) ? 0 : ((screen.panorama as { slices?: number } | undefined)?.slices ?? 1);

/** Whether `screen` can grow to `slices` screenshots on the default page and on every set that shows it. */
function roomFor(config: Json, manifest: Json, screen: Json, slices: number): boolean {
  const validation = config.validation as { screensPerTarget?: { max?: number } } | undefined;
  const max = validation?.screensPerTarget?.max ?? 10;
  const screens = (manifest.screens as Json[] | undefined) ?? [];
  const added = slices - screenshotsOf(screen);
  const page = screens.filter((s) => s.enabled !== false).reduce((n, s) => n + screenshotsOf(s), 0);
  if (page + added > max) return false;
  const sets = (manifest.sets as { screens?: string[] }[] | undefined) ?? [];
  return sets.every((set) => {
    if (!set.screens?.includes(String(screen.id))) return true;
    const count = set.screens.reduce((n, id) => {
      const s = screens.find((x) => x.id === id);
      return n + (s ? screenshotsOf(s) : 0);
    }, 0);
    return count + added <= max;
  });
}

/**
 * Moves enabled screens along so none starts on an order a panorama before it
 * reserves. Relative order is kept. A moved screen whose capture is named by
 * its order ({order}-{id}.png) keeps the old number in its pattern, so it
 * still finds the captures it has.
 */
function makeRoom(byOrder: Json[]): void {
  let next = 1;
  for (const screen of byOrder) {
    if (screen.enabled === false) continue;
    const before = Number(screen.order);
    const order = Math.max(before, next);
    if (order !== before) {
      const source = { ...((screen.source as Json | undefined) ?? {}) };
      const pattern = typeof source.filePattern === "string" ? source.filePattern : "{order}-{id}.png";
      if (pattern.includes("{order}")) {
        source.filePattern = pattern.replaceAll("{order}", padOrder(before));
        screen.source = source;
      }
      screen.order = order;
    }
    next = order + ((screen.panorama as { slices?: number } | undefined)?.slices ?? 1);
  }
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
