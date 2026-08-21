import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Synthetic device frame: opaque bezel with a transparent screen cut-out and a
 * transparent outer margin (real frameit art has both, which is why a naive
 * "bounding box of transparency" measurement goes wrong).
 */
async function writeFrame(file: string, opts: { w: number; h: number; cut: { x: number; y: number; w: number; h: number }; margin: number }) {
  const { w, h, cut, margin } = opts;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const inCut = x >= cut.x && x < cut.x + cut.w && y >= cut.y && y < cut.y + cut.h;
      const inMargin = x < margin || y < margin || x >= w - margin || y >= h - margin;
      buf[o] = 40;
      buf[o + 1] = 40;
      buf[o + 2] = 40;
      buf[o + 3] = inCut || inMargin ? 0 : 255;
    }
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(file);
}

describe("frame screen cut-out measurement", () => {
  let dir: string;
  const prevEnv = process.env.STORE_SHOTS_FRAMES_DIR;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-frames-"));
    process.env.STORE_SHOTS_FRAMES_DIR = dir;
  });
  afterEach(() => {
    process.env.STORE_SHOTS_FRAMES_DIR = prevEnv;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("measures the cut-out from the alpha channel, ignoring the transparent outer margin", async () => {
    const file = path.join(dir, "Test Tablet.png");
    await writeFrame(file, { w: 200, h: 300, cut: { x: 20, y: 30, w: 160, h: 220 }, margin: 5 });
    const { measureScreenCutout } = await import("../lib/frames");
    expect(measureScreenCutout(file)).toEqual({ x: 20, y: 30, width: 160, height: 220 });
  });

  it("getFrame prefers the measured cut-out over offsets.json and reports screenHeight", async () => {
    const file = path.join(dir, "Test Tablet.png");
    await writeFrame(file, { w: 200, h: 300, cut: { x: 20, y: 30, w: 160, h: 220 }, margin: 5 });
    // Wrong on purpose, like the stale iPad entries in the real offsets.json.
    fs.writeFileSync(
      path.join(dir, "offsets.json"),
      JSON.stringify({ portrait: { "Test Tablet": { offset: "+111+224", width: 1536 } } }),
    );
    const { getFrame } = await import("../lib/frames");
    const frame = getFrame("Test Tablet")!;
    expect(frame.screenX).toBe(20);
    expect(frame.screenY).toBe(30);
    expect(frame.screenWidth).toBe(160);
    expect(frame.screenHeight).toBe(220);
    expect(frame.frameWidth).toBe(200);
    expect(frame.frameHeight).toBe(300);
  });
});
