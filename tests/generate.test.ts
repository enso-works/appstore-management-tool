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
    const s = await generateProject(p, { renderer, filter: { locales: ["ar-SA"], screens: ["home"] } });
    expect(s.planned).toBe(2);
    expect(s.rendered).toBe(2);
    expect(readGeneratedManifest(p)!.files).toHaveLength(8);
  }, 60_000);

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
