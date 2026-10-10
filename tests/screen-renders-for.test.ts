import { describe, expect, it } from "vitest";
import { screenRendersFor } from "../lib/targets";

describe("screenRendersFor", () => {
  it("keeps a screen without targets on every screenshot set and off opt-in pictures", () => {
    expect(screenRendersFor({}, "iphone-6.9-1320x2868")).toBe(true);
    expect(screenRendersFor({}, "ipad-13-2064x2752")).toBe(true);
    expect(screenRendersFor({}, "universal-5244x2950")).toBe(false);
    expect(screenRendersFor({}, "event-card-1920x1080")).toBe(false);
  });

  it("renders a screen that lists targets only for those", () => {
    const header = { targets: ["universal-5244x2950"] };
    expect(screenRendersFor(header, "universal-5244x2950")).toBe(true);
    expect(screenRendersFor(header, "iphone-6.9-1320x2868")).toBe(false);
  });
});
