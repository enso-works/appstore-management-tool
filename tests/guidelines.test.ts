import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { withSetCopy } from "../lib/content";
import { readinessReport, type ReadinessReport } from "../lib/readiness";
import { buildJob, buildRenderPlan, buildSetPlan } from "../lib/render-plan";
import { creativePlacementsOf, getTarget, isScreenshotSet, safeAreaOf, shortLabel, targetsFor } from "../lib/targets";
import { generateProject } from "../lib/generate";
import { validateProject } from "../lib/validate";
import { readVideoInfo } from "../lib/video";
import { editJson, mp4, tempFixture } from "./helpers";

const byId = (r: ReadinessReport, id: string) => r.checks.find((c) => c.id === id)!;

describe("Apple guideline checks", () => {
  let fx: ReturnType<typeof tempFixture>;
  const config = () => path.join(fx.root, "store-shots.config.json");
  const load = () => loadProject(config());
  const appJson = () => path.join(fx.root, "app.json");
  const manifest = () => path.join(fx.root, "store", "manifest.json");

  beforeEach(() => {
    fx = tempFixture();
  });
  afterEach(() => fx.cleanup());

  describe("dark mode", () => {
    it("is skipped for an app that is always light (Expo's default)", () => {
      expect(byId(readinessReport(load()), "dark-mode").status).toBe("skip");
    });

    it("asks for a dark screenshot when the app follows the system, until a screen is marked dark", () => {
      editJson(appJson(), (a) => {
        a.expo.userInterfaceStyle = "automatic";
      });
      const before = byId(readinessReport(load()), "dark-mode");
      expect(before.status).toBe("warn");
      expect(before.details[0]).toMatch(/app\.json userInterfaceStyle/);
      editJson(manifest(), (m) => {
        m.screens[1].appearance = "dark";
      });
      expect(byId(readinessReport(load()), "dark-mode").status).toBe("pass");
    });
  });

  describe("icon variants", () => {
    it("warns about a single Expo icon and passes light/dark/tinted", () => {
      expect(byId(readinessReport(load()), "icon-variants").details[0]).toMatch(/no dark or tinted icon/);
      editJson(appJson(), (a) => {
        a.expo.ios.icon = {
          light: "./assets/icon.png",
          dark: "./assets/icon-dark.png",
          tinted: "./assets/icon-tinted.png",
        };
      });
      expect(byId(readinessReport(load()), "icon-variants").status).toBe("pass");
      editJson(appJson(), (a) => {
        a.expo.ios.icon = "./assets/app.icon";
      });
      expect(byId(readinessReport(load()), "icon-variants").status).toBe("pass");
    });

    it("reads the appearances of a native app's icon set", () => {
      fs.rmSync(appJson());
      const set = path.join(fx.root, "ios", "App", "Assets.xcassets", "AppIcon.appiconset");
      fs.mkdirSync(set, { recursive: true });
      const images = [
        { filename: "icon.png", idiom: "universal", platform: "ios", size: "1024x1024" },
        {
          filename: "dark.png",
          idiom: "universal",
          platform: "ios",
          size: "1024x1024",
          appearances: [{ appearance: "luminosity", value: "dark" }],
        },
      ];
      fs.writeFileSync(path.join(set, "Contents.json"), JSON.stringify({ images }));
      const check = byId(readinessReport(load()), "icon-variants");
      expect(check.status).toBe("warn");
      expect(check.details[0]).toMatch(/no tinted icon \(asset catalog\)/);
    });
  });

  describe("app previews", () => {
    const write = (locale: string, name: string, v: Parameters<typeof mp4>[0]) => {
      const dir = path.join(fx.root, "store", "previews", locale);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), mp4(v));
    };

    it("reads size, duration and frame rate from the movie header", () => {
      write("en-US", "a.mp4", { width: 886, height: 1920, seconds: 20, fps: 30 });
      const info = readVideoInfo(path.join(fx.root, "store/previews/en-US/a.mp4"));
      expect(info).toMatchObject({ width: 886, height: 1920, durationSeconds: 20, fps: 30 });
    });

    it("is skipped without a previews folder, and passes a preview within the limits", () => {
      expect(byId(readinessReport(load()), "app-previews").status).toBe("skip");
      write("en-US", "a.mp4", { width: 886, height: 1920, seconds: 20, fps: 30 });
      write("en-US", "b.mov", { width: 1600, height: 1200, seconds: 15, fps: 30 });
      expect(byId(readinessReport(load()), "app-previews").status).toBe("pass");
    });

    it("fails the wrong size, length or frame rate, and a fourth preview", () => {
      write("en-US", "size.mp4", { width: 1320, height: 2868, seconds: 20, fps: 30 });
      write("en-US", "short.mp4", { width: 886, height: 1920, seconds: 10, fps: 30 });
      write("en-US", "fast.mp4", { width: 886, height: 1920, seconds: 20, fps: 60 });
      write("en-US", "c.mp4", { width: 886, height: 1920, seconds: 20, fps: 30 });
      write("en-US", "d.mp4", { width: 886, height: 1920, seconds: 20, fps: 30 });
      const check = byId(readinessReport(load()), "app-previews");
      expect(check.status).toBe("fail");
      const text = check.details.join("\n");
      expect(text).toMatch(/size\.mp4: 1320x2868/);
      expect(text).toMatch(/short\.mp4: 10 s/);
      expect(text).toMatch(/fast\.mp4: 60 fps/);
      expect(text).toMatch(/en-US: 4 iPhone previews; at most 3/);
    });

    it("judges the exact length and the peak frame rate, and takes the Home-button iPhone size", () => {
      write("en-US", "almost.mp4", { width: 886, height: 1920, seconds: 14.96, fps: 30 });
      // 20 s that average 25 fps but include a 60 fps stretch, like a screen recording.
      write("en-US", "vfr.mp4", {
        width: 886,
        height: 1920,
        seconds: 20,
        fps: 25,
        runs: [
          [440, 30],
          [60, 60],
        ],
      });
      write("en-US", "plus.mp4", { width: 1080, height: 1920, seconds: 20, fps: 30 });
      // Jittery 60 fps: deltas alternate between 1/50 and 1/75 s, never a long uniform run.
      write("en-US", "jitter.mp4", {
        width: 886,
        height: 1920,
        seconds: 20,
        fps: 25,
        runs: [...Array.from({ length: 60 }, (_, i) => [1, i % 2 ? 50 : 75] as [number, number]), [450, 25]],
      });
      // One short gap between two frames is not 120 fps.
      write("en-US", "blip.mp4", {
        width: 886,
        height: 1920,
        seconds: 20,
        fps: 30,
        runs: [
          [300, 30],
          [1, 120],
          [299, 30],
        ],
      });
      const text = byId(readinessReport(load()), "app-previews").details.join("\n");
      expect(text).toMatch(/almost\.mp4: 14\.96 s/);
      expect(text).toMatch(/vfr\.mp4: 60 fps/);
      expect(text).not.toMatch(/plus\.mp4/);
      expect(text).not.toMatch(/blip\.mp4/);
      expect(text).toMatch(/jitter\.mp4: \d+(\.\d+)? fps/);
    });
  });

  describe("named sets", () => {
    const content = () => path.join(fx.root, "store", "content", "en-US.json");

    it("renders a page's own copy over the default page's", () => {
      const lc = {
        locale: "en-US",
        screens: { home: { headline: "Default", caption: "Shared" } },
        sets: { planners: { screens: { home: { headline: "Page only" } } } },
      };
      expect(withSetCopy(lc, "planners").screens.home).toEqual({ headline: "Page only", caption: "Shared" });
      expect(withSetCopy(lc, undefined).screens.home.headline).toBe("Default");
      expect(withSetCopy(lc, "other").screens.home.headline).toBe("Default");
    });

    it("checks each page's fields and text against what its kind allows", () => {
      editJson(manifest(), (m) => {
        m.sets = [
          { id: "planners", kind: "custom", deepLink: "demo://plan", screens: ["planning"] },
          { id: "test-a", kind: "ppo", deepLink: "demo://x", screens: ["home"] },
        ];
      });
      editJson(content(), (c) => {
        c.sets = {
          planners: {
            promotionalText: "x".repeat(171),
            keywords: ["planner", "spaceships"],
            screens: { home: { headline: "Not on this page" } },
          },
          "test-a": { keywords: ["planner"] },
          ghost: {},
        };
      });
      const items = validateProject(load()).issues.items;
      const byCode = (code: string) => items.filter((i) => i.code === code).map((i) => i.message);
      expect(byCode("sets.promotional-text")[0]).toMatch(/171\/170/);
      expect(byCode("sets.keyword-not-in-app")[0]).toMatch(/"spaceships"/);
      expect(byCode("sets.keyword-not-in-app")[0]).not.toMatch(/"planner"/);
      expect(byCode("sets.field-kind")).toHaveLength(2); // the treatment's deep link and its keywords
      expect(byCode("sets.content-screen")[0]).toMatch(/home/);
      expect(byCode("sets.content-unknown")[0]).toMatch(/ghost/);
    });

    it("keeps a set's own copy problems to that set", () => {
      editJson(manifest(), (m) => {
        m.sets = [{ id: "planners", kind: "custom", screens: ["planning", "home"] }];
      });
      editJson(content(), (c) => {
        c.sets = { planners: { screens: { home: { headline: "漢字 planner" } } } };
      });
      const glyph = validateProject(load()).issues.items.filter((i) => i.code === "content.glyph-missing");
      expect(glyph.map((i) => i.key)).toEqual(["sets/planners/en-US"]);
      expect(glyph[0].message).toMatch(/\(set "planners"\)/);
    });

    it("rejects a deep link that is not a URL", () => {
      editJson(manifest(), (m) => {
        m.sets = [{ id: "planners", kind: "custom", deepLink: "plan screen", screens: ["planning"] }];
      });
      expect(validateProject(load()).issues.items.some((i) => i.code === "manifest.schema")).toBe(true);
    });

    it("renders a custom product page's screens in its own order and folder, renumbered", () => {
      editJson(manifest(), (m) => {
        m.screens[1].enabled = false;
        m.sets = [{ id: "planners", kind: "custom", screens: ["planning", "home"] }];
      });
      const project = load();
      const v = validateProject(project);
      expect(v.issues.items.filter((i) => i.code.startsWith("sets."))).toEqual([]);
      const jobs = buildSetPlan(project, v.manifest!);
      // Two App Store targets x two locales x two screens.
      expect(jobs).toHaveLength(8);
      const first = jobs[0];
      expect(first.key).toBe("sets/planners/iphone-6.9-1320x2868/en-US/planning");
      expect(path.relative(fx.root, first.outputPath)).toBe(
        path.join("store", "generated", "sets", "planners", "en-US", "01_planning_IPHONE_69.png"),
      );
      expect(path.basename(jobs[1].outputPath)).toBe("02_home_IPHONE_69.png");
      // Renumbered outputs, but each screen still renders from its own capture.
      expect(path.basename(first.sourcePath)).toBe("02-planning.png");
      expect(fs.existsSync(first.sourcePath)).toBe(true);
      // The default page no longer shows the disabled screen.
      expect(buildRenderPlan(project, v.manifest!).map((j) => j.screen.id)).not.toContain("planning");
      expect(buildRenderPlan(project, v.manifest!, { sets: ["planners"] })).toEqual([]);
    });

    it("keeps a broken set from stopping the default page or another set", async () => {
      editJson(manifest(), (m) => {
        m.sets = [
          { id: "broken", kind: "custom", screens: ["home", "nope"] },
          { id: "fine", kind: "custom", screens: ["home"] },
        ];
      });
      const project = load();
      for (const filter of [undefined, { sets: ["fine"] }]) {
        const summary = await generateProject(project, { dryRun: true, filter });
        expect(summary.aborted).toBe(false);
      }
      const plan = await generateProject(project, { dryRun: true });
      expect(plan.jobs.some((j) => j.key.startsWith("sets/fine/"))).toBe(true);
    });

    it("rejects unknown screens and more treatments than a test allows", () => {
      editJson(manifest(), (m) => {
        m.sets = [
          { id: "a", kind: "ppo", screens: ["home", "nope"] },
          { id: "b", kind: "ppo", screens: ["home"] },
          { id: "c", kind: "ppo", screens: ["home"] },
          { id: "d", kind: "ppo", screens: ["home"] },
        ];
      });
      const codes = validateProject(load()).issues.items.map((i) => i.code);
      expect(codes).toContain("sets.unknown-screen");
      expect(codes).toContain("sets.too-many-sets");
      // Four treatments split over two experiments are within the limit.
      editJson(manifest(), (m) => {
        m.sets[0].screens = ["home"];
        m.sets[3].experiment = "icons";
      });
      expect(validateProject(load()).issues.items.map((i) => i.code)).not.toContain("sets.too-many-sets");
    });
  });

  describe("in-app event media", () => {
    it("renders from the iPhone captures into store/generated/events and is not a screenshot set", () => {
      editJson(config(), (c) => {
        c.targets.push("event-card-1920x1080", "event-detail-1080x1920");
      });
      editJson(manifest(), (m) => {
        m.screens.push({
          id: "event",
          order: 3,
          template: "feature-graphic",
          targets: ["event-card-1920x1080"],
          source: { filePattern: "01-home.png" },
        });
      });
      const project = load();
      const v = validateProject(project);
      const job = buildJob(project, v.manifest!.screens[2], "event-card-1920x1080", "en-US")!;
      expect(job.sourceDevice).toBe("iphone");
      expect(path.relative(fx.root, job.outputPath)).toBe(
        path.join("store", "generated", "events", "en-US", "03_event_EVENT_CARD.png"),
      );
      expect(isScreenshotSet("event-card-1920x1080")).toBe(false);
      expect(shortLabel(getTarget("event-detail-1080x1920")!)).toBe("Event details");
      // Event media do not count towards the 3-10 screenshots of a set.
      expect(v.issues.items.filter((i) => i.code.startsWith("plan.") && i.key?.startsWith("event"))).toEqual([]);
    });

    it("renders event media only for screens that name them", () => {
      editJson(config(), (c) => {
        c.targets.push("event-card-1920x1080");
      });
      const project = load();
      const v = validateProject(project);
      expect(buildRenderPlan(project, v.manifest!).some((j) => j.target.family === "event")).toBe(false);
      expect(v.issues.items.filter((i) => i.level === "error" && /event/.test(i.message))).toEqual([]);
    });

    it("requires the banner layout for the wide event card", () => {
      editJson(config(), (c) => {
        c.targets.push("event-card-1920x1080");
      });
      editJson(manifest(), (m) => {
        m.screens.push({ id: "event", order: 3, template: "hero-top", targets: ["event-card-1920x1080"] });
      });
      const issues = validateProject(load()).issues.items;
      expect(
        issues.some((i) => i.code === "manifest.template-unsupported-target" && /feature-graphic/.test(i.message)),
      ).toBe(true);
    });
  });

  describe("iPhone Duo", () => {
    it("renders from the iPhone captures into store/generated/duo, outside deliver's folder, and stays opt-in", () => {
      editJson(config(), (c) => {
        c.targets.push("iphone-duo-2007x2853");
      });
      const project = load();
      const v = validateProject(project);
      const job = buildJob(project, v.manifest!.screens[0], "iphone-duo-2007x2853", "en-US")!;
      expect(job.sourceDevice).toBe("iphone");
      expect(path.relative(fx.root, job.outputPath)).toBe(
        path.join("store", "generated", "duo", "en-US", "01_home_IPHONE_DUO_INNER.png"),
      );
      expect(isScreenshotSet("iphone-duo-2007x2853")).toBe(true);
      expect(shortLabel(getTarget("iphone-duo-1398x2034")!)).toBe("iPhone Duo outer");
      // An iPhone capture on a Duo canvas is expected, not an aspect mismatch.
      expect(v.issues.items.filter((i) => i.code === "source.aspect" && i.key?.includes("duo"))).toEqual([]);
      expect(targetsFor({ orientation: "portrait", ipad: false, play: false }).some((t) => t.includes("duo"))).toBe(
        false,
      );
    });

    it("takes one Duo size: App Store Connect shows one Duo set", () => {
      editJson(config(), (c) => {
        c.targets.push("iphone-duo-2007x2853", "iphone-duo-1398x2034");
      });
      expect(validateProject(load()).issues.items.map((i) => i.code)).toContain("config.duo-targets");
    });

    it("is named in readiness until the app has a Duo set", () => {
      const text = () => byId(readinessReport(load()), "required-sizes").details.join("\n");
      expect(text()).toMatch(/no iPhone Duo set yet; App Store Connect requires one from April 2027/);
      editJson(config(), (c) => {
        c.targets.push("iphone-duo-2007x2853");
      });
      expect(text()).not.toMatch(/Duo/);
    });
  });

  describe("creative assets", () => {
    it("are App Store Connect's header and search results sizes, the universal one filling both", () => {
      expect(["header-3840x1646", "search-3840x2560", "universal-5244x2950"].map((id) => getTarget(id)!)).toEqual([
        expect.objectContaining({ width: 3840, height: 1646 }),
        expect.objectContaining({ width: 3840, height: 2560 }),
        expect.objectContaining({ width: 5244, height: 2950 }),
      ]);
      expect(creativePlacementsOf("header-3840x1646")).toEqual(["header"]);
      expect(creativePlacementsOf("universal-5244x2950")).toEqual(["header", "search"]);
      expect(isScreenshotSet("universal-5244x2950")).toBe(false);
      expect(shortLabel(getTarget("universal-5244x2950")!)).toBe("Header + search");
      // The 21:9 header crop and the 3:2 search crop, centred: only their overlap is safe.
      expect(safeAreaOf(getTarget("universal-5244x2950")!)).toEqual({ left: 410, top: 352, width: 4425, height: 2247 });
      expect(safeAreaOf(getTarget("header-3840x1646")!)).toEqual({ left: 0, top: 0, width: 3840, height: 1646 });
    });

    it("render from the iPhone captures into store/generated/creative with the banner layout", async () => {
      editJson(config(), (c) => {
        c.targets.push("header-3840x1646");
      });
      editJson(manifest(), (m) => {
        m.screens.push({
          id: "banner",
          order: 3,
          template: "feature-graphic",
          targets: ["header-3840x1646"],
          source: { filePattern: "01-home.png" },
        });
      });
      const project = load();
      const v = validateProject(project);
      expect(v.issues.items.filter((i) => i.level === "error" && i.code.startsWith("manifest."))).toEqual([]);
      const job = buildJob(project, v.manifest!.screens[2], "header-3840x1646", "en-US")!;
      expect(job.sourceDevice).toBe("iphone");
      expect(path.relative(fx.root, job.outputPath)).toBe(
        path.join("store", "generated", "creative", "en-US", "03_banner_HEADER.png"),
      );
    });

    it("allow one header and one search results image per page", () => {
      editJson(config(), (c) => {
        c.targets.push("header-3840x1646", "search-3840x2560", "universal-5244x2950");
      });
      const banner = (id: string, targets: string[]) => ({
        id,
        order: 3,
        template: "feature-graphic",
        targets,
        source: { filePattern: "01-home.png" },
      });
      editJson(manifest(), (m) => {
        m.screens.push(banner("wide", ["header-3840x1646"]), banner("both", ["universal-5244x2950"]));
        m.screens.push({ ...banner("search", ["search-3840x2560"]), enabled: false });
        m.sets = [
          { id: "page", kind: "custom", screens: ["home", "search", "both"] },
          { id: "two", kind: "custom", screens: ["home", "wide", "both"] },
        ];
      });
      const issues = validateProject(load()).issues.items.filter((i) => i.code === "creative.too-many");
      // The default page and "two" have two headers each; on "page" the universal image gives way
      // to the page's own search image. The errors block only the pages' creative images.
      expect(issues.map((i) => [i.key, i.message])).toEqual([
        ["creative", "The default page has 2 header images (wide, both); a page shows one"],
        ["sets/two/creative", '"two" has 2 header images (wide, both); a page shows one'],
      ]);
    });

    it("are checked by readiness once rendered: size, PNG, opaque", async () => {
      expect(byId(readinessReport(load()), "creative-assets").status).toBe("skip");
      const dir = path.join(fx.root, "store", "generated", "creative", "en-US");
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(
        path.join(fx.root, "store", "raw", "iphone", "en-US", "01-home.png"),
        path.join(dir, "03_banner_HEADER.png"),
      );
      const check = byId(readinessReport(load()), "creative-assets");
      expect(check.status).toBe("fail");
      expect(check.details[0]).toMatch(/03_banner_HEADER\.png: \d+x\d+, App Store Connect takes 3840x1646/);
    });

    it("require the banner layout", () => {
      editJson(config(), (c) => {
        c.targets.push("search-3840x2560");
      });
      editJson(manifest(), (m) => {
        m.screens.push({ id: "wide", order: 3, template: "hero-top", targets: ["search-3840x2560"] });
      });
      const issues = validateProject(load()).issues.items;
      expect(
        issues.some(
          (i) => i.code === "manifest.template-unsupported-target" && /"hero-top".*search-3840x2560/.test(i.message),
        ),
      ).toBe(true);
    });
  });
});
