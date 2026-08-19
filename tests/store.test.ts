import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { laneSpec, preflightLane, runLane } from "../lib/fastlane";
import {
  createMetadataLocale,
  metadataEtag,
  MetadataConflict,
  readMetadataLocale,
  writeMetadataField,
} from "../lib/metadata";
import { editJson, tempFixture } from "./helpers";

describe("metadata writes", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("writes a field atomically with normalised whitespace and reports length", () => {
    const p = load();
    const before = metadataEtag(p, "en-US", "subtitle");
    const r = writeMetadataField(p, "en-US", "subtitle", "  New subtitle \r\n", before);
    expect(fs.readFileSync(path.join(fx.root, "fastlane/metadata/en-US/subtitle.txt"), "utf8")).toBe("New subtitle");
    expect(r.length).toBe(12);
    expect(r.overLimit).toBe(false);
    expect(r.etag).not.toBe(before);
    const d = writeMetadataField(p, "en-US", "description", "Line one\r\nLine two");
    expect(fs.readFileSync(path.join(fx.root, "fastlane/metadata/en-US/description.txt"), "utf8")).toBe(
      "Line one\nLine two\n",
    );
    expect(d.length).toBe(17);
  });

  it("flags over-limit values but still writes them (the lane/readiness block the upload)", () => {
    const r = writeMetadataField(load(), "en-US", "name", "x".repeat(31));
    expect(r.overLimit).toBe(true);
    expect(readMetadataLocale(load(), "en-US").fields.find((f) => f.field === "name")?.overLimit).toBe(true);
  });

  it("refuses stale etags, unknown locales and missing directories", () => {
    const p = load();
    expect(() => writeMetadataField(p, "en-US", "name", "x", "stale")).toThrow(MetadataConflict);
    expect(() => writeMetadataField(p, "fr-FR", "name", "x")).toThrow(/not configured/);
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => c.locales.push("de-DE"));
    expect(() => writeMetadataField(load(), "de-DE", "name", "x")).toThrow(/create it first/);
  });

  it("creates a locale directory explicitly, seeding only URL fields", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => c.locales.push("de-DE"));
    const created = createMetadataLocale(load(), "de-DE", "en-US");
    expect(created.sort()).toEqual(["de-DE/marketing_url.txt", "de-DE/privacy_url.txt", "de-DE/support_url.txt"]);
    expect(fs.existsSync(path.join(fx.root, "fastlane/metadata/de-DE/name.txt"))).toBe(false);
    const state = readMetadataLocale(load(), "de-DE");
    expect(state.dirExists).toBe(true);
    expect(state.fields.find((f) => f.field === "support_url")?.value.trim()).toBe("https://example.com/support");
  });
});

describe("fastlane runner", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("parses lane specs and refuses build/submit-looking lanes", () => {
    const p = load();
    expect(laneSpec(p, "validate").args).toEqual(["ios", "validate_metadata"]);
    expect(laneSpec(p, "metadata").uploads).toBe(true);
    expect(laneSpec(p, "validate").uploads).toBe(false);
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.fastlane = { lanes: { validate: "ios beta" } }));
    expect(() => laneSpec(load(), "validate")).toThrow(/build\/submit/);
    editJson(
      path.join(fx.root, "store-shots.config.json"),
      (c) => (c.fastlane = { lanes: { validate: "ios metadata;rm" } }),
    );
    expect(() => laneSpec(load(), "validate")).toThrow(/not a plain lane name/);
  });

  it("preflight blocks upload lanes when readiness fails or fastlane is disabled", () => {
    // Fixture has fastlane.enabled false and no screenshots -> everything blocked for uploads.
    const pre = preflightLane(load(), "screenshots");
    expect(pre.blocked).toBe(true);
    expect(pre.reasons.join(" ")).toMatch(/fastlane.enabled is false/);
    expect(pre.reasons.join(" ")).toMatch(/readiness failing/);
    const v = preflightLane(load(), "validate");
    expect(v.spec.uploads).toBe(false);
  });

  it("refuses to run an upload lane without confirmation and without an override when blocked", async () => {
    const p = load();
    await expect(runLane(p, { key: "metadata" })).rejects.toThrow(/confirm explicitly/);
    await expect(runLane(p, { key: "metadata", confirmed: true })).rejects.toThrow(/fastlane.enabled is false/);
  });

  it("runs a lane through a fake fastlane binary with cwd = app root and streams lines", async () => {
    const fake = path.join(fx.root, "fake-fastlane.sh");
    fs.writeFileSync(fake, '#!/bin/sh\necho "args: $@"\necho "cwd: $(pwd)"\necho "warn" 1>&2\nexit 3\n');
    fs.chmodSync(fake, 0o755);
    fs.mkdirSync(path.join(fx.root, "fastlane"), { recursive: true });
    fs.writeFileSync(path.join(fx.root, "fastlane/Fastfile"), "");
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.fastlane = { enabled: true }));
    const prev = process.env.STORE_SHOTS_FASTLANE;
    process.env.STORE_SHOTS_FASTLANE = fake;
    try {
      const lines: string[] = [];
      const r = await runLane(load(), { key: "validate", onLine: (l, s) => lines.push(`${s}:${l}`) });
      expect(r.exitCode).toBe(3);
      expect(lines.some((l) => l === "stdout:args: ios validate_metadata")).toBe(true);
      expect(lines.some((l) => l === `stdout:cwd: ${fs.realpathSync(fx.root)}` || l === `stdout:cwd: ${fx.root}`)).toBe(
        true,
      );
      expect(lines.some((l) => l === "stderr:warn")).toBe(true);
      expect(lines[0]).toMatch(/^meta:\$ /);
    } finally {
      if (prev === undefined) delete process.env.STORE_SHOTS_FASTLANE;
      else process.env.STORE_SHOTS_FASTLANE = prev;
    }
  });
});
