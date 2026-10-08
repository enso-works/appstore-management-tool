import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { readImageInfo } from "../lib/image";
import { writeSolidPng } from "../lib/png-write";
import { readinessReport } from "../lib/readiness";
import { tempFixture } from "./helpers";

// Apple's screenshot specification and asset best practices, as checked on 2026-10-08.

describe("JPEG screenshots", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());

  it("reads JPEG dimensions from the header", async () => {
    const file = path.join(fx.root, "shot.jpg");
    await sharp({ create: { width: 1206, height: 2622, channels: 3, background: "#123456" } })
      .withMetadata()
      .jpeg()
      .toFile(file);
    expect(readImageInfo(file)).toEqual({ format: "jpeg", width: 1206, height: 2622, hasAlpha: false });
    fs.writeFileSync(path.join(fx.root, "x.jpg"), "hello");
    expect(() => readImageInfo(path.join(fx.root, "x.jpg"))).toThrow(/not a PNG or JPEG/);
  });

  it("counts JPEG screenshots in readiness", async () => {
    for (const locale of ["en-US", "ar-SA"]) {
      const dir = path.join(fx.root, "fastlane/screenshots", locale);
      fs.mkdirSync(dir, { recursive: true });
      for (let i = 1; i <= 2; i++) {
        await sharp({ create: { width: 1320, height: 2868, channels: 3, background: "#123456" } })
          .jpeg()
          .toFile(path.join(dir, `0${i}_x_IPHONE_69.jpg`));
        writeSolidPng(path.join(dir, `0${i}_x_IPAD_PRO_129.png`), { width: 2064, height: 2752, color: [1, 2, 3] });
      }
    }
    const r = readinessReport(loadProject(path.join(fx.root, "store-shots.config.json")));
    expect(r.checks.find((c) => c.id === "screenshots")!.status).toBe("pass");
  });
});
