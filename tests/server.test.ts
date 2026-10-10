import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { contentFileFor } from "../lib/content";
import { previewHtml } from "../lib/render/preview";
import {
  duplicateScreen,
  etagOf,
  HttpError,
  listBackgroundAssets,
  projectSnapshot,
  saveBackgroundAsset,
  saveBrandBackground,
  saveConfigPatch,
  saveCapture,
  captureTarget,
  bootstrapLocaleContent,
  saveContent,
  saveManifest,
  savePresets,
} from "../lib/server/projects";
import { requireSameOrigin } from "../lib/server/http";
import { editJson, readJson, tempFixture } from "./helpers";

describe("editor server helpers", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("saves the devices, languages and brand colours the Mac app edits, and nothing else", () => {
    const p = load();
    const file = path.join(fx.root, "store-shots.config.json");
    const before = readJson<Record<string, unknown>>(file);
    const r = saveConfigPatch(
      p,
      { targets: ["iphone-6.9-1320x2868", "iphone-duo-2007x2853"], brand: { primary: "#112233", accent: null } },
      etagOf(file),
    );
    const after = readJson<Record<string, unknown> & { brand: Record<string, unknown> }>(file);
    expect(after.targets).toEqual(["iphone-6.9-1320x2868", "iphone-duo-2007x2853"]);
    expect(after.brand.primary).toBe("#112233");
    expect(after.locales).toEqual(before.locales);
    expect(r.etag).toBe(etagOf(file));
    expect(() => saveConfigPatch(p, { targets: ["nope"] }, r.etag)).toThrow(HttpError);
    expect(() => saveConfigPatch(p, { locales: ["en-US"] }, "stale")).toThrow(/changed on disk/);
  });

  it("puts a dropped capture where the screen reads it for that device and locale", () => {
    const p = load();
    const png = fs.readFileSync(path.join(fx.root, "store", "raw", "iphone", "en-US", "01-home.png"));
    const before = fs.readFileSync(path.join(fx.root, "store/raw/iphone/en-US/02-planning.png"));
    const r = saveCapture(p, "planning", "iphone-6.9-1320x2868", "en-US", png);
    expect(r.path).toBe("store/raw/iphone/en-US/02-planning.png");
    expect(fs.readFileSync(path.join(fx.root, r.path)).equals(png)).toBe(true);
    expect(r.aspectFits).toBe(true);
    // The capture it replaced is kept.
    expect(fs.readFileSync(path.join(fx.root, r.backup!)).equals(before)).toBe(true);
    // A broken image never replaces a good one.
    const broken = Buffer.concat([png.subarray(0, 8), Buffer.from("broken")]);
    expect(() => saveCapture(p, "planning", "iphone-6.9-1320x2868", "en-US", broken)).toThrow(/readable PNG or JPEG/);
    expect(fs.readFileSync(path.join(fx.root, r.path)).equals(png)).toBe(true);
    expect(() => saveCapture(p, "ghost", "iphone-6.9-1320x2868", "en-US", png)).toThrow(/No screen/);
  });

  it("says what else reads a capture before it is replaced", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
      c.targets = ["iphone-6.9-1320x2868", "iphone-6.1-1206x2622"];
    });
    const shared = captureTarget(load(), "planning", "iphone-6.9-1320x2868", "en-US").info;
    expect(shared).toMatchObject({ path: "store/raw/iphone/en-US/02-planning.png", exists: true });
    expect(shared.sharedWith).toEqual(["every language", "iphone-6.1-1206x2622"]);
    // Its own capture, in its own language: no question asked.
    expect(shared.confirm).toBeUndefined();
    // The same file seen from another language, or from a Duo size, asks first.
    expect(captureTarget(load(), "planning", "iphone-6.9-1320x2868", "ar-SA").info.confirm).toMatch(/every language/);
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
      c.targets = ["iphone-6.9-1320x2868", "iphone-duo-2007x2853"];
    });
    expect(captureTarget(load(), "home", "iphone-duo-2007x2853", "en-US").info.confirm).toMatch(/iphone capture/);
  });

  it("snapshot returns manifest, every locale's content and etags", () => {
    const snap = projectSnapshot(load());
    expect(snap.manifest?.screens.map((s) => s.id)).toEqual(["home", "planning"]);
    expect(Object.keys(snap.content).sort()).toEqual(["ar-SA", "en-US"]);
    expect(snap.contentEtags["en-US"]).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.manifestEtag).toMatch(/^[0-9a-f]{64}$/);
  });

  it("saves content atomically, keeps $schema, returns a new etag, and validates", () => {
    const p = load();
    const file = contentFileFor(p, "en-US");
    const before = etagOf(file);
    const content = readJson<Record<string, unknown>>(file);
    const screens = content.screens as Record<string, Record<string, string>>;
    screens.home.headline = "Edited headline";
    delete content.$schema;
    const r = saveContent(p, "en-US", content, before);
    expect(r.etag).not.toBe(before);
    const after = readJson<Record<string, unknown>>(file);
    expect((after.screens as Record<string, Record<string, string>>).home.headline).toBe("Edited headline");
    expect(after.$schema).toBe("../../../../schema/content.schema.json");
    expect(fs.readdirSync(path.dirname(file)).some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("keeps named sets and their copy when the editor saves", () => {
    const p = load();
    const manifestFile = p.paths.manifest;
    const manifest = readJson<Record<string, unknown>>(manifestFile);
    manifest.sets = [{ id: "planners", kind: "custom", deepLink: "demo://plan", screens: ["planning", "home"] }];
    saveManifest(p, manifest, etagOf(manifestFile));
    expect(readJson<{ sets?: unknown[] }>(manifestFile).sets).toHaveLength(1);

    const file = contentFileFor(p, "en-US");
    const content = readJson<Record<string, unknown>>(file);
    content.sets = { planners: { promotionalText: "Plan it", screens: { home: { headline: "Plan your week" } } } };
    saveContent(p, "en-US", content, etagOf(file));
    expect(readJson<{ sets?: Record<string, unknown> }>(file).sets?.planners).toEqual({
      promotionalText: "Plan it",
      screens: { home: { headline: "Plan your week" } },
    });

    // An id `asc push` stored survives a save from an editor that loaded the manifest earlier.
    const stored = readJson<{ sets: Record<string, unknown>[] }>(manifestFile);
    stored.sets[0].ascId = "cpp-123";
    fs.writeFileSync(manifestFile, JSON.stringify(stored, null, 2));
    saveManifest(p, manifest, etagOf(manifestFile));
    expect(readJson<{ sets: { ascId?: string }[] }>(manifestFile).sets[0].ascId).toBe("cpp-123");
    // ...unless the editor unlinks it on purpose.
    const unlinked = structuredClone(manifest) as { sets: Record<string, unknown>[] };
    unlinked.sets[0].ascId = "";
    saveManifest(p, unlinked, etagOf(manifestFile));
    expect("ascId" in readJson<{ sets: object[] }>(manifestFile).sets[0]).toBe(false);

    // Without sets, neither file gets an empty key.
    delete manifest.sets;
    saveManifest(p, manifest, etagOf(manifestFile));
    expect("sets" in readJson<object>(manifestFile)).toBe(false);
  });

  it("rejects stale etags with 409 and bad bodies with 422", () => {
    const p = load();
    const content = readJson<Record<string, unknown>>(contentFileFor(p, "en-US"));
    expect(() => saveContent(p, "en-US", content, "stale")).toThrow(HttpError);
    try {
      saveContent(p, "en-US", content, "stale");
    } catch (e) {
      expect((e as HttpError).status).toBe(409);
    }
    try {
      saveContent(p, "en-US", { locale: "en-US", screens: { home: { headline: 5 } } }, undefined);
    } catch (e) {
      expect((e as HttpError).status).toBe(422);
    }
    try {
      saveContent(p, "fr-FR", { locale: "fr-FR", screens: {} }, undefined);
    } catch (e) {
      expect((e as HttpError).status).toBe(400);
    }
  });

  it("saves the manifest with the same guarantees", () => {
    const p = load();
    const before = etagOf(p.paths.manifest);
    const manifest = readJson<{ screens: { id: string; order: number }[] }>(p.paths.manifest);
    manifest.screens[0].order = 5;
    const r = saveManifest(p, manifest, before);
    expect(r.etag).not.toBe(before);
    expect(readJson<{ screens: { order: number }[] }>(p.paths.manifest).screens[0].order).toBe(5);
    expect(() => saveManifest(p, manifest, before)).toThrow(/changed on disk/);
  });

  it("renders preview HTML for a draft with API asset URLs and the reporting script", () => {
    const p = load();
    const r = previewHtml(
      p,
      {
        targetId: "iphone-6.9-1320x2868",
        locale: "en-US",
        screen: { id: "home", order: 1, template: "hero-top", overrides: { deviceTilt: 3 } },
        fields: { headline: "Draft headline", eyebrow: "Draft" },
        interactive: true,
      },
      {
        sourceImage: (abs) => `/api/file?raw=${path.basename(abs)}`,
        fontUrl: (abs) => `/api/file?font=${path.basename(abs)}`,
        assetUrl: (rel) => `/api/file?asset=${rel}`,
      },
    );
    expect(r.html).toContain("data-artwork");
    expect(r.html).toContain("Draft headline");
    expect(r.html).toContain("/api/file?raw=01-home.png");
    expect(r.html).toContain("/api/file?font=inter-700.ttf");
    expect(r.html).toContain("store-shots-preview");
    expect(r.html).toContain("rotate(3deg)");
    expect(r.job.sourceExists).toBe(true);
    // Panorama text drags must report which slide's stack moved so the editor
    // writes textOffsetX2/Y2 instead of the base keys (right slide moved left bug).
    expect(r.html).toContain('slice: Number(a.stack.getAttribute("data-text-stack") || 0)');
  });

  it("preview falls back to a placeholder when the raw capture is missing", () => {
    const p = load();
    fs.rmSync(path.join(fx.root, "store/raw/iphone/en-US/01-home.png"));
    const r = previewHtml(
      p,
      {
        targetId: "iphone-6.9-1320x2868",
        locale: "en-US",
        screen: { id: "home", order: 1, template: "hero-top" },
        fields: { headline: "x" },
      },
      { sourceImage: () => "/x", fontUrl: () => "/f", assetUrl: () => "/a" },
    );
    expect(r.job.sourceExists).toBe(false);
    expect(r.html).toContain("data:image/svg+xml");
  });
});

describe("duplicate and presets", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("duplicates a screen with the next free order and every locale's copy", () => {
    const p = load();
    const r = duplicateScreen(p, "home", "home-copy");
    expect(r.manifestEtag).toMatch(/^[0-9a-f]{64}$/);
    const manifest = readJson<{ screens: { id: string; order: number }[] }>(p.paths.manifest);
    const copy = manifest.screens.find((s) => s.id === "home-copy")!;
    expect(copy.order).toBe(3);
    for (const l of ["en-US", "ar-SA"]) {
      const c = readJson<{ screens: Record<string, { headline: string }> }>(contentFileFor(p, l));
      expect(c.screens["home-copy"].headline).toBe(c.screens.home.headline);
    }
    expect(() => duplicateScreen(p, "home", "home-copy")).toThrow(/already exists/);
    expect(() => duplicateScreen(p, "nope", "x")).toThrow(/No screen/);
    expect(() => duplicateScreen(p, "home", "Bad Id")).toThrow(/lowercase/);
  });

  it("saves presets into the config with etag checking and schema validation", () => {
    const p = load();
    const r = savePresets(p, { cream: { background: "#F4F0E7", deviceTilt: -10 } }, etagOf(p.configPath));
    expect(r.etag).not.toBe("missing");
    const cfg = loadProject(p.configPath).config;
    expect(cfg.presets.cream).toEqual({ background: "#F4F0E7", deviceTilt: -10 });
    expect(() => savePresets(p, {}, "stale")).toThrow(HttpError);
  });
});

