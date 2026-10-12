import { accentChoices, type AccentGuess } from "@/lib/accent";
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
  let proposal: (AppProposal & { accent?: AccentGuess; accents?: AccentGuess[] }) | undefined;
  let error = "";
  if (dir) {
    try {
      const found = inspectApp(resolveAppPath(dir));
      // The colours a starter theme could draw in, as GET /api/import answers them.
      const accents = await accentChoices(found.root);
      proposal = { ...found, accent: accents[0], accents };
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
