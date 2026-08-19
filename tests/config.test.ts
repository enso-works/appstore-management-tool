import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, findConfigPath, loadProject, resolveProjectArg, sourceDeviceFor } from "../lib/config";
import { PathEscapeError, resolveWithin } from "../lib/paths";
import { editJson, tempFixture } from "./helpers";

describe("config discovery", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());

  it("walks up from a nested directory", () => {
    const nested = path.join(fx.root, "store", "content");
    expect(findConfigPath(nested)).toBe(path.join(fx.root, "store-shots.config.json"));
  });

  it("accepts a directory or a config file as --project", () => {
    expect(resolveProjectArg(fx.root)).toBe(path.join(fx.root, "store-shots.config.json"));
    expect(resolveProjectArg(path.join(fx.root, "store-shots.config.json"))).toBe(
      path.join(fx.root, "store-shots.config.json"),
    );
  });

  it("fails clearly when nothing is found", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-empty-"));
    try {
      expect(() => resolveProjectArg(undefined, empty)).toThrow(ConfigError);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
    expect(() => resolveProjectArg(path.join(fx.root, "nope"))).toThrow(/No store-shots.config.json/);
  });
});

describe("loadProject", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());

  it("applies nested defaults", () => {
    const p = loadProject(path.join(fx.root, "store-shots.config.json"));
    expect(p.config.paths.manifest).toBe("store/manifest.json");
    expect(p.config.output.format).toBe("png");
    expect(p.config.validation.screensPerTarget).toEqual({ min: 2, max: 10 });
    expect(p.config.metadata.fields).toContain("keywords");
    expect(p.config.fastlane.lanes.screenshots).toBe("ios screenshots");
    expect(p.paths.outputScreenshots).toBe(path.join(fx.root, "fastlane", "screenshots"));
  });

  it("rejects a default locale that is not listed", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.defaultLocale = "fr-FR"));
    expect(() => loadProject(path.join(fx.root, "store-shots.config.json"))).toThrow(
      /defaultLocale "fr-FR" is not in locales/,
    );
  });

  it("rejects unknown targets and unknown keys", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
      c.targets = ["iphone-5.5-1242x2208"];
      c.bogus = 1;
    });
    expect(() => loadProject(path.join(fx.root, "store-shots.config.json"))).toThrow(/targets|bogus/);
  });

  it("rejects paths that escape the app root", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.paths = { raw: "../outside" }));
    expect(() => loadProject(path.join(fx.root, "store-shots.config.json"))).toThrow(/must not contain/);
  });

  it("maps targets to source devices by family unless overridden", () => {
    const p = loadProject(path.join(fx.root, "store-shots.config.json"));
    expect(sourceDeviceFor(p, "iphone-6.9-1320x2868")).toBe("iphone");
    expect(sourceDeviceFor(p, "ipad-13-2064x2752")).toBe("ipad");
    p.config.sourceDevices["ipad-13-2064x2752"] = "tablet-captures";
    expect(sourceDeviceFor(p, "ipad-13-2064x2752")).toBe("tablet-captures");
  });
});

describe("resolveWithin", () => {
  it("allows paths inside the root and refuses escapes", () => {
    const root = fs.mkdtempSync(path.join(process.cwd(), "tmp-root-"));
    try {
      expect(resolveWithin(root, "store/raw")).toBe(path.join(root, "store", "raw"));
      expect(resolveWithin(root, ".")).toBe(root);
      expect(() => resolveWithin(root, "../sibling")).toThrow(PathEscapeError);
      expect(() => resolveWithin(root, "/etc/passwd")).toThrow(PathEscapeError);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses symlinks that point outside the root", () => {
    const base = fs.mkdtempSync(path.join(process.cwd(), "tmp-sym-"));
    try {
      const root = path.join(base, "root");
      const outside = path.join(base, "outside");
      fs.mkdirSync(root);
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(root, "link"));
      expect(() => resolveWithin(root, "link/file.png")).toThrow(PathEscapeError);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
