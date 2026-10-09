import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Project } from "../config";
import { readJsonFile } from "../config";
import { formatJson, jsonStyleFor } from "../json-style";
import type { LocaleContent, Manifest, ScreenSet } from "../schema";
import { withSetCopy } from "../content";
import { resolveFontStack } from "../fonts";
import { inputsHash, readToolVersion, templatesSourceHash } from "../generate";
import { readGeneratedManifest } from "../generated-manifest";
import { buildSetPlan } from "../render-plan";
import { AscApiError, related, type AscClient, type Resource } from "./client";
import type { Issue } from "../issues";
import { AscStatusError, findAscApp } from "./status";

/**
 * Upload a named set to App Store Connect as a draft: a custom product page
 * (name, deep link, per-locale promotional text, keywords and screenshots)
 * or an optimization treatment (name, alternate icon, per-locale
 * screenshots). Screenshots are the files `generate --set` wrote. Nothing is
 * ever submitted for review: that stays a decision made in App Store Connect.
 *
 * Without `apply` the same walk only reads and returns what it would do, so
 * `asc push` always shows its plan first.
 */

export interface PushStep {
  action: "create" | "update" | "upload" | "delete" | "keep" | "skip";
  what: string;
}

export interface PushResult {
  set: string;
  steps: PushStep[];
  /** The page's or treatment's id in App Store Connect, once it exists. */
  ascId?: string;
  applied: boolean;
}

export class AscPushError extends Error {}

/** App Store Connect's screenshot display type for each App Store target. */
export const DISPLAY_TYPES: Record<string, string> = {
  "iphone-6.9-1320x2868": "APP_IPHONE_67",
  "iphone-6.9-2868x1320": "APP_IPHONE_67",
  "iphone-6.1-1206x2622": "APP_IPHONE_61",
  "iphone-6.1-2622x1206": "APP_IPHONE_61",
  "ipad-13-2064x2752": "APP_IPAD_PRO_3GEN_129",
  "ipad-13-2752x2064": "APP_IPAD_PRO_3GEN_129",
};

/** A page version in one of these states takes edits; any other gets a new version (or is in review). */
const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW", "REJECTED", "DEVELOPER_REJECTED"]);
const IN_REVIEW = new Set(["WAITING_FOR_REVIEW", "IN_REVIEW"]);

interface Ctx {
  project: Project;
  client: AscClient;
  apply: boolean;
  steps: PushStep[];
  log: (line: string) => void;
}

/** Record a step, and run it when applying. */
async function act<T>(ctx: Ctx, step: PushStep, run: () => Promise<T>): Promise<T | undefined> {
  ctx.steps.push(step);
  if (!ctx.apply) return undefined;
  ctx.log(`${step.action.padEnd(6)} ${step.what}`);
  return run();
}

const one = (doc: { data: Resource | Resource[] }) => (Array.isArray(doc.data) ? doc.data[0] : doc.data);

export async function pushSet(
  project: Project,
  client: AscClient,
  manifest: Manifest,
  content: Map<string, LocaleContent>,
  setId: string,
  opts: { apply: boolean; log?: (line: string) => void; experimentName?: string; trafficProportion?: number },
): Promise<PushResult> {
  const found = manifest.sets?.find((s) => s.id === setId);
  if (!found) throw new AscPushError(`No set "${setId}" in the manifest`);
  // An empty id is an unlinked page: matched by name again, like before its first upload.
  const set = { ...found, ascId: found.ascId || undefined };
  const ctx: Ctx = { project, client, apply: opts.apply, steps: [], log: opts.log ?? (() => {}) };
  // Local checks first: stale renders are the user's next step, before any network or key trouble.
  const files = setScreenshots(project, set, manifest, content);
  if (files.size === 0) {
    throw new AscPushError(`No App Store screenshots for "${set.id}": it shows no iPhone or iPad target`);
  }
  const appId = await findApp(project, client);
  const ascId =
    set.kind === "custom"
      ? await pushCustomPage(ctx, appId, set, content, files)
      : await pushTreatment(
          ctx,
          appId,
          set,
          files,
          set.experiment ?? opts.experimentName ?? "store-shots",
          opts.trafficProportion ?? 50,
        );
  if (opts.apply && ascId && ascId !== set.ascId) rememberAscId(project, set.id, ascId);
  return { set: set.id, steps: ctx.steps, ascId, applied: opts.apply };
}

