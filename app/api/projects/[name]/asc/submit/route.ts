import { handle, json, requireSameOrigin } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { AscAuthError, tokenSource } from "@/lib/asc/auth";
import { AscApiError, AscClient } from "@/lib/asc/client";
import { AscPushError, DEFAULT_PAGE, pushBlockers, submitDefaultCreative } from "@/lib/asc/push";
import { validateProject } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ name: string }> };

/**
 * POST { page: "default", apply? } -> the plan (apply false) or the result of
 * submitting the default page's Asset Library images for review: images only,
 * never a version, page or experiment (CLAUDE.md).
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    requireSameOrigin(req);
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json().catch(() => ({}))) as { page?: string; apply?: boolean };
    if (body.page !== DEFAULT_PAGE) throw new HttpError(400, `only "${DEFAULT_PAGE}" can be submitted: its images`);
    const v = validateProject(project);
    const blocking = pushBlockers(v.issues.items, DEFAULT_PAGE);
    if (!v.manifest || blocking.length) {
      throw new HttpError(
        422,
        "Fix these before submitting",
        blocking.map((i) => i.message),
      );
    }
    try {
      return json(
        await submitDefaultCreative(project, new AscClient(tokenSource(project)), v.manifest, v.content, {
          apply: body.apply === true,
        }),
      );
    } catch (err) {
      if (err instanceof AscAuthError || err instanceof AscPushError || err instanceof AscApiError) {
        throw new HttpError(err instanceof AscApiError ? 502 : 422, err.message);
      }
      throw err;
    }
  });
}
