import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureAll, captureScreen, listBootedSimulators, localeSwitchHint } from "../lib/capture";
import { loadProject } from "../lib/config";
import { encodeSolidPng } from "../lib/png-write";
import { editJson, tempFixture } from "./helpers";

const BOOTED = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-18-3": [
      { udid: "AAA", name: "iPhone 16 Pro Max", state: "Booted" },
      { udid: "BBB", name: "iPad Pro 13-inch (M4)", state: "Booted" },
      { udid: "CCC", name: "iPhone SE", state: "Shutdown" },
    ],
  },
});

function fakeExec() {
  return ((cmd: string, args: string[]) => {
    if (cmd === "xcrun" && args[1] === "list") return BOOTED;
    throw new Error(`unexpected exec ${cmd} ${args.join(" ")}`);
  }) as unknown as typeof import("node:child_process").execFileSync;
}

function fakeSpawn(calls: string[][], size: [number, number] = [660, 1434]) {
  return ((cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    if (args[1] === "io") {
      fs.writeFileSync(args[args.length - 1], encodeSolidPng({ width: size[0], height: size[1], color: [1, 2, 3] }));
    }
    return { status: 0, stdout: "", stderr: "" };
  }) as unknown as typeof import("node:child_process").spawnSync;
}

describe("capture helper", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("lists booted simulators with their family", () => {
    const sims = listBootedSimulators(fakeExec());
    expect(sims.map((s) => `${s.family}:${s.name}`)).toEqual([
      "iPhone:iPhone 16 Pro Max",
      "iPad:iPad Pro 13-inch (M4)",
    ]);
  });

  it("captures into the manifest path, picks the right family, and refuses to overwrite", () => {
    const calls: string[][] = [];
    fs.rmSync(path.join(fx.root, "store/raw/ipad/en-US/01-home.png"));
    const r = captureScreen(load(), {
      device: "ipad",
      locale: "en-US",
      screenId: "home",
      exec: fakeExec(),
      spawn: fakeSpawn(calls, [1032, 1376]),
    });
    expect(r.simulator.udid).toBe("BBB");
    expect(r.file).toBe(path.join(fx.root, "store/raw/ipad/en-US/01-home.png"));
    expect(calls[0].slice(0, 4)).toEqual(["xcrun", "simctl", "io", "BBB"]);
    expect(r.aspectWarning).toBeUndefined();
    expect(() =>
      captureScreen(load(), {
        device: "ipad",
        locale: "en-US",
        screenId: "home",
        exec: fakeExec(),
        spawn: fakeSpawn(calls),
      }),
    ).toThrow(/already exists/);
  });

  it("warns when the simulator aspect does not match the target", () => {
    const calls: string[][] = [];
    const r = captureScreen(load(), {
      device: "iphone",
      locale: "ar-SA",
      screenId: "home",
      exec: fakeExec(),
      spawn: fakeSpawn(calls, [100, 100]),
      force: true,
    });
    expect(r.aspectWarning).toMatch(/needs 0.460/);
  });

  it("refuses a non-default locale for a non-localized screen and unknown screens", () => {
    expect(() =>
      captureScreen(load(), {
        device: "iphone",
        locale: "ar-SA",
        screenId: "planning",
        exec: fakeExec(),
        spawn: fakeSpawn([]),
      }),
    ).toThrow(/localized=false/);
    expect(() =>
      captureScreen(load(), {
        device: "iphone",
        locale: "en-US",
        screenId: "nope",
        exec: fakeExec(),
        spawn: fakeSpawn([]),
      }),
    ).toThrow(/not in store\/manifest.json/);
  });

  it("sets a clean status bar when asked", () => {
    const calls: string[][] = [];
    captureScreen(load(), {
      device: "iphone",
      locale: "en-US",
      screenId: "home",
      exec: fakeExec(),
      spawn: fakeSpawn(calls),
      force: true,
      cleanStatusBar: true,
    });
    expect(calls[0].slice(0, 5)).toEqual(["xcrun", "simctl", "status_bar", "AAA", "override"]);
    expect(calls[0]).toContain("9:41");
  });

  it("asks for --udid when several simulators of the family are booted", () => {
    const two = JSON.stringify({
      devices: {
        rt: [
          { udid: "A", name: "iPhone 15", state: "Booted" },
          { udid: "B", name: "iPhone 16", state: "Booted" },
        ],
      },
    });
    const exec = ((_c: string, args: string[]) =>
      args[1] === "list" ? two : "") as unknown as typeof import("node:child_process").execFileSync;
    expect(() =>
      captureScreen(load(), {
        device: "iphone",
        locale: "en-US",
        screenId: "home",
        exec,
        spawn: fakeSpawn([]),
        force: true,
      }),
    ).toThrow(/pass --udid/);
    editJson(path.join(fx.root, "store/manifest.json"), (m) => m);
  });

  it("prints locale switch commands", () => {
    expect(localeSwitchHint("AAA", "de-DE")[1]).toContain("de_DE");
  });
});

describe("capture --all", () => {
  let fx: ReturnType<typeof tempFixture>;
  beforeEach(() => (fx = tempFixture()));
  afterEach(() => fx.cleanup());
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));

  it("opens each deep link, waits, captures in order, and skips screens without one", async () => {
    editJson(path.join(fx.root, "store/manifest.json"), (m) => {
      m.screens[0].source.deepLink = "demo://home";
    });
    const calls: string[][] = [];
    const sleeps: number[] = [];
    const r = await captureAll(load(), {
      device: "iphone",
      locale: "en-US",
      exec: fakeExec(),
      spawn: fakeSpawn(calls),
      settleSeconds: 0.01,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(r.captured).toHaveLength(1);
    expect(r.skipped).toEqual([{ screenId: "planning", reason: "no source.deepLink in the manifest" }]);
    expect(calls.some((c) => c[2] === "openurl" && c[4] === "demo://home")).toBe(true);
    expect(sleeps).toEqual([10]);
    const openIdx = calls.findIndex((c) => c[2] === "openurl");
    const shotIdx = calls.findIndex((c) => c[2] === "io");
    expect(openIdx).toBeLessThan(shotIdx);
  });

  it("skips non-default locales for non-localized screens", async () => {
    editJson(path.join(fx.root, "store/manifest.json"), (m) => {
      m.screens[1].source.deepLink = "demo://planning";
    });
    const r = await captureAll(load(), {
      device: "iphone",
      locale: "ar-SA",
      exec: fakeExec(),
      spawn: fakeSpawn([]),
      sleep: async () => {},
    });
    expect(r.captured).toHaveLength(0);
    expect(r.skipped.find((sk) => sk.screenId === "planning")?.reason).toMatch(/localized=false/);
  });
});
