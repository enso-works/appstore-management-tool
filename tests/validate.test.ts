import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { buildRenderPlan, interpolatePattern, outputFileName } from "../lib/render-plan";
import { targetProfiles } from "../lib/targets";
import { validateProject } from "../lib/validate";
import { writeSolidPng } from "../lib/png-write";
import { editJson, tempFixture } from "./helpers";

function codes(result: ReturnType<typeof validateProject>) {
  return result.issues.items.map((i) => i.code);
}

describe("validateProject on the fixture", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());

  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("passes cleanly", () => {
    const r = validateProject(load());
    expect(r.issues.items).toEqual([]);
    expect(r.plan).toHaveLength(8);
  });

  it("builds a deterministic plan: targets, then locales, then screens by order", () => {
    const r = validateProject(load());
    expect(r.plan.map((j) => j.key)).toEqual([
      "iphone-6.9-1320x2868/en-US/home",
      "iphone-6.9-1320x2868/en-US/planning",
      "iphone-6.9-1320x2868/ar-SA/home",
      "iphone-6.9-1320x2868/ar-SA/planning",
      "ipad-13-2064x2752/en-US/home",
      "ipad-13-2064x2752/en-US/planning",
      "ipad-13-2064x2752/ar-SA/home",
      "ipad-13-2064x2752/ar-SA/planning",
    ]);
  });

  it("uses the default-locale capture for non-localized screens", () => {
    const r = validateProject(load());
    const job = r.plan.find((j) => j.key === "iphone-6.9-1320x2868/ar-SA/planning")!;
    expect(job.sourceLocale).toBe("en-US");
    expect(job.sourcePath.endsWith(path.join("iphone", "en-US", "02-planning.png"))).toBe(true);
    expect(job.outputPath.endsWith(path.join("ar-SA", "02_planning_IPHONE_69.png"))).toBe(true);
  });

  it("reports a missing translation as an error in strict mode and a warning otherwise", () => {
    editJson(path.join(fx.root, "store/content/ar-SA.json"), (c) => delete c.screens.home.headline);
    let r = validateProject(load());
    expect(r.issues.errors.map((i) => i.code)).toContain("content.missing-field");
    expect(r.issues.errors.find((i) => i.code === "content.missing-field")?.key).toBe("ar-SA/home");

    editJson(
      path.join(fx.root, "store-shots.config.json"),
      (c) => (c.validation = { ...c.validation, strictTranslations: false }),
    );
    r = validateProject(load());
    expect(r.issues.errors.map((i) => i.code)).not.toContain("content.missing-field");
    expect(r.issues.warnings.map((i) => i.code)).toContain("content.missing-field");
  });

  it("always requires the default locale to be complete", () => {
    editJson(
      path.join(fx.root, "store-shots.config.json"),
      (c) => (c.validation = { ...c.validation, strictTranslations: false }),
    );
    editJson(path.join(fx.root, "store/content/en-US.json"), (c) => delete c.screens.planning);
    const r = validateProject(load());
    expect(r.issues.errors.map((i) => i.code)).toContain("content.missing-screen");
  });

  it("flags fields a template does not declare", () => {
    editJson(path.join(fx.root, "store/content/en-US.json"), (c) => (c.screens.home.subtitle = "x"));
    const r = validateProject(load());
    expect(codes(r)).toContain("content.unknown-field");
  });

  it("reports a missing content file", () => {
    fs.rmSync(path.join(fx.root, "store/content/ar-SA.json"));
    const r = validateProject(load());
    expect(r.issues.errors.map((i) => i.code)).toContain("content.missing-locale");
  });

  it("catches duplicate ids, duplicate orders, unknown templates and unsupported overrides", () => {
    editJson(path.join(fx.root, "store/manifest.json"), (m) => {
      m.screens.push({ id: "home", order: 1, template: "nope", overrides: { wobble: 1 } });
    });
    const r = validateProject(load());
    const c = codes(r);
    expect(c).toContain("manifest.duplicate-id");
    expect(c).toContain("manifest.duplicate-order");
    expect(c).toContain("manifest.unknown-template");
  });

  it("warns on unknown overrides", () => {
    editJson(path.join(fx.root, "store/manifest.json"), (m) => (m.screens[0].overrides = { wobble: 1 }));
    const r = validateProject(load());
    expect(r.issues.warnings.map((i) => i.code)).toContain("manifest.unknown-override");
  });

  it("reports missing raw captures with a capture hint", () => {
    fs.rmSync(path.join(fx.root, "store/raw/iphone/ar-SA/01-home.png"));
    const r = validateProject(load());
    const issue = r.issues.errors.find((i) => i.code === "source.missing");
    expect(issue?.key).toBe("iphone-6.9-1320x2868/ar-SA/home");
    expect(issue?.hint).toMatch(/capture --device iphone --locale ar-SA --screen home/);
  });

  it("warns when a raw capture has the wrong aspect ratio", () => {
    writeSolidPng(path.join(fx.root, "store/raw/iphone/en-US/01-home.png"), {
      width: 100,
      height: 100,
      color: [1, 2, 3],
    });
    const r = validateProject(load());
    expect(r.issues.warnings.map((i) => i.code)).toContain("source.aspect");
  });

  it("enforces the per-set screenshot range", () => {
    editJson(
      path.join(fx.root, "store-shots.config.json"),
      (c) => (c.validation = { screensPerTarget: { min: 3, max: 10 } }),
    );
    const r = validateProject(load());
    expect(r.issues.errors.map((i) => i.code)).toContain("plan.too-few");
  });

  it("warns about unknown App Store locale codes", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => c.locales.push("xx-YY"));
    const r = validateProject(load());
    expect(r.issues.warnings.map((i) => i.code)).toContain("config.locale-unknown");
  });

  it("respects per-screen target restrictions", () => {
    editJson(path.join(fx.root, "store/manifest.json"), (m) => (m.screens[1].targets = ["iphone-6.9-1320x2868"]));
    const p = load();
    const r = validateProject(p);
    expect(r.plan.filter((j) => j.screen.id === "planning").every((j) => j.target.family === "iphone")).toBe(true);
    // iPad sets now have only one screen -> below the fixture minimum of 2
    expect(r.issues.errors.map((i) => i.code)).toContain("plan.too-few");
  });
});

describe("naming", () => {
  it("interpolates patterns", () => {
    expect(
      interpolatePattern("{device}-{order}-{id}-{locale}.png", {
        order: 3,
        id: "stats",
        locale: "de-DE",
        device: "iphone",
        target: "t",
      }),
    ).toBe("iphone-03-stats-de-DE.png");
  });

  it("builds output names with order, id and device token", () => {
    const screen = {
      id: "my-home",
      order: 1,
      enabled: true,
      template: "hero-top",
      source: { filePattern: "", localized: true },
      overrides: {},
    };
    expect(outputFileName(screen, targetProfiles["iphone-6.9-1320x2868"], "png")).toBe("01_my_home_IPHONE_69.png");
    expect(outputFileName(screen, targetProfiles["ipad-13-2064x2752"], "png")).toBe("01_my_home_IPAD_PRO_129.png");
  });

  it("filters the plan", () => {
    const fx = tempFixture();
    try {
      const p = loadProject(path.join(fx.root, "store-shots.config.json"));
      const r = validateProject(p);
      const subset = buildRenderPlan(p, r.manifest!, {
        locales: ["ar-SA"],
        screens: ["home"],
        targets: ["ipad-13-2064x2752"],
      });
      expect(subset.map((j) => j.key)).toEqual(["ipad-13-2064x2752/ar-SA/home"]);
    } finally {
      fx.cleanup();
    }
  });
});
