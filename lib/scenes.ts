import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Project } from "./config";
import { dirExists, fileExists } from "./paths";
import type { SceneStep } from "./schema";

/**
 * The art pipeline behind store/assets (`store-shots scenes`): the steps in
 * the config's `scenes` run in order, Blender ones headless with a factory
 * startup, Python ones isolated. A step is skipped while its scripts, inputs
 * and definition are unchanged since its last run and its outputs exist,
 * since a Cycles render takes minutes. Once a step runs, the selected steps
 * that read its output run too: those that list it in `needs`, or, without
 * `needs`, every step after it.
 *
 * Scripts get their paths from arguments (`{root}`, `{work}`, `{assets}`) or
 * the environment: STORE_SHOTS_ROOT, STORE_SHOTS_WORK, STORE_SHOTS_ASSETS,
 * and STORE_SHOTS_QUICK=1 for a quick look. A quick run writes its "assets"
 * under the work folder and records nothing, so it never replaces real art.
 */

export interface SceneDirs {
  root: string;
  /** Intermediate renders and logs (gitignored, under store/generated). */
  work: string;
  /** Where final art goes: store/assets, or a scratch folder for a quick run. */
  assets: string;
}

export interface StepPlan {
  step: SceneStep;
  hash: string;
  run: boolean;
  /** Why it runs or is skipped, for the list and the log. */
  reason: string;
}

export interface StepResult {
  id: string;
  ok: boolean;
  skipped: boolean;
  seconds: number;
  log?: string;
  /** The last lines of the log, when it failed. */
  tail?: string[];
}

export class ScenesError extends Error {}

export function sceneSteps(project: Project): SceneStep[] {
  return project.config.scenes?.steps ?? [];
}

export function sceneDirs(project: Project, quick = false): SceneDirs {
  const work = path.join(project.paths.generated, "scenes");
  // A quick run keeps its drafts apart, so a real run never mistakes them for its own renders.
  if (quick) return { root: project.root, work: path.join(work, "quick"), assets: path.join(work, "quick", "assets") };
  return { root: project.root, work, assets: project.paths.assets };
}

function statePath(project: Project): string {
  return path.join(sceneDirs(project).work, "state.json");
}

function readState(project: Project): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(statePath(project), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeState(project: Project, state: Record<string, string>) {
  fs.mkdirSync(path.dirname(statePath(project)), { recursive: true });
  fs.writeFileSync(statePath(project), JSON.stringify(state, null, 2) + "\n");
}

function scriptOf(step: SceneStep): string {
  return (step.blender ?? step.python)!;
}

/**
 * What a step depends on: its definition, every file in its script's folder
 * (the shared helpers live there), and its inputs. Large inputs (models) are
 * fingerprinted by size and modification time, scripts by content.
 */
export function stepHash(project: Project, step: SceneStep): string {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify(step));
  const scriptDir = path.dirname(path.join(project.root, scriptOf(step)));
  const add = (abs: string, byContent: boolean) => {
    if (fileExists(abs)) {
      const st = fs.statSync(abs);
      h.update(path.relative(project.root, abs));
      h.update(byContent && st.size < 4_000_000 ? fs.readFileSync(abs) : `${st.size}:${st.mtimeMs}`);
    } else if (dirExists(abs)) {
      for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (e.name.startsWith(".") || e.name === "__pycache__") continue;
        add(path.join(abs, e.name), byContent);
      }
    } else {
      h.update(`missing:${path.relative(project.root, abs)}`);
    }
  };
  if (dirExists(scriptDir)) {
    for (const f of fs.readdirSync(scriptDir).sort()) {
      if (f.endsWith(".py")) add(path.join(scriptDir, f), true);
    }
  }
  add(path.join(project.root, scriptOf(step)), true);
  for (const input of step.inputs) add(path.join(project.root, input), false);
  return h.digest("hex").slice(0, 16);
}

/** Every step that reads `id`'s output, directly or through another step. */
function dependants(steps: SceneStep[], id: string): string[] {
  const out = new Set<string>();
  const reads = (s: SceneStep, i: number, dep: string) => (s.needs ?? steps.slice(0, i).map((e) => e.id)).includes(dep);
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const dep of frontier) {
      steps.forEach((s, i) => {
        if (!out.has(s.id) && reads(s, i, dep)) {
          out.add(s.id);
          next.push(s.id);
        }
      });
    }
    frontier = next;
  }
  return [...out];
}

