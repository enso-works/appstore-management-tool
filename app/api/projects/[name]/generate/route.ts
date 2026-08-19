import { handle, json } from "@/lib/server/http";
import { requireProject } from "@/lib/server/projects";
import { generateProject } from "@/lib/generate";
import type { PlanFilter } from "@/lib/render-plan";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

type Ctx = { params: Promise<{ name: string }> };

/** POST { filter?, strict? } -> GenerationSummary. Runs the same pipeline as the CLI. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json().catch(() => ({}))) as { filter?: PlanFilter; strict?: boolean };
    const log: string[] = [];
    const summary = await generateProject(project, {
      filter: body.filter,
      strict: body.strict,
      log: (l) => log.push(l),
    });
    return json({ ...summary, log });
  });
}
