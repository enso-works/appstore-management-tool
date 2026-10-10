import { handle, json } from "@/lib/server/http";
import { requireProject } from "@/lib/server/projects";
import { generateProject } from "@/lib/generate";
import type { PlanFilter } from "@/lib/render-plan";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

type Ctx = { params: Promise<{ name: string }> };

/**
 * POST { filter?, strict?, stream? } -> GenerationSummary. Runs the same
 * pipeline as the CLI. With `stream: true` the answer is server-sent events
 * instead: `progress` ({ done, total, key, status }) after each job, `log`
 * ({ line }) for each log line, then `done` with the summary (or `error`).
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json().catch(() => ({}))) as { filter?: PlanFilter; strict?: boolean; stream?: boolean };
    const log: string[] = [];
    if (!body.stream) {
      const summary = await generateProject(project, {
        filter: body.filter,
        strict: body.strict,
        log: (l) => log.push(l),
      });
      return json({ ...summary, log });
    }
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        try {
          const summary = await generateProject(project, {
            filter: body.filter,
            strict: body.strict,
            log: (line) => {
              log.push(line);
              send("log", { line });
            },
            onProgress: (p) => send("progress", p),
          });
          send("done", { ...summary, log });
        } catch (err) {
          send("error", { error: (err as Error).message });
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store" },
    });
  });
}