async function findApp(project: Project, client: AscClient): Promise<string> {
  try {
    return (await findAscApp(project, client)).id;
  } catch (err) {
    if (err instanceof AscStatusError) throw new AscPushError(err.message);
    throw err;
  }
}

/** Validation errors that stop an upload of `setId`: global ones and any about that set, in any locale. */
export function pushBlockers(issues: Issue[], setId: string): Issue[] {
  return issues.filter(
    (i) => i.level === "error" && (!i.key || i.key === `sets/${setId}` || i.key.startsWith(`sets/${setId}/`)),
  );
}

/**
 * locale -> display type -> rendered files in the set's order: exactly the
 * files the set's render plan names, each checked against the renderer's
 * input hash, so a removed screen's old file is never sent and neither is a
 * render older than the copy, capture or layout it shows.
 */
export function setScreenshots(
  project: Project,
  set: ScreenSet,
  manifest: Manifest,
  content: Map<string, LocaleContent>,
): Map<string, Map<string, string[]>> {
  const generated = readGeneratedManifest(project);
  const { stack } = resolveFontStack(project);
  const fontHashes = stack.flatMap((f) => f.files.map((x) => x.sha256));
  const templatesHash = templatesSourceHash();
  const toolVersion = readToolVersion();
  const out = new Map<string, Map<string, string[]>>();
  const problems: string[] = [];
  for (const job of buildSetPlan(project, manifest, { sets: [set.id] })) {
    const type = DISPLAY_TYPES[job.target.id];
    const lc = content.get(job.locale);
    if (!type || !lc) continue;
    const hash = inputsHash(project, job, withSetCopy(lc, set.id), toolVersion, fontHashes, templatesHash);
    for (const abs of job.outputPaths) {
      const rel = path.relative(project.root, abs).split(path.sep).join("/");
      const entry = generated?.files.find((f) => f.path === rel);
      if (!fs.existsSync(abs)) problems.push(`${rel} is missing`);
      else if (entry?.inputsSha256 !== hash) problems.push(`${rel} is older than its copy, capture or layout`);
      else {
        const byType = out.get(job.locale) ?? new Map<string, string[]>();
        // Portrait and landscape sets of one device share a display type; App Store Connect takes both in one set.
        byType.set(type, [...(byType.get(type) ?? []), abs]);
        out.set(job.locale, byType);
      }
    }
  }
  if (problems.length) {
    throw new AscPushError(
      `Render "${set.id}" again first (store-shots generate --set ${set.id}): ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? ` and ${problems.length - 3} more` : ""}`,
    );
  }
  for (const [locale, byType] of out) {
    for (const [type, shots] of byType) {
      if (shots.length > 10)
        throw new AscPushError(`${locale} ${type}: ${shots.length} screenshots; App Store Connect takes 10`);
    }
  }
  return out;
}

// ---- custom product pages -------------------------------------------------

