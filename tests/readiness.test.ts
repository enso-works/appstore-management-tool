import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { analyzeKeywords, METADATA_LIMITS, metadataLength, readMetadataLocale } from "../lib/metadata";
import { readPngInfo } from "../lib/png";
import { writeSolidPng } from "../lib/png-write";
import { readinessReport } from "../lib/readiness";
import { editJson, tempFixture } from "./helpers";

describe("metadata helpers", () => {
  it("counts code points like Ruby String#length", () => {
    expect(metadataLength("abc")).toBe(3);
    expect(metadataLength("  abc \n")).toBe(3);
    expect(metadataLength("héllo")).toBe(5);
    expect(metadataLength("日本語")).toBe(3);
    expect(metadataLength("👍")).toBe(1);
  });

  it("keeps the same limits as the Fastfile lane", () => {
    expect(METADATA_LIMITS).toEqual({
      name: 30,
      subtitle: 30,
      keywords: 100,
      promotional_text: 170,
      description: 4000,
      release_notes: 4000,
      marketing_url: 255,
      support_url: 255,
      privacy_url: 255,
    });
  });

  it("analyzes keyword hygiene", () => {
    const a = analyzeKeywords("calm, breathe,sleep,Calm,focus", "Braele: Breathe & Relax", "Box breathing timer");
    expect(a.keywords).toEqual(["calm", "breathe", "sleep", "Calm", "focus"]);
    expect(a.duplicates).toEqual(["calm"]);
    expect(a.spacesAfterCommas).toBe(true);
    expect(a.redundantWithTitle).toEqual(["breathe"]);
  });
});

