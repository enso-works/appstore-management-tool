import CanvasHost from "./canvas-host";

export const dynamic = "force-dynamic";

/** Only the canvas, for the Mac app: it draws everything else natively (docs/canvas-bridge.md). */
export default async function CanvasPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return <CanvasHost name={decodeURIComponent(name)} />;
}
