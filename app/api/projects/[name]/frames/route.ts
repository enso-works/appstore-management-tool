import { handle, json } from "@/lib/server/http";
import { framesAvailable, listFrames } from "@/lib/frames";

export const dynamic = "force-dynamic";

/** Locally available device frames (fastlane frameit) for the shell picker. */
export async function GET() {
  return handle(async () =>
    json({
      available: framesAvailable(),
      frames: listFrames().map((f) => ({
        name: f.name,
        width: f.frameWidth,
        height: f.frameHeight,
        screenWidth: f.screenWidth,
      })),
    }),
  );
}
