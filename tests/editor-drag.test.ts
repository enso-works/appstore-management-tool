import { describe, expect, it } from "vitest";
import { dragPatch, fieldsFor, nudgePatch, pageScreens, stripWindow, textOffsetKeys } from "../lib/editor/drag";
import type { LocaleContent, Manifest, ScreenDefinition } from "../lib/schema";

const screen = (over: Partial<ScreenDefinition> = {}): ScreenDefinition => ({
  id: "home",
  order: 1,
  enabled: true,
  template: "hero-top",
  source: { filePattern: "{order}-{id}.png", localized: true },
  overrides: {},
  layers: [],
  ...over,
});
const ctx = { targetWidth: 1000, family: "iphone", rtl: false };

describe("dragPatch", () => {
  it("moves the phone by fractions of the target width, mirrored for right-to-left copy", () => {
    expect(dragPatch(screen(), { mode: "move", dx: 120, dy: -50 }, ctx)).toEqual({
      overrides: { screenshotOffsetX: 0.12, screenshotOffsetY: -0.05 },
    });
    expect(dragPatch(screen(), { mode: "move", dx: 120, dy: 0 }, { ...ctx, rtl: true }).overrides).toMatchObject({
      screenshotOffsetX: -0.12,
    });
  });

  it("moves a panorama slide's text under that slide's keys, within the allowed range", () => {
    const p = dragPatch(
      screen({ overrides: { textOffsetY2: 0.95 } }),
      { mode: "text", dx: 10, dy: 200, slice: 1 },
      ctx,
    );
    expect(p.overrides).toEqual({ textOffsetY2: 1, textOffsetX2: 0.01 });
    expect(textOffsetKeys(0)).toEqual({ kx: "textOffsetX", ky: "textOffsetY" });
  });

  it("tilts and scales the phone, clamped, from the template default scale", () => {
    expect(dragPatch(screen(), { mode: "tilt", dTilt: 47 }, ctx).overrides).toEqual({ deviceTilt: 30 });
    expect(dragPatch(screen(), { mode: "scale", dScale: 1.1 }, ctx).overrides).toEqual({ screenshotScale: 0.88 });
    expect(dragPatch(screen(), { mode: "scale", dScale: 1.1 }, { ...ctx, family: "ipad" }).overrides).toEqual({
      screenshotScale: 0.79,
    });
  });

  it("moves, rotates and resizes layers", () => {
    const s = screen({ layers: [{ id: "a", type: "image", asset: "x.png", x: 0.1, y: 0.2, width: 0.5 } as never] });
    expect(dragPatch(s, { mode: "layer", layerId: "a", dx: 100, dy: 0 }, ctx).layers?.[0]).toMatchObject({ x: 0.2 });
    expect(dragPatch(s, { mode: "layer-tilt", layerId: "a", dTilt: 15.3 }, ctx).layers?.[0]).toMatchObject({
      rotate: 15.5,
    });
    expect(dragPatch(s, { mode: "layer-scale", layerId: "a", dScale: 10 }, ctx).layers?.[0]).toMatchObject({
      width: 2,
    });
  });
});

describe("nudgePatch", () => {
  it("nudges the phone, a slide's text or a layer, and nothing else", () => {
    expect(nudgePatch(screen(), "phone", 0.005, 0)?.overrides).toEqual({
      screenshotOffsetX: 0.005,
      screenshotOffsetY: 0,
    });
    expect(nudgePatch(screen(), "text:2", 0, 0.05)?.overrides).toEqual({ textOffsetX3: 0, textOffsetY3: 0.05 });
    expect(nudgePatch(screen(), "background", 0.1, 0)).toBeUndefined();
  });
});

describe("pages", () => {
  const manifest: Manifest = {
    screens: [
      screen({ id: "b", order: 2 }),
      screen({ id: "a", order: 1 }),
      screen({ id: "off", order: 3, enabled: false }),
    ],
    sets: [{ id: "p", kind: "custom", screens: ["off", "a"] }],
  };

  it("lists a page's screens in its own order, and the default page's enabled ones", () => {
    expect(pageScreens(manifest, undefined).map((s) => s.id)).toEqual(["a", "b"]);
    expect(pageScreens(manifest, manifest.sets![0]).map((s) => s.id)).toEqual(["off", "a"]);
  });

  it("gives a page's own copy precedence over the default page's", () => {
    const content: Record<string, LocaleContent> = {
      "en-US": {
        locale: "en-US",
        screens: { a: { headline: "Default", caption: "Shared" } },
        sets: { p: { screens: { a: { headline: "Page" } } } },
      } as LocaleContent,
    };
    expect(fieldsFor(content, "en-US", "a", manifest.sets![0])).toEqual({ headline: "Page", caption: "Shared" });
    expect(fieldsFor(content, "en-US", "a", undefined)).toEqual({ headline: "Default", caption: "Shared" });
  });

  it("places each enabled screen in the strip", () => {
    expect(stripWindow(manifest, "b", 100)).toEqual({ offsetX: 100, width: 200 });
  });
});
