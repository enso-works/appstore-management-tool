import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accentOf, iconAccent, statedAccent } from "../lib/accent";
import { orientationOf, themeChanges } from "../lib/apply-theme";
import { contrast, FALLBACK_ACCENT, hexToOklch, oklchToHex, paletteFrom } from "../lib/color";
import { loadProject } from "../lib/config";
import { resolveFont, resolveFontStack } from "../lib/fonts";
import { initProject } from "../lib/init";
import { readinessReport } from "../lib/readiness";
import { renderArtworkHtml } from "../lib/render/html";
import { missingCapture } from "../lib/render/preview";
import { projectConfigSchema } from "../lib/schema";
import { getTarget } from "../lib/targets";
import { isStarterPrompt, STARTER_PROMPTS, STARTER_SCREEN_IDS, THEMES } from "../lib/themes";
import { validateProject } from "../lib/validate";
import { getTemplateModule } from "../templates";
import { editJson, readJson, tempFixture, writeJson, type AnyJson } from "./helpers";

const HEX = /^#[0-9A-F]{6}$/;

describe("colour", () => {
  it("round-trips through OKLCH", () => {
    for (const hex of ["#3FA69F", "#E5484D", "#0C5A97", "#ACDA26", "#777777"]) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  it("brings out-of-gamut colours back into sRGB", () => {
    expect(oklchToHex({ l: 0.7, c: 0.4, h: 140 })).toMatch(HEX);
  });

  it("derives every tone in the accent's hue, with readable text on the accent", () => {
    for (const accent of ["#83D5CC", "#041534", "#E5484D", "#ACDA26", "#2F6FEB", "#888888"]) {
      const p = paletteFrom(accent);
      for (const v of Object.values(p)) expect(v).toMatch(HEX);
      expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(3);
      expect(contrast("#FFFFFF", p.night)).toBeGreaterThan(12);
      expect(contrast(p.ink, p.paper)).toBeGreaterThan(10);
    }
  });

  it("falls back to the neutral blue for something that is not a colour", () => {
    expect(paletteFrom("nope").accent).toBe(paletteFrom(FALLBACK_ACCENT).accent);
  });
});

describe("accent of an app", () => {
  let root: string;
  beforeEach(() => (root = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-accent-"))));
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("takes the colour the app states, skipping white and black", () => {
    writeJson(path.join(root, "app.json"), {
      expo: {
        name: "A",
        splash: { backgroundColor: "#ffffff" },
        android: { adaptiveIcon: { backgroundColor: "#3FA69F" } },
      },
    });
    expect(statedAccent(root)).toEqual({ hex: "#3FA69F", source: "app.json android.adaptiveIcon.backgroundColor" });
  });

  it("finds a small vivid detail on a dark icon", async () => {
    const icon = path.join(root, "icon.png");
    const corner = await sharp({ create: { width: 160, height: 160, channels: 3, background: "#B8F21A" } })
      .png()
      .toBuffer();
    await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#0C0E14" } })
      .composite([
        { input: corner, left: 700, top: 700 },
        {
          input: await sharp({ create: { width: 500, height: 300, channels: 3, background: "#F6F3EC" } })
            .png()
            .toBuffer(),
          left: 200,
          top: 200,
        },
      ])
      .png()
      .toFile(icon);
    const hex = (await iconAccent(icon))!;
    expect(hexToOklch(hex).h).toBeGreaterThan(100);
    expect(hexToOklch(hex).h).toBeLessThan(140);
  });

  it("uses the icon when the app states no colour, else the default", async () => {
    writeJson(path.join(root, "app.json"), { expo: { name: "A", icon: "./icon.png" } });
    expect((await accentOf(root)).source).toBe("default");
    await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#E5484D" } })
      .png()
      .toFile(path.join(root, "icon.png"));
    const guess = await accentOf(root);
    expect(guess.source).toBe("app icon");
    expect(guess.hex).toBe("#E5484D");
  });
});

describe("themes", () => {
  it("are complete: fonts bundled, brand values valid, layouts valid for their template", () => {
    for (const theme of THEMES) {
      const font = resolveFont(undefined, theme.headlineFont.family);
      expect(font, theme.id).toBeDefined();
      for (const w of theme.headlineFont.weights) expect(font!.files.some((f) => f.weight === w)).toBe(true);
      for (const accent of ["#3FA69F", "#ACDA26"]) {
        const p = paletteFrom(accent);
        for (const orientation of ["portrait", "landscape"] as const) {
          for (let index = 0; index < 6; index++) {
            const look = theme.screen({ palette: p, index, orientation });
            const mod = getTemplateModule(look.template)!;
            expect(mod, `${theme.id} ${look.template}`).toBeDefined();
            expect(mod.descriptor.orientations).toContain(orientation);
            expect(
              () => mod.overridesSchema.parse(look.overrides),
              `${theme.id} ${orientation} ${index}`,
            ).not.toThrow();
          }
        }
      }
    }
  });

  it("keeps theme fonts out of every app's fallback stack", () => {
    const fx = tempFixture();
    try {
      const { stack } = resolveFontStack(loadProject(path.join(fx.root, "store-shots.config.json")));
      expect(stack.map((f) => f.family)).not.toContain("Poppins");
    } finally {
      fx.cleanup();
    }
  });

  it("reads the orientation of the app's screenshot sets", () => {
    expect(orientationOf(["iphone-6.9-2868x1320", "header-3840x1646"])).toBe("landscape");
    expect(orientationOf(["header-3840x1646", "iphone-6.9-1320x2868"])).toBe("portrait");
  });
});

describe("applying a theme", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const configFile = () => path.join(fx.root, "store-shots.config.json");
  const manifestFile = () => path.join(fx.root, "store/manifest.json");

  function apply(theme: string, accent = "#3FA69F") {
    const changes = themeChanges(readJson(configFile()), readJson(manifestFile()), theme, accent);
    writeJson(configFile(), changes.config);
    writeJson(manifestFile(), changes.manifest);
    return changes;
  }

  it("validates and renders every theme in both directions, portrait and landscape", () => {
    for (const orientation of ["portrait", "landscape"]) {
      if (orientation === "landscape") {
        editJson(configFile(), (c) => (c.targets = ["iphone-6.9-2868x1320"]));
      }
      for (const theme of THEMES) {
        apply(theme.id);
        const project = loadProject(configFile());
        expect(projectConfigSchema.safeParse(readJson(configFile())).success).toBe(true);
        const result = validateProject(project);
        expect(result.issues.errors, `${theme.id} ${orientation}`).toEqual([]);
        for (const job of result.plan) {
          const { html } = renderArtworkHtml(project, job, result.content.get(job.locale)!, {
            sourceImage: "about:blank",
            fontUrl: (p) => p,
            assetUrl: (p) => p,
          });
          expect(html).toContain("data-artwork");
          if (job.locale === "ar-SA") expect(html).toContain('dir="rtl"');
        }
      }
    }
  });

  it("restyles screens and brand, and leaves copy, layers, ids, order and official frames alone", () => {
    editJson(manifestFile(), (m) => {
      m.screens[0].layers = [{ type: "image", id: "badge", asset: "logos/badge.png", x: 0.5, y: 0.5, width: 0.2 }];
      m.screens[1].overrides.shell = "frame:Apple iPhone 16 Pro Max Black Titanium";
    });
    const before = readJson<AnyJson>(manifestFile());
    const fontBefore = readJson<AnyJson>(configFile()).brand.font;
    const content = fs.readFileSync(path.join(fx.root, "store/content/en-US.json"), "utf8");
    const changes = apply("swing");
    const after = readJson<AnyJson>(manifestFile());
    const config = readJson<AnyJson>(configFile());
    expect(changes.restyled).toEqual(["home", "planning"]);
    expect(after.screens.map((s: AnyJson) => [s.id, s.order, s.source])).toEqual(
      before.screens.map((s: AnyJson) => [s.id, s.order, s.source]),
    );
    expect(after.screens[0].layers).toEqual(before.screens[0].layers);
    expect(after.screens[1].overrides.shell).toBe("frame:Apple iPhone 16 Pro Max Black Titanium");
    // Swing alternates sides.
    expect(Math.sign(after.screens[0].overrides.screenshotOffsetX)).toBe(
      -Math.sign(after.screens[1].overrides.screenshotOffsetX),
    );
    expect(config.brand.headlineFont.family).toBe("Nunito");
    expect(config.brand.font).toEqual(fontBefore);
    expect(config.brand.background.span).toBe(true);
    expect(fs.readFileSync(path.join(fx.root, "store/content/en-US.json"), "utf8")).toBe(content);
  });

  it("only recolours screens made for the header, search or event pictures", () => {
    editJson(configFile(), (c) => c.targets.push("header-3840x1646"));
    editJson(manifestFile(), (m) =>
      m.screens.push({
        id: "banner",
        order: 3,
        enabled: false,
        template: "feature-graphic",
        targets: ["header-3840x1646"],
        source: { filePattern: "01-home.png", localized: false },
        overrides: { screenshotScale: 0.5, background: "#000000" },
      }),
    );
    const changes = apply("aurora");
    const banner = readJson<AnyJson>(manifestFile()).screens.find((s: AnyJson) => s.id === "banner");
    expect(changes.recoloured).toEqual(["banner"]);
    expect(banner.template).toBe("feature-graphic");
    expect(banner.overrides.screenshotScale).toBe(0.5);
    expect(banner.overrides.background).toContain("radial-gradient");
  });

  it("does not change its inputs", () => {
    const config = readJson<AnyJson>(configFile());
    const manifest = readJson<AnyJson>(manifestFile());
    const snapshot = JSON.stringify([config, manifest]);
    themeChanges(config, manifest, "bold", "#E5484D");
    expect(JSON.stringify([config, manifest])).toBe(snapshot);
  });

  it("keeps copy for a field the new template does not show, as a warning", () => {
    apply("card");
    const result = validateProject(loadProject(configFile()));
    expect(result.issues.errors).toEqual([]);
    expect(result.issues.items.map((i) => i.code)).toContain("content.unused-field");
  });
});

describe("init with a theme", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-themed-"));
    writeJson(path.join(root, "app.json"), { expo: { name: "Fresh", ios: { bundleIdentifier: "com.x.fresh" } } });
    fs.mkdirSync(path.join(root, "fastlane", "metadata", "en-US"), { recursive: true });
    fs.writeFileSync(path.join(root, "fastlane", "metadata", "en-US", "subtitle.txt"), "Plan meals in minutes\n");
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("starts five styled screens with prompts to replace, and the hero from the store subtitle", () => {
    initProject({
      appRoot: root,
      toolRelPath: "../tools/store-shots",
      locales: ["en-US"],
      theme: { id: "paper", accent: "#E5484D" },
    });
    const manifest = readJson<AnyJson>(path.join(root, "store/manifest.json"));
    const content = readJson<AnyJson>(path.join(root, "store/content/en-US.json"));
    const config = readJson<AnyJson>(path.join(root, "store-shots.config.json"));
    expect(manifest.screens.map((s: AnyJson) => s.id)).toEqual([...STARTER_SCREEN_IDS]);
    expect(config.brand.headlineFont.family).toBe("Instrument Serif");
    expect(content.screens.hero.headline).toBe("Plan meals in minutes");
    expect(content.screens["feature-1"].headline).toBe(STARTER_PROMPTS.headline);

    const project = loadProject(path.join(root, "store-shots.config.json"));
    const codes = validateProject(project).issues.items.map((i) => i.code);
    expect(codes).toContain("content.starter-copy");
    const placeholders = readinessReport(project).checks.find((c) => c.id === "placeholders")!;
    expect(placeholders.status).toBe("fail");
    expect(placeholders.details.join(" ")).toContain("feature-1.headline");
  });

  it("without a theme, starts as before: one plain screen", () => {
    initProject({ appRoot: root, toolRelPath: "../tools/store-shots", locales: ["en-US"] });
    const manifest = readJson<AnyJson>(path.join(root, "store/manifest.json"));
    expect(manifest.screens.map((s: AnyJson) => s.id)).toEqual(["home"]);
  });

  it("recognises only the exact prompts", () => {
    expect(isStarterPrompt(STARTER_PROMPTS.caption)).toBe(true);
    expect(isStarterPrompt("One line on why it matters")).toBe(false);
    expect(isStarterPrompt(null)).toBe(false);
  });
});

describe("the capture placeholder", () => {
  it("is drawn the right way round in the app's colours", () => {
    const fx = tempFixture();
    try {
      const project = loadProject(path.join(fx.root, "store-shots.config.json"));
      const portrait = decodeURIComponent(missingCapture(project, getTarget("iphone-6.9-1320x2868")!));
      const landscape = decodeURIComponent(missingCapture(project, getTarget("iphone-6.9-2868x1320")!));
      expect(portrait).toContain('width="600" height="1300"');
      expect(landscape).toContain('width="1300" height="600"');
      expect(portrait).toContain(paletteFrom(project.config.brand.primary).accent);
    } finally {
      fx.cleanup();
    }
  });
});