describe("png header reader", () => {
  it("reads dimensions and alpha", () => {
    const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp-png-"));
    try {
      writeSolidPng(path.join(dir, "rgb.png"), { width: 10, height: 20, color: [1, 2, 3] });
      writeSolidPng(path.join(dir, "rgba.png"), { width: 5, height: 5, color: [1, 2, 3, 128] });
      expect(readPngInfo(path.join(dir, "rgb.png"))).toMatchObject({
        width: 10,
        height: 20,
        hasAlpha: false,
        colorType: 2,
      });
      expect(readPngInfo(path.join(dir, "rgba.png"))).toMatchObject({
        width: 5,
        height: 5,
        hasAlpha: true,
        colorType: 6,
      });
      fs.writeFileSync(path.join(dir, "not.png"), "hello");
      expect(() => readPngInfo(path.join(dir, "not.png"))).toThrow(/not a PNG/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readiness on the fixture", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));
  const byId = (r: ReturnType<typeof readinessReport>, id: string) => r.checks.find((c) => c.id === id)!;

  it("fails only on missing screenshots out of the box", () => {
    const r = readinessReport(load());
    expect(byId(r, "placeholders").status).toBe("pass");
    expect(byId(r, "metadata-locales").status).toBe("pass");
    expect(byId(r, "metadata-limits").status).toBe("pass");
    expect(byId(r, "icon").status).toBe("pass");
    expect(byId(r, "credentials").status).toBe("skip");
    expect(byId(r, "screenshots").status).toBe("fail");
    expect(r.status).toBe("fail");
  });

  it("passes screenshots when every set is complete and exact", () => {
    for (const locale of ["en-US", "ar-SA"]) {
      for (let i = 1; i <= 2; i++) {
        writeSolidPng(path.join(fx.root, "fastlane/screenshots", locale, `0${i}_x_IPHONE_69.png`), {
          width: 1320,
          height: 2868,
          color: [1, 2, 3],
        });
        writeSolidPng(path.join(fx.root, "fastlane/screenshots", locale, `0${i}_x_IPAD_PRO_129.png`), {
          width: 2064,
          height: 2752,
          color: [1, 2, 3],
        });
      }
    }
    const r = readinessReport(load());
    expect(byId(r, "screenshots").status).toBe("pass");
    expect(byId(r, "screenshot-consistency").status).toBe("pass");
    // The fixture has no 6.1" set, which Apple names as required but scales from 6.9",
    // and one icon, from which iOS derives the dark and tinted ones.
    expect(r.checks.filter((c) => c.status !== "pass" && c.status !== "skip").map((c) => c.id)).toEqual([
      "required-sizes",
      "icon-variants",
    ]);
    expect(r.status).toBe("warn");
  });

  it("flags alpha, odd sizes and inconsistent counts", () => {
    writeSolidPng(path.join(fx.root, "fastlane/screenshots/en-US/01.png"), {
      width: 1320,
      height: 2868,
      color: [1, 2, 3, 255],
    });
    writeSolidPng(path.join(fx.root, "fastlane/screenshots/en-US/02.png"), {
      width: 1320,
      height: 2868,
      color: [1, 2, 3],
    });
    writeSolidPng(path.join(fx.root, "fastlane/screenshots/en-US/odd.png"), {
      width: 1290,
      height: 2796,
      color: [1, 2, 3],
    });
    const r = readinessReport(load());
    const s = byId(r, "screenshots");
    expect(s.details.join("\n")).toMatch(/01.png has an alpha channel/);
    expect(s.details.join("\n")).toMatch(/odd.png \(1290x2796 matches no configured target\)/);
    expect(byId(r, "screenshot-consistency").status).toBe("warn");
  });

  it("detects over-limit metadata and missing fields", () => {
    fs.writeFileSync(path.join(fx.root, "fastlane/metadata/en-US/subtitle.txt"), "x".repeat(31));
    fs.rmSync(path.join(fx.root, "fastlane/metadata/ar-SA/keywords.txt"));
    const r = readinessReport(load());
    expect(byId(r, "metadata-limits").status).toBe("fail");
    expect(byId(r, "metadata-limits").details).toEqual(["en-US/subtitle is 31/30"]);
    expect(byId(r, "metadata-locales").status).toBe("fail");
    expect(byId(r, "metadata-locales").details).toEqual(["ar-SA: missing or empty keywords"]);
    const state = readMetadataLocale(load(), "en-US");
    expect(state.fields.find((f) => f.field === "subtitle")?.overLimit).toBe(true);
  });

  it("detects placeholders and a bad icon", () => {
    fs.writeFileSync(path.join(fx.root, "fastlane/metadata/en-US/name.txt"), "__APP_NAME__");
    writeSolidPng(path.join(fx.root, "assets/icon.png"), { width: 512, height: 512, color: [1, 2, 3, 255] });
    const r = readinessReport(load());
    expect(byId(r, "placeholders").status).toBe("fail");
    expect(byId(r, "placeholders").details[0]).toMatch(/name.txt: __APP_NAME__/);
    expect(byId(r, "icon").status).toBe("fail");
    expect(byId(r, "icon").details).toHaveLength(2);
    writeSolidPng(path.join(fx.root, "assets/icon.png"), { width: 1024, height: 1024, color: [1, 2, 3, 255] });
    expect(byId(readinessReport(load()), "icon").status).toBe("warn");
  });

  it("locates the App Store Connect key without reading a .p8 when fastlane is enabled", () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => (c.fastlane = { enabled: true }));
    let r = readinessReport(load());
    expect(byId(r, "credentials").status).toBe("fail");
    // A .p8 is only located (its content is never parsed here), with the ids the Fastfile names.
    fs.writeFileSync(path.join(fx.root, "fastlane/AuthKey_ABC123.p8"), "not a real key");
    fs.writeFileSync(path.join(fx.root, "fastlane/Deliverfile"), "");
    fs.writeFileSync(path.join(fx.root, "fastlane/Fastfile"), 'ASC_KEY_ID = "ABC123"\nASC_ISSUER_ID = "iss"\n');
    r = readinessReport(load());
    expect(byId(r, "credentials").status).toBe("pass");
    // A Deliverfile that reads fastlane's JSON key file needs it there.
    fs.writeFileSync(path.join(fx.root, "fastlane/Deliverfile"), 'api_key_path("fastlane/asc_api_key.json")\n');
    r = readinessReport(load());
    expect(byId(r, "credentials").details.join("\n")).toMatch(/reads fastlane\/asc_api_key\.json, which is missing/);
    // Only its existence is checked; the contents (the key) are not read here.
    fs.writeFileSync(path.join(fx.root, "fastlane/asc_api_key.json"), "not json at all");
    r = readinessReport(load());
    expect(byId(r, "credentials").status).toBe("pass");
  });

  it("warns when generated screenshots are from another version", () => {
    fs.writeFileSync(
      path.join(fx.root, "fastlane/screenshots/.store-shots-manifest.json"),
      JSON.stringify({ version: 1, generatedAt: "x", appVersion: "1.1.0", files: [] }),
    );
    const r = readinessReport(load());
    expect(byId(r, "version").status).toBe("warn");
    expect(byId(r, "version").details[0]).toMatch(/generated for version 1.1.0; the app is 1.2.0 \(app.json version\)/);
  });
});
