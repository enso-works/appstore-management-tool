import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProject } from "../lib/config";
import { validateProject } from "../lib/validate";
import { buildRenderPlan } from "../lib/render-plan";
import { resolveFontStack } from "../lib/fonts";
import { inputsHash, templatesSourceHash, readToolVersion } from "../lib/generate";
import { appVersionOf, readSignoffs, releaseStatus, setSignoff } from "../lib/release";
import { editJson, tempFixture } from "./helpers";

describe("release", () => {
  let fx: { root: string; cleanup: () => void };
  beforeEach(() => {
    fx = tempFixture();
  });
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("reads the app version and persists sign-offs per version", () => {
    const project = load();
    expect(appVersionOf(project)).toBe("1.2.0");
    expect(readSignoffs(project).signoffs).toEqual({});

    setSignoff(project, "en-US", true);
    setSignoff(project, "ar-SA", true);
    expect(Object.keys(readSignoffs(project).signoffs).sort()).toEqual(["ar-SA", "en-US"]);
    expect(readSignoffs(project).appVersion).toBe("1.2.0");
    expect(releaseStatus(project).signoffsStale).toBe(false);

    setSignoff(project, "ar-SA", false);
    expect(Object.keys(readSignoffs(project).signoffs)).toEqual(["en-US"]);

    // A version bump invalidates existing sign-offs; the next write resets them.
    editJson(path.join(fx.root, "app.json"), (a) => {
      (a as { expo: { version: string } }).expo.version = "1.3.0";
    });
    expect(releaseStatus(load()).signoffsStale).toBe(true);
    setSignoff(load(), "en-US", true);
    const after = readSignoffs(load());
    expect(after.appVersion).toBe("1.3.0");
    expect(Object.keys(after.signoffs)).toEqual(["en-US"]);
  });

  it("marks planned outputs missing before any generate", () => {
    const status = releaseStatus(load());
    expect(status.appVersion).toBe("1.2.0");
    expect(status.generatedAt).toBeUndefined();
    // 2 targets x 2 locales, 2 screens each.
    expect(status.sets).toHaveLength(4);
    for (const set of status.sets) {
      expect(set.shots).toHaveLength(2);
      expect(set.shots.every((s) => s.state === "missing")).toBe(true);
      expect(set.missing).toBe(2);
    }
  });

  it("marks a shot blocked when its raw capture is gone", () => {
    fs.rmSync(path.join(fx.root, "store", "raw", "iphone", "ar-SA", "01-home.png"));
    const status = releaseStatus(load());
    const set = status.sets.find((s) => s.target === "iphone-6.9-1320x2868" && s.locale === "ar-SA")!;
    const home = set.shots.find((s) => s.screen === "home")!;
    expect(home.state).toBe("blocked");
    expect(home.reason).toBeTruthy();
  });

  it("tracks ok -> stale with the renderer's inputs hash", () => {
    const project = load();
    const validation = validateProject(project);
    const plan = buildRenderPlan(project, validation.manifest!);
    const job = plan.find((j) => j.target.id === "iphone-6.9-1320x2868" && j.locale === "en-US" && j.screen.id === "home")!;
    const { stack } = resolveFontStack(project);
    const hash = inputsHash(
      project,
      job,
      validation.content.get("en-US")!,
      readToolVersion(),
      stack.flatMap((f) => f.files.map((x) => x.sha256)),
      templatesSourceHash(),
    );
    fs.mkdirSync(path.dirname(job.outputPath), { recursive: true });
    fs.writeFileSync(job.outputPath, "png");
    const rel = path.relative(project.root, job.outputPath).split(path.sep).join("/");
    fs.writeFileSync(
      path.join(project.paths.outputScreenshots, ".store-shots-manifest.json"),
      JSON.stringify({
        version: 1,
        generatedAt: "2026-08-21T00:00:00.000Z",
        appVersion: "1.2.0",
        files: [
          { path: rel, target: job.target.id, locale: "en-US", screen: "home", slice: 0, sha256: "x", inputsSha256: hash },
        ],
      }),
    );

    const fresh = releaseStatus(load());
    expect(fresh.generatedAt).toBe("2026-08-21T00:00:00.000Z");
    const shot = () =>
      releaseStatus(load())
        .sets.find((s) => s.target === "iphone-6.9-1320x2868" && s.locale === "en-US")!
        .shots.find((s) => s.screen === "home")!;
    expect(shot().state).toBe("ok");

    // Editing the copy changes the inputs hash: the file on disk is now stale.
    editJson(path.join(fx.root, "store", "content", "en-US.json"), (c) => {
      (c as { screens: { home: { headline: string } } }).screens.home.headline = "Changed";
    });
    expect(shot().state).toBe("stale");
  });
});
