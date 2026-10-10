import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AscAuthError, findAscKey, signToken, tokenSource } from "../lib/asc/auth";
import { AscApiError, AscClient } from "../lib/asc/client";
import { AscPushError, pushBlockers, pushDefaultPage, pushSet, submitDefaultCreative } from "../lib/asc/push";
import { ascStatus } from "../lib/asc/status";
import { loadProject } from "../lib/config";
import { generateProject } from "../lib/generate";
import { ExportRenderer } from "../lib/render/export";
import { validateProject } from "../lib/validate";
import { editJson, mp4, readJson, tempFixture } from "./helpers";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

/** A fake App Store Connect: answers by path, records every request. */
function fakeApi(
  routes: Record<string, (url: URL) => { status?: number; body?: unknown; headers?: Record<string, string> }>,
) {
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", url, auth: new Headers(init.headers).get("authorization") });
    const route = routes[u.pathname];
    const r = route ? route(u) : { status: 404, body: { errors: [{ detail: `no route ${u.pathname}` }] } };
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
  };
  return { fetchImpl, calls };
}

describe("App Store Connect", () => {
  let fx: ReturnType<typeof tempFixture>;
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));
  const fastlane = () => path.join(fx.root, "fastlane");

  beforeEach(() => {
    fx = tempFixture();
    fs.mkdirSync(fastlane(), { recursive: true });
  });
  afterEach(() => fx.cleanup());

  describe("tokens", () => {
    it("signs an ES256 token App Store Connect accepts, verifiable with the public key", () => {
      const now = Date.UTC(2026, 9, 9);
      const { token, expiresAt } = signToken({ keyId: "ABC123", issuerId: "issuer-1", privateKey }, now);
      const [h, p, sig] = token.split(".");
      expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123", typ: "JWT" });
      const payload = JSON.parse(Buffer.from(p, "base64url").toString());
      expect(payload).toMatchObject({ iss: "issuer-1", aud: "appstoreconnect-v1", iat: now / 1000 });
      expect(payload.exp - payload.iat).toBeLessThanOrEqual(20 * 60);
      expect(expiresAt).toBe(payload.exp * 1000);
      const ok = crypto.verify(
        "sha256",
        Buffer.from(`${h}.${p}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(sig, "base64url"),
      );
      expect(ok).toBe(true);
    });

    it("reads fastlane's asc_api_key.json, or the .p8 the Fastfile names", () => {
      expect(findAscKey(load())).toBeUndefined();
      fs.writeFileSync(path.join(fastlane(), "Fastfile"), 'ASC_KEY_ID = "KEY9"\nASC_ISSUER_ID = "iss-9"\n');
      fs.writeFileSync(path.join(fastlane(), "AuthKey_KEY9.p8"), pem);
      expect(findAscKey(load())).toEqual({ keyId: "KEY9", issuerId: "iss-9", source: "fastlane/AuthKey_KEY9.p8" });
      fs.writeFileSync(
        path.join(fastlane(), "asc_api_key.json"),
        JSON.stringify({ key_id: "JSON1", issuer_id: "iss-json", key: pem, in_house: false }),
      );
      // The JSON file is only found, not read, until a token is signed.
      expect(findAscKey(load())).toEqual({ source: "fastlane/asc_api_key.json" });
      expect(tokenSource(load())().split(".")).toHaveLength(3);
    });

    it("finds the key the way fastlane and Apple's tools do: env path, ENV.fetch defaults, ~/.appstoreconnect", () => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-home-"));
      const saved = { HOME: process.env.HOME, P: process.env.APP_STORE_CONNECT_API_KEY_PATH };
      try {
        process.env.HOME = home;
        fs.writeFileSync(
          path.join(fastlane(), "Fastfile"),
          "KEY_ID = ENV.fetch('ASC_KEY_ID', 'HOMEKEY')\nISSUER_ID = ENV.fetch('ASC_ISSUER_ID', 'iss-home')\n",
        );
        fs.mkdirSync(path.join(home, ".appstoreconnect", "private_keys"), { recursive: true });
        fs.writeFileSync(path.join(home, ".appstoreconnect", "private_keys", "AuthKey_HOMEKEY.p8"), pem);
        expect(findAscKey(load())).toEqual({
          keyId: "HOMEKEY",
          issuerId: "iss-home",
          source: "~/.appstoreconnect/private_keys/AuthKey_HOMEKEY.p8",
        });
        const json = path.join(home, "key.json");
        fs.writeFileSync(json, JSON.stringify({ key_id: "ENVKEY", issuer_id: "iss-env", key: pem }));
        process.env.APP_STORE_CONNECT_API_KEY_PATH = json;
        expect(findAscKey(load())).toEqual({ source: "APP_STORE_CONNECT_API_KEY_PATH" });
        expect(tokenSource(load())().split(".")).toHaveLength(3);
      } finally {
        process.env.HOME = saved.HOME;
        if (saved.P === undefined) delete process.env.APP_STORE_CONNECT_API_KEY_PATH;
        else process.env.APP_STORE_CONNECT_API_KEY_PATH = saved.P;
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    it("names the file, never its contents, when the key is unusable", () => {
      fs.writeFileSync(
        path.join(fastlane(), "asc_api_key.json"),
        JSON.stringify({ key_id: "K", issuer_id: "I", key: "SECRET-NOT-A-KEY" }),
      );
      let message = "";
      try {
        tokenSource(load())();
      } catch (err) {
        expect(err).toBeInstanceOf(AscAuthError);
        message = (err as Error).message;
      }
      expect(message).toMatch(/asc_api_key\.json/);
      expect(message).not.toMatch(/SECRET/);
    });
  });

  describe("client", () => {
    it("follows pagination and sends the token", async () => {
      const api = fakeApi({
        "/v1/things": (u) =>
          u.searchParams.get("cursor")
            ? { body: { data: [{ type: "things", id: "2" }] } }
            : {
                body: {
                  data: [{ type: "things", id: "1" }],
                  links: { next: "https://api.appstoreconnect.apple.com/v1/things?cursor=2" },
                },
              },
      });
      const client = new AscClient(() => "tok", api.fetchImpl);
      const all = await client.getAll("/v1/things");
      expect(all.data.map((d) => d.id)).toEqual(["1", "2"]);
      expect(api.calls[0].auth).toBe("Bearer tok");
      expect(api.calls[0].url).toContain("limit=200");
    });

    it("retries a rate limit, then reports Apple's explanation for a real error", async () => {
      let n = 0;
      const api = fakeApi({
        "/v1/flaky": () => (n++ === 0 ? { status: 429, headers: { "retry-after": "1" } } : { body: { data: [] } }),
        "/v1/bad": () => ({ status: 409, body: { errors: [{ detail: "The page name is already in use" }] } }),
      });
      const waits: number[] = [];
      const client = new AscClient(
        () => "tok",
        api.fetchImpl,
        async (ms) => void waits.push(ms),
      );
      await client.get("/v1/flaky");
      expect(waits).toEqual([1000]);
      await expect(client.post("/v1/bad", {})).rejects.toThrow(AscApiError);
      await expect(client.post("/v1/bad", {})).rejects.toThrow(/already in use/);
    });

    it("signs a fresh token after a stray 401 and goes again, for any method", async () => {
      let n = 0;
      const api = fakeApi({
        "/v1/thing": () => (n++ === 0 ? { status: 401 } : { status: 201, body: { data: { type: "x", id: "1" } } }),
      });
      const tokens: boolean[] = [];
      const client = new AscClient(
        (fresh = false) => (tokens.push(fresh), fresh ? "new" : "old"),
        api.fetchImpl,
        async () => {},
      );
      await client.post("/v1/thing", {});
      expect(api.calls.map((c) => c.auth)).toEqual(["Bearer old", "Bearer new"]);
      expect(tokens).toEqual([false, true]);
    });

    it("goes again after a read that got no answer, but reports a create that got none", async () => {
      const calls: string[] = [];
      const fetchImpl = async (url: string, init: RequestInit) => {
        calls.push(init.method ?? "GET");
        if (calls.length === 1 || init.method === "POST") throw new DOMException("timed out", "TimeoutError");
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      };
      const client = new AscClient(
        () => "tok",
        fetchImpl,
        async () => {},
      );
      await client.get("/v1/slow");
      expect(calls).toEqual(["GET", "GET"]);
      await expect(client.post("/v1/create", {})).rejects.toThrow(/no answer in 60 s/);
      expect(calls.filter((c) => c === "POST")).toHaveLength(1);
    });

    it("does not repeat a POST that failed on Apple's side, since it may have been created", async () => {
      let posts = 0;
      const api = fakeApi({ "/v1/create": () => (posts++, { status: 500 }) });
      const client = new AscClient(
        () => "tok",
        api.fetchImpl,
        async () => {},
      );
      await expect(client.post("/v1/create", {})).rejects.toThrow(/500/);
      expect(posts).toBe(1);
    });
  });

  describe("status", () => {
    it("lists pages and experiments and matches them to the manifest's sets", async () => {
      editJson(path.join(fx.root, "store", "manifest.json"), (m) => {
        m.sets = [
          { id: "planners", kind: "custom", name: "Planners", screens: ["planning"] },
          { id: "new-one", kind: "custom", screens: ["home"] },
          { id: "bold", kind: "ppo", name: "Bold icon", screens: ["home"] },
        ];
      });
      const api = fakeApi({
        "/v1/apps": () => ({
          body: { data: [{ type: "apps", id: "app1", attributes: { name: "Demo", bundleId: "com.example.demo" } }] },
        }),
        "/v1/apps/app1/appStoreVersions": () => ({
          body: {
            data: [
              {
                type: "appStoreVersions",
                id: "v1",
                attributes: { versionString: "1.2.0", appVersionState: "WAITING_FOR_REVIEW" },
              },
            ],
          },
        }),
        "/v1/apps/app1/appCustomProductPages": () => ({
          body: {
            data: [
              {
                type: "appCustomProductPages",
                id: "cpp1",
                attributes: { name: "Planners", visible: true },
                relationships: {
                  appCustomProductPageVersions: { data: [{ type: "appCustomProductPageVersions", id: "cv1" }] },
                },
              },
            ],
            included: [
              {
                type: "appCustomProductPageVersions",
                id: "cv1",
                attributes: { state: "APPROVED", deepLink: "demo://plan" },
              },
            ],
          },
        }),
        "/v1/apps/app1/appStoreVersionExperimentsV2": () => ({
          body: {
            data: [
              {
                type: "appStoreVersionExperiments",
                id: "exp1",
                attributes: { name: "Icons", state: "PREPARE_FOR_SUBMISSION" },
                relationships: {
                  appStoreVersionExperimentTreatments: {
                    data: [{ type: "appStoreVersionExperimentTreatments", id: "t1" }],
                  },
                },
              },
            ],
            included: [
              {
                type: "appStoreVersionExperimentTreatments",
                id: "t1",
                attributes: { name: "Bold icon", appIconName: "Bold" },
              },
            ],
          },
        }),
      });
      const project = load();
      const manifest = JSON.parse(fs.readFileSync(project.paths.manifest, "utf8"));
      const s = await ascStatus(project, new AscClient(() => "tok", api.fetchImpl), manifest);
      expect(s.app).toEqual({ id: "app1", name: "Demo", bundleId: "com.example.demo" });
      expect(s.versions[0]).toMatchObject({ version: "1.2.0", state: "WAITING_FOR_REVIEW" });
      expect(s.pages[0]).toMatchObject({
        name: "Planners",
        set: "planners",
        versions: [{ state: "APPROVED", deepLink: "demo://plan" }],
      });
      expect(s.experiments[0].treatments[0]).toMatchObject({ name: "Bold icon", appIconName: "Bold", set: "bold" });
      expect(s.notUploaded).toEqual(["new-one"]);
      // Read-only: nothing but GETs.
      expect(api.calls.every((c) => c.method === "GET")).toBe(true);
    });
  });
});

/** A fake App Store Connect that remembers what was created, enough for pushSet. */
function statefulApi(opts: { pageState?: string; versionState?: string } = {}) {
  const db = {
    pages: [] as { id: string; name: string; versions: string[] }[],
    versions: new Map<string, { id: string; state: string; deepLink?: string; locs: string[] }>(),
    locs: new Map<
      string,
      { id: string; locale: string; promotionalText?: string; sets: string[]; keywords: string[] }
    >(),
    sets: new Map<string, { id: string; type: string; shots: string[] }>(),
    shots: new Map<
      string,
      { id: string; fileName?: string; checksum?: string; uploaded?: boolean; parts: number; processing?: boolean }
    >(),
    images: new Map<
      string,
      { id: string; referenceName: string; fileName: string; uploaded?: boolean; parts: number; state?: string }
    >(),
    submissions: [] as { id: string; items: string[]; submitted: boolean; other?: boolean }[],
    placements: new Map<
      string,
      { id: string; type: string; group: string; image: string; loc: string; position: number }
    >(),
    orderings: [] as { group: string; loc: string; ids: string[] }[],
  };
  // The app's version and its localization, for the default page.
  db.locs.set("vloc1", { id: "vloc1", locale: "en-US", sets: [], keywords: [] });
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const writes: string[] = [];
  const reads: string[] = [];
  const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    if (u.host === "upload.example") {
      const image = u.searchParams.get("image");
      if (image) db.images.get(image)!.parts++;
      else db.shots.get(u.searchParams.get("shot")!)!.parts++;
      return new Response("", { status: 200 });
    }
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const p = u.pathname;
    if (method !== "GET") writes.push(`${method} ${p}`);
    else reads.push(p);
    let m: RegExpMatchArray | null;
    if (p === "/v1/apps")
      return res({ data: [{ type: "apps", id: "app1", attributes: { bundleId: "com.example.demo" } }] });
    if (p === "/v1/apps/app1/appCustomProductPages" && method === "GET")
      return res({
        data: db.pages.map((pg) => ({ type: "appCustomProductPages", id: pg.id, attributes: { name: pg.name } })),
      });
    if (p === "/v1/appCustomProductPages" && method === "POST") {
      const pg = { id: id("page"), name: body.data.attributes.name, versions: [] as string[] };
      const v = body.included.find((i: { type: string }) => i.type === "appCustomProductPageVersions");
      const ver = {
        id: id("ver"),
        state: opts.pageState ?? "PREPARE_FOR_SUBMISSION",
        deepLink: v.attributes.deepLink,
        locs: [] as string[],
      };
      for (const l of body.included.filter((i: { type: string }) => i.type === "appCustomProductPageLocalizations")) {
        const loc = {
          id: id("loc"),
          locale: l.attributes.locale,
          promotionalText: l.attributes.promotionalText,
          sets: [],
          keywords: [],
        };
        db.locs.set(loc.id, loc);
        ver.locs.push(loc.id);
      }
      db.versions.set(ver.id, ver);
      pg.versions.push(ver.id);
      db.pages.push(pg);
      return res({ data: { type: "appCustomProductPages", id: pg.id, attributes: { name: pg.name } } }, 201);
    }
    if ((m = p.match(/^\/v1\/appCustomProductPages\/(\w+)\/appCustomProductPageVersions$/))) {
      const pg = db.pages.find((x) => x.id === m![1])!;
      return res({
        data: pg.versions.map((v) => {
          const ver = db.versions.get(v)!;
          return {
            type: "appCustomProductPageVersions",
            id: v,
            attributes: { state: ver.state, deepLink: ver.deepLink },
          };
        }),
      });
    }
    if ((m = p.match(/^\/v1\/appCustomProductPageVersions\/(\w+)\/appCustomProductPageLocalizations$/))) {
      return res({
        data: db.versions.get(m[1])!.locs.map((l) => {
          const loc = db.locs.get(l)!;
          return {
            type: "appCustomProductPageLocalizations",
            id: l,
            attributes: { locale: loc.locale, promotionalText: loc.promotionalText },
          };
        }),
      });
    }
    if (p === "/v1/apps/app1/searchKeywords")
      return res({ data: ["planner", "tasks", "notes"].map((k) => ({ type: "appKeywords", id: k })) });
    if ((m = p.match(/^\/v1\/appCustomProductPageLocalizations\/(\w+)\/relationships\/searchKeywords$/))) {
      const loc = db.locs.get(m[1])!;
      if (method === "POST") loc.keywords.push(...body.data.map((d: { id: string }) => d.id));
      if (method === "DELETE")
        loc.keywords = loc.keywords.filter((k) => !body.data.some((d: { id: string }) => d.id === k));
      return method === "GET"
        ? res({ data: loc.keywords.map((k) => ({ type: "appKeywords", id: k })) })
        : new Response(null, { status: 204 });
    }
    if (p === "/v1/apps/app1/appStoreVersions")
      return res({
        data: [
          {
            type: "appStoreVersions",
            id: "ver-app",
            attributes: { versionString: "2.0", appVersionState: opts.versionState ?? "PREPARE_FOR_SUBMISSION" },
          },
        ],
      });
    if (p === "/v1/appStoreVersions/ver-app/appStoreVersionLocalizations")
      return res({ data: [{ type: "appStoreVersionLocalizations", id: "vloc1", attributes: { locale: "en-US" } }] });
    const LOC = "(?:appCustomProductPageLocalizations|appStoreVersionLocalizations)";
    const locOf = (rel: Record<string, { data: { id: string } }>) =>
      (rel.appCustomProductPageLocalization ?? rel.appStoreVersionLocalization).data.id;
    if ((m = p.match(new RegExp(`^/v1/${LOC}/(\\w+)/(appScreenshotSets|appPreviewSets)$`)))) {
      const previews = m[2] === "appPreviewSets";
      const items = previews ? "appPreviews" : "appScreenshots";
      const sets = db.locs
        .get(m[1])!
        .sets.map((s) => db.sets.get(s)!)
        .filter((s) => s.type.startsWith("APP_") !== previews);
      return res({
        data: sets.map((s) => ({
          type: m![2],
          id: s.id,
          attributes: previews ? { previewType: s.type } : { screenshotDisplayType: s.type },
          relationships: { [items]: { data: s.shots.map((x) => ({ type: items, id: x })) } },
        })),
        included: sets.flatMap((s) =>
          s.shots.map((x) => {
            const shot = db.shots.get(x)!;
            return {
              type: items,
              id: x,
              attributes: {
                fileName: shot.fileName,
                sourceFileChecksum: shot.checksum,
                assetDeliveryState: { state: shot.processing ? "UPLOAD_COMPLETE" : "COMPLETE" },
              },
            };
          }),
        ),
      });
    }
    if ((p === "/v1/appScreenshotSets" || p === "/v1/appPreviewSets") && method === "POST") {
      const type = body.data.attributes.screenshotDisplayType ?? body.data.attributes.previewType;
      const s = { id: id("set"), type, shots: [] as string[] };
      db.sets.set(s.id, s);
      db.locs.get(locOf(body.data.relationships))!.sets.push(s.id);
      return res({ data: { type: body.data.type, id: s.id, attributes: {} } }, 201);
    }
    if ((p === "/v1/appScreenshots" || p === "/v1/appPreviews") && method === "POST") {
      const shot = { id: id("shot"), fileName: body.data.attributes.fileName as string, parts: 0 };
      db.shots.set(shot.id, shot);
      const rel = body.data.relationships.appScreenshotSet ?? body.data.relationships.appPreviewSet;
      db.sets.get(rel.data.id)!.shots.push(shot.id);
      if (p === "/v1/appPreviews") expect(body.data.attributes.mimeType).toBe("video/mp4");
      const size = body.data.attributes.fileSize;
      return res(
        {
          data: {
            type: body.data.type,
            id: shot.id,
            attributes: {
              uploadOperations: [
                {
                  method: "PUT",
                  url: `https://upload.example/x?shot=${shot.id}`,
                  offset: 0,
                  length: size,
                  requestHeaders: [],
                },
              ],
            },
          },
        },
        201,
      );
    }
    if ((m = p.match(/^\/v1\/(?:appScreenshots|appPreviews)\/(\w+)$/))) {
      if (method === "PATCH") {
        Object.assign(db.shots.get(m[1])!, {
          uploaded: body.data.attributes.uploaded,
          checksum: body.data.attributes.sourceFileChecksum,
        });
        return res({ data: { type: "appScreenshots", id: m[1] } });
      }
      if (method === "DELETE") {
        db.shots.delete(m[1]);
        for (const set of db.sets.values()) set.shots = set.shots.filter((x) => x !== m![1]);
        return new Response(null, { status: 204 });
      }
    }
    // Asset Library: images, and placements tying them to a page localization.
    const imageJson = (i: {
      id: string;
      referenceName: string;
      fileName: string;
      uploaded?: boolean;
      state?: string;
    }) => ({
      type: "appAssetLibraryImages",
      id: i.id,
      attributes: {
        referenceName: i.referenceName,
        fileName: i.fileName,
        state: i.state ?? (i.uploaded ? "PREPARE_FOR_SUBMISSION" : "AWAITING_UPLOAD"),
      },
    });
    // Review submissions: an unsent one, its items, and sending it.
    if (p === "/v1/apps/app1/reviewSubmissions")
      return res({
        data: db.submissions
          .filter((x) => !x.submitted)
          .map((x) => ({ type: "reviewSubmissions", id: x.id, attributes: { state: "READY_FOR_REVIEW" } })),
      });
    if ((m = p.match(/^\/v1\/reviewSubmissions\/(\w+)\/items$/))) {
      const sub = db.submissions.find((x) => x.id === m![1])!;
      return res({
        data: [
          ...sub.items.map((img, i) => ({
            type: "reviewSubmissionItems",
            id: `${sub.id}-${i}`,
            relationships: { appAssetLibraryImage: { data: { type: "appAssetLibraryImages", id: img } } },
          })),
          ...(sub.other
            ? [{ type: "reviewSubmissionItems", id: "v", relationships: { appStoreVersion: { data: { id: "x" } } } }]
            : []),
        ],
      });
    }
    if (p === "/v1/reviewSubmissions" && method === "POST") {
      const sub = { id: id("sub"), items: [] as string[], submitted: false };
      db.submissions.push(sub);
      return res({ data: { type: "reviewSubmissions", id: sub.id } }, 201);
    }
    if (p === "/v1/reviewSubmissionItems" && method === "POST") {
      const sub = db.submissions.find((x) => x.id === body.data.relationships.reviewSubmission.data.id)!;
      sub.items.push(body.data.relationships.appAssetLibraryImage.data.id);
      return res({ data: { type: "reviewSubmissionItems", id: id("item") } }, 201);
    }
    if ((m = p.match(/^\/v1\/reviewSubmissions\/(\w+)$/)) && method === "PATCH") {
      const sub = db.submissions.find((x) => x.id === m![1])!;
      sub.submitted = body.data.attributes.submitted;
      for (const img of sub.items) db.images.get(img)!.state = "WAITING_FOR_REVIEW";
      return res({ data: { type: "reviewSubmissions", id: sub.id } });
    }
    if ((m = p.match(new RegExp(`^/v1/${LOC}/(\\w+)/placements$`)))) {
      const types = u.searchParams.get("filter[placementType]")?.split(",");
      const group = u.searchParams.get("filter[placementGroup]");
      const mine = [...db.placements.values()]
        .filter((x) => x.loc === m![1] && (!types || types.includes(x.type)) && (!group || x.group === group))
        .sort((a, b) => a.position - b.position);
      return res({
        data: mine.map((x) => ({
          type: "appAssetLibraryPlacements",
          id: x.id,
          attributes: { placementType: x.type, placementGroup: x.group },
          relationships: { image: { data: { type: "appAssetLibraryImages", id: x.image } } },
        })),
        included: [...new Set(mine.map((x) => x.image))].map((i) => imageJson(db.images.get(i)!)),
      });
    }
    if (p === "/v1/apps/app1/assetLibrary") return res({ data: { type: "appAssetLibraries", id: "lib1" } });
    if (p === "/v1/appAssetLibraries/lib1/images") {
      const name = u.searchParams.get("filter[referenceName]");
      return res({ data: [...db.images.values()].filter((i) => !name || i.referenceName === name).map(imageJson) });
    }
    if (p === "/v1/appAssetLibraryImages" && method === "POST") {
      expect(body.data.attributes.category).toBe(
        /IPHONE_DUO/.test(body.data.attributes.fileName) ? "APP_SCREENSHOTS_AND_PREVIEWS" : "CREATIVE_ASSETS",
      );
      expect(body.data.relationships.assetLibrary.data.id).toBe("lib1");
      const image = {
        id: id("img"),
        referenceName: body.data.attributes.referenceName,
        fileName: body.data.attributes.fileName,
        parts: 0,
      };
      db.images.set(image.id, image);
      const size = body.data.attributes.fileSize;
      return res(
        {
          data: {
            type: "appAssetLibraryImages",
            id: image.id,
            attributes: {
              uploadOperations: [
                { method: "PUT", url: `https://upload.example/x?image=${image.id}`, offset: 0, length: size },
              ],
            },
          },
        },
        201,
      );
    }
    if ((m = p.match(/^\/v1\/appAssetLibraryImages\/(\w+)$/))) {
      if (method === "PATCH") {
        db.images.get(m[1])!.uploaded = body.data.attributes.uploaded;
        return res({ data: imageJson(db.images.get(m[1])!) });
      }
      if (method === "DELETE") {
        db.images.delete(m[1]);
        return new Response(null, { status: 204 });
      }
      if (method === "GET") return res({ data: imageJson(db.images.get(m[1])!) });
    }
    if ((m = p.match(/^\/v1\/appAssetLibraryImages\/(\w+)\/relationships\/placements$/))) {
      return res({
        data: [...db.placements.values()]
          .filter((x) => x.image === m![1])
          .map((x) => ({ type: "appAssetLibraryPlacements", id: x.id })),
      });
    }
    if (p === "/v1/appAssetLibraryPlacements" && method === "POST") {
      const loc = locOf(body.data.relationships);
      const type = body.data.attributes.placementType;
      const group = body.data.attributes.placementGroup;
      expect(group).toBe(type === "APP_SCREENSHOT" ? "IPHONE_DUO_PROFILE" : "DEFAULT_PROFILE");
      // One header or search image, or ten screenshots, per localization, as App Store Connect allows.
      const taken = [...db.placements.values()].filter((x) => x.loc === loc && x.type === type && x.group === group);
      if (taken.length >= (type === "APP_SCREENSHOT" ? 10 : 1))
        return res({ errors: [{ status: "409", detail: "placement limit reached" }] }, 409);
      const placement = { id: id("pl"), type, group, image: body.data.relationships.image.data.id, loc, position: 99 };
      db.placements.set(placement.id, placement);
      return res({ data: { type: "appAssetLibraryPlacements", id: placement.id } }, 201);
    }
    if (p === "/v1/appAssetLibraryPlacementOrderingRequests" && method === "POST") {
      const ids: string[] = body.data.relationships.orderedPlacements.data.map((d: { id: string }) => d.id);
      db.orderings.push({ group: body.data.attributes.placementGroup, loc: locOf(body.data.relationships), ids });
      ids.forEach((pid, i) => (db.placements.get(pid)!.position = i));
      return res({ data: { type: "appAssetLibraryPlacementOrderingRequests", id: id("ord") } }, 201);
    }
    if ((m = p.match(/^\/v1\/appAssetLibraryPlacements\/(\w+)$/)) && method === "DELETE") {
      db.placements.delete(m[1]);
      return new Response(null, { status: 204 });
    }
    return res({ errors: [{ detail: `no route ${method} ${p}` }] }, 404);
  };
  return { fetchImpl, db, writes, reads };
}

