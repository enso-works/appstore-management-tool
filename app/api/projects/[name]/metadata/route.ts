import { handle, json } from "@/lib/server/http";
import { requireProject } from "@/lib/server/projects";
import {
  listMetadataLocales,
  metadataEtags,
  readMetadataLocale,
  analyzeKeywords,
  METADATA_LIMITS,
} from "@/lib/metadata";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** All managed metadata for every configured locale, with lengths, limits and etags. */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const locales: Record<string, unknown> = {};
    for (const locale of project.config.locales) {
      const state = readMetadataLocale(project, locale);
      const etags = metadataEtags(project, locale);
      const byField = Object.fromEntries(state.fields.map((f) => [f.field, f.value]));
      locales[locale] = {
        dirExists: state.dirExists,
        fields: state.fields.map((f) => ({ ...f, etag: etags[f.field] })),
        keywords: analyzeKeywords(byField.keywords ?? "", byField.name ?? "", byField.subtitle ?? ""),
      };
    }
    return json({
      locales,
      onDisk: listMetadataLocales(project),
      limits: METADATA_LIMITS,
      managedFields: project.config.metadata.fields,
      defaultLocale: project.config.defaultLocale,
    });
  });
}
