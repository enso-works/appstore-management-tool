import { describe, expect, it } from "vitest";
import { templateModules } from "../templates";
import {
  backgroundCss,
  backgroundStyle,
  PATTERN_KINDS,
  patternDataUri,
  stackLayout,
  withAlpha,
} from "../templates/shared";
import type { TemplateRenderInput } from "../templates/types";
import { renderStatic } from "../lib/render/ssr";
import { targetProfiles } from "../lib/targets";

/** Template contract tests (plan §18.2): every template renders for every supported target, LTR and RTL, and honours positional overrides. */

function input(targetId: keyof typeof targetProfiles, extra: Partial<TemplateRenderInput> = {}): TemplateRenderInput {
  return {
    target: targetProfiles[targetId],
    canvasWidth: targetProfiles[targetId].width,
    locale: "en-US",
    direction: "ltr",
    fields: { headline: "Headline text", eyebrow: "Eyebrow", caption: "Caption copy here" },
    sourceImageUrl: "data:,",
    brand: { fontFamily: "Inter", fontStack: '"Inter", sans-serif', primary: "#336699", onPrimary: "#ffffff" },
    overrides: {},
    mode: "export",
    assetUrl: (rel) => `asset://${rel}`,
    ...extra,
  };
}

describe("template contracts", () => {
  for (const mod of Object.values(templateModules).filter((m) => m.descriptor.id !== "feature-graphic")) {
    describe(mod.descriptor.id, () => {
      it("declares fields and targets", () => {
        expect(mod.descriptor.requiredFields).toContain("headline");
        expect(mod.descriptor.families).toEqual(["iphone", "ipad", "phone"]);
        expect(mod.overridesSchema.safeParse({}).success).toBe(true);
        expect(mod.overridesSchema.safeParse({ nope: 1 }).success).toBe(false);
      });

      for (const targetId of Object.keys(targetProfiles) as (keyof typeof targetProfiles)[]) {
        it(`renders an exact-size artwork root for ${targetId} in LTR and RTL`, () => {
          for (const direction of ["ltr", "rtl"] as const) {
            const html = renderStatic(
              mod.render(
                input(targetId, { direction, overrides: mod.overridesSchema.parse({}) as Record<string, unknown> }),
              ),
            );
            const t = targetProfiles[targetId];
            expect(html).toContain("data-artwork");
            expect(html).toContain(`width:${t.width}px;height:${t.height}px`);
            expect(html).toContain(`dir="${direction}"`);
            expect(html).toContain('data-check="headline"');
            expect(html).toContain("data-device");
            expect(html).not.toContain("contenteditable");
          }
        });
      }

      it("applies tilt, background image and text colour overrides", () => {
        const html = renderStatic(
          mod.render(
            input("iphone-6.9-1320x2868", {
              overrides: mod.overridesSchema.parse({
                deviceTilt: 7,
                backgroundImage: "pattern:waves",
                patternColor: "#ff0000",
                textColor: "#123456",
                background: "#F4F0E7",
              }) as Record<string, unknown>,
            }),
          ),
        );
        expect(html).toContain("rotate(7deg)");
        expect(html).toContain("data:image/svg+xml");
        expect(html).toContain("%23ff0000");
        expect(html).toContain("color:#123456");
        expect(html).toContain("#F4F0E7");
      });

      it("uses the headline font stack only for the headline", () => {
        const html = renderStatic(
          mod.render(
            input("iphone-6.9-1320x2868", {
              brand: {
                fontFamily: "Inter",
                fontStack: '"Inter", sans-serif',
                headlineFontStack: '"Fraunces", "Inter", sans-serif',
                primary: "#000",
                onPrimary: "#fff",
              },
            }),
          ),
        );
        const headline = /<div data-check="headline"[^>]*>/.exec(html)![0];
        expect(headline).toContain("Fraunces");
        const caption = /<div data-check="caption"[^>]*>/.exec(html)![0];
        expect(caption).not.toContain("Fraunces");
      });
    });
  }

  it("resolves asset: backgrounds through assetUrl", () => {
    const mod = templateModules["hero-top"];
    const html = renderStatic(
      mod.render(input("iphone-6.9-1320x2868", { overrides: { backgroundImage: "asset:backgrounds/x.png" } })),
    );
    expect(html).toContain("asset://backgrounds/x.png");
  });
});

