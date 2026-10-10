import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { generateProject } from "../lib/generate";
import { ExportRenderer } from "../lib/render/export";
import { editJson, tempFixture } from "./helpers";

describe("generate progress", () => {
  it("reports each job as it finishes, counting up to the plan", async () => {
    const fx = tempFixture();
    const renderer = new ExportRenderer();
    try {
      editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
        c.locales = ["en-US"];
        c.targets = ["iphone-6.9-1320x2868"];
      });
      await renderer.start();
      const seen: { done: number; total: number; status: string }[] = [];
      const summary = await generateProject(loadProject(path.join(fx.root, "store-shots.config.json")), {
        renderer,
        onProgress: ({ done, total, status }) => seen.push({ done, total, status }),
      });
      expect(seen.map((s) => s.done)).toEqual(Array.from({ length: summary.planned }, (_, i) => i + 1));
      expect(seen.every((s) => s.total === summary.planned)).toBe(true);
      expect(seen.map((s) => s.status)).toEqual(summary.jobs.map((j) => j.status));
    } finally {
      await renderer.close();
      fx.cleanup();
    }
  }, 120_000);
});
