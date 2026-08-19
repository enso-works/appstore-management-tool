import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { initProject } from "../lib/init";
import { metadataLength, rubyStrip } from "../lib/metadata";
import { writeSolidPng } from "../lib/png-write";
import { readinessReport } from "../lib/readiness";
import { validateProject } from "../lib/validate";
import { editJson, tempFixture } from "./helpers";

/** Regression tests for the Phase 1 code-review findings. */

describe("init input validation", () => {
  let ws: string;
  beforeEach(() => (ws = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-init-"))));
  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("refuses bad locales before writing anything", () => {
    const root = path.join(ws, "app");
    fs.mkdirSync(root);
    expect(() => initProject({ appRoot: root, toolRelPath: "x", locales: ["../../../out/pwn"] })).toThrow(
      /Refusing to scaffold/,
    );
    expect(() => initProject({ appRoot: root, toolRelPath: "x", locales: [] })).toThrow(/Refusing to scaffold/);
    expect(() => initProject({ appRoot: root, toolRelPath: "x", locales: ["en-US"], defaultLocale: "de-DE" })).toThrow(
      /Refusing to scaffold/,
    );
    expect(fs.readdirSync(root)).toEqual([]);
    expect(fs.existsSync(path.join(ws, "out"))).toBe(false);
  });

  it("tolerates a null or array app.json", () => {
    const root = path.join(ws, "app");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "app.json"), "null");
    const r = initProject({ appRoot: root, toolRelPath: "x" });
    expect(r.config.projectName).toBe("app");
  });
});

describe("root-bound source and icon paths", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("rejects filePattern and sourceDevices values with '..' at the schema level", () => {
    editJson(
      path.join(fx.root, "store/manifest.json"),
      (m) => (m.screens[0].source.filePattern = "../../../etc/hosts"),
    );
    const r = validateProject(load());
    expect(r.issues.errors.map((i) => i.code)).toContain("manifest.schema");

    fx.cleanup();
    fx = tempFixture();
    editJson(
      path.join(fx.root, "store-shots.config.json"),
      (c) => (c.sourceDevices = { "iphone-6.9-1320x2868": "../../.." }),
    );
    expect(() => load()).toThrow(/sourceDevices/);
  });

  it("reports an escaping interpolated source path instead of opening it", () => {
    // A pattern that only escapes after interpolation is still caught by resolveWithin.
    editJson(
      path.join(fx.root, "store/manifest.json"),
      (m) => (m.screens[0].source.filePattern = "{locale}/x/../../../../../../etc/hosts"),
    );
    const r = validateProject(load());
    const codes = r.issues.errors.map((i) => i.code);
    expect(codes.some((c) => c === "manifest.schema" || c === "source.escape")).toBe(true);
  });

  it("flags an app.json icon outside the app root without reading it", () => {
    editJson(path.join(fx.root, "app.json"), (a) => (a.expo.icon = "/etc/hosts"));
    const r = readinessReport(load());
    const icon = r.checks.find((c) => c.id === "icon")!;
    expect(icon.status).toBe("fail");
    expect(icon.details[0]).toMatch(/points outside the app/);
  });
});

describe("readiness robustness", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));
  const byId = (r: ReturnType<typeof readinessReport>, id: string) => r.checks.find((c) => c.id === id)!;

  it("treats a truncated PNG as one failed finding, not a crashed report", () => {
    const dir = path.join(fx.root, "fastlane/screenshots/en-US");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "01.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]),
    );
    const r = readinessReport(load());
    expect(r.checks).toHaveLength(8);
    expect(byId(r, "screenshots").details.join("\n")).toMatch(/01.png \(unreadable PNG/);
  });

  it("reports a malformed app.json inside the icon/version checks", () => {
    fs.writeFileSync(path.join(fx.root, "app.json"), "{bad");
    const r = readinessReport(load());
    expect(r.checks).toHaveLength(8);
    expect(byId(r, "icon").status).toBe("fail");
    expect(byId(r, "icon").details[0]).toMatch(/Invalid JSON/);
    expect(byId(r, "version").status).toBe("fail");
  });

  it("does not demote an alpha failure because of the file name", () => {
    const dir = path.join(fx.root, "fastlane/screenshots/en-US");
    for (const name of ["01_not-a-PNG.png", "02_x.png"]) {
      writeSolidPng(path.join(dir, name), { width: 1320, height: 2868, color: [1, 2, 3, 255] });
      writeSolidPng(path.join(dir, name.replace("IPHONE", "IPAD")), {
        width: 1320,
        height: 2868,
        color: [1, 2, 3, 255],
      });
    }
    const r = readinessReport(load());
    expect(byId(r, "screenshots").status).toBe("fail");
    expect(byId(r, "screenshots").details.join("\n")).toMatch(/01_not-a-PNG.png has an alpha channel/);
  });

  it("checks all nine metadata fields like the Fastfile lane, not just the managed ones", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.metadata = { fields: ["name", "description"] }));
    fs.writeFileSync(path.join(fx.root, "fastlane/metadata/en-US/keywords.txt"), "k".repeat(120));
    const r = readinessReport(load());
    expect(byId(r, "metadata-limits").status).toBe("fail");
    expect(byId(r, "metadata-limits").details).toEqual(["en-US/keywords is 120/100"]);
  });
});

describe("metadata length matches Ruby strip", () => {
  it("strips ASCII whitespace only", () => {
    expect(rubyStrip("  a b \n\t")).toBe("a b");
    expect(rubyStrip(" a ")).toBe(" a ");
    expect(metadataLength("﻿" + "x".repeat(30))).toBe(31);
    expect(metadataLength("x".repeat(30) + "\n")).toBe(30);
  });
});

describe("validation details", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("rejects null for a required template field", () => {
    editJson(path.join(fx.root, "store/content/en-US.json"), (c) => (c.screens.home.headline = null));
    const r = validateProject(load());
    expect(r.issues.errors.map((i) => i.code)).toContain("content.missing-field");
  });

  it("surfaces the unused-sourceDevices warning", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.sourceDevices = { "ipad-13-9999x9999": "ipad" }));
    const r = validateProject(load());
    expect(r.issues.warnings.map((i) => i.code)).toContain("config.source-device-unused");
  });

  it("rejects jpg output format until a JPEG reader exists", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.output = { format: "jpg" }));
    expect(() => load()).toThrow(/format/);
  });
});

describe("CLI exit codes", () => {
  const bin = path.resolve(import.meta.dirname, "..", "bin", "store-shots.mjs");
  const run = (...args: string[]) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

  it("uses 2 for usage errors and 0 for help", () => {
    expect(run("bogus").status).toBe(2);
    expect(run("init").status).toBe(2); // missing --project
    expect(run("validate", "--nope").status).toBe(2);
    expect(run("--help").status).toBe(0);
  });

  it("uses 1 for a failed validation and 0 for a clean one", () => {
    const fx = tempFixture();
    try {
      expect(run("validate", "--project", fx.root).status).toBe(0);
      fs.rmSync(path.join(fx.root, "store/content/ar-SA.json"));
      expect(run("validate", "--project", fx.root).status).toBe(1);
      expect(run("validate", "--project", path.join(fx.root, "nope")).status).toBe(2);
    } finally {
      fx.cleanup();
    }
  });
});