describe("asc push for treatments", () => {
  it("says up front that an app not yet on the App Store cannot run a test", async () => {
    const fx = tempFixture();
    try {
      editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
        c.locales = ["en-US"];
        c.targets = ["iphone-6.9-1320x2868"];
      });
      editJson(path.join(fx.root, "store", "manifest.json"), (m) => {
        m.sets = [{ id: "bold", kind: "ppo", screens: ["home"] }];
      });
      const project = loadProject(path.join(fx.root, "store-shots.config.json"));
      const v = validateProject(project);
      // Pretend the renders are fresh: only the App Store Connect side is under test.
      const renderer = new ExportRenderer();
      await renderer.start();
      try {
        await generateProject(project, { renderer, filter: { sets: ["bold"] } });
      } finally {
        await renderer.close();
      }
      const api = fakeApi({
        "/v1/apps": () => ({
          body: { data: [{ type: "apps", id: "app1", attributes: { bundleId: "com.example.demo" } }] },
        }),
        "/v1/apps/app1/appStoreVersions": () => ({ body: { data: [] } }),
      });
      await expect(
        pushSet(project, new AscClient(() => "tok", api.fetchImpl), v.manifest!, v.content, "bold", { apply: false }),
      ).rejects.toThrow(/need the app on the App Store/);
    } finally {
      fx.cleanup();
    }
  }, 60_000);
});

