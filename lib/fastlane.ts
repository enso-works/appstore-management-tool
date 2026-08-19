import { spawn } from "node:child_process";
import fs from "node:fs";
import type { Project } from "./config";
import { readinessReport, type ReadinessReport } from "./readiness";

/**
 * Fastlane runner (plan §13.3). The tool never holds credentials: it only
 * spawns the app's own lanes, from the app's own directory, with the user's
 * own environment. Lanes come from an allowlist in the project config; build
 * and submit lanes are never offered.
 */
export type LaneKey = "validate" | "metadata" | "screenshots";

export const LANE_KEYS: LaneKey[] = ["validate", "metadata", "screenshots"];

/** Lanes that talk to App Store Connect and therefore need confirmation + a readiness gate. */
export const UPLOAD_LANES: ReadonlySet<LaneKey> = new Set(["metadata", "screenshots"]);

const FORBIDDEN_WORDS = /\b(beta|internal|submit|release|deliver|pilot|upload_to_testflight|upload_to_play_store)\b/i;

export interface LaneSpec {
  key: LaneKey;
  /** e.g. "ios validate_metadata" -> ["ios", "validate_metadata"] */
  args: string[];
  uploads: boolean;
}

export function laneSpec(project: Project, key: LaneKey): LaneSpec {
  const raw = project.config.fastlane.lanes[key];
  const args = raw.trim().split(/\s+/).filter(Boolean);
  if (args.length === 0 || args.length > 2)
    throw new Error(`fastlane.lanes.${key} must be "<platform> <lane>" or "<lane>"`);
  for (const a of args) {
    if (!/^[A-Za-z0-9_]+$/.test(a)) throw new Error(`fastlane.lanes.${key}: "${a}" is not a plain lane name`);
    if (FORBIDDEN_WORDS.test(a))
      throw new Error(`fastlane.lanes.${key}: "${a}" looks like a build/submit lane; the tool never runs those`);
  }
  return { key, args, uploads: UPLOAD_LANES.has(key) };
}

export function fastlaneBinary(): string | undefined {
  const candidates = [process.env.STORE_SHOTS_FASTLANE, "/opt/homebrew/bin/fastlane", "/usr/local/bin/fastlane"].filter(
    Boolean,
  ) as string[];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // Fall back to PATH lookup by spawn.
  return "fastlane";
}

export interface LanePreflight {
  spec: LaneSpec;
  readiness: ReadinessReport;
  /** Upload lanes are blocked when readiness fails, unless overridden. */
  blocked: boolean;
  reasons: string[];
}

export function preflightLane(project: Project, key: LaneKey): LanePreflight {
  const spec = laneSpec(project, key);
  const readiness = readinessReport(project);
  const reasons: string[] = [];
  if (!project.config.fastlane.enabled) reasons.push("fastlane.enabled is false in store-shots.config.json");
  const fastfile = `${project.root}/fastlane/Fastfile`;
  if (!fs.existsSync(fastfile)) reasons.push("fastlane/Fastfile missing");
  else {
    const laneName = spec.args[spec.args.length - 1];
    const text = fs.readFileSync(fastfile, "utf8");
    if (!new RegExp(`lane\\s+:${laneName}\\b`).test(text)) {
      reasons.push(
        `lane "${laneName}" not found in fastlane/Fastfile (copy it from starter-template/fastlane/Fastfile)`,
      );
    }
  }
  if (spec.uploads) {
    const failing = readiness.checks.filter((c) => c.status === "fail");
    if (failing.length) reasons.push(`readiness failing: ${failing.map((c) => c.id).join(", ")}`);
  }
  return { spec, readiness, blocked: reasons.length > 0, reasons };
}

export interface RunLaneOptions {
  key: LaneKey;
  /** Required for upload lanes. */
  confirmed?: boolean;
  /** Run an upload lane despite failing readiness; the reason is logged. */
  overrideReason?: string;
  onLine?: (line: string, stream: "stdout" | "stderr" | "meta") => void;
  signal?: AbortSignal;
}

export interface RunLaneResult {
  key: LaneKey;
  command: string;
  exitCode: number | null;
  durationMs: number;
  lines: string[];
}

/**
 * Spawn `fastlane <args>` with cwd = app root. Output is streamed line by
 * line. Environment is inherited (PATH for Homebrew fastlane / rbenv Ruby)
 * plus a few flags that keep fastlane non-interactive and colourless; no
 * secret is ever read or injected by the tool.
 */
export function runLane(project: Project, opts: RunLaneOptions): Promise<RunLaneResult> {
  const pre = preflightLane(project, opts.key);
  if (pre.spec.uploads && !opts.confirmed) {
    return Promise.reject(new Error(`Lane "${opts.key}" uploads to App Store Connect; confirm explicitly`));
  }
  if (pre.blocked) {
    const hard = pre.reasons.filter((r) => !r.startsWith("readiness failing"));
    if (hard.length) return Promise.reject(new Error(hard.join("; ")));
    if (!opts.overrideReason)
      return Promise.reject(new Error(`Blocked: ${pre.reasons.join("; ")}. Fix readiness or pass an override reason.`));
  }
  const bin = fastlaneBinary();
  const command = `${bin} ${pre.spec.args.join(" ")}`;
  const started = Date.now();
  const lines: string[] = [];
  const emit = (line: string, stream: "stdout" | "stderr" | "meta") => {
    lines.push(line);
    opts.onLine?.(line, stream);
  };
  emit(`$ ${command}  (cwd: ${project.root})`, "meta");
  if (opts.overrideReason)
    emit(`override: running despite readiness failures — reason: ${opts.overrideReason}`, "meta");

  return new Promise<RunLaneResult>((resolve, reject) => {
    const child = spawn(bin!, pre.spec.args, {
      cwd: project.root,
      env: {
        ...process.env,
        FASTLANE_SKIP_UPDATE_CHECK: "1",
        FASTLANE_HIDE_CHANGELOG: "1",
        FASTLANE_DISABLE_COLORS: "1",
        FASTLANE_OPT_OUT_USAGE: "1",
        LANG: process.env.LANG ?? "en_US.UTF-8",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pump = (stream: NodeJS.ReadableStream, name: "stdout" | "stderr") => {
      let buf = "";
      stream.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          emit(buf.slice(0, i).replace(/\r$/, ""), name);
          buf = buf.slice(i + 1);
        }
      });
      stream.on("end", () => {
        if (buf) emit(buf, name);
      });
    };
    pump(child.stdout, "stdout");
    pump(child.stderr, "stderr");
    child.on("error", (err) => {
      emit(`failed to start fastlane: ${err.message}`, "meta");
      reject(err);
    });
    child.on("close", (code) => {
      emit(`exit ${code} after ${((Date.now() - started) / 1000).toFixed(1)} s`, "meta");
      resolve({ key: opts.key, command, exitCode: code, durationMs: Date.now() - started, lines });
    });
    opts.signal?.addEventListener("abort", () => child.kill("SIGTERM"));
  });
}