describe("backgroundStyle span", () => {
  const brand = {
    fontFamily: "Inter",
    fontStack: '"Inter", sans-serif',
    primary: "#336699",
    onPrimary: "#ffffff",
    backgroundDefaults: { background: "linear-gradient(90deg, #fff 0%, #000 100%), #abcdef", span: true },
  };

  it("stretches each inherited gradient layer to the strip and shifts by the screen offset", () => {
    const st = backgroundStyle(input("iphone-6.9-1320x2868", { brand, strip: { offsetX: 2640, width: 6600 } }));
    expect(st.background).toBeUndefined();
    expect(st.backgroundImage).toBe("linear-gradient(90deg, #fff 0%, #000 100%)");
    expect(st.backgroundSize).toBe("6600px 100%");
    expect(st.backgroundPosition).toBe("-2640px 0");
    expect(st.backgroundColor).toBe("#abcdef");
  });

  it("keeps the plain shorthand when the screen has its own background or span is off", () => {
    const own = backgroundStyle(
      input("iphone-6.9-1320x2868", {
        brand,
        strip: { offsetX: 2640, width: 6600 },
        overrides: { background: "#111" },
      }),
    );
    expect(own.background).toBe("#111");
    const noSpan = backgroundStyle(
      input("iphone-6.9-1320x2868", {
        brand: { ...brand, backgroundDefaults: { background: "#eee" } },
        strip: { offsetX: 2640, width: 6600 },
      }),
    );
    expect(noSpan.background).toBe("#eee");
  });
});

describe("withAlpha", () => {
  it("handles #rgb, #rrggbb, #rrggbbaa and leaves other colours alone", () => {
    expect(withAlpha("#694", 0.5)).toBe("rgba(102, 153, 68, 0.5)");
    expect(withAlpha("#6946F4", 0.93)).toBe("rgba(105, 70, 244, 0.93)");
    expect(withAlpha("#6946F4CC", 0.93)).toBe("rgba(105, 70, 244, 0.93)");
    expect(withAlpha("tomato", 0.5)).toBe("tomato");
  });
});

describe("stackLayout", () => {
  const base = input("iphone-6.9-1320x2868");
  const defaults = { textWidth: 1, textSide: "start" as const, scale: 0.8, gap: 0.06, sideDeviceLeft: 0.4 };

  it("stacks text above a centred device at full width", () => {
    const l = stackLayout(base, 500, defaults);
    expect(l.narrow).toBe(false);
    expect(l.device.width).toBe(Math.round(1320 * 0.8));
    expect(l.device.left).toBe(Math.round((1320 - l.device.width) / 2));
    expect(l.device.top).toBe(l.text.top + 500 + Math.round(1320 * 0.06));
  });

  it("puts a narrow text column on the visual left in LTR, right in RTL, and the device beside it", () => {
    const ltr = stackLayout({ ...base, overrides: { textWidth: 0.4 } }, 500, defaults);
    expect(ltr.narrow).toBe(true);
    expect(ltr.text.left).toBe(ltr.pad);
    expect(ltr.device.left).toBe(Math.round(1320 * 0.4));
    expect(ltr.device.top).toBe(ltr.text.top);
    const rtl = stackLayout({ ...base, direction: "rtl", overrides: { textWidth: 0.4 } }, 500, defaults);
    expect(rtl.text.left).toBe(1320 - rtl.pad - rtl.text.width);
    expect(rtl.device.left).toBeLessThan(ltr.device.left);
    const end = stackLayout({ ...base, overrides: { textWidth: 0.4, textSide: "end" } }, 500, defaults);
    expect(end.text.left).toBe(1320 - end.pad - end.text.width);
  });

  it("applies X/Y offsets as fractions of the canvas width, each element independently", () => {
    const a = stackLayout(base, 500, defaults);
    const b = stackLayout(
      { ...base, overrides: { screenshotOffsetX: 0.1, screenshotOffsetY: -0.2, textOffsetY: 0.05 } },
      500,
      defaults,
    );
    expect(b.device.left - a.device.left).toBe(132);
    expect(b.text.top - a.text.top).toBe(66);
    // textOffsetY must NOT move the device: only screenshotOffsetY does.
    expect(b.device.top - a.device.top).toBe(-264);
    const textOnly = stackLayout({ ...base, overrides: { textOffsetY: 0.3, textOffsetX: 0.1 } }, 500, defaults);
    expect(textOnly.device.top).toBe(a.device.top);
    expect(textOnly.device.left).toBe(a.device.left);
    expect(textOnly.text.left - a.text.left).toBe(132);
  });
});

