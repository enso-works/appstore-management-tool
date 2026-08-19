import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { addGoogleFont, parseFontFaces, resolveFont } from "../lib/fonts";
import { generateProject } from "../lib/generate";
import { cleanGenerated, readGeneratedManifest } from "../lib/generated-manifest";
import { readPngInfo } from "../lib/png";
import { ExportRenderer } from "../lib/render/export";
import { editJson, tempFixture } from "./helpers";

/**
 * Integration tests: real Chromium via Playwright, real Sharp. One browser is
 * shared across the file to keep this under ~10 s.
 */
const renderer = new ExportRenderer();
beforeAll(() => renderer.start(), 60_000);
afterAll(() => renderer.close());

describe("generate on the fixture", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));
  const out = (rel: string) => path.join(fx.root, "fastlane/screenshots", rel);

  it("renders every job at exact size with no alpha and writes the manifest", async () => {
    const s = await generateProject(load(), { renderer });
    expect(s.aborted).toBe(false);
    expect(s.failed).toBe(0);
    expect(s.rendered).toBe(8);
    expect(s.filesWritten).toHaveLength(8);
    const iphone = readPngInfo(out("en-US/01_home_IPHONE_69.png"));
    expect(iphone).toMatchObject({ width: 1320, height: 2868, hasAlpha: false, colorType: 2 });
    const ipad = readPngInfo(out("ar-SA/02_planning_IPAD_PRO_129.png"));
    expect(ipad).toMatchObject({ width: 2064, height: 2752, hasAlpha: false });
    const manifest = readGeneratedManifest(load())!;
    expect(manifest.files).toHaveLength(8);
    expect(manifest.appVersion).toBe("1.2.0");
    expect(manifest.files.map((f) => f.path)).toEqual([...manifest.files.map((f) => f.path)].sort());
  }, 60_000);

  it("is deterministic: a second run produces byte-identical files", async () => {
    const p = load();
    await generateProject(p, { renderer });
    const first = readGeneratedManifest(p)!.files.map((f) => [f.path, f.sha256]);
    await generateProject(p, { renderer });
    const second = readGeneratedManifest(p)!.files.map((f) => [f.path, f.sha256]);
    expect(second).toEqual(first);
  }, 60_000);

  it("clean removes only manifest-listed files and leaves foreign files alone", async () => {
    const p = load();
    fs.mkdirSync(out("en-US"), { recursive: true });
    fs.writeFileSync(out("en-US/handmade.png"), "x");
    await generateProject(p, { renderer });
    expect(fs.existsSync(out("en-US/01_home_IPHONE_69.png"))).toBe(true);
    const r = cleanGenerated(p);
    expect(r.deleted).toHaveLength(8);
    expect(fs.existsSync(out("en-US/01_home_IPHONE_69.png"))).toBe(false);
    expect(fs.existsSync(out("en-US/handmade.png"))).toBe(true);
    expect(fs.existsSync(out(".store-shots-manifest.json"))).toBe(false);
  }, 60_000);

  it("filters render a subset and keep the rest of the manifest", async () => {
    const p = load();
    await generateProject(p, { renderer });
    let s = await generateProject(p, { renderer, filter: { locales: ["ar-SA"], screens: ["home"] } });
    expect(s.planned).toBe(2);
    expect(s.unchanged).toBe(2); // inputs identical -> nothing re-rendered
    expect(readGeneratedManifest(p)!.files).toHaveLength(8);
    s = await generateProject(p, { renderer, filter: { locales: ["ar-SA"], screens: ["home"] }, force: true });
    expect(s.rendered).toBe(2);
    expect(readGeneratedManifest(p)!.files).toHaveLength(8);
  }, 60_000);

  it("is incremental: unchanged inputs are skipped, edited ones re-render, removed screens are cleaned up", async () => {
    const p = load();
    const first = await generateProject(p, { renderer });
    expect(first.rendered).toBe(8);
    const second = await generateProject(p, { renderer });
    expect(second.rendered).toBe(0);
    expect(second.unchanged).toBe(8);
    expect(second.filesWritten).toHaveLength(0);
    // Edit one locale's headline: only that screen re-renders (2 targets).
    editJson(path.join(fx.root, "store/content/ar-SA.json"), (c) => (c.screens.home.headline = "عنوان جديد"));
    const third = await generateProject(load(), { renderer });
    expect(third.rendered).toBe(2);
    expect(third.unchanged).toBe(6);
    // Remove a screen: its previous outputs disappear, manifest shrinks.
    editJson(
      path.join(fx.root, "store/manifest.json"),
      (m) => (m.screens = m.screens.filter((s: { id: string }) => s.id !== "planning")),
    );
    editJson(
      path.join(fx.root, "store-shots.config.json"),
      (c) => (c.validation = { screensPerTarget: { min: 1, max: 10 } }),
    );
    const fourth = await generateProject(load(), { renderer });
    expect(fourth.planned).toBe(4);
    expect(fs.existsSync(out("en-US/02_planning_IPHONE_69.png"))).toBe(false);
    expect(readGeneratedManifest(load())!.files).toHaveLength(4);
    // Foreign files are never touched.
    fs.writeFileSync(out("en-US/handmade.png"), "x");
    await generateProject(load(), { renderer });
    expect(fs.existsSync(out("en-US/handmade.png"))).toBe(true);
  }, 90_000);

  it("does not abort a filtered run because of errors outside the filter", async () => {
    fs.rmSync(path.join(fx.root, "store/raw/ipad/ar-SA/01-home.png"));
    const s = await generateProject(load(), { renderer, filter: { targets: ["iphone-6.9-1320x2868"] } });
    expect(s.aborted).toBe(false);
    expect(s.rendered).toBe(4);
    expect(s.issues.some((i) => i.code === "source.missing")).toBe(false);
  }, 60_000);

  it("skips only the jobs a missing translation blocks, and strict mode aborts everything", async () => {
    editJson(path.join(fx.root, "store/content/ar-SA.json"), (c) => delete c.screens.home);
    let s = await generateProject(load(), { renderer });
    expect(s.aborted).toBe(false);
    expect(s.skipped).toBe(2); // ar-SA/home on both targets
    expect(s.rendered).toBe(6);
    s = await generateProject(load(), { renderer, strict: true });
    expect(s.aborted).toBe(true);
    expect(s.filesWritten).toHaveLength(0);
  }, 60_000);

  it("shrinks a long headline within the template range and reports it", async () => {
    editJson(path.join(fx.root, "store/content/en-US.json"), (c) => {
      c.screens.home.headline = "Plan absolutely everything you need in one calm, quiet place";
    });
    const s = await generateProject(load(), { renderer, filter: { locales: ["en-US"], screens: ["home"] } });
    expect(s.failed).toBe(0);
    expect(s.rendered).toBe(2);
    const fitted = s.issues.find((i) => i.code === "render.fitted");
    expect(fitted?.message).toMatch(/"headline" shrunk to \d+%/);
  }, 60_000);

  it("fails a job whose headline overflows even at the minimum size and names the field to edit", async () => {
    editJson(path.join(fx.root, "store/content/en-US.json"), (c) => {
      c.screens.home.headline =
        "An impossibly long headline that keeps going and going and going well past three lines of space at any size we allow, and then some more words for good measure";
    });
    const s = await generateProject(load(), { renderer, filter: { locales: ["en-US"], screens: ["home"] } });
    expect(s.failed).toBe(2);
    const issue = s.issues.find((i) => i.code === "render.overflow")!;
    expect(issue.message).toMatch(/even at the minimum allowed size/);
    expect(issue.hint).toMatch(/screens.home.headline for en-US/);
    expect(fs.existsSync(out("en-US/01_home_IPHONE_69.png"))).toBe(false);
  }, 60_000);

  it("aborts with a font.missing error when the brand font is not local", async () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.brand.font = { family: "Nope Sans" }));
    const s = await generateProject(load(), { renderer });
    expect(s.aborted).toBe(true);
    expect(s.issues.some((i) => i.code === "font.missing")).toBe(true);
  }, 60_000);
});

