import { NextResponse, type NextRequest } from "next/server";

/**
 * The editor's API writes files in the user's apps, runs fastlane lanes and
 * uploads to App Store Connect, all on localhost. Browsers send an Origin
 * header with every cross-site write, so any write whose Origin is another
 * site (or "null", a sandboxed page) is refused before it reaches a route.
 */
export function proxy(request: NextRequest) {
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") return;
  const origin = request.headers.get("origin");
  if (origin !== null && (origin === "null" || new URL(origin).host !== request.nextUrl.host)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
}

export const config = {
  matcher: "/api/:path*",
};
