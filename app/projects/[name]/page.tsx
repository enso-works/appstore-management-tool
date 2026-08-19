import Editor from "./editor";

export const dynamic = "force-dynamic";

export default async function ProjectEditorPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <Editor name={decodeURIComponent(name)} />;
}
