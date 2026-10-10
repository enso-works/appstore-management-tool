import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Project } from "../config";
import { readJsonFile } from "../config";
import { formatJson, jsonStyleFor } from "../json-style";
import { DEFAULT_PAGE, type LocaleContent, type Manifest, type ScreenSet } from "../schema";
import { withSetCopy } from "../content";
import { resolveFontStack } from "../fonts";
import { inputsHash, readToolVersion, templatesSourceHash } from "../generate";
import { readGeneratedManifest } from "../generated-manifest";
import { buildRenderPlan, buildSetPlan, type RenderJob } from "../render-plan";
import { AscApiError, related, type AscClient, type Resource } from "./client";
import type { Issue } from "../issues";
import { AscStatusError, findAscApp } from "./status";
import { readVideoInfo } from "../video";
import { PREVIEW_LIMITS, previewClass, VIDEO_MIME } from "../previews";
import { creativePlacementsOf, getTarget, isDuo, type CreativePlacement } from "../targets";

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
  /** The default page with no version taking edits: creative images went to the Asset Library only. */
  libraryOnly?: boolean;
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
  const files = setFiles(project, set, manifest, content);
  if (files.screenshots.size === 0 && files.duo.size === 0) {
    throw new AscPushError(`No App Store screenshots for "${set.id}": it shows no iPhone or iPad target`);
  }
  const appId = await findApp(project, client);
  ctx.appId = appId;
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

export { DEFAULT_PAGE };

