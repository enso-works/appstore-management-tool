import { handle, json } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { AscAuthError, tokenSource } from "@/lib/asc/auth";
import { AscApiError, AscClient } from "@/lib/asc/client";
import { ascVersions } from "@/lib/asc/versions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ name: string }> };

/**
 * GET -> the app's versions with the live one and the one in progress, read at most every
 * five minutes (`?fresh=1` reads now). Without a key or a record: `{ connected: false }`. Read-only.
 */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const fresh = new URL(req.url).searchParams.get("fresh") === "1";
    try {
      return json(await ascVersions(project, () => new AscClient(tokenSource(project)), { fresh }));
    } catch (err) {
      if (err instanceof AscAuthError || err instanceof AscApiError) {
        throw new HttpError(err instanceof AscApiError ? 502 : 422, err.message);
      }
      throw err;
    }
  });
}