describe("asc push", () => {
  let fx: ReturnType<typeof tempFixture>;
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));
  const renderer = new ExportRenderer();
  beforeAll(() => renderer.start(), 60_000);
  afterAll(() => renderer.close());
  const render = () => generateProject(load(), { renderer, filter: { sets: ["planners"] } });

  beforeEach(() => {
    fx = tempFixture();
    // One locale and one target keep the real renders quick.
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
      c.locales = ["en-US"];
      c.targets = ["iphone-6.9-1320x2868"];
    });
    editJson(path.join(fx.root, "store", "manifest.json"), (m) => {
      m.sets = [
        { id: "planners", kind: "custom", name: "Planners", deepLink: "demo://plan", screens: ["planning", "home"] },
      ];
    });
    editJson(path.join(fx.root, "store", "content", "en-US.json"), (c) => {
      c.sets = { planners: { promotionalText: "Plan the week", keywords: ["planner", "Notes"], screens: {} } };
    });
  });
  afterEach(() => fx.cleanup());

  const push = async (api: ReturnType<typeof statefulApi>, apply: boolean) => {
    const v = validateProject(load());
    return pushSet(load(), new AscClient(() => "tok", api.fetchImpl), v.manifest!, v.content, "planners", { apply });
  };

  it("plans without writing anything", async () => {
    await render();
    const api = statefulApi();
    const r = await push(api, false);
    expect(api.writes).toEqual([]);
    expect(r.steps[0]).toEqual({ action: "create", what: 'custom product page "Planners" (en-US)' });
    expect(r.steps).toContainEqual({ action: "update", what: "en-US keywords + planner, Notes" });
    expect(r.steps.some((s) => s.action === "upload" && /APP_IPHONE_67: 2 screenshot/.test(s.what))).toBe(true);
  });

  it("creates the page with its text, keywords and screenshots, stores its id, and then has nothing to do", async () => {
    await render();
    const api = statefulApi();
    const r = await push(api, true);
    expect(r.ascId).toMatch(/^page/);
    const loc = [...api.db.locs.values()].find((l) => l.id !== "vloc1")!;
    expect(loc).toMatchObject({ locale: "en-US", promotionalText: "Plan the week" });
    expect(loc.keywords.sort()).toEqual(["notes", "planner"]);
    const set = [...api.db.sets.values()][0];
    expect(set.type).toBe("APP_IPHONE_67");
    const shots = set.shots.map((s) => api.db.shots.get(s)!);
    expect(shots.map((s) => [s.uploaded, s.parts])).toEqual([
      [true, 1],
      [true, 1],
    ]);
    const first = path.join(fx.root, "store/generated/sets/planners/en-US/01_planning_IPHONE_69.png");
    expect(shots[0].checksum).toBe(crypto.createHash("md5").update(fs.readFileSync(first)).digest("hex"));
    expect(readJson<{ sets: { ascId?: string }[] }>(path.join(fx.root, "store", "manifest.json")).sets[0].ascId).toBe(
      r.ascId,
    );

    api.writes.length = 0;
    const again = await push(api, true);
    expect(api.writes).toEqual([]);
    expect(again.steps.map((s) => s.action)).toEqual(["keep"]);
    // Without creative targets the push never asks about the Asset Library.
    expect(api.reads.filter((r) => /placements|assetLibrary/i.test(r))).toEqual([]);

    // Right after an upload Apple may not have filled in the checksum yet: the file name stands in.
    const pendingShot = api.db.shots.get(set.shots[1])!;
    pendingShot.checksum = undefined;
    pendingShot.processing = true;
    const meanwhile = await push(api, false);
    expect(meanwhile.steps).toEqual([
      { action: "keep", what: "en-US APP_IPHONE_67: 2 screenshot(s) unchanged (1 still processing at Apple)" },
    ]);
  });

  it("puts the page's universal image in the Asset Library as its header and search results asset", async () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
      c.targets = ["iphone-6.9-1320x2868", "universal-5244x2950"];
    });
    editJson(path.join(fx.root, "store", "manifest.json"), (m) => {
      // Only the page shows it, and it takes no screenshot position.
      m.screens.push({
        id: "banner",
        order: 3,
        enabled: false,
        template: "feature-graphic",
        targets: ["universal-5244x2950"],
        source: { filePattern: "01-home.png", localized: true },
        overrides: {},
      });
      m.sets[0].screens = ["banner", "planning", "home"];
    });
    editJson(path.join(fx.root, "store", "content", "en-US.json"), (c) => {
      c.screens.banner = { headline: "Plan the week" };
    });
    await render();
    const out = path.join(fx.root, "store/generated/sets/planners/en-US");
    expect(fs.readdirSync(out).sort()).toEqual([
      "01_banner_UNIVERSAL.png",
      "01_planning_IPHONE_69.png",
      "02_home_IPHONE_69.png",
    ]);

    const api = statefulApi();
    const plan = await push(api, false);
    expect(plan.steps).toContainEqual({
      action: "upload",
      what: "en-US header: 01_banner_UNIVERSAL.png to the new page",
    });
    expect(plan.steps).toContainEqual({
      action: "upload",
      what: "en-US search results: 01_banner_UNIVERSAL.png to the new page",
    });

    await push(api, true);
    // One upload fills both placements.
    expect([...api.db.images.values()]).toEqual([
      expect.objectContaining({ fileName: "01_banner_UNIVERSAL.png", uploaded: true, parts: 1 }),
    ]);
    const [image] = api.db.images.values();
    expect(image.referenceName).toMatch(/^store-shots planners en-US 01_banner_UNIVERSAL [0-9a-f]{12}$/);
    expect([...api.db.placements.values()].map((x) => [x.type, x.image]).sort()).toEqual([
      ["APP_STORE_SEARCH_RESULTS_ASSET", image.id],
      ["PRODUCT_PAGE_HEADER_ASSET", image.id],
    ]);

    api.writes.length = 0;
    const again = await push(api, true);
    expect(api.writes).toEqual([]);
    expect(again.steps.filter((s) => / header| search/.test(s.what))).toEqual([
      { action: "keep", what: "en-US header: 01_banner_UNIVERSAL.png unchanged" },
      { action: "keep", what: "en-US search results: 01_banner_UNIVERSAL.png unchanged" },
    ]);

    // New copy: a new image replaces the old in both places, and the old one leaves the library.
    editJson(path.join(fx.root, "store", "content", "en-US.json"), (c) => {
      c.screens.banner = { headline: "Plan the month" };
    });
    await render();
    await push(api, true);
    const images = [...api.db.images.values()];
    expect(images).toHaveLength(1);
    expect(images[0].id).not.toBe(image.id);
    expect(new Set([...api.db.placements.values()].map((x) => x.image))).toEqual(new Set([images[0].id]));

    // Off the page: the placements this tool made go, and so does the image.
    editJson(path.join(fx.root, "store", "manifest.json"), (m) => {
      m.sets[0].screens = ["planning", "home"];
    });
    await push(api, true);
    expect(api.db.placements.size).toBe(0);
    expect(api.db.images.size).toBe(0);
  }, 120_000);

  it("puts iPhone Duo screenshots in the Asset Library as the page's ordered Duo placements", async () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
      c.targets = ["iphone-6.9-1320x2868", "iphone-duo-2007x2853"];
    });
    await render();
    const out = path.join(fx.root, "store/generated/sets/planners/en-US");
    expect(fs.readdirSync(out).filter((f) => f.includes("DUO"))).toEqual([
      "01_planning_IPHONE_DUO_INNER.png",
      "02_home_IPHONE_DUO_INNER.png",
    ]);
    const api = statefulApi();
    const plan = await push(api, false);
    expect(plan.steps).toContainEqual({ action: "upload", what: "en-US iPhone Duo: 2 screenshot(s) to the new page" });

    await push(api, true);
    const duo = () =>
      [...api.db.placements.values()]
        .filter((x) => x.group === "IPHONE_DUO_PROFILE")
        .sort((a, b) => a.position - b.position)
        .map((x) => api.db.images.get(x.image)!.fileName);
    expect(duo()).toEqual(["01_planning_IPHONE_DUO_INNER.png", "02_home_IPHONE_DUO_INNER.png"]);
    expect(api.db.orderings).toHaveLength(1);
    // The classic screenshots still go to their screenshot set.
    expect([...api.db.sets.values()].map((x) => x.type)).toEqual(["APP_IPHONE_67"]);

    api.writes.length = 0;
    const again = await push(api, true);
    expect(api.writes).toEqual([]);
    expect(again.steps).toContainEqual({ action: "keep", what: "en-US iPhone Duo: 2 screenshot(s) unchanged" });

    // A new order: the page shows the new files in it, and the old images leave the library.
    editJson(path.join(fx.root, "store", "manifest.json"), (m) => {
      m.sets[0].screens = ["home", "planning"];
    });
    await render();
    await push(api, true);
    expect(duo()).toEqual(["01_home_IPHONE_DUO_INNER.png", "02_planning_IPHONE_DUO_INNER.png"]);
    expect(api.db.images.size).toBe(2);
  }, 120_000);

  it("refuses to touch a page that is in review", async () => {
    await render();
    const api = statefulApi({ pageState: "WAITING_FOR_REVIEW" });
    await push(api, true).catch(() => undefined);
    await expect(push(api, true)).rejects.toThrow(AscPushError);
    await expect(push(api, true)).rejects.toThrow(/no edits until review ends/);
  });

  it("needs the set's screenshots first, and fresh ones", async () => {
    await expect(push(statefulApi(), false)).rejects.toThrow(
      /generate --set planners.*01_planning_IPHONE_69\.png is missing/,
    );
    await render();
    editJson(path.join(fx.root, "store", "content", "en-US.json"), (c) => {
      c.sets.planners.screens = { home: { headline: "A new headline" } };
    });
    await expect(push(statefulApi(), false)).rejects.toThrow(/02_home_IPHONE_69\.png is older than its copy/);
  }, 60_000);
});

