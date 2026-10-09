import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AscAuthError, findAscKey, signToken, tokenSource } from "../lib/asc/auth";
import { AscApiError, AscClient } from "../lib/asc/client";
import { AscPushError, pushSet } from "../lib/asc/push";
import { ascStatus } from "../lib/asc/status";
import { loadProject } from "../lib/config";
import { generateProject } from "../lib/generate";
import { ExportRenderer } from "../lib/render/export";
import { validateProject } from "../lib/validate";
import { editJson, readJson, tempFixture } from "./helpers";

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
function statefulApi(opts: { pageState?: string } = {}) {
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
  };
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const writes: string[] = [];
  const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    if (u.host === "upload.example") {
      db.shots.get(u.searchParams.get("shot")!)!.parts++;
      return new Response("", { status: 200 });
    }
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const p = u.pathname;
    if (method !== "GET") writes.push(`${method} ${p}`);
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
    if ((m = p.match(/^\/v1\/appCustomProductPageLocalizations\/(\w+)\/appScreenshotSets$/))) {
      const sets = db.locs.get(m[1])!.sets.map((s) => db.sets.get(s)!);
      return res({
        data: sets.map((s) => ({
          type: "appScreenshotSets",
          id: s.id,
          attributes: { screenshotDisplayType: s.type },
          relationships: { appScreenshots: { data: s.shots.map((x) => ({ type: "appScreenshots", id: x })) } },
        })),
        included: sets.flatMap((s) =>
          s.shots.map((x) => {
            const shot = db.shots.get(x)!;
            return {
              type: "appScreenshots",
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
    if (p === "/v1/appScreenshotSets" && method === "POST") {
      const s = { id: id("set"), type: body.data.attributes.screenshotDisplayType, shots: [] as string[] };
      db.sets.set(s.id, s);
      db.locs.get(body.data.relationships.appCustomProductPageLocalization.data.id)!.sets.push(s.id);
      return res({ data: { type: "appScreenshotSets", id: s.id, attributes: { screenshotDisplayType: s.type } } }, 201);
    }
    if (p === "/v1/appScreenshots" && method === "POST") {
      const shot = { id: id("shot"), fileName: body.data.attributes.fileName as string, parts: 0 };
      db.shots.set(shot.id, shot);
      db.sets.get(body.data.relationships.appScreenshotSet.data.id)!.shots.push(shot.id);
      const size = body.data.attributes.fileSize;
      return res(
        {
          data: {
            type: "appScreenshots",
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
    if ((m = p.match(/^\/v1\/appScreenshots\/(\w+)$/)) && method === "PATCH") {
      Object.assign(db.shots.get(m[1])!, {
        uploaded: body.data.attributes.uploaded,
        checksum: body.data.attributes.sourceFileChecksum,
      });
      return res({ data: { type: "appScreenshots", id: m[1] } });
    }
    return res({ errors: [{ detail: `no route ${method} ${p}` }] }, 404);
  };
  return { fetchImpl, db, writes };
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
    const loc = [...api.db.locs.values()][0];
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

    // Right after an upload Apple may not have filled in the checksum yet: the file name stands in.
    const pendingShot = api.db.shots.get(set.shots[1])!;
    pendingShot.checksum = undefined;
    pendingShot.processing = true;
    const meanwhile = await push(api, false);
    expect(meanwhile.steps).toEqual([
      { action: "keep", what: "en-US APP_IPHONE_67: 2 screenshot(s) unchanged (1 still processing at Apple)" },
    ]);
  });

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
