import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { findImportCandidates, importApp, ImportError, inspectApp } from "../lib/import";
import { listRegistered } from "../lib/registered";
import { FIXTURE_ROOT, tempFixture, writeJson } from "./helpers";

describe("import", () => {
  let ws: string;
  let home: string | undefined;
  let workspace: string | undefined;
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-import-"));
    // Never touch the real list of apps in ~/.store-shots.
    home = process.env.STORE_SHOTS_HOME;
    workspace = process.env.STORE_SHOTS_WORKSPACE;
    process.env.STORE_SHOTS_HOME = path.join(ws, ".home");
    process.env.STORE_SHOTS_WORKSPACE = ws;
  });
  afterEach(() => {
    for (const [key, value] of [
      ["STORE_SHOTS_HOME", home],
      ["STORE_SHOTS_WORKSPACE", workspace],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(ws, { recursive: true, force: true });
  });

  const write = (rel: string, text: string) => {
    const file = path.join(ws, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };

  const plist = (entries: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${entries}\n</dict>\n</plist>\n`;

  function capacitorGame(name = "game") {
    write(
      `${name}/capacitor.config.ts`,
      "const config: CapacitorConfig = {\n  appId: 'com.example.rally',\n  appName: 'Rally',\n  webDir: 'dist',\n};\n",
    );
    write(
      `${name}/ios/App/App/Info.plist`,
      plist(
        "<key>CFBundleDisplayName</key>\n<string>Rally</string>\n" +
          "<key>UISupportedInterfaceOrientations</key>\n<array>\n" +
          "<string>UIInterfaceOrientationLandscapeLeft</string>\n<string>UIInterfaceOrientationLandscapeRight</string>\n</array>",
      ),
    );
    write(
      `${name}/ios/App/App.xcodeproj/project.pbxproj`,
      [
        // A widget extension listed first: its bundle id and device family must not win.
        "buildSettings = {\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.rally.widget;\n\t\t\t\tTARGETED_DEVICE_FAMILY = 1;\n\t\t\t};",
        'buildSettings = {\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.rally;\n\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";\n\t\t\t};',
      ].join("\n"),
    );
    fs.mkdirSync(path.join(ws, name, "fastlane", "metadata", "en-US"), { recursive: true });
    fs.mkdirSync(path.join(ws, name, "fastlane", "metadata", "de-DE"), { recursive: true });
    return path.join(ws, name);
  }

  it("reads a Capacitor game: name, bundle id, landscape and iPad from its native project", () => {
    const p = inspectApp(capacitorGame());
    expect(p).toMatchObject({
      kind: "capacitor",
      hasConfig: false,
      projectName: "Rally",
      bundleId: "com.example.rally",
      locales: ["en-US", "de-DE"],
      defaultLocale: "en-US",
      orientation: "landscape",
      ipad: true,
      play: false,
      targets: ["iphone-6.9-2868x1320", "iphone-6.1-2622x1206", "ipad-13-2752x2064"],
    });
    expect(p.sources.orientation).toBe("Info.plist UISupportedInterfaceOrientations");
    expect(p.sources.ipad).toBe("Xcode project TARGETED_DEVICE_FAMILY");
  });

  it("prefers app.json for Expo apps, and only adds iPad and Play when the app ships there", () => {
    const root = path.join(ws, "expo");
    writeJson(path.join(root, "app.json"), {
      expo: {
        name: "Calm",
        orientation: "portrait",
        ios: { bundleIdentifier: "com.example.calm", supportsTablet: false },
        android: { package: "com.example.calm" },
      },
    });
    let p = inspectApp(root);
    expect(p).toMatchObject({ kind: "expo", projectName: "Calm", orientation: "portrait", ipad: false, play: false });
    expect(p.targets).toEqual(["iphone-6.9-1320x2868", "iphone-6.1-1206x2622"]);
    fs.mkdirSync(path.join(root, "fastlane", "metadata", "android", "en-US"), { recursive: true });
    p = inspectApp(root);
    expect(p.play).toBe(true);
    expect(p.targets).toContain("play-phone-1080x1920");
  });

  it("maps a native app's languages to store locales", () => {
    write(
      "native/ios/Notes/Info.plist",
      plist(
        "<key>CFBundleName</key>\n<string>$(PRODUCT_NAME)</string>\n" +
          "<key>CFBundleLocalizations</key>\n<array>\n<string>en</string>\n<string>de</string>\n</array>",
      ),
    );
    const p = inspectApp(path.join(ws, "native"));
    expect(p.kind).toBe("native-ios");
    expect(p.projectName).toBe("native"); // a build-setting placeholder is not a name
    expect(p.locales).toContain("de-DE");
    expect(p.locales[0]).toBe("en-US");
  });

  it("refuses folders that are not apps, and the tool itself", () => {
    fs.mkdirSync(path.join(ws, "notes"));
    expect(() => inspectApp(path.join(ws, "notes"))).toThrow(ImportError);
    expect(() => inspectApp(path.join(ws, "missing"))).toThrow(/not a directory/);
    expect(() => inspectApp(path.resolve(import.meta.dirname, ".."))).toThrow(/store-shots itself/);
  });

  it("writes the reviewed choices, adds the app to the list, and leaves an existing config alone", () => {
    const root = capacitorGame();
    const result = importApp({ root, projectName: "Rally Pro", locales: ["en-US"], ipad: false });
    expect(result.registeredOnly).toBe(false);
    expect(result.entry).toMatchObject({ root, name: "game" });
    const project = loadProject(path.join(root, "store-shots.config.json"));
    expect(project.config).toMatchObject({
      projectName: "Rally Pro",
      bundleId: "com.example.rally",
      locales: ["en-US"],
      targets: ["iphone-6.9-2868x1320", "iphone-6.1-2622x1206"],
    });
    // Raw-capture folders only for the devices the targets use.
    expect(fs.readdirSync(path.join(root, "store", "raw"))).toEqual(["iphone"]);
    expect(listRegistered().map((p) => p.root)).toEqual([root]);

    const configBefore = fs.readFileSync(path.join(root, "store-shots.config.json"), "utf8");
    const again = importApp({ root, projectName: "Something else" });
    expect(again.registeredOnly).toBe(true);
    expect(fs.readFileSync(path.join(root, "store-shots.config.json"), "utf8")).toBe(configBefore);
    expect(listRegistered()).toHaveLength(1);
    expect(inspectApp(root).registeredAs).toBe("game");
  });

  it("adds an app that is already set up without rewriting it", () => {
    const fx = tempFixture();
    try {
      const before = fs.readFileSync(path.join(fx.root, "store-shots.config.json"), "utf8");
      const p = inspectApp(fx.root);
      expect(p.hasConfig).toBe(true);
      const result = importApp({ root: fx.root });
      expect(result.registeredOnly).toBe(true);
      expect(fs.readFileSync(path.join(fx.root, "store-shots.config.json"), "utf8")).toBe(before);
    } finally {
      fx.cleanup();
    }
  });

  it("keeps the apps the scan was showing when the first app is imported", () => {
    const configured = path.join(ws, "configured");
    fs.cpSync(FIXTURE_ROOT, configured, { recursive: true });
    const game = capacitorGame();
    expect(inspectApp(game).notes.join("\n")).toMatch(/none disappear/);
    importApp({ root: game });
    expect(
      listRegistered()
        .map((p) => p.root)
        .sort(),
    ).toEqual([configured, game].sort());
  });

  it("uses a default locale that is in the chosen locales", () => {
    const root = capacitorGame();
    importApp({ root, locales: ["de-DE", "fr-FR"] });
    expect(loadProject(path.join(root, "store-shots.config.json")).config.defaultLocale).toBe("de-DE");
  });

  it("lists apps next to the tool that are not in the list yet", () => {
    const game = capacitorGame();
    writeJson(path.join(ws, "group", "calm", "app.json"), { expo: { name: "Calm" } });
    write("docs/readme.md", "not an app");
    expect(findImportCandidates(ws).map((c) => [c.name, c.kind])).toEqual([
      ["game", "capacitor"],
      [path.join("group", "calm"), "expo"],
    ]);
    importApp({ root: game });
    expect(findImportCandidates(ws).map((c) => c.name)).toEqual([path.join("group", "calm")]);
  });
});
