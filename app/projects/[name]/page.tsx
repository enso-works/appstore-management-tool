import Editor from "./editor";

export const dynamic = "force-dynamic";

/** `?screen=<id>` opens straight on that screen (the template catalogue links here). */
export default async function ProjectEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { name } = await params;
  const query = await searchParams;
  const screen = typeof query.screen === "string" ? query.screen : undefined;
  return <Editor name={decodeURIComponent(name)} initialScreenId={screen} />;
}
