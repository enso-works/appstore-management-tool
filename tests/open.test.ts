import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OpenError, openLink, resolveOpenTarget } from "../lib/open";
import { listRegistered, register } from "../lib/registered";

describe("store-shots open", () => {
  let dir: string;
  let home: string | undefined;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-open-"));
    home = process.env.STORE_SHOTS_HOME;
    process.env.STORE_SHOTS_HOME = path.join(dir, ".home");
  });
  afterEach(() => {
    if (home === undefined) delete process.env.STORE_SHOTS_HOME;
    else process.env.STORE_SHOTS_HOME = home;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const app = (name: string) => {
    const root = path.join(dir, name);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "store-shots.config.json"), "{}");
    return root;
  };

  it("links to the Mac app, with the app when there is one", () => {
    expect(openLink()).toBe("storeshots://open");
    expect(openLink("My App")).toBe("storeshots://open?app=My%20App");
  });

  it("finds the app by name, by folder, or the one you are standing in", () => {
    const root = app("rallo");
    register(root, "Rallo");
    expect(resolveOpenTarget("Rallo")).toBe("Rallo");
    expect(resolveOpenTarget(root)).toBe("Rallo");
    expect(resolveOpenTarget(undefined, path.join(root, "src"))).toBe("Rallo");
    expect(resolveOpenTarget(undefined, dir)).toBeUndefined();
  });

  it("adds an app with a config that is not in the list yet, and refuses anything else", () => {
    const root = app("fresh");
    expect(resolveOpenTarget(root)).toBe("fresh");
    expect(listRegistered().map((p) => p.name)).toContain("fresh");
    expect(() => resolveOpenTarget(path.join(dir, "nothing-here"))).toThrow(OpenError);
  });
});
