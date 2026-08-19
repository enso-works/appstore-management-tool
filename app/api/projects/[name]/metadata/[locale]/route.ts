import { handle, json } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import {
  createMetadataLocale,
  isMetadataField,
  MetadataConflict,
  metadataEtags,
  writeMetadataField,
} from "@/lib/metadata";
import { readinessReport } from "@/lib/readiness";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string; locale: string }> };

/** Save fields for one locale. Body: { fields: { [field]: value }, ifMatch?: { [field]: etag } }. */
export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name, locale: rawLocale } = await ctx.params;
    const locale = decodeURIComponent(rawLocale);
    const project = requireProject(name);
    const body = (await req.json()) as { fields: Record<string, string>; ifMatch?: Record<string, string> };
    if (!body?.fields || typeof body.fields !== "object") throw new HttpError(400, "fields required");
    const results: Record<string, { etag: string; length: number; overLimit: boolean }> = {};
    try {
      for (const [field, value] of Object.entries(body.fields)) {
        if (!isMetadataField(field)) throw new HttpError(400, `Unknown field "${field}"`);
        if (!project.config.metadata.fields.includes(field))
          throw new HttpError(400, `Field "${field}" is not managed for this project`);
        if (typeof value !== "string") throw new HttpError(422, `${field} must be a string`);
        results[field] = writeMetadataField(project, locale, field, value, body.ifMatch?.[field]);
      }
    } catch (err) {
      if (err instanceof MetadataConflict) throw new HttpError(409, err.message);
      if (err instanceof HttpError) throw err;
      throw new HttpError(422, (err as Error).message);
    }
    return json({ results, etags: metadataEtags(project, locale), readiness: readinessReport(project) });
  });
}

/** Create the locale directory (explicit action). Body: { seedFrom?: locale }. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name, locale: rawLocale } = await ctx.params;
    const locale = decodeURIComponent(rawLocale);
    const project = requireProject(name);
    const body = (await req.json().catch(() => ({}))) as { seedFrom?: string };
    try {
      const created = createMetadataLocale(project, locale, body.seedFrom);
      return json({ created, etags: metadataEtags(project, locale) });
    } catch (err) {
      throw new HttpError(422, (err as Error).message);
    }
  });
}
