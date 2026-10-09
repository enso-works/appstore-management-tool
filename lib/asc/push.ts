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
import { creativePlacementsOf, type CreativePlacement } from "../targets";

/**
 * Upload a named set to App Store Connect as a draft: a custom product page
 * (name, deep link, per-locale promotional text, keywords and screenshots)
 * or an optimization treatment (name, alternate icon, per-locale
 * screenshots), each with its header and search results images through the
 * Asset Library. Files are the ones `generate --set` wrote. Nothing is ever
 * submitted for review: that stays a decision made in App Store Connect.
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
  appId?: string;
  /** The app's Asset Library, looked up the first time an image goes up. */
  libraryId?: string;
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
  const { screenshots: files, creative } = setFiles(project, set, manifest, content);
  if (files.size === 0) {
    throw new AscPushError(`No App Store screenshots for "${set.id}": it shows no iPhone or iPad target`);
  }
  const appId = await findApp(project, client);
  ctx.appId = appId;
  const ascId =
    set.kind === "custom"
      ? await pushCustomPage(ctx, appId, set, content, files, creative)
      : await pushTreatment(
          ctx,
          appId,
          set,
          files,
          creative,
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

/** A page's creative assets in one locale: the file for each placement (one universal file may fill both). */
export type PageCreative = Partial<Record<CreativePlacement, string>>;

/**
 * The set's rendered files: screenshots as locale -> display type -> files in
 * the set's order, and creative assets as locale -> placement -> file. Exactly
 * the files the set's render plan names, each checked against the renderer's
 * input hash, so a removed screen's old file is never sent and neither is a
 * render older than the copy, capture or layout it shows.
 */
export function setFiles(
  project: Project,
  set: ScreenSet,
  manifest: Manifest,
  content: Map<string, LocaleContent>,
): { screenshots: Map<string, Map<string, string[]>>; creative: Map<string, PageCreative> } {
  const generated = readGeneratedManifest(project);
  const { stack } = resolveFontStack(project);
  const fontHashes = stack.flatMap((f) => f.files.map((x) => x.sha256));
  const templatesHash = templatesSourceHash();
  const toolVersion = readToolVersion();
  const out = new Map<string, Map<string, string[]>>();
  const creative = new Map<string, PageCreative>();
  const problems: string[] = [];
  for (const job of buildSetPlan(project, manifest, { sets: [set.id] })) {
    const type = DISPLAY_TYPES[job.target.id];
    const placements = creativePlacementsOf(job.target);
    const lc = content.get(job.locale);
    if ((!type && !placements.length) || !lc) continue;
    const hash = inputsHash(project, job, withSetCopy(lc, set.id), toolVersion, fontHashes, templatesHash);
    for (const abs of job.outputPaths) {
      const rel = path.relative(project.root, abs).split(path.sep).join("/");
      const entry = generated?.files.find((f) => f.path === rel);
      if (!fs.existsSync(abs)) problems.push(`${rel} is missing`);
      else if (entry?.inputsSha256 !== hash) problems.push(`${rel} is older than its copy, capture or layout`);
      else if (placements.length) {
        const page = creative.get(job.locale) ?? {};
        // A dedicated image wins over the universal one for its placement.
        for (const p of placements) if (placements.length === 1 || !page[p]) page[p] = abs;
        creative.set(job.locale, page);
      } else if (type) {
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
  return { screenshots: out, creative };
}

// ---- custom product pages -------------------------------------------------

async function pushCustomPage(
  ctx: Ctx,
  appId: string,
  set: ScreenSet,
  content: Map<string, LocaleContent>,
  files: Map<string, Map<string, string[]>>,
  creative: Map<string, PageCreative>,
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
      planCreative(ctx, creative, "the new page");
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
      planCreative(ctx, creative, "the new version");
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
        planCreative(ctx, pick(creative, locale), `the new ${locale} localization`);
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
    const ref: LocalizationRef = {
      type: "appCustomProductPageLocalizations",
      id: loc.id,
      path: "appCustomProductPageLocalizations",
      relationship: "appCustomProductPageLocalization",
    };
    await syncScreenshots(ctx, ref, locale, files.get(locale)!);
    if (usesCreative(ctx.project)) await syncCreative(ctx, ref, set.id, locale, creative.get(locale) ?? {});
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
  creative: Map<string, PageCreative>,
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
      planCreative(ctx, creative, "the new treatment");
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
      planCreative(ctx, creative, "the new treatment");
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
        planCreative(ctx, pick(creative, locale), `the new ${locale} localization`);
        continue;
      }
      loc = one(created);
    }
    const ref: LocalizationRef = {
      type: "appStoreVersionExperimentTreatmentLocalizations",
      id: loc.id,
      path: "appStoreVersionExperimentTreatmentLocalizations",
      relationship: "appStoreVersionExperimentTreatmentLocalization",
    };
    await syncScreenshots(ctx, ref, locale, byType);
    if (usesCreative(ctx.project)) await syncCreative(ctx, ref, set.id, locale, creative.get(locale) ?? {});
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
  await uploadParts(client, reserved.attributes?.uploadOperations, bytes);
  await commit(() =>
    client.patch(`/v1/appScreenshots/${reserved.id}`, {
      data: { type: "appScreenshots", id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: checksum } },
    }),
  );
}

async function uploadParts(client: AscClient, ops: UploadOperation[] | undefined, bytes: Buffer) {
  for (const op of ops ?? []) {
    await client.uploadPart(
      {
        method: op.method,
        url: op.url,
        headers: Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value])),
      },
      bytes.subarray(op.offset, op.offset + op.length),
    );
  }
}