describe("background assets", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("saves with a sanitised unique name and lists it", () => {
    const p = load();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const a = saveBackgroundAsset(p, "My Wavy BG (final)!.PNG", png);
    expect(a.rel).toBe("backgrounds/my-wavy-bg-final.png");
    const b = saveBackgroundAsset(p, "My Wavy BG (final)!.PNG", png);
    expect(b.rel).toBe("backgrounds/my-wavy-bg-final-2.png");
    expect(listBackgroundAssets(p).map((x) => x.name)).toEqual(["my-wavy-bg-final-2.png", "my-wavy-bg-final.png"]);
  });

  it("rejects bad extensions, empty and oversized files", () => {
    const p = load();
    expect(() => saveBackgroundAsset(p, "x.exe", Buffer.from([1]))).toThrow(/Unsupported/);
    expect(() => saveBackgroundAsset(p, "x.png", Buffer.alloc(0))).toThrow(/Empty/);
    expect(() => saveBackgroundAsset(p, "x.png", Buffer.alloc(9 * 1024 * 1024))).toThrow(/too large/);
    expect(() => saveBackgroundAsset(p, "....png", Buffer.from([1]))).toThrow(/no usable characters/);
  });
});

describe("brand background default", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("writes, validates and clears brand.background with etag checks", () => {
    const p = load();
    const r = saveBrandBackground(
      p,
      { background: "#F4F0E7", backgroundImage: "pattern:waves", patternColor: "rgba(0,0,0,0.06)" },
      etagOf(p.configPath),
    );
    expect(r.etag).toMatch(/^[0-9a-f]{64}$/);
    expect(loadProject(p.configPath).config.brand.background).toEqual({
      background: "#F4F0E7",
      backgroundImage: "pattern:waves",
      patternColor: "rgba(0,0,0,0.06)",
    });
    expect(() => saveBrandBackground(load(), { backgroundImage: "pattern:bogus" })).toThrow(HttpError);
    saveBrandBackground(load(), null);
    expect(loadProject(p.configPath).config.brand.background).toBeUndefined();
    expect(() => saveBrandBackground(load(), {}, "stale")).toThrow(/changed on disk/);
  });
});