async function pushCustomPage(
  ctx: Ctx,
  appId: string,
  set: ScreenSet,
  content: Map<string, LocaleContent>,
  files: Map<string, Map<string, string[]>>,
): Promise<string | undefined> {
  const { client } = ctx;
  const name = set.name ?? set.id;
  const pages = await client.getAll<{ name: string }>(`/v1/apps/${appId}/appCustomProductPages`, {
    include: "appCustomProductPageVersions",
  });
  let page: Resource | undefined =
    pages.data.find((p) => p.id === set.ascId) ??
    (set.ascId ? undefined : pages.data.find((p) => p.attributes?.name === name));
  if (set.ascId && !page)
    throw new AscPushError(`Custom product page ${set.ascId} ("${name}") is gone from App Store Connect`);
  const promo = (locale: string) => content.get(locale)?.sets?.[set.id]?.promotionalText;
  const locales = [...files.keys()];

  if (!page) {
    // A new page is created with its first version and localizations in one request.
    const created = await act(
      ctx,
      { action: "create", what: `custom product page "${name}" (${locales.join(", ")})` },
      () =>
        client.post("/v1/appCustomProductPages", {
          data: {
            type: "appCustomProductPages",
            attributes: { name },
            relationships: {
              app: { data: { type: "apps", id: appId } },
              appCustomProductPageVersions: { data: [{ type: "appCustomProductPageVersions", id: "${version}" }] },
            },
          },
          included: [
            {
              type: "appCustomProductPageVersions",
              id: "${version}",
              attributes: set.deepLink ? { deepLink: set.deepLink } : {},
              relationships: {
                appCustomProductPageLocalizations: {
                  data: locales.map((l) => ({ type: "appCustomProductPageLocalizations", id: `\${${l}}` })),
                },
              },
            },
            ...locales.map((l) => ({
              type: "appCustomProductPageLocalizations",
              id: `\${${l}}`,
              attributes: { locale: l, ...(promo(l) ? { promotionalText: promo(l) } : {}) },
            })),
          ],
        }),
    );
    if (!created) {
      for (const l of locales) {
        const keywords = content.get(l)?.sets?.[set.id]?.keywords ?? [];
        if (keywords.length) ctx.steps.push({ action: "update", what: `${l} keywords + ${keywords.join(", ")}` });
      }
      planScreenshots(ctx, files, "the new page");
      return undefined;
    }
    page = one(created);
    // Stored at once: if a later step fails, the next run still finds this page by its id.
    rememberAscId(ctx.project, set.id, page.id);
  } else if (page.attributes?.name !== name) {
    await act(ctx, { action: "update", what: `rename the page to "${name}"` }, () =>
      client.patch(`/v1/appCustomProductPages/${page!.id}`, {
        data: { type: "appCustomProductPages", id: page!.id, attributes: { name } },
      }),
    );
  }

  // The version to edit: the latest editable one, or a new draft after an approved one.
  const versions = await client.getAll<{ state?: string; deepLink?: string; version?: string }>(
    `/v1/appCustomProductPages/${page.id}/appCustomProductPageVersions`,
  );
  // The API promises no order; the version number says which is latest.
  const latest = [...versions.data]
    .sort((a, b) => Number(a.attributes?.version ?? 0) - Number(b.attributes?.version ?? 0))
    .at(-1);
  if (latest && IN_REVIEW.has(latest.attributes?.state ?? "")) {
    throw new AscPushError(
      `"${name}" is ${latest.attributes?.state}; App Store Connect takes no edits until review ends`,
    );
  }
  let version = latest && EDITABLE.has(latest.attributes?.state ?? "") ? latest : undefined;
  if (!version) {
    const created = await act(ctx, { action: "create", what: `a new draft version of "${name}"` }, () =>
      client.post("/v1/appCustomProductPageVersions", {
        data: {
          type: "appCustomProductPageVersions",
          attributes: set.deepLink ? { deepLink: set.deepLink } : {},
          relationships: { appCustomProductPage: { data: { type: "appCustomProductPages", id: page!.id } } },
        },
      }),
    );
    if (!created) {
      for (const l of locales) ctx.steps.push({ action: "create", what: `${l} localization` });
      planScreenshots(ctx, files, "the new version");
      return page.id;
    }
    version = one(created);
  } else if ((version.attributes?.deepLink ?? undefined) !== set.deepLink) {
    await act(ctx, { action: "update", what: `deep link to ${set.deepLink ?? "none"}` }, () =>
      client.patch(`/v1/appCustomProductPageVersions/${version!.id}`, {
        data: { type: "appCustomProductPageVersions", id: version!.id, attributes: { deepLink: set.deepLink ?? null } },
      }),
    );
  }

  const existing = await client.getAll<{ locale: string; promotionalText?: string }>(
    `/v1/appCustomProductPageVersions/${version.id}/appCustomProductPageLocalizations`,
  );
  for (const locale of locales) {
    let loc: Resource | undefined = existing.data.find((l) => l.attributes?.locale === locale);
    if (!loc) {
      const created = await act(ctx, { action: "create", what: `${locale} localization` }, () =>
        client.post("/v1/appCustomProductPageLocalizations", {
          data: {
            type: "appCustomProductPageLocalizations",
            attributes: { locale, ...(promo(locale) ? { promotionalText: promo(locale) } : {}) },
            relationships: {
              appCustomProductPageVersion: { data: { type: "appCustomProductPageVersions", id: version!.id } },
            },
          },
        }),
      );
      if (!created) {
        planScreenshots(ctx, new Map([[locale, files.get(locale)!]]), `the new ${locale} localization`);
        continue;
      }
      loc = one(created);
    } else if ((loc.attributes?.promotionalText ?? "") !== (promo(locale) ?? "")) {
      await act(ctx, { action: "update", what: `${locale} promotional text` }, () =>
        client.patch(`/v1/appCustomProductPageLocalizations/${loc!.id}`, {
          data: {
            type: "appCustomProductPageLocalizations",
            id: loc!.id,
            attributes: { promotionalText: promo(locale) ?? null },
          },
        }),
      );
    }
    await syncKeywords(ctx, appId, loc.id, locale, content.get(locale)?.sets?.[set.id]?.keywords ?? []);
    await syncScreenshots(
      ctx,
      {
        type: "appCustomProductPageLocalizations",
        id: loc.id,
        path: "appCustomProductPageLocalizations",
        relationship: "appCustomProductPageLocalization",
      },
      locale,
      files.get(locale)!,
    );
  }
  return page.id;
}

