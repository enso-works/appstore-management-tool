import { accentOf } from "@/lib/accent";
import { findImportCandidates, ImportError, inspectApp, resolveAppPath, type AppProposal } from "@/lib/import";
import { defaultWorkspaceRoot } from "@/lib/registry";
import ImportForm from "./import-form";

export const dynamic = "force-dynamic";

/** /import?path=<app dir>: the Mac app's Import App... lands here with the folder it picked. */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { path } = await searchParams;
  const dir = typeof path === "string" ? path : "";
  let proposal: (AppProposal & { accent?: { hex: string; source: string } }) | undefined;
  let error = "";
  if (dir) {
    try {
      const found = inspectApp(resolveAppPath(dir));
      // The colour a starter theme would draw in, as GET /api/import answers it.
      proposal = { ...found, accent: await accentOf(found.root) };
    } catch (err) {
      if (!(err instanceof ImportError)) throw err;
      error = err.message;
    }
  }
  const workspace = defaultWorkspaceRoot();
  return (
    <ImportForm
      initialPath={dir}
      initialProposal={proposal}
      initialError={error}
      workspace={workspace}
      candidates={findImportCandidates(workspace)}
    />
  );
}