describe("review regressions (phases 2-8)", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));
  const out = (rel: string) => path.join(fx.root, "fastlane/screenshots", rel);

  it("skips every job that shares a missing capture instead of crashing, and keeps old outputs tracked", async () => {
    const p = load();
    await generateProject(p, { renderer });
    // "planning" is localized:false -> en-US and ar-SA share one file.
    fs.rmSync(path.join(fx.root, "store/raw/iphone/en-US/02-planning.png"));
    const s = await generateProject(load(), { renderer });
    expect(s.aborted).toBe(false);
    expect(s.skipped).toBe(2);
    expect(s.unchanged).toBe(6);
    // Old outputs for the skipped jobs stay on disk AND stay in the manifest, so clean still removes them.
    expect(fs.existsSync(out("ar-SA/02_planning_IPHONE_69.png"))).toBe(true);
    expect(readGeneratedManifest(load())!.files.some((f) => f.path.endsWith("ar-SA/02_planning_IPHONE_69.png"))).toBe(
      true,
    );
    cleanGenerated(load());
    expect(fs.existsSync(out("ar-SA/02_planning_IPHONE_69.png"))).toBe(false);
  }, 60_000);

  it("re-renders when direction or a referenced background asset changes", async () => {
    const p = load();
    fs.mkdirSync(path.join(fx.root, "store/assets/backgrounds"), { recursive: true });
    const asset = path.join(fx.root, "store/assets/backgrounds/bg.png");
    fs.writeFileSync(
      asset,
      (await import("../lib/png-write")).encodeSolidPng({ width: 10, height: 10, color: [200, 10, 10] }),
    );
    editJson(
      path.join(fx.root, "store/manifest.json"),
      (m) => (m.screens[0].overrides = { backgroundImage: "asset:backgrounds/bg.png" }),
    );
    await generateProject(load(), { renderer, filter: { screens: ["home"], locales: ["en-US"] } });
    let s = await generateProject(load(), { renderer, filter: { screens: ["home"], locales: ["en-US"] } });
    expect(s.unchanged).toBe(2);
    fs.writeFileSync(
      asset,
      (await import("../lib/png-write")).encodeSolidPng({ width: 10, height: 10, color: [10, 200, 10] }),
    );
    s = await generateProject(load(), { renderer, filter: { screens: ["home"], locales: ["en-US"] } });
    expect(s.rendered).toBe(2);
    editJson(path.join(fx.root, "store/content/en-US.json"), (c) => (c.direction = "rtl"));
    s = await generateProject(load(), { renderer, filter: { screens: ["home"], locales: ["en-US"] } });
    expect(s.rendered).toBe(2);
    void p;
  }, 90_000);

  it("treats a missing headline font as an error, not a silent fallback", async () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.brand.headlineFont = { family: "Nope Serif" }));
    const s = await generateProject(load(), { renderer });
    expect(s.aborted).toBe(true);
    expect(s.issues.filter((i) => i.code === "font.missing")).toHaveLength(1);
    expect(s.issues[0].message).toContain("Nope Serif");
  }, 60_000);

  it("full-bleed-card text over the capture is not reported as an overlap", async () => {
    editJson(path.join(fx.root, "store/manifest.json"), (m) => (m.screens[0].template = "full-bleed-card"));
    for (const l of ["en-US", "ar-SA"])
      editJson(path.join(fx.root, `store/content/${l}.json`), (c) => delete c.screens.home.eyebrow);
    const s = await generateProject(load(), { renderer, filter: { screens: ["home"], locales: ["en-US"] } });
    expect(s.rendered).toBe(2);
    expect(s.issues.some((i) => i.code === "render.text-overlaps-device")).toBe(false);
  }, 60_000);
});