async function syncKeywords(ctx: Ctx, appId: string, locId: string, locale: string, wanted: string[]) {
  const { client } = ctx;
  // App keywords are resources whose id is the keyword.
  const available = await client.getAll(`/v1/apps/${appId}/searchKeywords`, {
    "filter[locale]": locale,
    "filter[platform]": "IOS",
  });
  const byLower = new Map(available.data.map((k) => [k.id.toLowerCase(), k.id]));
  const want = wanted.map((w) => byLower.get(w.toLowerCase())).filter((w): w is string => !!w);
  const missing = wanted.filter((w) => !byLower.has(w.toLowerCase()));
  if (missing.length) {
    ctx.steps.push({
      action: "skip",
      what: available.data.length
        ? `${locale} keywords App Store Connect does not have: ${missing.join(", ")}`
        : `${locale} keywords: App Store Connect offers none yet (they come from the keyword field of an approved version)`,
    });
  }
  const linked = (
    await client.getAll(`/v1/appCustomProductPageLocalizations/${locId}/relationships/searchKeywords`)
  ).data.map((k) => k.id);
  const add = want.filter((k) => !linked.includes(k));
  const remove = linked.filter((k) => !want.includes(k));
  const linkage = (ids: string[]) => ({ data: ids.map((id) => ({ type: "appKeywords", id })) });
  if (add.length) {
    await act(ctx, { action: "update", what: `${locale} keywords + ${add.join(", ")}` }, () =>
      client.post(`/v1/appCustomProductPageLocalizations/${locId}/relationships/searchKeywords`, linkage(add)),
    );
  }
  if (remove.length) {
    await act(ctx, { action: "update", what: `${locale} keywords - ${remove.join(", ")}` }, () =>
      client.delete(`/v1/appCustomProductPageLocalizations/${locId}/relationships/searchKeywords`, linkage(remove)),
    );
  }
}

// ---- optimization treatments ----------------------------------------------

