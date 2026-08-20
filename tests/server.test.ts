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
  saveContent,
  saveManifest,
  savePresets,
} from "../lib/server/projects";
import { readJson, tempFixture } from "./helpers";

describe("editor server helpers", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

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