describe("contact sheets and change summary", () => {
  it("reports changed/added/removed files and writes a sheet per locale x target", async () => {
    const fx = tempFixture();
    try {
      const p = loadProject(path.join(fx.root, "store-shots.config.json"));
      const first = await generateProject(p, { renderer });
      expect(first.changes.added).toHaveLength(8);
      editJson(path.join(fx.root, "store/content/en-US.json"), (c) => (c.screens.home.headline = "Changed"));
      const second = await generateProject(loadProject(path.join(fx.root, "store-shots.config.json")), { renderer });
      expect(second.changes.changed.sort()).toEqual([
        "fastlane/screenshots/en-US/01_home_IPAD_PRO_129.png",
        "fastlane/screenshots/en-US/01_home_IPHONE_69.png",
      ]);
      expect(second.changes.added).toEqual([]);
      const { writeContactSheets } = await import("../lib/sheet");
      const sheets = await writeContactSheets(loadProject(path.join(fx.root, "store-shots.config.json")));
      expect(sheets.map((s) => `${s.locale}/${s.target}/${s.count}`).sort()).toEqual([
        "ar-SA/ipad-13-2064x2752/2",
        "ar-SA/iphone-6.9-1320x2868/2",
        "en-US/ipad-13-2064x2752/2",
        "en-US/iphone-6.9-1320x2868/2",
      ]);
      expect(fs.existsSync(path.join(fx.root, "store/generated/sheets/en-US_IPHONE_69.png"))).toBe(true);
    } finally {
      fx.cleanup();
    }
  }, 90_000);
});

