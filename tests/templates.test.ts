import { describe, expect, it } from "vitest";
import { templateModules } from "../templates";
import { stackLayout } from "../templates/shared";
import type { TemplateRenderInput } from "../templates/types";
import { renderStatic } from "../lib/render/ssr";
import { targetProfiles } from "../lib/targets";

/** Template contract tests (plan §18.2): every template renders for every supported target, LTR and RTL, and honours positional overrides. */

function input(targetId: keyof typeof targetProfiles, extra: Partial<TemplateRenderInput> = {}): TemplateRenderInput {
  return {
    target: targetProfiles[targetId],
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
  for (const mod of Object.values(templateModules)) {
    describe(mod.descriptor.id, () => {
      it("declares fields and targets", () => {
        expect(mod.descriptor.requiredFields).toContain("headline");
        expect(mod.descriptor.families).toEqual(["iphone", "ipad"]);
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

  it("applies X/Y offsets as fractions of the canvas width", () => {
    const a = stackLayout(base, 500, defaults);
    const b = stackLayout(
      { ...base, overrides: { screenshotOffsetX: 0.1, screenshotOffsetY: -0.2, textOffsetY: 0.05 } },
      500,
      defaults,
    );
    expect(b.device.left - a.device.left).toBe(132);
    expect(b.text.top - a.text.top).toBe(66);
    expect(b.device.top - a.device.top).toBe(-264 + 66);
  });
});
