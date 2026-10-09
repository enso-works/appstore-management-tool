import { handle, json, requireSameOrigin } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { AscAuthError, tokenSource } from "@/lib/asc/auth";
import { AscApiError, AscClient } from "@/lib/asc/client";
import { AscPushError, pushBlockers, pushPage } from "@/lib/asc/push";
import { validateProject } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

type Ctx = { params: Promise<{ name: string }> };

/**
 * POST { set, apply? } -> the plan (apply false) or the result of uploading
 * the set as a draft custom product page or treatment, or with set "default"
 * the product page's media to the editable version. Never submits.
 */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    requireSameOrigin(req);
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json().catch(() => ({}))) as { set?: string; apply?: boolean };
    if (!body.set) throw new HttpError(400, "set is required");
    const v = validateProject(project);
    const blocking = pushBlockers(v.issues.items, body.set!);
    if (!v.manifest || blocking.length) {
      throw new HttpError(
        422,
        "Fix these before uploading",
        blocking.map((i) => i.message),
      );
    }
    const log: string[] = [];
    try {
      const result = await pushPage(project, new AscClient(tokenSource(project)), v.manifest, v.content, body.set, {
        apply: body.apply === true,
        log: (l) => log.push(l),
      });
      return json({ ...result, log });
    } catch (err) {
      if (err instanceof AscAuthError || err instanceof AscPushError || err instanceof AscApiError) {
        throw new HttpError(err instanceof AscApiError ? 502 : 422, err.message);
      }
      throw err;
    }
  });
}
