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

export function json(data: unknown, init?: ResponseInit): Response {
  return NextResponse.json(data, init);
}