/** A commit retried after its first answer got lost is refused as already done: that is success. */
async function commit(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
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

// ---- creative assets (Asset Library) ----------------------------------------

/** App Store Connect's placement for each creative slot; each takes one image per page and locale. */
const PLACEMENT_TYPES: Record<CreativePlacement, string> = {
  header: "PRODUCT_PAGE_HEADER_ASSET",
  search: "APP_STORE_SEARCH_RESULTS_ASSET",
};
const PLACEMENT_LABEL: Record<CreativePlacement, string> = { header: "header", search: "search results" };

/** Images this tool uploads carry this prefix in their Asset Library name; others are left alone. */
const REFERENCE_PREFIX = "store-shots ";

/**
 * The image's name in the Asset Library: the page, locale and file, and the
 * file's checksum, so an unchanged image is recognised without downloading it.
 */
function referenceNameFor(setId: string, locale: string, file: string): string {
  return `${REFERENCE_PREFIX}${setId} ${locale} ${path.basename(file, path.extname(file))} ${md5(file).slice(0, 12)}`;
}

/** Apps without creative targets never touch the Asset Library. */
const usesCreative = (project: Project) => project.config.targets.some((t) => creativePlacementsOf(t).length > 0);

const pick = (creative: Map<string, PageCreative>, locale: string) =>
  new Map(creative.has(locale) ? [[locale, creative.get(locale)!]] : []);

function planCreative(ctx: Ctx, creative: Map<string, PageCreative>, where: string) {
  for (const [locale, page] of creative) {
    for (const [placement, file] of Object.entries(page) as [CreativePlacement, string][]) {
      ctx.steps.push({
        action: "upload",
        what: `${locale} ${PLACEMENT_LABEL[placement]}: ${path.basename(file)} to ${where}`,
      });
    }
  }
}

/**
 * Make the localization's header and search results placements show the
 * local files. An image already placed under the same reference name is
 * unchanged; otherwise the image goes to the Asset Library (or is reused
 * from there) and replaces the placement. A placement without a local file
 * is removed only when this tool made it.
 */
async function syncCreative(ctx: Ctx, loc: LocalizationRef, setId: string, locale: string, want: PageCreative) {
  const { client } = ctx;
  const placements = await client.getAll<{ placementType?: string }>(`/v1/${loc.path}/${loc.id}/placements`, {
    include: "image",
    "filter[placementType]": Object.values(PLACEMENT_TYPES).join(","),
  });
  const imageOf = (p: Resource) =>
    placements.included.find((r) => r.type === "appAssetLibraryImages" && r.id === related(p, "image")[0]) as
      Resource<{ referenceName?: string; state?: string }> | undefined;
  // One upload serves both placements when a universal image fills them.
  const uploaded = new Map<string, string>();
  const replaced: Resource<{ referenceName?: string; state?: string }>[] = [];
  for (const placement of ["header", "search"] as const) {
    const type = PLACEMENT_TYPES[placement];
    const label = `${locale} ${PLACEMENT_LABEL[placement]}`;
    const current = placements.data.find((p) => p.attributes?.placementType === type);
    const image = current && imageOf(current);
    const file = want[placement];
    if (!file) {
      if (current && image?.attributes?.referenceName?.startsWith(REFERENCE_PREFIX)) {
        await act(ctx, { action: "delete", what: `${label}: ${image.attributes.referenceName}` }, () =>
          client.delete(`/v1/appAssetLibraryPlacements/${current.id}`),
        );
        replaced.push(image);
      } else if (current) {
        ctx.steps.push({ action: "keep", what: `${label}: set in App Store Connect, not by store-shots` });
      }
      continue;
    }
    const name = referenceNameFor(setId, locale, file);
    // An image Apple could not process is sent again, whatever its name.
    const broken = ["FAILED", "REJECTED", "ARCHIVED"].includes(image?.attributes?.state ?? "");
    if (image?.attributes?.referenceName === name && !broken) {
      ctx.steps.push({ action: "keep", what: `${label}: ${path.basename(file)} unchanged` });
      continue;
    }
    // In a dry run an image planned for upload has no id yet ("").
    let imageId = uploaded.has(name) ? uploaded.get(name) : await libraryImage(ctx, name);
    if (imageId === undefined) {
      imageId = await act(
        ctx,
        { action: "upload", what: `${label}: ${path.basename(file)} to the Asset Library` },
        () => uploadLibraryImage(ctx, file, name),
      );
    }
    uploaded.set(name, imageId ?? "");
    // A page takes one image per placement, so the old placement goes first; the new image
    // is ready before that, so a page is never left without one by an image Apple turns down.
    if (current && imageId) await whenProcessed(ctx, imageId);
    if (current) {
      await act(ctx, { action: "delete", what: `${label}: old placement ${current.id}` }, () =>
        client.delete(`/v1/appAssetLibraryPlacements/${current.id}`),
      );
      if (image) replaced.push(image);
    }
    await act(ctx, { action: "create", what: `${label}: place ${path.basename(file)}` }, () =>
      client.post("/v1/appAssetLibraryPlacements", {
        data: {
          type: "appAssetLibraryPlacements",
          attributes: { placementType: type, placementGroup: "DEFAULT_PROFILE" },
          relationships: {
            image: { data: { type: "appAssetLibraryImages", id: imageId! } },
            [loc.relationship]: { data: { type: loc.type, id: loc.id } },
          },
        },
      }),
    );
  }
  // Old images this tool uploaded go once nothing shows them; anything else stays in the library.
  for (const old of new Map(replaced.map((r) => [r.id, r])).values()) {
    if (!old.attributes?.referenceName?.startsWith(REFERENCE_PREFIX) || [...uploaded.values()].includes(old.id))
      continue;
    if (!ctx.apply) {
      ctx.steps.push({
        action: "delete",
        what: `${locale}: old image ${old.attributes.referenceName}, if nothing else shows it`,
      });
      continue;
    }
    const still = await client.get(`/v1/appAssetLibraryImages/${old.id}/relationships/placements`);
    if ((Array.isArray(still.data) ? still.data : [still.data]).filter(Boolean).length) continue;
    try {
      await act(ctx, { action: "delete", what: `${locale}: old image ${old.attributes.referenceName}` }, () =>
        client.delete(`/v1/appAssetLibraryImages/${old.id}`),
      );
    } catch (err) {
      // Apple deletes only images not yet submitted; a reviewed one stays in the library.
      if (!(err instanceof AscApiError) || err.status !== 409) throw err;
      ctx.steps.push({
        action: "skip",
        what: `${locale}: old image ${old.attributes.referenceName} stays (${err.message})`,
      });
    }
  }
}

async function assetLibraryId(ctx: Ctx): Promise<string> {
  if (!ctx.libraryId) {
    const lib = one(await ctx.client.get(`/v1/apps/${ctx.appId}/assetLibrary`));
    if (!lib?.id) throw new AscPushError("App Store Connect has no Asset Library for this app yet");
    ctx.libraryId = lib.id;
  }
  return ctx.libraryId;
}

/** Wait (up to a few minutes) until Apple has processed an uploaded image; a failed one stops the push. */
async function whenProcessed(ctx: Ctx, imageId: string, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  if (!ctx.apply) return;
  for (let i = 0; i < 40; i++) {
    const image = one(await ctx.client.get(`/v1/appAssetLibraryImages/${imageId}`));
    const state = (image?.attributes as { state?: string } | undefined)?.state ?? "";
    if (["FAILED", "REJECTED"].includes(state)) {
      throw new AscPushError(`App Store Connect could not process image ${imageId} (${state}); the old one stays`);
    }
    if (!["AWAITING_UPLOAD", "UPLOAD_COMPLETE"].includes(state)) return;
    await wait(i < 5 ? 2000 : 5000);
  }
  throw new AscPushError(`Image ${imageId} is still processing at Apple; run the push again in a few minutes`);
}

/** An image of that name already in the library (an earlier run that stopped before placing it). */
async function libraryImage(ctx: Ctx, referenceName: string): Promise<string | undefined> {
  const found = await ctx.client.get<{ referenceName?: string; state?: string }>(
    `/v1/appAssetLibraries/${await assetLibraryId(ctx)}/images`,
    { "filter[referenceName]": referenceName, "filter[category]": "CREATIVE_ASSETS", limit: "5" },
  );
  const usable = (Array.isArray(found.data) ? found.data : [found.data]).find(
    (r) =>
      r?.attributes?.referenceName === referenceName &&
      !["AWAITING_UPLOAD", "FAILED", "REJECTED", "ARCHIVED"].includes(r.attributes?.state ?? ""),
  );
  return usable?.id;
}

/** Reserve the image in the app's Asset Library, upload its parts, then commit it. */
async function uploadLibraryImage(ctx: Ctx, file: string, referenceName: string): Promise<string> {
  const { client } = ctx;
  const bytes = fs.readFileSync(file);
  const reserved = one(
    await client.post<{ uploadOperations?: UploadOperation[] }>("/v1/appAssetLibraryImages", {
      data: {
        type: "appAssetLibraryImages",
        attributes: {
          category: "CREATIVE_ASSETS",
          fileName: path.basename(file),
          fileSize: bytes.length,
          referenceName,
        },
        relationships: { assetLibrary: { data: { type: "appAssetLibraries", id: await assetLibraryId(ctx) } } },
      },
    }),
  ) as Resource<{ uploadOperations?: UploadOperation[] }>;
  await uploadParts(client, reserved.attributes?.uploadOperations, bytes);
  await commit(() =>
    client.patch(`/v1/appAssetLibraryImages/${reserved.id}`, {
      data: { type: "appAssetLibraryImages", id: reserved.id, attributes: { uploaded: true } },
    }),
  );
  return reserved.id;
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
