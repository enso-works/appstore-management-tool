import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadProject } from "../lib/config";
import { planScenes, renderScenes, stepCommand, sceneDirs, ScenesError } from "../lib/scenes";
import { editJson, tempFixture } from "./helpers";

// Two Python steps stand in for Blender: "render" writes an intermediate into
// the work folder, "post" turns it into an asset. Both import a helper from
// their own folder, the way Rallo's scripts share lib.py.
const HELPER = `def stamp(text):\n    return "made: " + text\n`;
const RENDER = `import os, sys\nfrom helper import stamp\nopen(os.path.join(sys.argv[1], "render.txt"), "w").write(stamp("render"))\n`;
const POST = `import os, sys\nsrc = open(os.path.join(os.environ["STORE_SHOTS_WORK"], "render.txt")).read()\nos.makedirs(os.path.join(os.environ["STORE_SHOTS_ASSETS"], "art"), exist_ok=True)\nopen(os.path.join(os.environ["STORE_SHOTS_ASSETS"], "art", "out.txt"), "w").write(src + (" quick" if os.environ.get("STORE_SHOTS_QUICK") else ""))\n`;

describe("scenes", () => {
  let fx: ReturnType<typeof tempFixture>;
  const config = () => path.join(fx.root, "store-shots.config.json");
  const project = () => loadProject(config());
  const scenesDir = () => path.join(fx.root, "store", "scenes");

  beforeEach(() => {
    fx = tempFixture();
    fs.mkdirSync(scenesDir(), { recursive: true });
    fs.writeFileSync(path.join(scenesDir(), "helper.py"), HELPER);
    fs.writeFileSync(path.join(scenesDir(), "render.py"), RENDER);
    fs.writeFileSync(path.join(scenesDir(), "post.py"), POST);
    fs.mkdirSync(path.join(fx.root, "models"));
    fs.writeFileSync(path.join(fx.root, "models", "player.glb"), "v1");
    editJson(config(), (c) => {
      c.scenes = {
        steps: [
          { id: "render", python: "store/scenes/render.py", args: ["{work}"], inputs: ["models"] },
          { id: "post", python: "store/scenes/post.py", outputs: ["store/assets/art/out.txt"] },
        ],
      };
    });
  });
  afterEach(() => fx.cleanup());

  const ran = (results: { id: string; skipped: boolean }[]) => results.filter((r) => !r.skipped).map((r) => r.id);

  it("runs every step the first time, then nothing until something changes", async () => {
    const first = await renderScenes(project());
    expect(first.every((r) => r.ok)).toBe(true);
    expect(ran(first)).toEqual(["render", "post"]);
    expect(fs.readFileSync(path.join(fx.root, "store/assets/art/out.txt"), "utf8")).toBe("made: render");
    expect(ran(await renderScenes(project()))).toEqual([]);
  });

  it("re-runs a step whose input or shared helper changed, and every step after it", async () => {
    await renderScenes(project());
    fs.writeFileSync(path.join(fx.root, "models", "player.glb"), "v2-longer");
    expect(planScenes(project()).map((p) => [p.step.id, p.reason])).toEqual([
      ["render", "its scripts or inputs changed"],
      ["post", "render ran"],
    ]);
    await renderScenes(project());
    fs.appendFileSync(path.join(scenesDir(), "helper.py"), "# tweak\n");
    expect(ran(await renderScenes(project()))).toEqual(["render", "post"]);
  });

  it("re-runs only the steps that need one that ran", async () => {
    editJson(config(), (c) => {
      c.scenes.steps.splice(1, 0, { id: "other", python: "store/scenes/post.py", needs: [] });
      c.scenes.steps[2].needs = ["render"];
    });
    await renderScenes(project());
    fs.writeFileSync(path.join(fx.root, "models", "player.glb"), "v2-longer");
    expect(ran(await renderScenes(project()))).toEqual(["render", "post"]);
    editJson(config(), (c) => {
      c.scenes.steps[1].needs = ["post"];
    });
    expect(() => planScenes(project())).toThrow(/not an earlier step/);
  });

  it("leaves the steps after one run on its own out of date until they run", async () => {
    await renderScenes(project());
    fs.writeFileSync(path.join(fx.root, "models", "player.glb"), "v2-longer");
    expect(ran(await renderScenes(project(), { only: ["render"] }))).toEqual(["render"]);
    expect(planScenes(project()).map((p) => [p.step.id, p.reason])).toEqual([
      ["render", "up to date"],
      ["post", "render ran since"],
    ]);
  });

  it("re-runs a step whose output is missing", async () => {
    await renderScenes(project());
    fs.rmSync(path.join(fx.root, "store/assets/art/out.txt"));
    expect(ran(await renderScenes(project()))).toEqual(["post"]);
  });

  it("runs only the named steps", async () => {
    await renderScenes(project());
    expect(ran(await renderScenes(project(), { only: ["post"], force: true }))).toEqual(["post"]);
    await expect(renderScenes(project(), { only: ["nope"] })).rejects.toThrow(ScenesError);
  });

  it("stops at a failing step, keeps its log, and runs it again next time", async () => {
    fs.writeFileSync(path.join(scenesDir(), "render.py"), "raise SystemExit('no models')\n");
    const results = await renderScenes(project());
    expect(results.map((r) => [r.id, r.ok])).toEqual([["render", false]]);
    expect(results[0].tail?.join("\n")).toContain("no models");
    expect(fs.existsSync(results[0].log!)).toBe(true);
    expect(planScenes(project())[0].reason).toBe("never ran");
  });

  it("fails a step that exits 0 without writing its outputs", async () => {
    fs.writeFileSync(path.join(scenesDir(), "post.py"), "pass\n");
    const results = await renderScenes(project());
    expect(results.at(-1)).toMatchObject({ id: "post", ok: false });
    expect(results.at(-1)?.tail?.at(-1)).toContain("did not write store/assets/art/out.txt");
  });

  it("a quick run leaves store/assets and the recorded state alone", async () => {
    const results = await renderScenes(project(), { quick: true });
    expect(results.every((r) => r.ok)).toBe(true);
    expect(fs.existsSync(path.join(fx.root, "store/assets/art/out.txt"))).toBe(false);
    const quick = path.join(sceneDirs(project(), true).assets, "art", "out.txt");
    // Its intermediates are apart from a real run's, which still has everything to do.
    expect(fs.existsSync(path.join(sceneDirs(project()).work, "render.txt"))).toBe(false);
    expect(fs.readFileSync(quick, "utf8")).toBe("made: render quick");
    expect(planScenes(project()).every((p) => p.run)).toBe(true);
  });

  it("runs Blender headless with the script's folder importable and its arguments after --", () => {
    editJson(config(), (c) => {
      c.scenes.steps[0] = { id: "render", blender: "store/scenes/render.py", args: ["{work}", "0.25"] };
    });
    const p = project();
    const dirs = sceneDirs(p);
    const { cmd, args } = stepCommand(p, p.config.scenes!.steps[0], dirs, "/opt/blender");
    expect(cmd).toBe("/opt/blender");
    expect(args.slice(0, 3)).toEqual(["-b", "--factory-startup", "--python-expr"]);
    expect(args[3]).toContain(`sys.path.insert(0, ${JSON.stringify(scenesDir())})`);
    expect(args.slice(4)).toEqual(["--", dirs.work, "0.25"]);
    expect(() => stepCommand(p, p.config.scenes!.steps[0], dirs, undefined)).toThrow(/Blender not found/);
  });

  it("rejects a step with both or neither of blender and python", () => {
    editJson(config(), (c) => {
      c.scenes.steps[0] = { id: "render", blender: "a.py", python: "b.py" };
    });
    expect(() => project()).toThrow(ConfigError);
  });
});