async function pushTreatment(
  ctx: Ctx,
  appId: string,
  set: ScreenSet,
  files: Map<string, Map<string, string[]>>,
  experimentName: string,
  trafficProportion: number,
): Promise<string | undefined> {
  const { client } = ctx;
  const name = set.name ?? set.id;
  // Apple runs optimization tests only for an app that is on the App Store.
  const live = await client.get(`/v1/apps/${appId}/appStoreVersions`, {
    "filter[platform]": "IOS",
    "filter[appVersionState]": "READY_FOR_DISTRIBUTION",
    limit: "1",
  });
  if ((Array.isArray(live.data) ? live.data : [live.data]).filter(Boolean).length === 0) {
    throw new AscPushError(
      "Optimization tests need the app on the App Store (a version Ready for Distribution); upload this treatment once it is live",
    );
  }
  const experiments = await client.getAll<{ name: string; state?: string }>(
    `/v1/apps/${appId}/appStoreVersionExperimentsV2`,
    { include: "appStoreVersionExperimentTreatments" },
  );
  // The treatment already uploaded, or one of that name in the named draft experiment.
  let experiment: Resource<{ name?: string; state?: string }> | undefined = experiments.data.find((e) =>
    related(e, "appStoreVersionExperimentTreatments").includes(set.ascId ?? ""),
  );
  // The set's own treatment can only change while its experiment is a draft.
  if (experiment && experiment.attributes?.state !== "PREPARE_FOR_SUBMISSION") {
    throw new AscPushError(
      `"${name}" is in experiment "${experiment.attributes?.name}", which is ${experiment.attributes?.state}; treatments change only before it is submitted`,
    );
  }
  // A new treatment joins the draft experiment of that name; a finished one of the same name is history.
  experiment ??= experiments.data.find(
    (e) => e.attributes?.name === experimentName && e.attributes?.state === "PREPARE_FOR_SUBMISSION",
  );
  if (!experiment) {
    const created = await act(
      ctx,
      { action: "create", what: `experiment "${experimentName}" (${trafficProportion}% of traffic to treatments)` },
      () =>
        client.post("/v2/appStoreVersionExperiments", {
          data: {
            type: "appStoreVersionExperiments",
            attributes: { name: experimentName, platform: "IOS", trafficProportion },
            relationships: { app: { data: { type: "apps", id: appId } } },
          },
        }),
    );
    if (!created) {
      ctx.steps.push({
        action: "create",
        what: `treatment "${name}"${set.appIconName ? ` with icon ${set.appIconName}` : ""}`,
      });
      planScreenshots(ctx, files, "the new treatment");
      return undefined;
    }
    experiment = one(created);
  }
  const treatments = experiments.included.filter(
    (r) =>
      r.type === "appStoreVersionExperimentTreatments" &&
      related(experiment!, "appStoreVersionExperimentTreatments").includes(r.id),
  ) as Resource<{ name?: string; appIconName?: string }>[];
  let treatment = treatments.find((t) => t.id === set.ascId) ?? treatments.find((t) => t.attributes?.name === name);
  if (!treatment) {
    if (treatments.length >= 3) throw new AscPushError(`Experiment "${experimentName}" already has 3 treatments`);
    const created = await act(
      ctx,
      { action: "create", what: `treatment "${name}"${set.appIconName ? ` with icon ${set.appIconName}` : ""}` },
      () =>
        client.post("/v1/appStoreVersionExperimentTreatments", {
          data: {
            type: "appStoreVersionExperimentTreatments",
            attributes: { name, ...(set.appIconName ? { appIconName: set.appIconName } : {}) },
            relationships: {
              appStoreVersionExperimentV2: { data: { type: "appStoreVersionExperiments", id: experiment!.id } },
            },
          },
        }),
    );
    if (!created) {
      planScreenshots(ctx, files, "the new treatment");
      return undefined;
    }
    treatment = one(created) as Resource<{ name?: string; appIconName?: string }>;
    rememberAscId(ctx.project, set.id, treatment.id);
  } else if (
    treatment.attributes?.name !== name ||
    (treatment.attributes?.appIconName ?? undefined) !== set.appIconName
  ) {
    await act(ctx, { action: "update", what: `treatment name or icon` }, () =>
      client.patch(`/v1/appStoreVersionExperimentTreatments/${treatment!.id}`, {
        data: {
          type: "appStoreVersionExperimentTreatments",
          id: treatment!.id,
          attributes: { name, appIconName: set.appIconName ?? null },
        },
      }),
    );
  }
  const existing = await client.getAll<{ locale: string }>(
    `/v1/appStoreVersionExperimentTreatments/${treatment.id}/appStoreVersionExperimentTreatmentLocalizations`,
  );
  for (const [locale, byType] of files) {
    let loc: Resource | undefined = existing.data.find((l) => l.attributes?.locale === locale);
    if (!loc) {
      const created = await act(ctx, { action: "create", what: `${locale} treatment localization` }, () =>
        client.post("/v1/appStoreVersionExperimentTreatmentLocalizations", {
          data: {
            type: "appStoreVersionExperimentTreatmentLocalizations",
            attributes: { locale },
            relationships: {
              appStoreVersionExperimentTreatment: {
                data: { type: "appStoreVersionExperimentTreatments", id: treatment!.id },
              },
            },
          },
        }),
      );
      if (!created) {
        planScreenshots(ctx, new Map([[locale, byType]]), `the new ${locale} localization`);
        continue;
      }
      loc = one(created);
    }
    await syncScreenshots(
      ctx,
      {
        type: "appStoreVersionExperimentTreatmentLocalizations",
        id: loc.id,
        path: "appStoreVersionExperimentTreatmentLocalizations",
        relationship: "appStoreVersionExperimentTreatmentLocalization",
      },
      locale,
      byType,
    );
  }
  return treatment.id;
}

