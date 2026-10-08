import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAME, loadProject, readJsonFile, validateConfigSemantics } from "./config";
import { APP_LANGUAGE_TO_STORE_LOCALES, type AppStoreLocale } from "./locales";
import { dirExists, displayRelative, fileExists } from "./paths";
import { formatZodError, projectConfigSchema, type ProjectConfigInput } from "./schema";
import { targetsFor, type Orientation } from "./targets";

export interface InitOptions {
  /** Absolute app root. */
  appRoot: string;
  /** Path (relative to the app root) to the tool directory, for $schema links. */
  toolRelPath?: string;
  projectName?: string;
  locales?: string[];
  defaultLocale?: string;
  /** Screen orientation of the app's store sets (default portrait; landscape for sideways games). */
  orientation?: Orientation;
  /** Store targets; default the iPhone sets in `orientation`, plus iPad 13" when app.json supportsTablet. */
  targets?: string[];
  /** Default: app.json ios.bundleIdentifier. */
  bundleId?: string;
  force?: boolean;
}

/** The choices would produce an invalid config; nothing was written. */
export class ScaffoldError extends Error {}

export interface InitResult {
  created: string[];
  skipped: string[];
  config: ProjectConfigInput;
}

/** Scaffold store/ + store-shots.config.json into an app (plan §6.2). Never overwrites unless force. */
export function initProject(opts: InitOptions): InitResult {
  const root = path.resolve(opts.appRoot);
  if (!dirExists(root)) throw new Error(`${root} is not a directory`);
  const created: string[] = [];
  const skipped: string[] = [];
  const toolRel = opts.toolRelPath ?? defaultToolRelPath(root);

  const app = readExpoConfig(root);
  const projectName = opts.projectName ?? (app?.name as string | undefined) ?? path.basename(root);
  const bundleId = opts.bundleId ?? (app?.ios as { bundleIdentifier?: string } | undefined)?.bundleIdentifier;
  const locales = opts.locales ?? proposeLocales(root, app);
  const defaultLocale = opts.defaultLocale ?? (locales.includes("en-US") ? "en-US" : locales[0]);

  const config: ProjectConfigInput = {
    $schema: `${toolRel}/schema/project.schema.json`,
    projectName,
    bundleId,
    defaultLocale,
    locales,
    // iOS store targets by default; Google Play and App Preview posters are opt-in per app.
    targets:
      opts.targets ??
      targetsFor({
        orientation: opts.orientation ?? "portrait",
        ipad: (app?.ios as { supportsTablet?: unknown } | undefined)?.supportsTablet === true,
        play: false,
      }),
    brand: { font: { family: "Inter", source: "google", weights: [400, 600, 700] } },
  };

  // Validate before touching the disk so bad --locales/--default-locale cannot
  // leave a half-written scaffold (write() never overwrites on a rerun).
  const parsed = projectConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new ScaffoldError(`Refusing to scaffold: ${formatZodError(parsed.error).join("; ")}`);
  }
  const semantic = validateConfigSemantics(parsed.data);
  if (semantic.hasErrors) {
    throw new ScaffoldError(`Refusing to scaffold: ${semantic.errors.map((i) => i.message).join("; ")}`);
  }

  write(path.join(root, CONFIG_FILENAME), JSON.stringify(config, null, 2) + "\n");

  const storeDir = path.join(root, "store");
  write(
    path.join(storeDir, "manifest.json"),
    JSON.stringify(
      {
        $schema: `../${toolRel}/schema/manifest.schema.json`,
        screens: [
          {
            id: "home",
            order: 1,
            enabled: true,
            template: "hero-top",
            source: { filePattern: "{order}-{id}.png", localized: true },
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  write(
    path.join(storeDir, "content", `${defaultLocale}.json`),
    JSON.stringify(
      {
        $schema: `../../${toolRel}/schema/content.schema.json`,
        locale: defaultLocale,
        screens: { home: { eyebrow: null, headline: `${projectName} headline`, caption: null } },
      },
      null,
      2,
    ) + "\n",
  );
  // One raw-capture folder per device the targets render from (the target id's first token).
  const devices = new Set(
    config.targets
      .filter((t) => !t.startsWith("appreview-") && t !== "play-feature-1024x500")
      .map((t) => t.split("-")[0]),
  );
  for (const device of devices) {
    for (const locale of locales) keep(path.join(storeDir, "raw", device, locale));
  }
  for (const sub of ["fonts", "logos", "backgrounds"]) keep(path.join(storeDir, "assets", sub));
  write(path.join(storeDir, "generated", ".gitignore"), "*\n!.gitignore\n");
  write(path.join(storeDir, "README.md"), storeReadme(toolRel));

  // Validate what we wrote.
  loadProject(path.join(root, CONFIG_FILENAME));

  return { created, skipped, config };

  function write(abs: string, text: string) {
    const rel = displayRelative(root, abs);
    if (fileExists(abs) && !opts.force) {
      skipped.push(rel);
      return;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, "utf8");
    created.push(rel);
  }

  function keep(dir: string) {
    write(path.join(dir, ".gitkeep"), "");
  }
}

function defaultToolRelPath(appRoot: string): string {
  // tools/store-shots lives next to the app directory: <workspace>/tools/store-shots
  const here = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), "..");
  return path.relative(appRoot, here).split(path.sep).join("/");
}

/** app.json as Expo writes it ({ expo: {...} }) or flat. */
export function readExpoConfig(root: string): Record<string, unknown> | undefined {
  const file = path.join(root, "app.json");
  if (!fileExists(file)) return undefined;
  const raw = readJsonFile(file);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  const expo = "expo" in obj ? obj.expo : obj;
  return expo && typeof expo === "object" && !Array.isArray(expo) ? (expo as Record<string, unknown>) : undefined;
}

/** Existing fastlane/metadata locale dirs, else CFBundleLocalizations mapped, else en-US. */
export function proposeLocales(root: string, app: Record<string, unknown> | undefined): string[] {
  const onDisk = metadataLocaleDirs(root);
  const ios = app?.ios as { infoPlist?: { CFBundleLocalizations?: string[] } } | undefined;
  const langs = ios?.infoPlist?.CFBundleLocalizations ?? [];
  const mapped: AppStoreLocale[] = [];
  for (const lang of langs) {
    for (const l of APP_LANGUAGE_TO_STORE_LOCALES[lang.split("-")[0]] ?? []) if (!mapped.includes(l)) mapped.push(l);
  }
  const set = new Set<string>([...onDisk, ...mapped]);
  if (set.size === 0) set.add("en-US");
  // en-US first, then alphabetical.
  return [...set].sort((a, b) => (a === "en-US" ? -1 : b === "en-US" ? 1 : a.localeCompare(b)));
}

/** App Store locale folders under fastlane/metadata (not android/ or review_information/). */
export function metadataLocaleDirs(root: string): string[] {
  const metaDir = path.join(root, "fastlane", "metadata");
  if (!dirExists(metaDir)) return [];
  return fs
    .readdirSync(metaDir, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "review_information" && d.name !== "android",
    )
    .map((d) => d.name);
}

function storeReadme(toolRel: string): string {
  return `# store/

Store assets for this app, managed with the workspace store tool
(\`${toolRel}\`, plan: \`${toolRel}/docs/store-tool-plan.md\`).

- \`manifest.json\` — screens, order, template, raw-capture mapping.
- \`content/<locale>.json\` — screenshot copy per App Store locale.
- \`raw/<device>/<locale>/<order>-<id>.png\` — raw simulator captures (never written by the generator).
- \`assets/fonts|logos|backgrounds\` — brand assets; fonts come from \`store-shots fonts add <family>\`.
- \`generated/\` — contact sheets and reports (gitignored).

Generated screenshots go to \`fastlane/screenshots/<locale>/\`; metadata lives in
\`fastlane/metadata/<locale>/\`. Both are what \`fastlane ios screenshots\` / \`metadata\` upload.

\`\`\`sh
npx --prefix ${toolRel} store-shots validate  --project .
npx --prefix ${toolRel} store-shots readiness --project .
\`\`\`
`;
}
