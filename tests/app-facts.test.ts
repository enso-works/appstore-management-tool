import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appFacts } from "../lib/app-facts";
import { loadProject } from "../lib/config";
import { writeSolidPng } from "../lib/png-write";
import { readinessReport } from "../lib/readiness";
import { FIXTURE_ROOT } from "./helpers";

describe("app facts for apps without app.json", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-facts-"));
    // A Capacitor game: the store-shots project from the demo fixture, without its app.json.
    fs.cpSync(FIXTURE_ROOT, root, { recursive: true });
    fs.rmSync(path.join(root, "app.json"));
    fs.writeFileSync(
      path.join(root, "capacitor.config.ts"),
      "export default { appId: 'com.example.rally', appName: 'Rally' };\n",
    );
    const project = path.join(root, "ios/App/App.xcodeproj");
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, "project.pbxproj"),
      [
        "buildSettings = {\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.rally.widget;\n\t\t\t\tMARKETING_VERSION = 9.9;\n\t\t\t\tTARGETED_DEVICE_FAMILY = 1;\n\t\t\t};",
        'buildSettings = {\n\t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n\t\t\t\tMARKETING_VERSION = 2.3;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.example.rally;\n\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";\n\t\t\t};',
      ].join("\n"),
    );
    const set = path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
    fs.mkdirSync(set, { recursive: true });
    fs.writeFileSync(
      path.join(set, "Contents.json"),
      JSON.stringify({
        images: [
          {
            filename: "dark.png",
            idiom: "universal",
            platform: "ios",
            size: "1024x1024",
            appearances: [{ value: "dark" }],
          },
          { filename: "AppIcon-512@2x.png", idiom: "universal", platform: "ios", size: "1024x1024" },
        ],
      }),
    );
    writeSolidPng(path.join(set, "AppIcon-512@2x.png"), { width: 1024, height: 1024, color: [10, 60, 30] });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const check = (id: string) =>
    readinessReport(loadProject(path.join(root, "store-shots.config.json"))).checks.find((c) => c.id === id)!;

  it("reads the version, icon and iPad from the app target in the Xcode project", () => {
    const facts = appFacts(root);
    expect(facts.kind).toBe("capacitor");
    expect(facts.version).toEqual({ value: "2.3", source: "Xcode project MARKETING_VERSION" });
    expect(facts.icon?.value.rel).toBe(path.join("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"));
    expect(facts.ipad).toEqual({ value: true, source: "Xcode project TARGETED_DEVICE_FAMILY" });
  });

  it("passes readiness for the icon, version and iPad set without an app.json", () => {
    expect(check("icon").status).toBe("pass");
    expect(check("version").status).toBe("pass");
    expect(check("version").title).toBe("App version 2.3 consistent");
    expect(check("required-sizes").details.join("\n")).not.toMatch(/iPad/);
  });

  it("fails an icon with alpha, since nothing flattens it on the way to the store", () => {
    const icon = path.join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
    writeSolidPng(icon, { width: 1024, height: 1024, color: [10, 60, 30, 200] });
    expect(check("icon").status).toBe("fail");
    expect(check("icon").details.join("\n")).toMatch(/must be opaque/);
  });

  it("fails clearly when the icon set has no 1024 image", () => {
    fs.rmSync(path.join(root, "ios/App/App/Assets.xcassets"), { recursive: true });
    expect(check("icon").details[0]).toMatch(/no 1024x1024 image in the app icon set/);
  });
});
