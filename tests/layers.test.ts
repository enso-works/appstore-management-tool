import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { inputsHash } from "../lib/generate";
import { templateInputFor } from "../lib/render/html";
import { buildRenderPlan } from "../lib/render-plan";
import { getTarget, shortLabel } from "../lib/targets";
import { validateProject } from "../lib/validate";
import { editJson, tempFixture } from "./helpers";

describe("layers per target", () => {
  it("re-renders when a layer changes", () => {
    const fx = tempFixture();
    try {
      const hash = () => {
        const project = loadProject(path.join(fx.root, "store-shots.config.json"));
        const v = validateProject(project);
        const job = buildRenderPlan(project, v.manifest!).find((j) => j.target.id === "ipad-13-2064x2752")!;
        return inputsHash(project, job, v.content.get(job.locale)!, "1", [], "t");
      };
      const before = hash();
      editJson(path.join(fx.root, "store/manifest.json"), (m) => {
        for (const sc of m.screens) sc.layers = [{ type: "image", id: "a", asset: "logos/x.png", x: 0.2, y: 0.2 }];
      });
      const withLayer = hash();
      expect(withLayer).not.toBe(before);
      editJson(path.join(fx.root, "store/manifest.json"), (m) => {
        for (const sc of m.screens) sc.layers[0].targets = ["iphone-6.9-1320x2868"];
      });
      // Now the layer is not drawn on iPad: same inputs as without it.
      expect(hash()).toBe(before);
    } finally {
      fx.cleanup();
    }
  });

  it("renders a layer only on the targets it names", () => {
    const fx = tempFixture();
    try {
      editJson(path.join(fx.root, "store/manifest.json"), (m) => {
        m.screens[0].layers = [
          { type: "image", id: "wide", asset: "logos/badge.png", x: 0.2, y: 0.2, targets: ["iphone-6.9-1320x2868"] },
          { type: "image", id: "everywhere", asset: "logos/badge.png", x: 0.5, y: 0.2 },
        ];
      });
      const project = loadProject(path.join(fx.root, "store-shots.config.json"));
      const v = validateProject(project);
      const plan = buildRenderPlan(project, v.manifest!).filter((j) => j.screen.id === v.manifest!.screens[0].id);
      const ids = (targetId: string) => {
        const job = plan.find((j) => j.target.id === targetId && j.locale === "en-US")!;
        return (templateInputFor(project, job, v.content.get("en-US")!, "x.png", "export").layers ?? []).map(
          (l) => l.id,
        );
      };
      expect(ids("iphone-6.9-1320x2868")).toEqual(["wide", "everywhere"]);
      expect(ids("ipad-13-2064x2752")).toEqual(["everywhere"]);
    } finally {
      fx.cleanup();
    }
  });

  it("rejects a layer target that is not configured, and an empty list", () => {
    const fx = tempFixture();
    try {
      editJson(path.join(fx.root, "store/manifest.json"), (m) => {
        m.screens[0].layers = [
          { type: "image", id: "x", asset: "logos/badge.png", x: 0.2, y: 0.2, targets: ["iphone-6.1-1206x2622"] },
        ];
      });
      const load = () => validateProject(loadProject(path.join(fx.root, "store-shots.config.json")));
      expect(load().issues.errors.map((i) => i.code)).toContain("manifest.layer-target");
      editJson(path.join(fx.root, "store/manifest.json"), (m) => (m.screens[0].layers[0].targets = []));
      expect(load().issues.errors.map((i) => i.code)).toContain("manifest.schema");
    } finally {
      fx.cleanup();
    }
  });
});

describe("shortLabel", () => {
  const t = (id: string) => getTarget(id)!;

  it("names targets the way the layer panel shows them", () => {
    expect(shortLabel(t("iphone-6.9-2868x1320"))).toBe('iPhone 6.9"');
    expect(shortLabel(t("ipad-13-2752x2064"))).toBe('iPad 13"');
    expect(shortLabel(t("play-phone-1080x1920"))).toBe("Play phone");
    expect(shortLabel(t("play-feature-1024x500"))).toBe("Feature graphic");
    expect(shortLabel(t("appreview-6.9-886x1920"))).toBe('Preview 6.9"');
  });

  it("adds the orientation only when both orientations of a class are shown", () => {
    const both = [t("iphone-6.9-1320x2868"), t("iphone-6.9-2868x1320"), t("ipad-13-2064x2752")];
    expect(shortLabel(both[0], both)).toBe('iPhone 6.9" portrait');
    expect(shortLabel(both[1], both)).toBe('iPhone 6.9" landscape');
    expect(shortLabel(both[2], both)).toBe('iPad 13"');
  });
});