/** Version states App Store Connect takes screenshot and preview edits in. */
const VERSION_EDITABLE = new Set([
  "PREPARE_FOR_SUBMISSION",
  "READY_FOR_REVIEW",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

/**
 * Upload the default product page's media to the app's editable version: its
 * screenshots, iPhone Duo screenshots, header and search results images, and
 * the app previews in <previews>/<locale>/. Text stays deliver's job, and so
 * does making the version; with no version taking edits this says so and
 * stops. Like pushSet it plans first and never submits.
 */
export async function pushDefaultPage(
  project: Project,
  client: AscClient,
  manifest: Manifest,
  content: Map<string, LocaleContent>,
  opts: { apply: boolean; log?: (line: string) => void },
): Promise<PushResult> {
  const ctx: Ctx = { project, client, apply: opts.apply, steps: [], log: opts.log ?? (() => {}) };
  // Header and search images first: a live version takes only those, so they are all a
  // live page needs current. Screenshots are checked once a version takes them.
  const creative = defaultPageFiles(project, manifest, content, (j) => j.target.family === "creative").creative;
  const appId = await findApp(project, client);
  ctx.appId = appId;
  const versions = await client.get<{ versionString?: string; appVersionState?: string; appStoreState?: string }>(
    `/v1/apps/${appId}/appStoreVersions`,
    { "filter[platform]": "IOS", limit: "10" },
  );
  const all = (Array.isArray(versions.data) ? versions.data : [versions.data]).filter(Boolean);
  const stateOf = (v: (typeof all)[number]) => v.attributes?.appVersionState ?? v.attributes?.appStoreState ?? "";
  const version = all.find((v) => VERSION_EDITABLE.has(stateOf(v)));
  if (!version) {
    const pending = all.find((v) => IN_REVIEW.has(stateOf(v)));
    const why = pending
      ? `version ${pending.attributes?.versionString} is ${stateOf(pending)}; App Store Connect takes no screenshot edits until review ends`
      : `no version takes edits${all[0] ? ` (${all[0].attributes?.versionString} is ${stateOf(all[0])})` : ""}; create the next version in App Store Connect for screenshots and previews`;
    // A live page takes header and search images from the Asset Library once Apple has
    // approved them, without a new version: they go up as drafts to submit there.
    if (!creative.size) throw new AscPushError(why.charAt(0).toUpperCase() + why.slice(1));
    ctx.steps.push({ action: "skip", what: `screenshots and previews: ${why}` });
    await uploadCreativeToLibrary(ctx, creative);
    return { set: DEFAULT_PAGE, steps: ctx.steps, applied: opts.apply, libraryOnly: true };
  }
  const files = defaultPageFiles(project, manifest, content);
  const previews = previewFiles(project, ctx);
  if (files.screenshots.size === 0 && files.duo.size === 0 && previews.size === 0) {
    throw new AscPushError("Nothing to upload: the default page renders no App Store screenshots");
  }
  ctx.steps.push({
    action: "keep",
    what: `version ${version.attributes?.versionString} (${stateOf(version)})`,
  });
  const locs = await client.getAll<{ locale: string }>(
    `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
  );
  for (const locale of [...new Set([...localesOf(files), ...previews.keys()])]) {
    const loc = locs.data.find((l) => l.attributes?.locale === locale);
    if (!loc) {
      ctx.steps.push({
        action: "skip",
        what: `${locale}: version ${version.attributes?.versionString} has no ${locale} localization yet (deliver adds it with the text)`,
      });
      continue;
    }
    const ref: LocalizationRef = {
      type: "appStoreVersionLocalizations",
      id: loc.id,
      path: "appStoreVersionLocalizations",
      relationship: "appStoreVersionLocalization",
    };
    // A locale with only previews keeps whatever else App Store Connect shows there.
    if (localesOf(files).includes(locale)) await syncLocalization(ctx, ref, DEFAULT_PAGE, locale, files);
    const byType = previews.get(locale);
    if (byType) await syncMedia(ctx, PREVIEWS, ref, locale, byType);
  }
  return { set: DEFAULT_PAGE, steps: ctx.steps, ascId: version.id, applied: opts.apply };
}

/**
 * The default page's header and search results images into the Asset Library
 * as drafts, placed nowhere: submitted for review there and approved, they
 * can be chosen for the live page (Browse Assets) without a new version. An
 * image already there under its checksum name is not sent again.
 */
async function uploadCreativeToLibrary(ctx: Ctx, creative: Map<string, PageCreative>) {
  for (const [locale, page] of creative) {
    for (const file of new Set(Object.values(page))) {
      const name = referenceNameFor(DEFAULT_PAGE, locale, file);
      const label = `${locale} ${(Object.keys(page) as CreativePlacement[])
        .filter((p) => page[p] === file)
        .map((p) => PLACEMENT_LABEL[p])
        .join(" and ")}`;
      if (await libraryImage(ctx, name)) {
        ctx.steps.push({ action: "keep", what: `${label}: ${path.basename(file)} is in the Asset Library` });
        continue;
      }
      await act(
        ctx,
        { action: "upload", what: `${label}: ${path.basename(file)} to the Asset Library, for review there` },
        () => uploadLibraryImage(ctx, file, name),
      );
    }
  }
}

/**
 * App previews by locale and preview type, from <previews>/<locale>/ in name
 * order. Readiness checks them against Apple's specification; a size this
 * cannot place is skipped with a note.
 */
function previewFiles(project: Project, ctx: Ctx): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  const root = project.paths.previews;
  if (!fs.existsSync(root)) return out;
  // The app's own locales only: a folder for any other is not the app's to upload.
  for (const locale of project.config.locales) {
    const dir = path.join(root, locale);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!VIDEO_MIME[path.extname(name).toLowerCase()]) continue;
      const file = path.join(dir, name);
      let type: string | undefined;
      try {
        const { width, height } = readVideoInfo(file);
        type = previewClass(width, height)?.type;
      } catch {
        // unreadable: readiness reports it
      }
      if (!type) {
        ctx.steps.push({
          action: "skip",
          what: `${locale}: ${name} is no App Store preview size (readiness says why)`,
        });
        continue;
      }
      const byType = out.get(locale) ?? new Map<string, string[]>();
      byType.set(type, [...(byType.get(type) ?? []), file]);
      out.set(locale, byType);
    }
  }
  for (const [locale, byType] of out) {
    for (const [type, files] of byType) {
      if (files.length > PREVIEWS.max)
        throw new AscPushError(`${locale} ${type}: ${files.length} previews; App Store Connect takes ${PREVIEWS.max}`);
    }
  }
  return out;
}

/** `asc push <set>`: a named set, or the default page for "default". */
export function pushPage(
  project: Project,
  client: AscClient,
  manifest: Manifest,
  content: Map<string, LocaleContent>,
  setId: string,
  opts: { apply: boolean; log?: (line: string) => void; experimentName?: string; trafficProportion?: number },
): Promise<PushResult> {
  return setId === DEFAULT_PAGE
    ? pushDefaultPage(project, client, manifest, content, opts)
    : pushSet(project, client, manifest, content, setId, opts);
}

async function findApp(project: Project, client: AscClient): Promise<string> {
  try {
    return (await findAscApp(project, client)).id;
  } catch (err) {
    if (err instanceof AscStatusError) throw new AscPushError(err.message);
    throw err;
  }
}

/**
 * Validation errors that stop an upload of `setId`: global ones and any about
 * that set, in any locale; for the default page, any error not about a set.
 */
export function pushBlockers(issues: Issue[], setId: string): Issue[] {
  if (setId === DEFAULT_PAGE) {
    // The default page sends iOS media only: errors about sets or Play targets do not stop it.
    const android = (key: string) => getTarget(key.split("/")[0])?.platform === "android";
    return issues.filter((i) => i.level === "error" && !i.key?.startsWith("sets/") && !(i.key && android(i.key)));
  }
  return issues.filter(
    (i) => i.level === "error" && (!i.key || i.key === `sets/${setId}` || i.key.startsWith(`sets/${setId}/`)),
  );
}

/** A page's creative assets in one locale: the file for each placement (one universal file may fill both). */
export type PageCreative = Partial<Record<CreativePlacement, string>>;

/** A page's rendered files, per locale. */
export interface PageFiles {
  /** locale -> display type -> files in the page's order. */
  screenshots: Map<string, Map<string, string[]>>;
  /** locale -> iPhone Duo files in the page's order (Asset Library only). */
  duo: Map<string, string[]>;
  /** locale -> header and search results files. */
  creative: Map<string, PageCreative>;
}

/** Every locale the page has a file for. */
function localesOf(files: PageFiles): string[] {
  return [...new Set([...files.screenshots.keys(), ...files.duo.keys(), ...files.creative.keys()])];
}

/**
 * The set's rendered files: exactly the files its render plan names, each
 * checked against the renderer's input hash, so a removed screen's old file
 * is never sent and neither is a render older than the copy, capture or
 * layout it shows.
 */
export function setFiles(
  project: Project,
  set: ScreenSet,
  manifest: Manifest,
  content: Map<string, LocaleContent>,
): PageFiles {
  return collectFiles(
    project,
    buildSetPlan(project, manifest, { sets: [set.id] }),
    (lc) => withSetCopy(lc, set.id),
    `Render "${set.id}" again first (store-shots generate --set ${set.id})`,
    content,
  );
}

/** The default product page's rendered App Store files, checked the same way. */
export function defaultPageFiles(
  project: Project,
  manifest: Manifest,
  content: Map<string, LocaleContent>,
  only: (job: RenderJob) => boolean = () => true,
): PageFiles {
  return collectFiles(
    project,
    buildRenderPlan(project, manifest).filter((j) => j.target.platform === "ios" && only(j)),
    (lc) => lc,
    "Render the default page again first (store-shots generate)",
    content,
  );
}

function collectFiles(
  project: Project,
  jobs: RenderJob[],
  copyFor: (lc: LocaleContent) => LocaleContent,
  rerun: string,
  content: Map<string, LocaleContent>,
): PageFiles {
  const generated = readGeneratedManifest(project);
  const { stack } = resolveFontStack(project);
  const fontHashes = stack.flatMap((f) => f.files.map((x) => x.sha256));
  const templatesHash = templatesSourceHash();
  const toolVersion = readToolVersion();
  const out: PageFiles = { screenshots: new Map(), duo: new Map(), creative: new Map() };
  const problems: string[] = [];
  for (const job of jobs) {
    const type = DISPLAY_TYPES[job.target.id];
    const duo = isDuo(job.target);
    const placements = creativePlacementsOf(job.target);
    const lc = content.get(job.locale);
    if ((!type && !duo && !placements.length) || !lc) continue;
    const hash = inputsHash(project, job, copyFor(lc), toolVersion, fontHashes, templatesHash);
    for (const abs of job.outputPaths) {
      const rel = path.relative(project.root, abs).split(path.sep).join("/");
      const entry = generated?.files.find((f) => f.path === rel);
      if (!fs.existsSync(abs)) problems.push(`${rel} is missing`);
      else if (entry?.inputsSha256 !== hash) problems.push(`${rel} is older than its copy, capture or layout`);
      else if (placements.length) {
        const page = out.creative.get(job.locale) ?? {};
        // A dedicated image wins over the universal one for its placement.
        for (const p of placements) if (placements.length === 1 || !page[p]) page[p] = abs;
        out.creative.set(job.locale, page);
      } else if (duo) {
        out.duo.set(job.locale, [...(out.duo.get(job.locale) ?? []), abs]);
      } else if (type) {
        const byType = out.screenshots.get(job.locale) ?? new Map<string, string[]>();
        // Portrait and landscape sets of one device share a display type; App Store Connect takes both in one set.
        byType.set(type, [...(byType.get(type) ?? []), abs]);
        out.screenshots.set(job.locale, byType);
      }
    }
  }
  if (problems.length) {
    throw new AscPushError(
      `${rerun}: ${problems.slice(0, 3).join("; ")}${problems.length > 3 ? ` and ${problems.length - 3} more` : ""}`,
    );
  }
  for (const [locale, byType] of out.screenshots) {
    for (const [type, shots] of byType) {
      if (shots.length > 10)
        throw new AscPushError(`${locale} ${type}: ${shots.length} screenshots; App Store Connect takes 10`);
    }
  }
  for (const [locale, shots] of out.duo) {
    if (shots.length > 10)
      throw new AscPushError(`${locale} iPhone Duo: ${shots.length} screenshots; App Store Connect takes 10`);
  }
  return out;
}

// ---- custom product pages -------------------------------------------------

async function pushCustomPage(
  ctx: Ctx,
  appId: string,
  set: ScreenSet,
  content: Map<string, LocaleContent>,
  files: PageFiles,
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
  const locales = localesOf(files);

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
      planFiles(ctx, files, "the new page");
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
      planFiles(ctx, files, "the new version");
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
        planFiles(ctx, files, `the new ${locale} localization`, locale);
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
    await syncLocalization(ctx, ref, set.id, locale, files);
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
  files: PageFiles,
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
      planFiles(ctx, files, "the new treatment");
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
      planFiles(ctx, files, "the new treatment");
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
  for (const locale of localesOf(files)) {
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
        planFiles(ctx, files, `the new ${locale} localization`, locale);
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
    await syncLocalization(ctx, ref, set.id, locale, files);
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

/** The checksum of a file of any size, read in chunks (app previews run to hundreds of MB). */
function md5Streamed(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** In a dry run of something that does not exist yet, every file would be uploaded (only `locale`'s, if given). */
function planFiles(ctx: Ctx, files: PageFiles, where: string, locale?: string) {
  for (const l of localesOf(files)) {
    if (locale && l !== locale) continue;
    for (const [type, shots] of files.screenshots.get(l) ?? []) {
      ctx.steps.push({ action: "upload", what: `${l} ${type}: ${shots.length} screenshot(s) to ${where}` });
    }
    const duo = files.duo.get(l) ?? [];
    if (duo.length)
      ctx.steps.push({ action: "upload", what: `${l} iPhone Duo: ${duo.length} screenshot(s) to ${where}` });
    for (const [placement, file] of Object.entries(files.creative.get(l) ?? {}) as [CreativePlacement, string][]) {
      ctx.steps.push({
        action: "upload",
        what: `${l} ${PLACEMENT_LABEL[placement]}: ${path.basename(file)} to ${where}`,
      });
    }
  }
}

/** Everything one page localization shows: screenshots, iPhone Duo screenshots, header and search results images. */
async function syncLocalization(ctx: Ctx, ref: LocalizationRef, pageId: string, locale: string, files: PageFiles) {
  await syncScreenshots(ctx, ref, locale, files.screenshots.get(locale) ?? new Map());
  if (usesDuo(ctx.project)) await syncDuo(ctx, ref, pageId, locale, files.duo.get(locale) ?? []);
  if (usesCreative(ctx.project)) await syncCreative(ctx, ref, pageId, locale, files.creative.get(locale) ?? {});
}

/** Screenshots and app previews: the same sets-of-items API under different names. */
interface MediaKind {
  /** /v1/<loc>/<id>/<sets> and POST /v1/<sets>. */
  sets: "appScreenshotSets" | "appPreviewSets";
  /** The set's items, and POST /v1/<items>. */
  items: "appScreenshots" | "appPreviews";
  /** The set attribute naming its device. */
  typeAttr: "screenshotDisplayType" | "previewType";
  /** The item's relationship to its set. */
  setRel: "appScreenshotSet" | "appPreviewSet";
  /** How many a set holds. */
  max: number;
  noun: string;
}

const SCREENSHOTS: MediaKind = {
  sets: "appScreenshotSets",
  items: "appScreenshots",
  typeAttr: "screenshotDisplayType",
  setRel: "appScreenshotSet",
  max: 10,
  noun: "screenshot",
};

const PREVIEWS: MediaKind = {
  sets: "appPreviewSets",
  items: "appPreviews",
  typeAttr: "previewType",
  setRel: "appPreviewSet",
  max: PREVIEW_LIMITS.perSet,
  noun: "preview",
};

function syncScreenshots(ctx: Ctx, loc: LocalizationRef, locale: string, byType: Map<string, string[]>) {
  return syncMedia(ctx, SCREENSHOTS, loc, locale, byType);
}

/**
 * Make each type's set hold exactly the local files, in order. A set whose
 * items already match by checksum is left alone; otherwise its items are
 * replaced.
 */
async function syncMedia(
  ctx: Ctx,
  kind: MediaKind,
  loc: LocalizationRef,
  locale: string,
  byType: Map<string, string[]>,
) {
  const { client } = ctx;
  const sets = await client.getAll<Record<string, string>>(`/v1/${loc.path}/${loc.id}/${kind.sets}`, {
    include: kind.items,
  });
  for (const [type, files] of byType) {
    let set = sets.data.find((s) => s.attributes?.[kind.typeAttr] === type);
    // The set's own relationship gives the display order; `included` may come in any order.
    const current = set
      ? related(set, kind.items)
          .map((id) => sets.included.find((r) => r.type === kind.items && r.id === id))
          .filter((r): r is Resource<MediaAttributes> => !!r)
      : [];
    const local = await Promise.all(files.map(md5Streamed));
    // Apple fills in the checksum once it has processed an upload; until then the file name
    // (ours, in order) stands in for it. A reservation that never got its bytes still differs.
    const processing = (s: Resource<MediaAttributes>) =>
      !s.attributes?.sourceFileChecksum && s.attributes?.assetDeliveryState?.state === "UPLOAD_COMPLETE";
    const same = (s: Resource<MediaAttributes>, i: number) =>
      s.attributes?.sourceFileChecksum === local[i] ||
      (processing(s) && s.attributes?.fileName === path.basename(files[i]));
    if (current.length === local.length && current.every(same)) {
      const pending = current.filter(processing).length;
      ctx.steps.push({
        action: "keep",
        what: `${locale} ${type}: ${files.length} ${kind.noun}(s) unchanged${pending ? ` (${pending} still processing at Apple)` : ""}`,
      });
      continue;
    }
    const removeOld = async () => {
      for (const s of current) {
        await act(ctx, { action: "delete", what: `${locale} ${type}: old ${kind.noun} ${s.id}` }, () =>
          client.delete(`/v1/${kind.items}/${s.id}`),
        );
      }
    };
    // With room for both, the new items go up before the old ones go: a failed upload
    // leaves the old ones in place (with whatever new ones made it) instead of a half-empty
    // page, and the next run, which compares checksums, puts the set right.
    const uploadFirst = current.length + files.length <= kind.max;
    if (!uploadFirst) await removeOld();
    if (!set) {
      const created = await act(ctx, { action: "create", what: `${locale} ${type} ${kind.noun} set` }, () =>
        client.post(`/v1/${kind.sets}`, {
          data: {
            type: kind.sets,
            attributes: { [kind.typeAttr]: type },
            relationships: { [loc.relationship]: { data: { type: loc.type, id: loc.id } } },
          },
        }),
      );
      if (!created) {
        ctx.steps.push({ action: "upload", what: `${locale} ${type}: ${files.length} ${kind.noun}(s)` });
        continue;
      }
      set = one(created) as Resource<Record<string, string>>;
    }
    for (const [i, file] of files.entries()) {
      await act(ctx, { action: "upload", what: `${locale} ${type}: ${path.basename(file)}` }, () =>
        uploadMedia(client, kind, set!.id, file, local[i]),
      );
    }
    if (uploadFirst) await removeOld();
  }
}

/** Reserve, upload the parts App Store Connect asks for, then commit with the checksum. */
async function uploadMedia(client: AscClient, kind: MediaKind, setId: string, file: string, checksum: string) {
  const fileSize = fs.statSync(file).size;
  const mimeType = kind === PREVIEWS ? VIDEO_MIME[path.extname(file).toLowerCase()] : undefined;
  const reserved = one(
    await client.post<{ uploadOperations?: UploadOperation[] }>(`/v1/${kind.items}`, {
      data: {
        type: kind.items,
        attributes: { fileName: path.basename(file), fileSize, ...(mimeType ? { mimeType } : {}) },
        relationships: { [kind.setRel]: { data: { type: kind.sets, id: setId } } },
      },
    }),
  ) as Resource<{ uploadOperations?: UploadOperation[] }>;
  await uploadParts(client, reserved.attributes?.uploadOperations, file);
  await commit(() =>
    client.patch(`/v1/${kind.items}/${reserved.id}`, {
      data: { type: kind.items, id: reserved.id, attributes: { uploaded: true, sourceFileChecksum: checksum } },
    }),
  );
}

/** Send each part App Store Connect asked for, read from the bytes or, part by part, from the file. */
async function uploadParts(client: AscClient, ops: UploadOperation[] | undefined, source: Buffer | string) {
  const fd = typeof source === "string" ? fs.openSync(source, "r") : undefined;
  try {
    for (const op of ops ?? []) {
      let part: Buffer;
      if (fd === undefined) part = (source as Buffer).subarray(op.offset, op.offset + op.length);
      else {
        part = Buffer.alloc(op.length);
        fs.readSync(fd, part, 0, op.length, op.offset);
      }
      await client.uploadPart(
        {
          method: op.method,
          url: op.url,
          headers: Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value])),
        },
        part,
      );
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
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

type MediaAttributes = {
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

/** Image states that will never show: such an image is sent again. */
const BROKEN = ["FAILED", "REJECTED", "ARCHIVED"];

/** Images this tool uploads carry this prefix in their Asset Library name; others are left alone. */
const REFERENCE_PREFIX = "store-shots ";

/**
 * The image's name in the Asset Library: the page, locale and file, and the
 * file's checksum, so an unchanged image is recognised without downloading it.
 */
function referenceNameFor(setId: string, locale: string, file: string): string {
  return `${REFERENCE_PREFIX}${setId} ${locale} ${path.basename(file, path.extname(file))} ${md5(file).slice(0, 12)}`;
}

/** Apps without creative or Duo targets never touch the Asset Library. */
const usesCreative = (project: Project) => project.config.targets.some((t) => creativePlacementsOf(t).length > 0);
const usesDuo = (project: Project) => project.config.targets.some((t) => isDuo(t));

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
    const broken = BROKEN.includes(image?.attributes?.state ?? "");
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
  await dropOldImages(ctx, locale, replaced, [...uploaded.values()]);
}

/** Old images this tool uploaded go once nothing shows them; anything else stays in the library. */
async function dropOldImages(
  ctx: Ctx,
  locale: string,
  replaced: Resource<{ referenceName?: string }>[],
  keep: string[],
) {
  const { client } = ctx;
  for (const old of new Map(replaced.map((r) => [r.id, r])).values()) {
    if (!old.attributes?.referenceName?.startsWith(REFERENCE_PREFIX) || keep.includes(old.id)) continue;
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

// ---- iPhone Duo screenshots (Asset Library) -------------------------------

const DUO_GROUP = "IPHONE_DUO_PROFILE";

/**
 * Make the localization's iPhone Duo screenshots the local files, in order.
 * App Store Connect takes them only as Asset Library placements: images go
 * up (or are reused by name), placements of images that are no longer wanted
 * go, new ones are made, and an ordering request sets the order. When the
 * page has no Duo files, only placements this tool made are removed.
 */
async function syncDuo(ctx: Ctx, loc: LocalizationRef, pageId: string, locale: string, files: string[]) {
  const { client } = ctx;
  const label = `${locale} iPhone Duo`;
  const placements = await client.getAll<{ placementType?: string; placementGroup?: string }>(
    `/v1/${loc.path}/${loc.id}/placements`,
    {
      include: "image",
      "filter[placementType]": "APP_SCREENSHOT",
      "filter[placementGroup]": DUO_GROUP,
      sort: "placementGroupPosition",
    },
  );
  const current = placements.data.map((p) => ({
    placement: p,
    image: placements.included.find((r) => r.type === "appAssetLibraryImages" && r.id === related(p, "image")[0]) as
      Resource<{ referenceName?: string; state?: string }> | undefined,
  }));
  const names = files.map((f) => referenceNameFor(pageId, locale, f));
  const ours = (c: (typeof current)[number]) => c.image?.attributes?.referenceName?.startsWith(REFERENCE_PREFIX);
  if (!files.length) {
    for (const c of current.filter(ours)) {
      await act(ctx, { action: "delete", what: `${label}: ${c.image!.attributes!.referenceName}` }, () =>
        client.delete(`/v1/appAssetLibraryPlacements/${c.placement.id}`),
      );
    }
    if (current.some((c) => !ours(c)))
      ctx.steps.push({ action: "keep", what: `${label}: set in App Store Connect, not by store-shots` });
    await dropOldImages(
      ctx,
      locale,
      current.filter(ours).flatMap((c) => (c.image ? [c.image] : [])),
      [],
    );
    return;
  }
  const healthy = (c: (typeof current)[number]) => !BROKEN.includes(c.image?.attributes?.state ?? "");
  if (
    current.length === names.length &&
    current.every((c, i) => c.image?.attributes?.referenceName === names[i] && healthy(c))
  ) {
    ctx.steps.push({ action: "keep", what: `${label}: ${files.length} screenshot(s) unchanged` });
    return;
  }
  // Images first, each processed before anything shown goes away.
  const imageIds: string[] = [];
  for (const [i, file] of files.entries()) {
    const placed = current.find((c) => c.image?.attributes?.referenceName === names[i] && healthy(c));
    let id = placed?.image?.id ?? (await libraryImage(ctx, names[i], "APP_SCREENSHOTS_AND_PREVIEWS"));
    if (id === undefined) {
      id = await act(ctx, { action: "upload", what: `${label}: ${path.basename(file)} to the Asset Library` }, () =>
        uploadLibraryImage(ctx, file, names[i], "APP_SCREENSHOTS_AND_PREVIEWS"),
      );
    }
    if (id) await whenProcessed(ctx, id);
    imageIds.push(id ?? "");
  }
  // Placements of images still wanted stay; the rest go, which also makes room under the limit of 10.
  const keep = new Map<string, string>();
  const removed: Resource<{ referenceName?: string }>[] = [];
  for (const c of current) {
    const wanted = c.image && healthy(c) && imageIds.includes(c.image.id) && !keep.has(c.image.id);
    if (wanted) keep.set(c.image!.id, c.placement.id);
    else {
      await act(
        ctx,
        { action: "delete", what: `${label}: placement of ${c.image?.attributes?.referenceName ?? c.placement.id}` },
        () => client.delete(`/v1/appAssetLibraryPlacements/${c.placement.id}`),
      );
      if (c.image) removed.push(c.image);
    }
  }
  const ordered: string[] = [];
  for (const [i, imageId] of imageIds.entries()) {
    const existing = imageId ? keep.get(imageId) : undefined;
    if (existing) {
      ordered.push(existing);
      continue;
    }
    const created = await act(ctx, { action: "create", what: `${label}: place ${path.basename(files[i])}` }, () =>
      client.post("/v1/appAssetLibraryPlacements", {
        data: {
          type: "appAssetLibraryPlacements",
          attributes: { placementType: "APP_SCREENSHOT", placementGroup: DUO_GROUP },
          relationships: {
            image: { data: { type: "appAssetLibraryImages", id: imageId } },
            [loc.relationship]: { data: { type: loc.type, id: loc.id } },
          },
        },
      }),
    );
    if (created) ordered.push(one(created).id);
  }
  await act(ctx, { action: "update", what: `${label}: order of ${files.length} screenshot(s)` }, () =>
    client.post("/v1/appAssetLibraryPlacementOrderingRequests", {
      data: {
        type: "appAssetLibraryPlacementOrderingRequests",
        attributes: { placementGroup: DUO_GROUP },
        relationships: {
          orderedPlacements: { data: ordered.map((id) => ({ type: "appAssetLibraryPlacements", id })) },
          [loc.relationship]: { data: { type: loc.type, id: loc.id } },
        },
      },
    }),
  );
  await dropOldImages(ctx, locale, removed, imageIds);
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
async function libraryImage(
  ctx: Ctx,
  referenceName: string,
  category: AssetCategory = "CREATIVE_ASSETS",
): Promise<string | undefined> {
  const found = await ctx.client.get<{ referenceName?: string; state?: string }>(
    `/v1/appAssetLibraries/${await assetLibraryId(ctx)}/images`,
    { "filter[referenceName]": referenceName, "filter[category]": category, limit: "5" },
  );
  const usable = (Array.isArray(found.data) ? found.data : [found.data]).find(
    (r) =>
      r?.attributes?.referenceName === referenceName &&
      !["AWAITING_UPLOAD", "FAILED", "REJECTED", "ARCHIVED"].includes(r.attributes?.state ?? ""),
  );
  return usable?.id;
}

/** Reserve the image in the app's Asset Library, upload its parts, then commit it. */
type AssetCategory = "CREATIVE_ASSETS" | "APP_SCREENSHOTS_AND_PREVIEWS";

async function uploadLibraryImage(
  ctx: Ctx,
  file: string,
  referenceName: string,
  category: AssetCategory = "CREATIVE_ASSETS",
): Promise<string> {
  const { client } = ctx;
  const bytes = fs.readFileSync(file);
  const reserved = one(
    await client.post<{ uploadOperations?: UploadOperation[] }>("/v1/appAssetLibraryImages", {
      data: {
        type: "appAssetLibraryImages",
        attributes: {
          category,
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