// ---- screenshots ----------------------------------------------------------

interface LocalizationRef {
  type: string;
  id: string;
  /** URL segment for /v1/<path>/<id>/appScreenshotSets. */
  path: string;
  /** The screenshot set's relationship name back to it. */
  relationship: string;
}

function md5(file: string): string {
  return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
}

/** In a dry run of something that does not exist yet, every screenshot would be uploaded. */
function planScreenshots(ctx: Ctx, files: Map<string, Map<string, string[]>>, where: string) {
  for (const [locale, byType] of files) {
    for (const [type, shots] of byType) {
      ctx.steps.push({ action: "upload", what: `${locale} ${type}: ${shots.length} screenshot(s) to ${where}` });
    }
  }
}

/**
 * Make each display type's set hold exactly the local files, in order. A set
 * whose screenshots already match by checksum is left alone; otherwise its
 * screenshots are replaced.
 */
async function syncScreenshots(ctx: Ctx, loc: LocalizationRef, locale: string, byType: Map<string, string[]>) {
  const { client } = ctx;
  const sets = await client.getAll<{ screenshotDisplayType: string }>(`/v1/${loc.path}/${loc.id}/appScreenshotSets`, {
    include: "appScreenshots",
  });
  for (const [type, shots] of byType) {
    let set = sets.data.find((s) => s.attributes?.screenshotDisplayType === type);
    // The set's own relationship gives the display order; `included` may come in any order.
    const current = set
      ? related(set, "appScreenshots")
          .map((id) => sets.included.find((r) => r.type === "appScreenshots" && r.id === id))
          .filter((r): r is Resource<ScreenshotAttributes> => !!r)
      : [];
    const local = shots.map(md5);
    // Apple fills in the checksum once it has processed an upload; until then the file name
    // (ours, in order) stands in for it. A reservation that never got its bytes still differs.
    const processing = (s: Resource<ScreenshotAttributes>) =>
      !s.attributes?.sourceFileChecksum && s.attributes?.assetDeliveryState?.state === "UPLOAD_COMPLETE";
    const same = (s: Resource<ScreenshotAttributes>, i: number) =>
      s.attributes?.sourceFileChecksum === local[i] ||
      (processing(s) && s.attributes?.fileName === path.basename(shots[i]));
    if (current.length === local.length && current.every(same)) {
      const pending = current.filter(processing).length;
      ctx.steps.push({
        action: "keep",
        what: `${locale} ${type}: ${shots.length} screenshot(s) unchanged${pending ? ` (${pending} still processing at Apple)` : ""}`,
      });
      continue;
    }
    const removeOld = async () => {
      for (const s of current) {
        await act(ctx, { action: "delete", what: `${locale} ${type}: old screenshot ${s.id}` }, () =>
          client.delete(`/v1/appScreenshots/${s.id}`),
        );
      }
    };
    // With room for both, the new screenshots go up before the old ones go: a failed upload
    // leaves the old ones in place (with whatever new ones made it) instead of a half-empty
    // page, and the next run, which compares checksums, puts the set right.
    const uploadFirst = current.length + shots.length <= 10;
    if (!uploadFirst) await removeOld();
    if (!set) {
      const created = await act(ctx, { action: "create", what: `${locale} ${type} screenshot set` }, () =>
        client.post("/v1/appScreenshotSets", {
          data: {
            type: "appScreenshotSets",
            attributes: { screenshotDisplayType: type },
            relationships: { [loc.relationship]: { data: { type: loc.type, id: loc.id } } },
          },
        }),
      );
      if (!created) {
        ctx.steps.push({ action: "upload", what: `${locale} ${type}: ${shots.length} screenshot(s)` });
        continue;
      }
      set = one(created) as Resource<{ screenshotDisplayType: string }>;
    }
    for (const [i, file] of shots.entries()) {
      await act(ctx, { action: "upload", what: `${locale} ${type}: ${path.basename(file)}` }, () =>
        uploadScreenshot(client, set!.id, file, local[i]),
      );
    }
    if (uploadFirst) await removeOld();
  }
}

