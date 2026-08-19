import { handle, json } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { fetchLiveListing } from "@/lib/live";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** GET ?country=us -> the live App Store listing's screenshots for this app's bundle id (public lookup). */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const bundleId = project.config.bundleId;
    if (!bundleId) throw new HttpError(400, "store-shots.config.json has no bundleId");
    const country = (new URL(req.url).searchParams.get("country") ?? "us").toLowerCase().slice(0, 2);
    try {
      const live = await fetchLiveListing(bundleId, country);
      return json({ live, country });
    } catch (err) {
      throw new HttpError(502, (err as Error).message);
    }
  });
}
