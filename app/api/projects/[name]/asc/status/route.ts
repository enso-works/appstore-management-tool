import { handle, json } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { AscAuthError, tokenSource } from "@/lib/asc/auth";
import { AscApiError, AscClient } from "@/lib/asc/client";
import { ascStatus, AscStatusError } from "@/lib/asc/status";
import { loadManifest } from "@/lib/content";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ name: string }> };

/** GET -> what App Store Connect has for the app (versions, pages, experiments), matched to the manifest. Read-only. */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const { manifest } = loadManifest(project);
    try {
      return json(await ascStatus(project, new AscClient(tokenSource(project)), manifest));
    } catch (err) {
      if (err instanceof AscAuthError || err instanceof AscStatusError || err instanceof AscApiError) {
        throw new HttpError(err instanceof AscApiError ? 502 : 422, err.message);
      }
      throw err;
    }
  });
}