describe("asc push default", () => {
  let fx: ReturnType<typeof tempFixture>;
  const load = () => loadProject(path.join(fx.root, "store-shots.config.json"));
  const renderer = new ExportRenderer();
  beforeAll(() => renderer.start(), 60_000);
  afterAll(() => renderer.close());

  beforeEach(() => {
    fx = tempFixture();
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
      c.locales = ["en-US"];
      c.targets = ["iphone-6.9-1320x2868", "iphone-duo-1398x2034"];
    });
  });
  afterEach(() => fx.cleanup());

  const push = (api: ReturnType<typeof statefulApi>, apply: boolean) => {
    const v = validateProject(load());
    return pushDefaultPage(load(), new AscClient(() => "tok", api.fetchImpl), v.manifest!, v.content, { apply });
  };

  it("uploads the page's screenshots, Duo screenshots and previews to the version that takes edits", async () => {
    await generateProject(load(), { renderer });
    const previews = path.join(fx.root, "store", "previews", "en-US");
    fs.mkdirSync(previews, { recursive: true });
    fs.writeFileSync(path.join(previews, "1-tour.mp4"), mp4({ width: 886, height: 1920, seconds: 20, fps: 30 }));
    const api = statefulApi();
    const plan = await push(api, false);
    expect(api.writes).toEqual([]);
    expect(plan.steps[0]).toEqual({ action: "keep", what: "version 2.0 (PREPARE_FOR_SUBMISSION)" });

    await push(api, true);
    const loc = api.db.locs.get("vloc1")!;
    const sets = loc.sets.map((x) => api.db.sets.get(x)!);
    expect(sets.map((x) => [x.type, x.shots.length])).toEqual([
      ["APP_IPHONE_67", 2],
      ["IPHONE_67", 1],
    ]);
    expect([...api.db.placements.values()].filter((x) => x.loc === "vloc1").map((x) => x.group)).toEqual([
      "IPHONE_DUO_PROFILE",
      "IPHONE_DUO_PROFILE",
    ]);

    api.writes.length = 0;
    await push(api, true);
    expect(api.writes).toEqual([]);
  }, 120_000);

  it("takes a version added for review but not yet sent, and ignores Play errors", async () => {
    await generateProject(load(), { renderer });
    const plan = await push(statefulApi({ versionState: "READY_FOR_REVIEW" }), false);
    expect(plan.steps[0]).toEqual({ action: "keep", what: "version 2.0 (READY_FOR_REVIEW)" });
    const issues = [
      { level: "error" as const, code: "plan.too-few", message: "play", key: "play-phone-1080x1920/en-US" },
      { level: "error" as const, code: "sets.x", message: "set", key: "sets/planners" },
      { level: "error" as const, code: "plan.too-few", message: "ios", key: "iphone-6.9-1320x2868/en-US" },
    ];
    expect(pushBlockers(issues, "default").map((i) => i.message)).toEqual(["ios"]);
  }, 120_000);

  it("with only a live version, puts the header in the Asset Library for review and places nothing", async () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
      c.targets = ["iphone-6.9-1320x2868", "universal-5244x2950"];
    });
    editJson(path.join(fx.root, "store", "manifest.json"), (m) => {
      m.screens.push({
        id: "banner",
        order: 3,
        enabled: true,
        template: "feature-graphic",
        targets: ["universal-5244x2950"],
        source: { filePattern: "01-home.png", localized: true },
        overrides: {},
      });
    });
    editJson(path.join(fx.root, "store", "content", "en-US.json"), (c) => {
      c.screens.banner = { headline: "Plan the week" };
    });
    await generateProject(load(), { renderer });
    const api = statefulApi({ versionState: "READY_FOR_DISTRIBUTION" });
    const r = await push(api, true);
    expect(r.libraryOnly).toBe(true);
    expect(r.steps[0].what).toMatch(
      /^screenshots and previews: no version takes edits \(2\.0 is READY_FOR_DISTRIBUTION\)/,
    );
    expect([...api.db.images.values()].map((i) => i.referenceName)).toEqual([
      expect.stringMatching(/^store-shots default en-US 03_banner_UNIVERSAL [0-9a-f]{12}$/),
    ]);
    expect(api.db.placements.size).toBe(0);
    expect(api.db.locs.get("vloc1")!.sets).toEqual([]);

    api.writes.length = 0;
    const again = await push(api, true);
    expect(api.writes).toEqual([]);
    expect(again.steps.slice(-2)).toEqual([
      {
        action: "keep",
        what: "en-US header and search results: 03_banner_UNIVERSAL.png is in the Asset Library (PREPARE_FOR_SUBMISSION)",
      },
      { action: "skip", what: "en-US: on the live page once Apple approves it" },
    ]);

    // asc submit default: plan, then one submission with the image and nothing else, sent.
    const v = validateProject(load());
    const submit = (apply: boolean) =>
      submitDefaultCreative(load(), new AscClient(() => "tok", api.fetchImpl), v.manifest!, v.content, { apply });
    expect((await submit(false)).steps.map((x) => x.what)).toEqual([
      "a review submission for the images",
      "en-US 03_banner_UNIVERSAL.png: add to the review submission",
      "submit 1 image(s) for review",
    ]);
    expect(api.db.submissions).toEqual([]);
    await submit(true);
    const [image] = api.db.images.values();
    expect(api.db.submissions).toEqual([expect.objectContaining({ items: [image.id], submitted: true })]);
    expect((await submit(true)).steps).toEqual([
      { action: "keep", what: "en-US 03_banner_UNIVERSAL.png: WAITING_FOR_REVIEW" },
    ]);

    // Approved: the next push places it on the live page as header and search results.
    image.state = "APPROVED";
    await push(api, true);
    expect(
      [...api.db.placements.values()]
        .filter((x) => x.loc === "vloc1")
        .map((x) => [x.type, x.image])
        .sort(),
    ).toEqual([
      ["APP_STORE_SEARCH_RESULTS_ASSET", image.id],
      ["PRODUCT_PAGE_HEADER_ASSET", image.id],
    ]);
  }, 120_000);

  it("submits nothing when an unsent review submission holds other items", async () => {
    editJson(path.join(fx.root, "store-shots.config.json"), (c) => {
      c.targets = ["iphone-6.9-1320x2868", "universal-5244x2950"];
    });
    editJson(path.join(fx.root, "store", "manifest.json"), (m) => {
      m.screens.push({
        id: "banner",
        order: 3,
        enabled: true,
        template: "feature-graphic",
        targets: ["universal-5244x2950"],
        source: { filePattern: "01-home.png", localized: true },
        overrides: {},
      });
    });
    editJson(path.join(fx.root, "store", "content", "en-US.json"), (c) => {
      c.screens.banner = { headline: "Plan the week" };
    });
    await generateProject(load(), { renderer });
    const api = statefulApi({ versionState: "READY_FOR_DISTRIBUTION" });
    await push(api, true);
    api.db.submissions.push({ id: "subX", items: [], submitted: false, other: true });
    const v = validateProject(load());
    await expect(
      submitDefaultCreative(load(), new AscClient(() => "tok", api.fetchImpl), v.manifest!, v.content, {
        apply: true,
      }),
    ).rejects.toThrow(/already holds 1 other item/);
    expect(api.db.submissions[0].submitted).toBe(false);
  }, 120_000);

  it("stops when no version takes edits, and says why", async () => {
    await generateProject(load(), { renderer });
    await expect(push(statefulApi({ versionState: "READY_FOR_DISTRIBUTION" }), false)).rejects.toThrow(
      /No version takes edits \(2\.0 is READY_FOR_DISTRIBUTION\); create the next version/,
    );
    await expect(push(statefulApi({ versionState: "WAITING_FOR_REVIEW" }), false)).rejects.toThrow(/until review ends/);
  }, 120_000);
});
