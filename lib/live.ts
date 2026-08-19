/**
 * Public App Store listing lookup (no credentials): what is live right now,
 * so the new set can be compared against it in the editor. Read-only, UI only;
 * never used during export.
 */
export interface LiveListing {
  bundleId: string;
  country: string;
  trackName?: string;
  version?: string;
  trackViewUrl?: string;
  iphone: string[];
  ipad: string[];
  fetchedAt: string;
}

const cache = new Map<string, { at: number; value: LiveListing | null }>();
const TTL_MS = 10 * 60 * 1000;

export async function fetchLiveListing(
  bundleId: string,
  country = "us",
  fetchImpl: typeof fetch = fetch,
): Promise<LiveListing | null> {
  const key = `${bundleId}|${country}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const url = `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}&country=${encodeURIComponent(country)}`;
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`iTunes lookup failed: ${res.status}`);
  const json = (await res.json()) as {
    resultCount: number;
    results: {
      trackName?: string;
      version?: string;
      trackViewUrl?: string;
      screenshotUrls?: string[];
      ipadScreenshotUrls?: string[];
    }[];
  };
  const r = json.results?.[0];
  const value: LiveListing | null = r
    ? {
        bundleId,
        country,
        trackName: r.trackName,
        version: r.version,
        trackViewUrl: r.trackViewUrl,
        iphone: r.screenshotUrls ?? [],
        ipad: r.ipadScreenshotUrls ?? [],
        fetchedAt: new Date().toISOString(),
      }
    : null;
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Apple's CDN renders any size from the path token; ask for full target size. */
export function liveImageUrl(url: string, width: number, height: number): string {
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${width}x${height}bb.png`);
}
