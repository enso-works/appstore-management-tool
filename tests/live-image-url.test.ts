import { describe, expect, it } from "vitest";
import { liveImageUrl } from "../lib/live";

const url = "https://is1-ssl.mzstatic.com/image/thumb/Purple/v4/aa/01_hero.png/320x480bb.jpg";

describe("liveImageUrl", () => {
  it("keeps the target's shape with the long side at most 1000", () => {
    expect(liveImageUrl(url, 1320, 2868)).toMatch(/\/460x1000bb\.png$/);
    expect(liveImageUrl(url, 2868, 1320)).toMatch(/\/1000x460bb\.png$/);
  });

  it("never asks for more than the target size", () => {
    expect(liveImageUrl(url, 600, 800)).toMatch(/\/600x800bb\.png$/);
    expect(liveImageUrl(url, 1320, 2868, 4000)).toMatch(/\/1320x2868bb\.png$/);
  });

  it("leaves a URL without a size token alone", () => {
    expect(liveImageUrl("https://example.com/a.png", 1320, 2868)).toBe("https://example.com/a.png");
  });
});
