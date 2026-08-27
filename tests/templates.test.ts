import { describe, expect, it } from "vitest";
import { screenTemplateIds, stripTemplateIds, templateModules } from "../templates";
import {
  backgroundCss,
  backgroundStyle,
  PATTERN_KINDS,
  patternDataUri,
  stackLayout,
  withAlpha,
} from "../templates/shared";
import { DECOR_KINDS, lighten } from "../templates/decor";
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
            // Capture-less templates (statement) place no device.
            if (mod.descriptor.usesCapture !== false) expect(html).toContain("data-device");
            expect(html).not.toContain("contenteditable");
          }
        });
      }

      it("applies background image and text colour overrides (and tilt where there is a device)", () => {
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
        if (mod.descriptor.usesCapture !== false) expect(html).toContain("rotate(7deg)");
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

  it("cover-crops the capture to the measured cut-out height", async () => {
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
            screenHeight: 2000,
          },
        }),
      ),
    );
    // Device width 0.8 * 1320 = 1056 -> s = 0.8; clip box = cut-out height * s.
    expect(html).toContain("height:1600px");
    expect(html).toContain("overflow:hidden");
  });

  it("accepts frame:<name> in the shell override schema", () => {
    const mod = templateModules["hero-top"];
    expect(mod.overridesSchema.safeParse({ shell: "frame:Apple iPhone 16 Pro Max Black Titanium" }).success).toBe(true);
    expect(mod.overridesSchema.safeParse({ shell: "bogus" }).success).toBe(false);
  });

  it("accepts and resolves a per-family shell map", async () => {
    const mod = templateModules["hero-top"];
    const perFamily = { iphone: "frame:Apple iPhone 16 Pro Max Black Titanium", ipad: "frame:Apple iPad Pro 13" };
    expect(mod.overridesSchema.safeParse({ shell: perFamily }).success).toBe(true);
    expect(mod.overridesSchema.safeParse({ shell: { iphone: "bogus" } }).success).toBe(false);

    const { resolveShell, shellValues } = await import("../lib/frames");
    expect(resolveShell(perFamily, "iphone")).toBe("frame:Apple iPhone 16 Pro Max Black Titanium");
    expect(resolveShell(perFamily, "ipad")).toBe("frame:Apple iPad Pro 13");
    expect(resolveShell(perFamily, "phone")).toBeUndefined();
    expect(resolveShell("light", "ipad")).toBe("light");
    expect(resolveShell(undefined, "ipad")).toBeUndefined();
    expect(shellValues(perFamily).sort()).toEqual([
      "frame:Apple iPad Pro 13",
      "frame:Apple iPhone 16 Pro Max Black Titanium",
    ]);
    expect(shellValues("dark")).toEqual(["dark"]);
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

  it("keeps the text column clear of the tilted card's bounding box", async () => {
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
    // Card: 0.34 x 1024 wide at 0.62 x 1024, tilted -8deg; its box grows sideways
    // by (w cos + h sin - w) / 2. The column must stop before that, or the
    // in-page overlap check fires on the stock layout.
    const devW = Math.round(1024 * 0.34);
    const devH = Math.round(devW * (2868 / 1320));
    const rad = (8 * Math.PI) / 180;
    const grow = Math.round((devW * Math.cos(rad) + devH * Math.sin(rad) - devW) / 2);
    const limit = Math.round(1024 * 0.62) - grow - Math.round(500 * 0.12) - Math.round(1024 * 0.02);
    expect(html).toContain(`width:${limit}px`);
  });

  it("keeps that clearance when the card is nudged towards the copy", async () => {
    const { renderStatic } = await import("../lib/render/ssr");
    const mod = templateModules["feature-graphic"];
    const html = renderStatic(
      mod.render(
        input("play-feature-1024x500" as never, {
          target: targetProfiles["play-feature-1024x500"],
          canvasWidth: 1024,
          fields: { headline: "Braele", caption: "Breathe & relax" },
          overrides: { screenshotOffsetX: -0.3 },
        }),
      ),
    );
    const devW = Math.round(1024 * 0.34);
    const devH = Math.round(devW * (2868 / 1320));
    const rad = (8 * Math.PI) / 180;
    const grow = Math.round((devW * Math.cos(rad) + devH * Math.sin(rad) - devW) / 2);
    const devLeft = Math.round(1024 * 0.62) + Math.round(1024 * -0.3);
    const limit = devLeft - grow - Math.round(500 * 0.12) - Math.round(1024 * 0.02);
    // The column shrinks with the card instead of being pinned by a comfort floor.
    expect(html).toContain(`width:${limit}px`);
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

describe("statement", () => {
  const mod = templateModules["statement"];

  it("declares that it needs no capture and renders no image", () => {
    expect(mod.descriptor.usesCapture).toBe(false);
    const html = renderStatic(mod.render(input("iphone-6.9-1320x2868", { fields: { headline: "No phone here" } })));
    expect(html).not.toContain("<img");
    expect(html).toContain('data-check="headline"');
  });

  it("draws the index watermark and a decorative shape", () => {
    const html = renderStatic(
      mod.render(
        input("iphone-6.9-1320x2868", {
          fields: { headline: "Step two", index: "02" },
          overrides: { decor: "rings", accentColor: "#ff0000", decorOpacity: 0.4 },
        }),
      ),
    );
    expect(html).toContain("data-index");
    expect(html).toContain(">02<");
    expect(html).toContain('data-decor="rings"');
    expect(html).toContain("%23ff0000");
    expect(html).toContain("opacity:0.4");
  });

  it("anchors the copy top, middle or bottom and can drop the rule", () => {
    const mid = renderStatic(mod.render(input("iphone-6.9-1320x2868", { overrides: { anchor: "middle" } })));
    expect(mid).toContain("translateY(calc(-50% + 0px))");
    const bottom = renderStatic(mod.render(input("iphone-6.9-1320x2868", { overrides: { anchor: "bottom" } })));
    expect(bottom).toMatch(/bottom:\d+px/);
    const noRule = renderStatic(mod.render(input("iphone-6.9-1320x2868", { overrides: { rule: false } })));
    expect(noRule).not.toContain("border-radius:999px");
  });
});

describe("zoom-detail", () => {
  const mod = templateModules["zoom-detail"];

  it("scales the capture by zoom and centres it on the focus point", () => {
    const html = renderStatic(
      mod.render(input("iphone-6.9-1320x2868", { overrides: { zoom: 2, focusX: 0.5, focusY: 0.5 } })),
    );
    // Card width 0.88 * 1320 = 1162; the capture is zoom x that wide.
    expect(html).toContain("width:2324px");
    expect(html).toContain("left:-581px");
  });

  it("only draws the locator with a backdrop, sized to the visible region", () => {
    const withLocator = renderStatic(
      mod.render(input("iphone-6.9-1320x2868", { overrides: { locator: true, zoom: 2 } })),
    );
    // Backdrop is inflated 1.12x when blurred; the ring is 1/zoom of it.
    expect(withLocator).toContain("width:739px");
    const noBackdrop = renderStatic(
      mod.render(input("iphone-6.9-1320x2868", { overrides: { locator: true, backdrop: "none" } })),
    );
    const images = noBackdrop.match(/<img/g) ?? [];
    expect(images).toHaveLength(1); // just the card, no backdrop copy
  });

  it("renders a circle when asked", () => {
    const html = renderStatic(mod.render(input("iphone-6.9-1320x2868", { overrides: { detailShape: "circle" } })));
    expect(html).toContain("border-radius:1162px");
  });
});

describe("stat-hero", () => {
  const mod = templateModules["stat-hero"];

  it("renders the figure and its label as checked text blocks", () => {
    const html = renderStatic(
      mod.render(input("iphone-6.9-1320x2868", { fields: { headline: "Loved", stat: "4.9", statLabel: "rating" } })),
    );
    expect(html).toContain('data-check="stat"');
    expect(html).toContain('data-check="statLabel"');
    expect(html).toContain(">4.9<");
  });

  it("supports outline and gradient figures", () => {
    const outline = renderStatic(
      mod.render(
        input("iphone-6.9-1320x2868", { fields: { headline: "h", stat: "0" }, overrides: { statStyle: "outline" } }),
      ),
    );
    expect(outline).toContain("-webkit-text-stroke-width");
    const gradient = renderStatic(
      mod.render(
        input("iphone-6.9-1320x2868", { fields: { headline: "h", stat: "0" }, overrides: { statStyle: "gradient" } }),
      ),
    );
    expect(gradient).toContain("background-clip:text");
  });

  it("lets text sit over the device on purpose", () => {
    const html = renderStatic(mod.render(input("iphone-6.9-1320x2868")));
    expect(html).toContain('data-device-overlap="allowed"');
  });
});

describe("diagonal-band", () => {
  const mod = templateModules["diagonal-band"];

  it("mirrors the cut with the reading direction", () => {
    const ltr = renderStatic(mod.render(input("iphone-6.9-1320x2868")));
    expect(ltr).toContain('data-band="split"');
    expect(ltr).toContain("rotate(-9deg)");
    const rtl = renderStatic(mod.render(input("iphone-6.9-1320x2868", { direction: "rtl" })));
    expect(rtl).toContain("rotate(9deg)");
  });

  it("draws a ribbon with both edges in stripe mode and honours bandWidth", () => {
    const html = renderStatic(
      mod.render(input("iphone-6.9-1320x2868", { overrides: { band: "stripe", bandWidth: 0.25 } })),
    );
    expect(html).toContain('data-band="stripe"');
    expect(html).toContain(`height:${Math.round(2868 * 0.25)}px`);
    expect(html).toContain("border-bottom:");
  });

  it('bandEdgeColor "none" removes the hairline', () => {
    const html = renderStatic(mod.render(input("iphone-6.9-1320x2868", { overrides: { bandEdgeColor: "none" } })));
    expect(html).not.toContain("border-top:");
  });
});

describe("spotlight", () => {
  const mod = templateModules["spotlight"];

  it("renders only the chips that have copy", () => {
    const html = renderStatic(
      mod.render(input("iphone-6.9-1320x2868", { fields: { headline: "h", chip1: "Offline", chip3: "Fast" } })),
    );
    expect(html).toContain('data-check="chip1"');
    expect(html).toContain('data-check="chip3"');
    expect(html).not.toContain('data-check="chip2"');
  });

  it("toggles the glow and the halo rings", () => {
    const on = renderStatic(mod.render(input("iphone-6.9-1320x2868", { overrides: { halo: true } })));
    expect(on).toContain("data-halo");
    expect(on).toContain("data-glow");
    const off = renderStatic(mod.render(input("iphone-6.9-1320x2868", { overrides: { glow: false } })));
    expect(off).not.toContain("data-glow");
    expect(off).not.toContain("data-halo");
  });
});

describe("overlap-headline", () => {
  const mod = templateModules["overlap-headline"];

  it("puts the device after the headline by default and before it when placed behind", () => {
    const front = renderStatic(mod.render(input("iphone-6.9-1320x2868")));
    expect(front.indexOf("data-device")).toBeGreaterThan(front.indexOf('data-check="headline"'));
    const behind = renderStatic(
      mod.render(input("iphone-6.9-1320x2868", { overrides: { devicePlacement: "behind" } })),
    );
    expect(behind.indexOf("data-device")).toBeLessThan(behind.indexOf('data-check="headline"'));
  });

  it("dims the capture behind type and applies the blend mode", () => {
    const behind = renderStatic(
      mod.render(input("iphone-6.9-1320x2868", { overrides: { devicePlacement: "behind", blend: "difference" } })),
    );
    expect(behind).toContain("mix-blend-mode:difference");
    expect(behind).toContain("rgba(0, 0, 0, 0.45)");
    const front = renderStatic(mod.render(input("iphone-6.9-1320x2868", { overrides: { deviceDim: 0 } })));
    expect(front).not.toContain("rgba(0, 0, 0, 0.45)");
    // In front the device paints over any scrim, so it is not drawn at all.
    const frontDim = renderStatic(mod.render(input("iphone-6.9-1320x2868", { overrides: { deviceDim: 0.5 } })));
    expect(frontDim).not.toContain("rgba(0, 0, 0, 0.5)");
  });

  it("scrims the caption edge unless switched off", () => {
    const withScrim = renderStatic(mod.render(input("iphone-6.9-1320x2868")));
    expect(withScrim).toContain("linear-gradient(0deg");
    const without = renderStatic(mod.render(input("iphone-6.9-1320x2868", { overrides: { captionScrim: false } })));
    expect(without).not.toContain("linear-gradient(0deg");
  });
});

describe("decor shapes", () => {
  it("renders every kind as an inline SVG in the artwork colour", () => {
    const mod = templateModules["statement"];
    for (const kind of DECOR_KINDS) {
      const html = renderStatic(
        mod.render(input("iphone-6.9-1320x2868", { overrides: { decor: kind, accentColor: "#00ff00" } })),
      );
      if (kind === "none") {
        expect(html).not.toContain("data-decor");
        continue;
      }
      expect(html).toContain(`data-decor="${kind}"`);
      expect(html).toContain("data:image/svg+xml");
      expect(html).toContain("%2300ff00");
    }
  });

  it("lightens hex colours towards white and leaves others alone", () => {
    expect(lighten("#000000", 0.5)).toBe("#808080");
    expect(lighten("#336699", 0)).toBe("#336699");
    expect(lighten("tomato", 0.5)).toBe("tomato");
  });
});

describe("strip templates", () => {
  /** A 3-slice strip: one wide canvas, one capture per slice. */
  const strip = (id: string, extra: Partial<TemplateRenderInput> = {}) =>
    input("iphone-6.9-1320x2868", {
      canvasWidth: 1320 * 3,
      sliceImageUrls: ["cap://1", "cap://2", "cap://3"],
      fields: {
        eyebrow: "How it works",
        headline: "Plan the day, run the week",
        caption: "First",
        label: "Today",
        label2: "This week",
        label3: "Progress",
        headline2: "See the week",
        caption2: "Second",
        headline3: "Watch it add up",
        caption3: "Third",
      },
      ...extra,
    }) as TemplateRenderInput;

  it("are marked as strip templates and kept out of the per-screen list", () => {
    expect(stripTemplateIds.sort()).toEqual([
      "strip-alternate",
      "strip-arc",
      "strip-banner",
      "strip-hero",
      "strip-marquee",
      "strip-quote",
      "strip-story",
    ]);
    for (const id of stripTemplateIds) expect(screenTemplateIds).not.toContain(id);
    expect(screenTemplateIds).toContain("hero-top");
  });

  it("strip-banner spans one headline and gives every slice its own capture", () => {
    const html = renderStatic(templateModules["strip-banner"].render(strip("strip-banner")));
    expect(html).toContain(`width:${1320 * 3}px`);
    // One headline for the whole strip, laid out across the full canvas.
    expect((html.match(/data-check="headline"/g) ?? []).length).toBe(1);
    for (const url of ["cap://1", "cap://2", "cap://3"]) expect(html).toContain(url);
    expect(html).toContain('data-check="label2"');
    expect((html.match(/data-device=""/g) ?? []).length).toBe(3);
  });

  it("strip-story numbers each slice and runs one path across the canvas", () => {
    const html = renderStatic(templateModules["strip-story"].render(strip("strip-story")));
    expect(html).toContain("data-path");
    expect(html).toContain(`width:${1320 * 3}px`);
    expect(html).toContain('data-marker="2"');
    expect(html).toContain(">03<");
    expect(html).toContain('data-check="headline3"');
    expect(html).toContain("Watch it add up");
  });

  it("strip-story can drop the path and the markers", () => {
    const html = renderStatic(
      templateModules["strip-story"].render(
        strip("strip-story", { overrides: { path: "none", markers: false } }) as TemplateRenderInput,
      ),
    );
    expect(html).not.toContain("data-path");
    expect(html).not.toContain("data-marker");
  });

  it("strip-arc lifts the middle device and draws one ring across the strip", () => {
    const html = renderStatic(templateModules["strip-arc"].render(strip("strip-arc")));
    expect(html).toContain("data-ring");
    const tops = [...html.matchAll(/data-device=""[^>]*top:(-?\d+)px/g)].map((m) => Number(m[1]));
    expect(tops).toHaveLength(3);
    // Middle sits highest (smallest top), outer two level with each other.
    expect(tops[1]).toBeLessThan(tops[0]);
    expect(tops[0]).toBe(tops[2]);
  });

  it("strip-alternate hangs the device from the top when its copy is below", () => {
    const html = renderStatic(templateModules["strip-alternate"].render(strip("strip-alternate")));
    const tops = [...html.matchAll(/data-device=""[^>]*top:(-?\d+)px/g)].map((m) => Number(m[1]));
    expect(tops[0]).toBeGreaterThan(0);
    expect(tops[1]).toBeLessThan(0); // cropped by the top edge, leaving room for copy
    expect(html).toContain('data-band="soft"');
  });

  it("strip-quote draws the stars and hides them at 0", () => {
    const five = renderStatic(templateModules["strip-quote"].render(strip("strip-quote")));
    expect(five).toContain('data-stars="5"');
    expect(five).toContain("data-quote-mark");
    const none = renderStatic(
      templateModules["strip-quote"].render(
        strip("strip-quote", { overrides: { stars: 0, quoteMark: false } }) as TemplateRenderInput,
      ),
    );
    expect(none).not.toContain("data-stars");
    expect(none).not.toContain("data-quote-mark");
  });

  it("strip-hero makes one slice the hero and knocks the others back", () => {
    const html = renderStatic(templateModules["strip-hero"].render(strip("strip-hero")));
    const widths = [...html.matchAll(/data-device=""[^>]*width:(\d+)px/g)].map((m) => Number(m[1]));
    expect(widths[0]).toBeGreaterThan(widths[1]); // slice 1 is the hero by default
    expect(widths[1]).toBe(widths[2]);
    // Two dim scrims: one over each supporting slice.
    expect((html.match(/rgba\(0, 0, 0, 0.25\)/g) ?? []).length).toBe(2);
    const second = renderStatic(
      templateModules["strip-hero"].render(
        strip("strip-hero", { overrides: { heroSlice: 2, supportDim: 0 } }) as TemplateRenderInput,
      ),
    );
    const w2 = [...second.matchAll(/data-device=""[^>]*width:(\d+)px/g)].map((m) => Number(m[1]));
    expect(w2[1]).toBeGreaterThan(w2[0]);
    expect(second).not.toContain("rgba(0, 0, 0, 0.25)");
  });

  it("strip-marquee repeats the phrase across the strip and skips it when empty", () => {
    const html = renderStatic(
      templateModules["strip-marquee"].render(
        strip("strip-marquee", {
          fields: { headline: "Add what matters", marquee: "plan . do . done" },
        }) as TemplateRenderInput,
      ),
    );
    expect(html).toContain("data-marquee");
    expect((html.match(/plan \. do \. done/g) ?? []).length).toBeGreaterThan(2);
    const bare = renderStatic(
      templateModules["strip-marquee"].render(
        strip("strip-marquee", { fields: { headline: "Add what matters" } }) as TemplateRenderInput,
      ),
    );
    expect(bare).not.toContain("data-marquee");
  });

  it("fall back to the single capture when the screen has no per-slice sources", () => {
    const html = renderStatic(
      templateModules["strip-banner"].render(
        strip("strip-banner", { sliceImageUrls: undefined, sourceImageUrl: "cap://only" }) as TemplateRenderInput,
      ),
    );
    // React also emits a preload <link> for the repeated image; count the <img>s.
    expect((html.match(/<img src="cap:\/\/only"/g) ?? []).length).toBe(3);
  });
});

describe("template catalogue", () => {
  it("every template has a summary and a committed preview image", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(import.meta.dirname, "..", "public", "template-previews");
    for (const mod of Object.values(templateModules)) {
      const { id, summary } = mod.descriptor;
      // Both feed /templates: a missing one means the catalogue shows a gap.
      expect(summary, `${id} has no descriptor.summary`).toBeTruthy();
      expect(
        fs.existsSync(path.join(dir, `${id}.jpg`)),
        `no preview for ${id} — add an example to scripts/template-previews.ts and run: npm run previews`,
      ).toBe(true);
    }
  });
});
