import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { readImageInfo } from "../lib/image";
import { analyzeKeywords } from "../lib/metadata";
import { writeSolidPng } from "../lib/png-write";
import { readinessReport } from "../lib/readiness";
import { buildRenderPlan } from "../lib/render-plan";
import { validateProject } from "../lib/validate";
import { editJson, tempFixture } from "./helpers";

// Apple's screenshot specification and asset best practices, as checked on 2026-10-08.

describe("required display sizes", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const config = () => path.join(fx.root, "store-shots.config.json");
  const check = () => readinessReport(loadProject(config())).checks.find((c) => c.id === "required-sizes")!;

  it('warns without a 6.1" iPhone set and passes with one', () => {
    expect(check().status).toBe("warn");
    expect(check().details.join("\n")).toMatch(/iphone-6\.1-1206x2622/);
    editJson(config(), (c) => (c.targets = ["iphone-6.9-1320x2868", "iphone-6.1-1206x2622", "ipad-13-2064x2752"]));
    expect(check().status).toBe("pass");
  });

  it("fails without an iPad 13-inch set when the app supports iPad", () => {
    editJson(config(), (c) => (c.targets = ["iphone-6.1-1206x2622"]));
    expect(check().status).toBe("fail");
    expect(check().details.join("\n")).toMatch(/supportsTablet.*ipad-13-2064x2752/);
    editJson(path.join(fx.root, "app.json"), (a) => (a.expo.ios.supportsTablet = false));
    expect(check().status).toBe("pass");
  });

  it("fails without any iPhone set and suggests the landscape size for landscape apps", () => {
    editJson(config(), (c) => (c.targets = ["ipad-13-2752x2064"]));
    expect(check().status).toBe("fail");
    expect(check().details.join("\n")).toMatch(/no iPhone set; add iphone-6\.1-2622x1206/);
  });

  it("skips projects without App Store targets", () => {
    editJson(config(), (c) => (c.targets = ["play-phone-1080x1920"]));
    expect(check().status).toBe("skip");
  });

  it('renders 6.1" from the same raw captures as 6.9"', () => {
    editJson(config(), (c) => (c.targets = ["iphone-6.9-1320x2868", "iphone-6.1-1206x2622"]));
    const project = loadProject(config());
    const plan = buildRenderPlan(project, validateProject(project).manifest!);
    const source = (target: string) => plan.find((j) => j.target.id === target && j.locale === "en-US")!.sourcePath;
    expect(source("iphone-6.1-1206x2622")).toBe(source("iphone-6.9-1320x2868"));
    expect(path.basename(plan.find((j) => j.target.id === "iphone-6.1-1206x2622")!.outputPath)).toMatch(
      /_IPHONE_61\.png$/,
    );
  });
});

describe("keyword guidance", () => {
  it("flags plurals, repeated words, app, categories, special characters and short terms", () => {
    const a = analyzeKeywords("timer,timers,stories,story,sleep sounds,sleep app,Weather,#calm,ai", "Calmly", "");
    expect(a.plurals).toEqual(["timers", "stories"]);
    expect(a.repeatedWords).toEqual(["sleep"]);
    expect(a.appWord).toBe(true);
    expect(a.categoryNames).toEqual(["weather"]);
    expect(a.specialChars).toEqual(["#calm"]);
    expect(a.tooShort).toEqual(["ai"]);
    expect(analyzeKeywords("瞑想,睡眠,呼吸,명상").tooShort).toEqual([]);
    expect(a.findings.every((f) => f.level === "warn")).toBe(true);
  });

  it("counts the limit in bytes, so non-Latin keywords fit fewer characters", () => {
    const japanese = Array.from({ length: 10 }, () => "瞑想").join(","); // 29 characters, 69 bytes
    expect(analyzeKeywords(japanese).bytes).toBe(69);
    const long = Array.from({ length: 15 }, (_, i) => `睡眠${i}`).join(",");
    const a = analyzeKeywords(long);
    expect(Array.from(long).length).toBeLessThan(100);
    expect(a.bytes).toBeGreaterThan(100);
    expect(a.findings[0]).toEqual({ level: "fail", text: `${a.bytes}/100 bytes` });
  });

  it("is clean for well-formed keywords", () => {
    expect(analyzeKeywords("planner,tasks,reminders,notes,focus", "Demo App", "Plan your day").findings).toEqual([]);
  });

  it("reports findings per locale in readiness", () => {
    const fx = tempFixture();
    try {
      fs.writeFileSync(path.join(fx.root, "fastlane/metadata/en-US/keywords.txt"), "tasks,task,apps\n");
      const r = readinessReport(loadProject(path.join(fx.root, "store-shots.config.json")));
      const check = r.checks.find((c) => c.id === "metadata-keywords")!;
      expect(check.status).toBe("warn");
      expect(check.details).toEqual(["en-US: plurals of included words: tasks", 'en-US: "app" is indexed already']);
    } finally {
      fx.cleanup();
    }
  });
});

describe("store claims in screenshot text", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());

  const claims = (headline: string) => {
    editJson(path.join(fx.root, "store/content/en-US.json"), (c) => (c.screens.home.headline = headline));
    return validateProject(loadProject(path.join(fx.root, "store-shots.config.json")))
      .issues.items.filter((i) => i.code === "content.store-claims")
      .map((i) => i.message);
  };

  it.each([
    ["Only $4.99 a month", "a price"],
    ["Pro für 9,99 €", "a price"],
    ["50% off this week", "a discount"],
    ["Learn more at braele.app", "a website URL"],
    ["© 2026 Bavrk", "a copyright symbol"],
    ["Also on Android", "another platform or marketplace"],
    ["Editor's Choice", "an Apple recognition"],
    ["App of the Day", "an Apple recognition"],
  ])("flags %s as %s", (headline, what) => {
    expect(claims(headline)).toEqual([expect.stringContaining(`shows ${what}`)]);
  });

  it("only applies to screens that render for the App Store", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.targets = ["play-phone-1080x1920"]));
    expect(claims("Now on Android")).toEqual([]);
  });

  it("leaves ordinary copy alone", () => {
    expect(claims("Run 5 km, sleep 8 hours, focus 100%")).toEqual([]);
  });
});

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
