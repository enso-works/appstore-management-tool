import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { initProject, proposeLocales } from "../lib/init";
import { discoverProjects } from "../lib/registry";
import { validateProject } from "../lib/validate";
import { readJson, writeJson, type AnyJson } from "./helpers";

describe("init", () => {
  let ws: string;
  beforeEach(() => (ws = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-ws-"))));
  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  function makeApp(name: string, appJson: unknown, metadataLocales: string[] = []) {
    const root = path.join(ws, name);
    fs.mkdirSync(root, { recursive: true });
    writeJson(path.join(root, "app.json"), appJson);
    for (const l of metadataLocales) fs.mkdirSync(path.join(root, "fastlane", "metadata", l), { recursive: true });
    return root;
  }

  it("scaffolds a valid project from app.json and never overwrites", () => {
    const root = makeApp("myapp", {
      expo: {
        name: "My App",
        version: "1.0.0",
        ios: { bundleIdentifier: "com.bavrk.myapp", infoPlist: { CFBundleLocalizations: ["en", "de", "es"] } },
      },
    });
    const first = initProject({ appRoot: root, toolRelPath: "../tools/store-shots" });
    expect(first.created).toContain("store-shots.config.json");
    expect(first.created).toContain("store/manifest.json");
    expect(first.created).toContain("store/content/en-US.json");
    expect(first.created).toContain("store/raw/iphone/de-DE/.gitkeep");
    expect(first.skipped).toEqual([]);

    const config = readJson<AnyJson>(path.join(root, "store-shots.config.json"));
    expect(config.projectName).toBe("My App");
    expect(config.bundleId).toBe("com.bavrk.myapp");
    expect(config.locales).toEqual(["en-US", "de-DE", "es-ES", "es-MX"]);
    expect(config.targets).toEqual(["iphone-6.9-1320x2868", "ipad-13-2064x2752"]);
    expect(config.$schema).toBe("../tools/store-shots/schema/project.schema.json");

    const project = loadProject(path.join(root, "store-shots.config.json"));
    const result = validateProject(project);
    // Scaffolded project: only the default locale has content and no raw captures exist yet.
    const codes = new Set(result.issues.items.map((i) => i.code));
    expect(codes.has("content.missing-locale")).toBe(true);
    expect(codes.has("source.missing")).toBe(true);
    expect(codes.has("manifest.schema")).toBe(false);
    expect(codes.has("config.schema")).toBe(false);

    fs.writeFileSync(path.join(root, "store/manifest.json"), '{ "screens": [] }\n');
    const second = initProject({ appRoot: root, toolRelPath: "../tools/store-shots" });
    expect(second.created).toEqual([]);
    expect(second.skipped).toContain("store/manifest.json");
    expect(fs.readFileSync(path.join(root, "store/manifest.json"), "utf8")).toBe('{ "screens": [] }\n');
  });

  it("prefers existing metadata locale directories", () => {
    const root = makeApp(
      "app2",
      { expo: { name: "App2", ios: { infoPlist: { CFBundleLocalizations: ["en", "fr"] } } } },
      ["en-US", "da", "nl-NL"],
    );
    expect(proposeLocales(root, readJson<AnyJson>(path.join(root, "app.json")).expo)).toEqual([
      "en-US",
      "da",
      "fr-FR",
      "nl-NL",
    ]);
  });

  it("falls back to en-US and the directory name", () => {
    const root = path.join(ws, "bare");
    fs.mkdirSync(root);
    const r = initProject({ appRoot: root, toolRelPath: "../tools/store-shots" });
    expect(r.config.projectName).toBe("bare");
    expect(r.config.locales).toEqual(["en-US"]);
  });

  it("honours explicit name/locales and is discoverable from the workspace", () => {
    const root = makeApp("app3", { expo: { name: "ignored" } });
    initProject({
      appRoot: root,
      toolRelPath: "../tools/store-shots",
      projectName: "Explicit",
      locales: ["de-DE", "en-US"],
      defaultLocale: "de-DE",
    });
    const found = discoverProjects(ws);
    expect(found.map((f) => f.name)).toEqual(["app3"]);
    expect(found[0].project?.config.projectName).toBe("Explicit");
    expect(found[0].project?.config.defaultLocale).toBe("de-DE");
  });

  it("reports invalid configs during discovery instead of throwing", () => {
    const root = makeApp("broken", { expo: { name: "B" } });
    fs.writeFileSync(path.join(root, "store-shots.config.json"), "{ not json");
    const found = discoverProjects(ws);
    expect(found[0].error).toMatch(/Invalid JSON/);
  });
});