/** Which of the selected steps would run, and why. */
export function planScenes(project: Project, opts: { only?: string[]; force?: boolean } = {}): StepPlan[] {
  const steps = sceneSteps(project);
  if (steps.length === 0) throw new ScenesError('This app has no "scenes" in store-shots.config.json.');
  const ids = new Set<string>();
  for (const s of steps) {
    if (ids.has(s.id)) throw new ScenesError(`Two scene steps are called "${s.id}".`);
    ids.add(s.id);
  }
  const unknown = (opts.only ?? []).filter((id) => !ids.has(id));
  if (unknown.length) {
    throw new ScenesError(`No scene step ${unknown.map((u) => `"${u}"`).join(", ")}. Steps: ${[...ids].join(", ")}`);
  }
  for (const [i, s] of steps.entries()) {
    const later = (s.needs ?? []).find((n) => !steps.slice(0, i).some((e) => e.id === n));
    if (later) throw new ScenesError(`Scene step "${s.id}" needs "${later}", which is not an earlier step.`);
  }
  const state = readState(project);
  const ran = new Set<string>();
  const plan: StepPlan[] = [];
  for (const [i, step] of steps.entries()) {
    if (opts.only?.length && !opts.only.includes(step.id)) continue;
    const hash = stepHash(project, step);
    const missing = step.outputs.filter((o) => !fileExists(path.join(project.root, o)));
    const upstream = (step.needs ?? steps.slice(0, i).map((s) => s.id)).find((n) => ran.has(n));
    const reason = opts.force
      ? "forced"
      : !state[step.id]
        ? "never ran"
        : state[step.id].startsWith("stale:")
          ? `${state[step.id].slice(6)} ran since`
          : state[step.id] !== hash
            ? "its scripts or inputs changed"
            : missing.length
              ? `missing ${missing[0]}${missing.length > 1 ? ` and ${missing.length - 1} more` : ""}`
              : upstream
                ? `${upstream} ran`
                : "";
    const run = reason !== "";
    if (run) ran.add(step.id);
    plan.push({ step, hash, run, reason: reason || "up to date" });
  }
  return plan;
}

/** The Blender binary: config, $BLENDER, the usual macOS app, or `blender` on PATH. */
export function findBlender(project: Project): string | undefined {
  const configured = project.config.scenes?.blender ?? process.env.BLENDER;
  if (configured) return fileExists(configured) ? configured : undefined;
  const mac = "/Applications/Blender.app/Contents/MacOS/Blender";
  if (fileExists(mac)) return mac;
  const which = spawnSync("which", ["blender"], { encoding: "utf8" });
  return which.status === 0 && which.stdout.trim() ? which.stdout.trim() : undefined;
}

export function expandArgs(args: string[], dirs: SceneDirs): string[] {
  return args.map((a) =>
    a.replaceAll("{root}", dirs.root).replaceAll("{work}", dirs.work).replaceAll("{assets}", dirs.assets),
  );
}

/**
 * Run a script with its own folder first on sys.path, so it can import its
 * helpers by name without a hard-coded path. Python literals are written as
 * JSON strings, which Python reads the same way.
 */
function bootstrap(script: string): string {
  const s = JSON.stringify(script);
  const d = JSON.stringify(path.dirname(script));
  return `import sys; sys.path.insert(0, ${d}); __file__ = ${s}; exec(compile(open(${s}, encoding="utf-8").read(), ${s}, "exec"))`;
}

/** The command line for a step (exported for tests and `scenes list`). */
export function stepCommand(
  project: Project,
  step: SceneStep,
  dirs: SceneDirs,
  blender: string | undefined,
): { cmd: string; args: string[] } {
  const script = path.join(project.root, scriptOf(step));
  const args = expandArgs(step.args, dirs);
  if (step.blender) {
    if (!blender) throw new ScenesError("Blender not found. Install it, or set scenes.blender or $BLENDER.");
    return { cmd: blender, args: ["-b", "--factory-startup", "--python-expr", bootstrap(script), "--", ...args] };
  }
  const python = process.env.PYTHON ?? "python3";
  // -c leaves sys.argv[0] as "-c"; the bootstrap runs the script as if it were argv[0].
  return {
    cmd: python,
    args: ["-I", "-c", `import sys; sys.argv[0] = ${JSON.stringify(script)}; ${bootstrap(script)}`, ...args],
  };
}

