import { readCapacitor, readExpoSafely, readXcodeProject } from "../app-facts";
import type { Project } from "../config";
import type { Manifest } from "../schema";
import { related, type AscClient, type Resource } from "./client";

/**
 * What App Store Connect has for the app: its versions, custom product pages
 * and optimization experiments, matched to the manifest's named sets by the
 * id the tool stored (`ascId`) or, before the first upload, by name.
 * Read-only.
 */

export interface AscPage {
  id: string;
  name: string;
  visible: boolean;
  url?: string;
  versions: { id: string; version?: string; state?: string; deepLink?: string }[];
  /** The manifest set this page is, if any. */
  set?: string;
}

export interface AscExperiment {
  id: string;
  name: string;
  state?: string;
  trafficProportion?: number;
  treatments: { id: string; name: string; appIconName?: string; set?: string }[];
}

export interface AscStatus {
  app: { id: string; name: string; bundleId: string };
  versions: { id: string; version: string; state?: string; platform?: string }[];
  pages: AscPage[];
  experiments: AscExperiment[];
  /** Manifest sets App Store Connect does not have yet. */
  notUploaded: string[];
}

export class AscStatusError extends Error {}

/** The app's bundle id: the config's, else what the app's own files say. */
export function appBundleId(project: Project): string | undefined {
  if (project.config.bundleId) return project.config.bundleId;
  const expo = readExpoSafely(project.root) as { ios?: { bundleIdentifier?: unknown } } | undefined;
  if (typeof expo?.ios?.bundleIdentifier === "string") return expo.ios.bundleIdentifier;
  return readCapacitor(project.root)?.appId ?? readXcodeProject(project.root)?.bundleId;
}

/** The app's record in App Store Connect, by its bundle id. */
export async function findAscApp(
  project: Project,
  client: AscClient,
): Promise<{ id: string; name: string; bundleId: string }> {
  const bundleId = appBundleId(project);
  if (!bundleId) throw new AscStatusError("No bundle id: set bundleId in store-shots.config.json");
  const apps = await client.get<{ name: string; bundleId: string }>("/v1/apps", {
    "filter[bundleId]": bundleId,
    "fields[apps]": "name,bundleId",
  });
  const app = (Array.isArray(apps.data) ? apps.data : [apps.data]).find((a) => a.attributes?.bundleId === bundleId);
  if (!app) throw new AscStatusError(`App Store Connect has no app with bundle id ${bundleId} for this key's team`);
  return { id: app.id, name: app.attributes?.name ?? "", bundleId };
}

export async function ascStatus(project: Project, client: AscClient, manifest?: Manifest): Promise<AscStatus> {
  const app = await findAscApp(project, client);

  const [versions, pages, experiments] = await Promise.all([
    // The latest few versions are enough to see what is live and what is in review.
    client
      .get<{ versionString: string; appVersionState?: string; appStoreState?: string; platform?: string }>(
        `/v1/apps/${app.id}/appStoreVersions`,
        { "filter[platform]": "IOS", limit: "5" },
      )
      .then((d) => ({ data: Array.isArray(d.data) ? d.data : [d.data] })),
    client.getAll<{ name: string; visible: boolean; url?: string }>(`/v1/apps/${app.id}/appCustomProductPages`, {
      include: "appCustomProductPageVersions",
    }),
    client.getAll<{ name: string; state?: string; trafficProportion?: number }>(
      `/v1/apps/${app.id}/appStoreVersionExperimentsV2`,
      { include: "appStoreVersionExperimentTreatments" },
    ),
  ]);

  const sets = manifest?.sets ?? [];
  const setFor = (kind: "custom" | "ppo", id: string, name: string) =>
    (
      sets.find((s) => s.kind === kind && s.ascId === id) ??
      sets.find((s) => s.kind === kind && !s.ascId && (s.name ?? s.id) === name)
    )?.id;
  const included = (all: Resource[], type: string, ids: string[]) =>
    all.filter((r) => r.type === type && ids.includes(r.id));

  const outPages: AscPage[] = pages.data.map((p) => ({
    id: p.id,
    name: p.attributes?.name ?? "",
    visible: Boolean(p.attributes?.visible),
    url: p.attributes?.url,
    versions: included(pages.included, "appCustomProductPageVersions", related(p, "appCustomProductPageVersions"))
      .map((v) => {
        const a = v.attributes as { version?: string; state?: string; deepLink?: string } | undefined;
        return { id: v.id, version: a?.version, state: a?.state, deepLink: a?.deepLink };
      })
      // Oldest first by version number, whatever order `included` came in.
      .sort((a, b) => Number(a.version ?? 0) - Number(b.version ?? 0)),
    set: setFor("custom", p.id, p.attributes?.name ?? ""),
  }));
  const outExperiments: AscExperiment[] = experiments.data.map((e) => ({
    id: e.id,
    name: e.attributes?.name ?? "",
    state: e.attributes?.state,
    trafficProportion: e.attributes?.trafficProportion,
    treatments: included(
      experiments.included,
      "appStoreVersionExperimentTreatments",
      related(e, "appStoreVersionExperimentTreatments"),
    ).map((t) => {
      const a = t.attributes as { name?: string; appIconName?: string } | undefined;
      return { id: t.id, name: a?.name ?? "", appIconName: a?.appIconName, set: setFor("ppo", t.id, a?.name ?? "") };
    }),
  }));
  const matched = new Set([
    ...outPages.flatMap((p) => (p.set ? [p.set] : [])),
    ...outExperiments.flatMap((e) => e.treatments.flatMap((t) => (t.set ? [t.set] : []))),
  ]);
  return {
    app,
    versions: versions.data.map((v) => ({
      id: v.id,
      version: v.attributes?.versionString ?? "",
      state: v.attributes?.appVersionState ?? v.attributes?.appStoreState,
      platform: v.attributes?.platform,
    })),
    pages: outPages,
    experiments: outExperiments,
    notUploaded: sets.filter((s) => !matched.has(s.id)).map((s) => s.id),
  };
}