/** Reserve, upload the parts App Store Connect asks for, then commit with the checksum. */
async function uploadScreenshot(client: AscClient, setId: string, file: string, checksum: string) {
  const bytes = fs.readFileSync(file);
  const reserved = one(
    await client.post<{ uploadOperations?: UploadOperation[] }>("/v1/appScreenshots", {
      data: {
        type: "appScreenshots",
        attributes: { fileName: path.basename(file), fileSize: bytes.length },
        relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
      },
    }),
  ) as Resource<{ uploadOperations?: UploadOperation[] }>;
  for (const op of reserved.attributes?.uploadOperations ?? []) {
    await client.uploadPart(
      {
        method: op.method,
        url: op.url,
        headers: Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value])),
      },
      bytes.subarray(op.offset, op.offset + op.length),
    );
  }
  try {
    await client.patch(`/v1/appScreenshots/${reserved.id}`, {
      data: { type: "appScreenshots", id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: checksum } },
    });
  } catch (err) {
    // A commit retried after its first answer got lost is refused as already done: that is success.
    const done = err instanceof AscApiError && err.status === 409 && /re-committed|already/i.test(err.message);
    if (!done) throw err;
  }
}

type ScreenshotAttributes = {
  fileName?: string;
  sourceFileChecksum?: string;
  assetDeliveryState?: { state?: string };
};

interface UploadOperation {
  method: string;
  url: string;
  offset: number;
  length: number;
  requestHeaders?: { name: string; value: string }[];
}

/** Store the page's or treatment's id in the manifest, in the app's JSON style. */
function rememberAscId(project: Project, setId: string, ascId: string) {
  const file = project.paths.manifest;
  const manifest = readJsonFile(file) as Manifest;
  const set = manifest.sets?.find((s) => s.id === setId);
  if (!set) return;
  set.ascId = ascId;
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, formatJson(manifest, jsonStyleFor(file)));
  fs.renameSync(tmp, file);
}
