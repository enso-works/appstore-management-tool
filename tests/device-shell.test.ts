import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderStatic } from "../lib/render/ssr";
import { targetProfiles } from "../lib/targets";
import { templateModules } from "../templates";
import { DeviceShell } from "../templates/shared";
import type { TemplateRenderInput } from "../templates/types";

function input(targetId: keyof typeof targetProfiles, overrides: Record<string, unknown> = {}): TemplateRenderInput {
  const target = targetProfiles[targetId];
  return {
    target,
    canvasWidth: target.width,
    locale: "en-US",
    direction: "ltr",
    fields: { headline: "Plan everything" },
    sourceImageUrl: "capture.png",
    brand: { fontFamily: "Inter", fontStack: "Inter", primary: "#111111", onPrimary: "#ffffff" },
    overrides,
    mode: "export",
    assetUrl: (rel) => rel,
    layers: [],
  } as TemplateRenderInput;
}

const render = (i: TemplateRenderInput) => renderStatic(templateModules["hero-top"].render(i));

describe("device shell", () => {
  it("draws an iPhone with a Dynamic Island and its five buttons", () => {
    const html = render(input("iphone-6.9-1320x2868"));
    expect(html).toContain("data-island");
    for (const b of ["action", "volume-up", "volume-down", "side", "camera-control"]) {
      expect(html).toContain(`data-button="${b}"`);
    }
  });

  it("puts the island on the left and the buttons on the long edges in landscape", () => {
    const html = render(input("iphone-6.9-2868x1320"));
    expect(html).toMatch(/data-island="" style="[^"]*left:\d+px;top:50%/);
    expect(html).toMatch(/data-button="action" style="[^"]*bottom:-\d+px/);
    expect(html).toMatch(/data-button="side" style="[^"]*top:-\d+px/);
  });

  it("draws the body around the display, so the capture keeps its size", () => {
    const html = renderStatic(
      createElement(DeviceShell, {
        input: input("iphone-6.9-1320x2868"),
        width: 1000,
        height: 2173,
        left: 100,
        top: 200,
      }),
    );
    const [, left, top, width, height] =
      /data-device="" style="[^"]*left:(-?\d+)px;top:(-?\d+)px;width:(\d+)px;height:(\d+)px/.exec(html)!.map(Number);
    const edge = 100 - left;
    expect(edge).toBe(32); // band (11) + glass (21) at 1000 px
    expect(top).toBe(200 - edge);
    expect([width, height]).toEqual([1000 + 2 * edge, 2173 + 2 * edge]);
  });

  it("leaves the island off App Preview posters", () => {
    expect(render(input("appreview-6.9-886x1920"))).not.toContain("data-island");
  });

  it("gives an iPad the band and buttons but no island, and shell none just the screen", () => {
    const ipad = render(input("ipad-13-2064x2752"));
    expect(ipad).not.toContain("data-island");
    expect(ipad).toContain('data-button="volume-up"');
    const bare = render(input("iphone-6.9-1320x2868", { shell: "none" }));
    expect(bare).not.toContain("data-island");
    expect(bare).not.toContain("data-button");
    expect(bare).toContain("data-source");
  });
});
