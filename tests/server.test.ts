import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { contentFileFor } from "../lib/content";
import { previewHtml } from "../lib/render/preview";
import { etagOf, HttpError, projectSnapshot, saveContent, saveManifest } from "../lib/server/projects";
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
      { sourceImage: () => "/x", fontUrl: () => "/f" },
    );
    expect(r.job.sourceExists).toBe(false);
    expect(r.html).toContain("data:image/svg+xml");
  });
});