describe("device frames", () => {
  it("renders the frame artwork with the capture in the cut-out when shell is frame:<name>", async () => {
    const { renderStatic } = await import("../lib/render/ssr");
    const mod = templateModules["hero-top"];
    const html = renderStatic(
      mod.render(
        input("iphone-6.9-1320x2868", {
          overrides: { shell: "frame:Test Frame" },
          frame: {
            url: "frame://test.png",
            frameWidth: 1470,
            frameHeight: 3000,
            screenX: 75,
            screenY: 66,
            screenWidth: 1320,
          },
        }),
      ),
    );
    expect(html).toContain("frame://test.png");
    // Device width default 0.8 * 1320 = 1056 -> scale 0.8; frame box 1176 wide.
    expect(html).toContain("width:1176px");
    expect(html).not.toContain("box-shadow"); // no CSS shell when a real frame is used
  });

  it("accepts frame:<name> in the shell override schema", () => {
    const mod = templateModules["hero-top"];
    expect(mod.overridesSchema.safeParse({ shell: "frame:Apple iPhone 16 Pro Max Black Titanium" }).success).toBe(true);
    expect(mod.overridesSchema.safeParse({ shell: "bogus" }).success).toBe(false);
  });
});

describe("feature graphic", () => {
  it("renders a 1024x500 landscape banner with the capture card", async () => {
    const { renderStatic } = await import("../lib/render/ssr");
    const mod = templateModules["feature-graphic"];
    const html = renderStatic(
      mod.render(
        input("play-feature-1024x500" as never, {
          target: targetProfiles["play-feature-1024x500"],
          canvasWidth: 1024,
          fields: { headline: "Braele", caption: "Breathe & relax" },
        }),
      ),
    );
    expect(html).toContain("width:1024px");
    expect(html).toContain("height:500px");
    expect(html).toContain('data-check="headline"');
    expect(html).toContain("data-device");
  });
});