/** Run the planned steps in order; stop at the first failure. */
export async function renderScenes(
  project: Project,
  opts: {
    only?: string[];
    force?: boolean;
    quick?: boolean;
    /** Stream each step's output instead of only logging it. */
    verbose?: boolean;
    onStep?: (plan: StepPlan) => void;
    onLine?: (line: string) => void;
  } = {},
): Promise<StepResult[]> {
  const plan = planScenes(project, { only: opts.only, force: opts.force || opts.quick });
  const dirs = sceneDirs(project, opts.quick);
  fs.mkdirSync(dirs.work, { recursive: true });
  fs.mkdirSync(dirs.assets, { recursive: true });
  const blender = plan.some((p) => p.run && p.step.blender) ? findBlender(project) : undefined;
  const state = readState(project);
  const results: StepResult[] = [];
  for (const p of plan) {
    opts.onStep?.(p);
    if (!p.run) {
      results.push({ id: p.step.id, ok: true, skipped: true, seconds: 0 });
      continue;
    }
    const { cmd, args } = stepCommand(project, p.step, dirs, blender);
    const log = path.join(dirs.work, `${p.step.id}.log`);
    const started = Date.now();
    const code = await runLogged(cmd, args, {
      cwd: project.root,
      log,
      env: {
        ...process.env,
        STORE_SHOTS_ROOT: dirs.root,
        STORE_SHOTS_WORK: dirs.work,
        STORE_SHOTS_ASSETS: dirs.assets,
        STORE_SHOTS_QUICK: opts.quick ? "1" : "",
      },
      onLine: opts.verbose ? opts.onLine : undefined,
    });
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const missing = opts.quick ? [] : p.step.outputs.filter((o) => !fileExists(path.join(project.root, o)));
    if (code !== 0 || missing.length) {
      const tail = fs.readFileSync(log, "utf8").trimEnd().split("\n").slice(-30);
      if (code === 0) tail.push(`(exited 0 but did not write ${missing.join(", ")})`);
      results.push({ id: p.step.id, ok: false, skipped: false, seconds, log, tail });
      // A failed step leaves its outputs suspect: it runs again next time.
      delete state[p.step.id];
      if (!opts.quick) writeState(project, state);
      break;
    }
    results.push({ id: p.step.id, ok: true, skipped: false, seconds, log });
    if (!opts.quick) {
      state[p.step.id] = p.hash;
      // Steps that read this one's output and did not run now are out of date, in later runs too.
      for (const d of dependants(sceneSteps(project), p.step.id)) {
        if (state[d] && !results.some((r) => r.id === d && !r.skipped)) state[d] = `stale:${p.step.id}`;
      }
      writeState(project, state);
    }
  }
  return results;
}

function runLogged(
  cmd: string,
  args: string[],
  opts: { cwd: string; log: string; env: NodeJS.ProcessEnv; onLine?: (line: string) => void },
): Promise<number> {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(opts.log);
    out.write(`$ ${[cmd, ...args].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}\n\n`);
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, stdio: ["ignore", "pipe", "pipe"] });
    let partial = "";
    const onData = (chunk: Buffer) => {
      out.write(chunk);
      if (!opts.onLine) return;
      const lines = (partial + chunk.toString("utf8")).split("\n");
      partial = lines.pop() ?? "";
      for (const l of lines) opts.onLine(l);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    // A command that cannot start emits "error" and may also emit "close"; settle once.
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      out.end(() => resolve(code));
    };
    child.on("error", (err) => {
      out.write(`\n${err.message}\n`);
      finish(127);
    });
    child.on("close", (code) => {
      if (partial && opts.onLine) opts.onLine(partial);
      finish(code ?? 1);
    });
  });
}
