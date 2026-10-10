import type { LocaleContent, Manifest, ScreenDefinition, ScreenSet } from "../schema";

/**
 * Editing maths shared by the web editor and the canvas page the Mac app
 * embeds: what a drag, a nudge or a page means for a screen definition.
 * Pure functions; positions are fractions of the target width, the unit the
 * templates read.
 */

export type Fields = Record<string, string | null>;

/** A drag the preview iframe reports when the pointer is released (artwork pixels). */
export interface DragEnd {
  mode: "move" | "text" | "tilt" | "scale" | "layer" | "layer-tilt" | "layer-scale";
  dx?: number;
  dy?: number;
  dTilt?: number;
  dScale?: number;
  layerId?: string;
  /** Text drags on a panorama: which slide's text moved. */
  slice?: number;
}

export interface DragContext {
  /** The target's width in pixels: drags convert to fractions of it. */
  targetWidth: number;
  /** The target's device family: the default phone scale differs on iPad. */
  family: string;
  /** Right-to-left copy mirrors horizontal offsets. */
  rtl: boolean;
}

type Overrides = Record<string, unknown>;
const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places;

/** The change a finished drag makes to the screen: new overrides, or new layers. */
export function dragPatch(screen: ScreenDefinition, d: DragEnd, ctx: DragContext): Partial<ScreenDefinition> {
  const W = ctx.targetWidth;
  const dx = d.dx ?? 0;
  const dy = d.dy ?? 0;
  const layers = screen.layers ?? [];
  if (d.mode === "layer" && d.layerId) {
    return {
      layers: layers.map((l) =>
        l.id === d.layerId ? { ...l, x: round(l.x + dx / W, 3), y: round(l.y + dy / W, 3) } : l,
      ),
    };
  }
  if (d.mode === "layer-tilt" && d.layerId) {
    return {
      layers: layers.map((l) =>
        l.id === d.layerId
          ? {
              ...l,
              rotate:
                Math.max(-180, Math.min(180, Math.round((num(l.rotate, 0) + (d.dTilt ?? 0)) * 2) / 2)) || undefined,
            }
          : l,
      ),
    };
  }
  if (d.mode === "layer-scale" && d.layerId) {
    return {
      layers: layers.map((l) =>
        l.id === d.layerId ? { ...l, width: Math.max(0.02, Math.min(2, round(l.width * (d.dScale ?? 1), 3))) } : l,
      ),
    };
  }
  const o: Overrides = { ...screen.overrides };
  const sign = ctx.rtl ? -1 : 1;
  if (d.mode === "move") {
    o.screenshotOffsetX = round(num(o.screenshotOffsetX, 0) + (sign * dx) / W, 2);
    o.screenshotOffsetY = round(num(o.screenshotOffsetY, 0) + dy / W, 2);
  } else if (d.mode === "text") {
    const { kx, ky } = textOffsetKeys(d.slice ?? 0);
    o[kx] = round(num(o[kx], 0) + (sign * dx) / W, 2);
    o[ky] = Math.max(-0.3, Math.min(1, round(num(o[ky], 0) + dy / W, 2)));
  } else if (d.mode === "tilt") {
    o.deviceTilt = Math.max(-30, Math.min(30, Math.round((num(o.deviceTilt, 0) + (d.dTilt ?? 0)) * 2) / 2));
  } else if (d.mode === "scale") {
    const base = num(o.screenshotScale, ctx.family === "ipad" ? 0.72 : 0.8);
    o.screenshotScale = Math.max(0.3, Math.min(1.8, round(base * (d.dScale ?? 1), 2)));
  } else {
    return {};
  }
  return { overrides: o as ScreenDefinition["overrides"] };
}

/** The override keys a slide's text offsets live under: the first slide has no suffix. */
export function textOffsetKeys(slice: number): { kx: string; ky: string } {
  return slice === 0
    ? { kx: "textOffsetX", ky: "textOffsetY" }
    : { kx: `textOffsetX${slice + 1}`, ky: `textOffsetY${slice + 1}` };
}

/**
 * Arrow-key nudge of the selected element ("phone", "text:<slice>" or
 * "layer:<id>") by dx, dy fractions of the target width. Undefined when
 * nothing nudgeable is selected.
 */
export function nudgePatch(
  screen: ScreenDefinition,
  selected: string,
  dx: number,
  dy: number,
): Partial<ScreenDefinition> | undefined {
  const o: Overrides = { ...screen.overrides };
  if (selected === "phone") {
    o.screenshotOffsetX = round(num(o.screenshotOffsetX, 0) + dx, 3);
    o.screenshotOffsetY = round(num(o.screenshotOffsetY, 0) + dy, 3);
    return { overrides: o as ScreenDefinition["overrides"] };
  }
  if (selected.startsWith("text")) {
    const { kx, ky } = textOffsetKeys(Number(selected.split(":")[1] ?? 0));
    o[kx] = round(num(o[kx], 0) + dx, 3);
    o[ky] = round(Math.max(-0.3, Math.min(1, num(o[ky], 0) + dy)), 3);
    return { overrides: o as ScreenDefinition["overrides"] };
  }
  if (selected.startsWith("layer:")) {
    const id = selected.slice(6);
    return {
      layers: (screen.layers ?? []).map((l) =>
        l.id === id ? { ...l, x: round(l.x + dx, 3), y: round(l.y + dy, 3) } : l,
      ),
    };
  }
  return undefined;
}

/** A screen's horizontal window into the strip of enabled screens (for span backgrounds). */
export function stripWindow(manifest: Manifest, id: string, W: number): { offsetX: number; width: number } {
  const ordered = [...manifest.screens]
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  let acc = 0;
  let offsetX = 0;
  for (const s of ordered) {
    if (s.id === id) offsetX = acc;
    acc += W * (s.panorama?.slices ?? 1);
  }
  return { offsetX, width: acc };
}

/** Screens in manifest order (order, then id). */
export function orderedScreens(manifest: Manifest): ScreenDefinition[] {
  return [...manifest.screens].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** The screens a page shows, in its order: a named set's own list, or every enabled screen. */
export function pageScreens(manifest: Manifest, page: ScreenSet | undefined): ScreenDefinition[] {
  const screens = orderedScreens(manifest);
  return page
    ? page.screens.map((id) => screens.find((s) => s.id === id)).filter((s): s is ScreenDefinition => !!s)
    : screens.filter((s) => s.enabled);
}

/** A screen's copy in a locale as a page renders it: the page's own fields over the default page's. */
export function fieldsFor(
  content: Record<string, LocaleContent>,
  locale: string,
  screenId: string,
  page: ScreenSet | undefined,
): Fields {
  return {
    ...((content[locale]?.screens[screenId] as Fields | undefined) ?? {}),
    ...((page ? content[locale]?.sets?.[page.id]?.screens[screenId] : undefined) ?? {}),
  };
}