describe("background presets data", () => {
  it("every curated preset parses against the background schema", async () => {
    const { BACKGROUND_PRESETS } = await import("../lib/background-presets");
    const { backgroundValuesSchema } = await import("../lib/schema");
    expect(BACKGROUND_PRESETS.length).toBeGreaterThan(8);
    for (const preset of BACKGROUND_PRESETS) {
      expect(backgroundValuesSchema.safeParse(preset.values).success).toBe(true);
      expect(preset.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("bootstrapLocaleContent", () => {
  it("creates missing locale files prefilled from the default and never touches existing ones", () => {
    const fx = tempFixture();
    try {
      editJson(
        path.join(fx.root, "store-shots.config.json"),
        (c) => (c.locales = ["en-US", "ar-SA", "de-DE", "fr-FR"]),
      );
      const p = loadProject(path.join(fx.root, "store-shots.config.json"));
      const before = fs.readFileSync(contentFileFor(p, "ar-SA"), "utf8");
      const r = bootstrapLocaleContent(p);
      expect(r.created.sort()).toEqual(["store/content/de-DE.json", "store/content/fr-FR.json"]);
      const de = readJson<{ locale: string; screens: Record<string, { headline: string }> }>(
        contentFileFor(p, "de-DE"),
      );
      expect(de.locale).toBe("de-DE");
      expect(de.screens.home.headline).toBe("Plan everything in one place");
      expect(fs.readFileSync(contentFileFor(p, "ar-SA"), "utf8")).toBe(before);
      expect(bootstrapLocaleContent(p).created).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  it("lets only the editor itself call routes that act outside the app", () => {
    const req = (headers: Record<string, string>) =>
      new Request("http://localhost:3000/api/projects/x/asc/push", { method: "POST", headers });
    const json = { "content-type": "application/json" };
    expect(() => requireSameOrigin(req({ ...json, origin: "http://localhost:3000" }))).not.toThrow();
    expect(() => requireSameOrigin(req(json))).not.toThrow(); // same-origin fetches may omit it
    expect(() => requireSameOrigin(req({ ...json, origin: "https://evil.example" }))).toThrow(/cross-site/);
    expect(() => requireSameOrigin(req({ ...json, origin: "null" }))).toThrow(/cross-site/);
    expect(() => requireSameOrigin(req({ "content-type": "text/plain", origin: "http://localhost:3000" }))).toThrow(
      /application\/json/,
    );
  });
});
