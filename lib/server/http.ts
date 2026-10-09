import { NextResponse } from "next/server";
import { HttpError } from "./projects";

/** Wrap a route handler: HttpError -> its status, anything else -> 500 with the message. */
export async function handle(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * For routes that act outside the app (App Store Connect uploads, fastlane
 * lanes): only the editor itself may call them. A page on another site can
 * POST to localhost without a CORS preflight only with a "simple" content
 * type and its own Origin, so both are refused here.
 */
export function requireSameOrigin(req: Request): void {
  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("application/json")) throw new HttpError(415, "send application/json");
  const origin = req.headers.get("origin");
  if (origin !== null && (origin === "null" || new URL(origin).host !== new URL(req.url).host)) {
    throw new HttpError(403, "cross-site request refused");
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  return NextResponse.json(data, init);
}
