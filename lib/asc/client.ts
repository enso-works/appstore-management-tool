/**
 * A small App Store Connect API client: JSON:API documents, pagination,
 * retries on rate limits and server errors, and errors that carry Apple's
 * own explanation. Tokens come from a callback (auth.ts), so nothing here
 * sees the key.
 */

export const ASC_BASE = "https://api.appstoreconnect.apple.com";

/** How long one API request may take, and one upload part (a few MB). */
const REQUEST_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 300_000;

export interface Resource<A = Record<string, unknown>> {
  type: string;
  id: string;
  attributes?: A;
  relationships?: Record<string, { data?: { type: string; id: string } | { type: string; id: string }[] | null }>;
}

export interface Document<A = Record<string, unknown>> {
  data: Resource<A> | Resource<A>[];
  included?: Resource[];
  links?: { next?: string };
}

export class AscApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly details: string[],
    method: string,
    path: string,
  ) {
    super(`App Store Connect ${status} on ${method} ${path}${details.length ? `: ${details.join("; ")}` : ""}`);
  }
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class AscClient {
  constructor(
    private readonly token: (fresh?: boolean) => string,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  async get<A = Record<string, unknown>>(path: string, query: Record<string, string> = {}): Promise<Document<A>> {
    return (await this.request("GET", withQuery(path, query))) as Document<A>;
  }

  /** Every page of a collection, with the included resources of all of them. */
  async getAll<A = Record<string, unknown>>(
    path: string,
    query: Record<string, string> = {},
  ): Promise<{ data: Resource<A>[]; included: Resource[] }> {
    const data: Resource<A>[] = [];
    const included: Resource[] = [];
    let next: string | undefined = withQuery(path, { limit: "200", ...query });
    while (next) {
      const doc = (await this.request("GET", next)) as Document<A>;
      data.push(...(Array.isArray(doc.data) ? doc.data : [doc.data]));
      included.push(...(doc.included ?? []));
      next = doc.links?.next;
    }
    return { data, included };
  }

  async post<A = Record<string, unknown>>(path: string, body: unknown): Promise<Document<A>> {
    return (await this.request("POST", path, body)) as Document<A>;
  }

  async patch<A = Record<string, unknown>>(path: string, body: unknown): Promise<Document<A>> {
    return (await this.request("PATCH", path, body)) as Document<A>;
  }

  async delete(path: string, body?: unknown): Promise<void> {
    await this.request("DELETE", path, body);
  }

  /** One part of an asset upload, to the URL App Store Connect handed out (no API token). */
  async uploadPart(
    op: { method: string; url: string; headers: Record<string, string> },
    body: Uint8Array,
  ): Promise<void> {
    // A part is a plain PUT of bytes to the same offset: safe to send again.
    for (let attempt = 0; ; attempt++) {
      let status = 0;
      try {
        const res = await this.fetchImpl(op.url, {
          method: op.method,
          headers: op.headers,
          body: body as BodyInit,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        });
        if (res.ok) return;
        status = res.status;
      } catch {
        status = 0;
      }
      if (attempt >= 2) throw new AscApiError(status, status ? [] : ["network error"], op.method, "upload part");
      await this.sleep(1000 * 2 ** attempt);
    }
  }

  private async request(method: string, pathOrUrl: string, body?: unknown): Promise<unknown> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${ASC_BASE}${pathOrUrl}`;
    const shown = url.replace(ASC_BASE, "").split("?")[0];
    let unauthorized = 0;
    for (let attempt = 0; ; attempt++) {
      // Signing errors (no key, bad key) are not network trouble: let them through as they are.
      const token = this.token(unauthorized > 0);
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          // A connection that stops answering must not hang the run.
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        // No answer: reads and updates go again; a create may have happened, so it is reported instead.
        if (method !== "POST" && attempt < 3) {
          await this.sleep(1000 * 2 ** attempt);
          continue;
        }
        const why = (err as Error).name === "TimeoutError" ? "no answer in 60 s" : (err as Error).message;
        throw new AscApiError(0, [why], method, shown);
      }
      if (res.ok) return res.status === 204 ? undefined : res.json();
      // App Store Connect now and then refuses a valid token with 401. Nothing was processed,
      // so any method can go again, with a freshly signed token (fastlane does the same).
      if (res.status === 401 && unauthorized < 2) {
        unauthorized++;
        await this.sleep(1000 * unauthorized);
        continue;
      }
      // A rate limit means the request was not processed, so any method can retry it. A server
      // error after a POST may still have created the resource; retrying could make a second one.
      const retry = res.status === 429 || (res.status >= 500 && method !== "POST");
      if (retry && attempt < 3) {
        const after = Number(res.headers.get("retry-after"));
        await this.sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      let details: string[] = [];
      try {
        const err = (await res.json()) as { errors?: { title?: string; detail?: string; code?: string }[] };
        details = (err.errors ?? []).map((e) => e.detail ?? e.title ?? e.code ?? "").filter(Boolean);
      } catch {
        // not JSON: the status says enough
      }
      throw new AscApiError(res.status, details, method, shown);
    }
  }
}

function withQuery(path: string, query: Record<string, string>): string {
  const q = new URLSearchParams(query).toString();
  return q ? `${path}${path.includes("?") ? "&" : "?"}${q}` : path;
}

/** The ids a resource's relationship points at. */
export function related(resource: Resource, name: string): string[] {
  const data = resource.relationships?.[name]?.data;
  if (!data) return [];
  return (Array.isArray(data) ? data : [data]).map((d) => d.id);
}