describe("panorama per-slice text", () => {
  it("renders one text stack per slice from headline2/caption2 fields", async () => {
    const { renderStatic } = await import("../lib/render/ssr");
    const mod = templateModules["hero-top"];
    const html = renderStatic(
      mod.render(
        input("iphone-6.9-1320x2868", {
          canvasWidth: 2640,
          fields: { headline: "Slide one", caption: "First", headline2: "Slide two", caption2: "Second" },
        }),
      ),
    );
    expect(html).toContain('data-text-stack="0"');
    expect(html).toContain('data-text-stack="1"');
    expect(html).toContain('data-check="headline"');
    expect(html).toContain('data-check="headline2"');
    expect(html).toContain("Slide two");
    // Second stack offset by one slice width (left = 1320 + pad).
    expect(html).toMatch(/data-text-stack="1" style="position:absolute;left:141[0-9]px/);
  });

  it("omits empty slices entirely", async () => {
    const { renderStatic } = await import("../lib/render/ssr");
    const mod = templateModules["hero-top"];
    const html = renderStatic(
      mod.render(input("iphone-6.9-1320x2868", { canvasWidth: 2640, fields: { headline: "Only one" } })),
    );
    expect(html).toContain('data-text-stack="0"');
    expect(html).not.toContain('data-text-stack="1"');
  });
});

describe("background patterns", () => {
  it("renders every pattern kind as an SVG data URI", () => {
    for (const kind of PATTERN_KINDS) {
      const uri = patternDataUri(kind, "#ff0000", 40);
      expect(uri).toMatch(/^url\("data:image\/svg\+xml;utf8,/);
      if (kind !== "noise") expect(uri).toContain("%23ff0000");
    }
  });

  it("patternScale changes the tile size and the schema bounds it", () => {
    const mod = templateModules["hero-top"];
    const base = input("iphone-6.9-1320x2868", { overrides: { backgroundImage: "pattern:dots" } });
    const small = backgroundCss({ ...base, overrides: { ...base.overrides } });
    const big = backgroundCss({ ...base, overrides: { ...base.overrides, patternScale: 2 } });
    expect(small).toContain("/ 66px");
    expect(big).toContain("/ 132px");
    expect(mod.overridesSchema.safeParse({ backgroundImage: "pattern:rings", patternScale: 2 }).success).toBe(true);
    expect(mod.overridesSchema.safeParse({ patternScale: 9 }).success).toBe(false);
    expect(mod.overridesSchema.safeParse({ backgroundImage: "pattern:bogus" }).success).toBe(false);
  });
});

describe("per-slice text offsets", () => {
  it("slide 2's stack moves with textOffsetY2 while slide 1 stays", async () => {
    const { renderStatic } = await import("../lib/render/ssr");
    const mod = templateModules["hero-top"];
    const base = input("iphone-6.9-1320x2868", {
      canvasWidth: 2640,
      fields: { headline: "One", headline2: "Two" },
    });
    const html0 = renderStatic(mod.render(base));
    const html2 = renderStatic(mod.render({ ...base, overrides: { textOffsetY2: 0.1 } }));
    const topOf = (html: string, slice: string) =>
      Number(
        /data-text-stack="SLICE" style="position:absolute;left:\d+px;top:(\d+)px/.source &&
          new RegExp(`data-text-stack="${slice}" style="position:absolute;left:\\d+px;top:(\\d+)px`).exec(html)?.[1],
      );
    expect(topOf(html2, "0")).toBe(topOf(html0, "0"));
    expect(topOf(html2, "1")).toBe(topOf(html0, "1") + 132);
    const html1 = renderStatic(mod.render({ ...base, overrides: { textOffsetY: 0.1 } }));
    expect(topOf(html1, "0")).toBe(topOf(html0, "0") + 132);
    expect(topOf(html1, "1")).toBe(topOf(html0, "1"));
  });
});

describe("project default background", () => {
  const brandWith = {
    fontFamily: "Inter",
    fontStack: '"Inter", sans-serif',
    primary: "#336699",
    onPrimary: "#ffffff",
    backgroundDefaults: {
      background: "#F4F0E7",
      backgroundImage: "pattern:waves",
      patternColor: "rgba(0,0,0,0.06)",
      patternScale: 2,
    },
  };

  it("screens inherit the brand default and overrides win per key", () => {
    const base = input("iphone-6.9-1320x2868", { brand: brandWith });
    const css = backgroundCss({ ...base, overrides: {} });
    expect(css).toContain("#F4F0E7");
    expect(css).toContain("data:image/svg+xml");
    expect(css).toContain("/ 317px"); // waves tile 158 x 2
    const overridden = backgroundCss({ ...base, overrides: { background: "#111111" } });
    expect(overridden).toContain("#111111");
    expect(overridden).toContain("data:image/svg+xml"); // texture still inherited
  });

  it('"none" cancels an inherited texture for one screen', () => {
    const base = input("iphone-6.9-1320x2868", { brand: brandWith });
    const css = backgroundCss({ ...base, overrides: { backgroundImage: "none" } });
    expect(css).toBe("#F4F0E7");
    const mod = templateModules["hero-top"];
    expect(mod.overridesSchema.safeParse({ backgroundImage: "none" }).success).toBe(true);
  });
});

describe("layers", () => {
  it("renders image and text layers over the template with data-layer handles", async () => {
    const { renderStatic } = await import("../lib/render/ssr");
    const mod = templateModules["hero-top"];
    const html = renderStatic(
      mod.render(
        input("iphone-6.9-1320x2868", {
          layers: [
            {
              type: "image",
              id: "badge",
              url: "asset://logos/badge.png",
              x: 0.8,
              y: 0.2,
              width: 0.25,
              rotate: 10,
              opacity: 0.9,
            },
            {
              type: "text",
              id: "callout",
              text: "New!",
              x: 0.2,
              y: 0.3,
              width: 0.3,
              size: 0.05,
              weight: 700,
              align: "center",
              font: "body",
              color: "#ff2200",
            },
            {
              type: "text",
              id: "empty",
              text: "",
              x: 0.5,
              y: 0.5,
              width: 0.3,
              size: 0.05,
              weight: 400,
              align: "start",
              font: "body",
            },
          ],
        }),
      ),
    );
    expect(html).toContain('data-layer="badge"');
    expect(html).toContain("asset://logos/badge.png");
    expect(html).toContain("rotate(10deg)");
    expect(html).toContain('data-layer="callout"');
    expect(html).toContain("New!");
    expect(html).toContain("color:#ff2200");
    expect(html).not.toContain('data-layer="empty"'); // empty text layers are dropped
  });
});