describe("panorama screens", () => {
  it("renders one wide artwork and slices it into consecutive exact-size files", async () => {
    const fx = tempFixture();
    try {
      editJson(path.join(fx.root, "store/manifest.json"), (m) => {
        m.screens[0].panorama = { slices: 2 };
        m.screens[0].overrides = { screenshotOffsetX: 0.5, textWidth: 0.5 };
        m.screens[1].order = 3; // 2 is reserved by the panorama
        m.screens[1].source.filePattern = "02-planning.png"; // keep the existing capture name
      });
      const p = loadProject(path.join(fx.root, "store-shots.config.json"));
      const { validateProject } = await import("../lib/validate");
      expect(validateProject(p).issues.errors).toEqual([]);
      const s = await generateProject(p, {
        renderer,
        filter: { locales: ["en-US"], targets: ["iphone-6.9-1320x2868"] },
      });
      expect(s.failed).toBe(0);
      expect(s.filesWritten.sort()).toEqual([
        "fastlane/screenshots/en-US/01_home_IPHONE_69.png",
        "fastlane/screenshots/en-US/02_home_IPHONE_69.png",
        "fastlane/screenshots/en-US/03_planning_IPHONE_69.png",
      ]);
      for (const f of s.filesWritten)
        expect(readPngInfo(path.join(fx.root, f))).toMatchObject({ width: 1320, height: 2868, hasAlpha: false });
      const m = readGeneratedManifest(p)!;
      expect(m.files.filter((f) => f.screen === "home").map((f) => f.slice)).toEqual([0, 1]);
      // Second run: unchanged (both slices checked).
      const again = await generateProject(loadProject(path.join(fx.root, "store-shots.config.json")), {
        renderer,
        filter: { locales: ["en-US"], targets: ["iphone-6.9-1320x2868"] },
      });
      expect(again.unchanged).toBe(2);
      // Reserved order collision is an error.
      editJson(path.join(fx.root, "store/manifest.json"), (mm) => (mm.screens[1].order = 2));
      expect(
        validateProject(loadProject(path.join(fx.root, "store-shots.config.json"))).issues.errors.map((i) => i.code),
      ).toContain("manifest.duplicate-order");
    } finally {
      fx.cleanup();
    }
  }, 90_000);
});

describe("Google Play target", () => {
  it("renders 9:16 PNGs into the supply layout with Play locale names, readiness counts them, clean removes them", async () => {
    const fx = tempFixture();
    try {
      editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
        c.targets = ["play-phone-1080x1920"];
        c.sourceDevices = { "play-phone-1080x1920": "iphone" };
        c.locales = ["en-US", "da"];
      });
      fs.mkdirSync(path.join(fx.root, "store/raw/iphone/da"), { recursive: true });
      fs.copyFileSync(
        path.join(fx.root, "store/raw/iphone/en-US/01-home.png"),
        path.join(fx.root, "store/raw/iphone/da/01-home.png"),
      );
      fs.writeFileSync(
        path.join(fx.root, "store/content/da.json"),
        JSON.stringify({
          locale: "da",
          screens: { home: { headline: "Planlæg alt ét sted" }, planning: { headline: "Fra plan til fremskridt" } },
        }),
      );
      fs.mkdirSync(path.join(fx.root, "fastlane/metadata/da"), { recursive: true });
      const p = loadProject(path.join(fx.root, "store-shots.config.json"));
      const s = await generateProject(p, { renderer });
      expect(s.failed).toBe(0);
      expect(s.rendered).toBe(4);
      const en = path.join(fx.root, "fastlane/metadata/android/en-US/images/phoneScreenshots/01_home_PLAY_PHONE.png");
      const da = path.join(fx.root, "fastlane/metadata/android/da-DK/images/phoneScreenshots/01_home_PLAY_PHONE.png");
      expect(readPngInfo(en)).toMatchObject({ width: 1080, height: 1920, hasAlpha: false });
      expect(fs.existsSync(da)).toBe(true);
      const { readinessReport } = await import("../lib/readiness");
      const r = readinessReport(loadProject(path.join(fx.root, "store-shots.config.json")));
      expect(r.checks.find((c) => c.id === "screenshots")?.status).toBe("pass");
      const manifest = readGeneratedManifest(p)!;
      expect(manifest.files[0].path.startsWith("fastlane/metadata/android/")).toBe(true);
      cleanGenerated(p);
      expect(fs.existsSync(en)).toBe(false);
    } finally {
      fx.cleanup();
    }
  }, 60_000);
});

