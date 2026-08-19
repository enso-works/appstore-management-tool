import { handle, json } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { LANE_KEYS, preflightLane, runLane, type LaneKey } from "@/lib/fastlane";

export const dynamic = "force-dynamic";
export const maxDuration = 1800;

type Ctx = { params: Promise<{ name: string }> };

function laneKey(v: string | null): LaneKey {
  if (!v || !(LANE_KEYS as string[]).includes(v))
    throw new HttpError(400, `lane must be one of ${LANE_KEYS.join(", ")}`);
  return v as LaneKey;
}

/** GET ?key=validate|metadata|screenshots -> preflight (command, uploads?, blocked?, reasons). */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const key = laneKey(new URL(req.url).searchParams.get("key"));
    const pre = preflightLane(project, key);
    return json({
      key,
      command: `fastlane ${pre.spec.args.join(" ")}`,
      uploads: pre.spec.uploads,
      blocked: pre.blocked,
      reasons: pre.reasons,
    });
  });
}

/**
 * POST { key, confirmed?, overrideReason? } -> streamed NDJSON lines
 * { stream: "stdout"|"stderr"|"meta", line } ... { done: true, exitCode }.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { key: string; confirmed?: boolean; overrideReason?: string };
    const key = laneKey(body.key);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const send = (obj: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          } catch {
            closed = true; // client went away
          }
        };
        const finish = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by cancel
          }
        };
        req.signal.addEventListener("abort", () => {
          closed = true;
        });
        let run: Promise<unknown>;
        try {
          run = runLane(project, {
            key,
            confirmed: body.confirmed,
            overrideReason: body.overrideReason,
            onLine: (line, s) => send({ stream: s, line }),
            signal: req.signal,
          });
        } catch (err) {
          run = Promise.reject(err);
        }
        run
          .then((r) => {
            const res = r as { exitCode: number | null; durationMs: number };
            send({ done: true, exitCode: res.exitCode, durationMs: res.durationMs });
            finish();
          })
          .catch((err: Error) => {
            send({ stream: "meta", line: `error: ${err.message}` });
            send({ done: true, exitCode: null, error: err.message });
            finish();
          });
      },
      cancel() {
        // client disconnected; runLane's abort signal (req.signal) kills the child
      },
    });
    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
    });
  });
}
