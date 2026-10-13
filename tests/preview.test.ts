import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { previewShots } from "../lib/preview-shots";
import { ExportRenderer } from "../lib/render/export";
import { editJson, tempFixture } from "./helpers";

describe("store-shots preview", () => {
  const renderer = new ExportRenderer();
  beforeAll(() => renderer.start());
  afterAll(() => renderer.close());

  it("renders the lead set in the default language, with the sketch for a missing capture", async () => {
    const fx = tempFixture();
    try {
      fs.rmSync(path.join(fx.root, "store/raw/iphone/en-US/02-planning.png"));
      const shotsDir = path.join(fx.root, "fastlane/screenshots");
      const listing = () => (fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir, { recursive: true }).sort() : []);
      const before = listing();
      const project = loadProject(path.join(fx.root, "store-shots.config.json"));
      const result = await previewShots(project, { renderer, height: 600 });
      expect(result.outDir).toBe(path.join(fx.root, "store/generated/preview"));
      expect(result.shots.map((s) => [s.target, s.locale, s.screen, s.placeholder])).toEqual([
        ["iphone-6.9-1320x2868", "en-US", "home", false],
        ["iphone-6.9-1320x2868", "en-US", "planning", true],
      ]);
      for (const s of result.shots) {
        expect(path.isAbsolute(s.file)).toBe(true);
        expect((await sharp(s.file).metadata()).height).toBe(600);
      }
      // The missing capture is not a problem here; nothing writes into fastlane/screenshots.
      expect(result.issues.map((i) => i.code)).not.toContain("source.missing");
      expect(listing()).toEqual(before);
    } finally {
      fx.cleanup();
    }
  });

  it("reports copy that does not fit, and leaves a folder you chose as it was", async () => {
    const fx = tempFixture();
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-preview-out-"));
    try {
      fs.writeFileSync(path.join(out, "keep.txt"), "mine");
      editJson(path.join(fx.root, "store/content/en-US.json"), (c) => {
        c.screens.home.headline = "A headline far too long to ever fit ".repeat(12).trim();
      });
      const project = loadProject(path.join(fx.root, "store-shots.config.json"));
      const result = await previewShots(project, { renderer, screens: ["home"], locales: ["ar-SA"], outDir: out });
      expect(result.shots).toHaveLength(1);
      expect(result.shots[0].file).toBe(path.join(out, "iphone-6.9-1320x2868", "ar-SA", "01-home.png"));
      expect(fs.readFileSync(path.join(out, "keep.txt"), "utf8")).toBe("mine");

      const en = await previewShots(project, { renderer, screens: ["home"], outDir: out });
      expect(en.shots[0].issues.map((i) => i.code)).toContain("render.overflow");
    } finally {
      fx.cleanup();
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