describe("glyph coverage", () => {
  it("fails validation for characters no local font covers and suggests a family", async () => {
    const fx = tempFixture();
    try {
      editJson(
        path.join(fx.root, "store/content/en-US.json"),
        (c) => (c.screens.home.caption = "日本語のキャプション"),
      );
      const { validateProject } = await import("../lib/validate");
      const r = validateProject(loadProject(path.join(fx.root, "store-shots.config.json")));
      const issue = r.issues.errors.find((i) => i.code === "content.glyph-missing")!;
      expect(issue).toBeDefined();
      expect(issue.hint).toMatch(/Noto Sans/);
      // Arabic is covered by the bundled Noto Sans Arabic, so ar-SA is clean.
      expect(
        r.issues.errors.filter((i) => i.code === "content.glyph-missing").every((i) => i.key?.startsWith("en-US")),
      ).toBe(true);
    } finally {
      fx.cleanup();
    }
  });
});

describe("fonts", () => {
  it("parses Google Fonts CSS into faces", () => {
    const css = `@font-face {\n font-family: 'Inter';\n font-style: normal;\n font-weight: 700;\n src: url(https://fonts.gstatic.com/s/inter/x.ttf) format('truetype');\n}`;
    expect(parseFontFaces(css)).toEqual([
      { url: "https://fonts.gstatic.com/s/inter/x.ttf", weight: 700, style: "normal" },
    ]);
  });

  it("resolves the bundled Inter", () => {
    const font = resolveFont(undefined, "Inter")!;
    expect(font.source).toBe("bundled");
    expect(font.files.map((f) => f.weight)).toEqual([400, 600, 700]);
  });

  it("downloads into the app with a mocked fetch and records a lock", async () => {
    const fx = tempFixture();
    try {
      const css = [400, 700]
        .map(
          (w) =>
            `@font-face { font-family: 'Demo Sans'; font-style: normal; font-weight: ${w}; src: url(https://x/demo-${w}.ttf) format('truetype'); }`,
        )
        .join("\n");
      const fetchImpl = (async (url: string | URL | Request) => {
        const u = String(url);
        if (u.includes("googleapis")) return new Response(css, { status: 200 });
        return new Response(Buffer.from(`ttf:${u}`), { status: 200 });
      }) as unknown as typeof fetch;
      const p = loadProject(path.join(fx.root, "store-shots.config.json"));
      const r = await addGoogleFont({
        family: "Demo Sans",
        weights: [400, 700],
        destDir: path.join(p.paths.assets, "fonts"),
        fetchImpl,
      });
      expect(r.files.map((f) => f.path)).toEqual(["demo-sans/demo-sans-400.ttf", "demo-sans/demo-sans-700.ttf"]);
      const resolved = resolveFont(p, "Demo Sans")!;
      expect(resolved.source).toBe("app");
      await expect(
        addGoogleFont({
          family: "Demo Sans",
          weights: [400, 900],
          destDir: path.join(p.paths.assets, "fonts"),
          fetchImpl,
        }),
      ).rejects.toThrow(/no weight\(s\) 900/);
    } finally {
      fx.cleanup();
    }
  });
});
