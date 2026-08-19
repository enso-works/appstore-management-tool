# Store Tool — Screenshot Generation and Store Management Plan

Status: revision 2, approved 2026-08-19; Phases 1-6 complete (Braele iPad/locales pending captures and copy); Phase 7 next
Working name: **store-shots** (directory name; a rename is an open decision, see 3.2)
Last verified against the workspace: 2026-08-19
Executor: Claude Code, phase by phase, with human approval between phases
Supersedes: `~/Downloads/app-store-screenshot-generator-plan.md` (revision 1, written for Codex)

## 1. Executive summary

One workspace-level tool, living next to `starter-template/` and the individual apps, that does two jobs for every app in this folder:

1. **Screenshot generation** — turns raw simulator captures into polished, templated, localized App Store (and later Google Play) screenshots, written straight into each app's `fastlane/screenshots/<locale>/`, which the existing `fastlane ios screenshots` lane already uploads.
2. **Store management** — a local UI and CLI for the rest of the listing: localized metadata (`fastlane/metadata/<locale>/*.txt`), character-limit validation, per-app "store readiness" checks, and one-click invocation of the app's own fastlane lanes (validate, upload metadata, upload screenshots). Credentials stay in each app's `fastlane/` directory; the tool never talks to App Store Connect itself.

The tool is one codebase serving N apps. Each app owns its content (copy, manifest, raw captures, metadata) under a `store/` directory; the tool owns templates, rendering, validation and the UI. New apps get the `store/` scaffold from `starter-template/`.

Revision 1 was written as a single-app, single-purpose generator with Codex as the executor. This revision changes: the executor (Claude Code), the home (its own repo next to the apps, not inside one), the scope (screenshots **and** store management), and replaces the plan's open questions with the answers discovered in this workspace.

## 2. Workspace discovery (Phase 0 findings)

Verified 2026-08-19 in `/Users/enso/PrivateProjects/outloud-expo`.

### 2.1 Apps

| Directory           | App              | Bundle id                    | Expo    | Git                               | fastlane                                              | Store locales                                | Screenshots today                                                                                                                       |
| ------------------- | ---------------- | ---------------------------- | ------- | --------------------------------- | ----------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `breathe/`          | Braele           | `com.bavrk.braele`           | 56.0.20 | yes, remote `enso-works/braele`   | full: Appfile, Deliverfile, Fastfile, ASC key present | en-US, de-DE, es-ES, es-MX, fr-FR, nl-NL, da | 5 × 1320×2868 en-US only (uploaded); raw 1206×2622 captures in `store/screenshots/raw-ios/`; iPad + Play images in `store/screenshots/` |
| `invoicer/`         | Invoit           | `com.bavrk.invoicer`         | 56.0.12 | yes, no remote                    | Appfile, Fastfile, ASC key present, no Deliverfile    | en-US                                        | none                                                                                                                                    |
| `mycv/`             | MyCV             | `com.bavrk.mycv`             | 56.0.12 | yes, no remote                    | Appfile, Fastfile, no keys                            | en-US                                        | none                                                                                                                                    |
| `bed-time-stories/` | bed-time-stories | `com.ensob.bed-time-stories` | 56.0.12 | yes, no remote                    | none                                                  | none                                         | none                                                                                                                                    |
| `outloud/`          | Mindsaid         | `com.bavrk.mindsaid`         | 54.0.32 | yes, remote `enso-works/mindsaid` | none                                                  | none                                         | none                                                                                                                                    |
| `starter-template/` | placeholder      | `com.bavrk.__APP_SLUG__`     | 56.0.12 | **no**                            | Appfile, Deliverfile, Fastfile, CREDENTIALS.md        | en-US                                        | none                                                                                                                                    |

Every app is portrait-only and has `ios.supportsTablet: true`. Apple requires iPad screenshots when the binary supports iPad, so **the iPad 13" target is mandatory, not optional**.

### 2.2 Toolchain

- Package manager: npm (lockfiles everywhere). Node v22.23.0.
- fastlane 2.236.1 via Homebrew, Ruby 4.0.5.
- Fastlane lanes (template and Braele are identical in shape): `ios beta`, `ios validate_metadata`, `ios metadata`, `ios screenshots`, `android internal`. The `Deliverfile` sets `screenshots_path("fastlane/screenshots")`, `overwrite_screenshots(true)`, `skip_binary_upload(true)`, `submit_for_review(false)`.
- **No `snapshot` lane exists in any app.** Raw captures are taken by hand from a booted simulator (`xcrun simctl io booted screenshot`). Braele's README documents this and recommends an iPhone 16 Pro Max simulator (1320×2868) for exact-size captures.
- Braele's `en-US` screenshots are 1320×2868, no alpha, and were accepted by App Store Connect. That settles the canonical 6.9" size.
- Claude Code has the `app-store-optimization` skill and `aso-*` agents available in this workspace; Braele's `store/aso-*.md` files were produced with them. ASO research is **not** part of this tool; the tool consumes and validates the resulting copy.
- The workspace root is not a git repository. Every app directory is its own git repository; `starter-template/` was a loose folder until Phase 1 made it a repo.

### 2.3 Consequences for the plan

- The tool cannot live inside one app repo; it is its own repo at `tools/store-shots/` (section 6).
- The pipeline starts at "raw PNGs exist", not at `snapshot`. A small `capture` helper replaces the `snapshot` step (section 7.4).
- Two targets from day one: `iphone-6.9-1320x2868` and `ipad-13-2064x2752`.
- Store locales are fixed to the seven the template already ships: `en-US`, `de-DE`, `es-ES`, `es-MX`, `fr-FR`, `nl-NL`, `da`. `es-ES` and `es-MX` share source images and app strings but need separate store copy entries.
- Braele is the pilot: it has raw captures, all seven metadata locales, live credentials, and a listing that is already in the store to compare against.

## 3. Decisions

### 3.1 Resolved by discovery

| Question (rev. 1 §26)               | Answer                                                                                                         |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Which repository contains the tool? | `tools/store-shots/` is its own git repo; `starter-template/` is its own; the workspace root is a plain folder |
| Package manager / Node              | npm, Node 22 (add `.nvmrc`)                                                                                    |
| Existing `snapshot` output tree     | None. Raw captures come from `xcrun simctl`; tool provides `capture` helper                                    |
| v1 locales                          | en-US, de-DE, es-ES, es-MX, fr-FR, nl-NL, da                                                                   |
| iPad / landscape                    | iPad yes (mandatory), landscape no                                                                             |
| Canonical iPhone 6.9" output        | 1320×2868                                                                                                      |
| Write Fastlane metadata in v1?      | Yes — metadata management is half the scope now. Writes are explicit and diffed                                |
| Device shells                       | Neutral CSS shell (rounded rect + thin bezel) in v1; no Apple hardware art                                     |
| Pilot app                           | Braele (`breathe/`)                                                                                            |

### 3.2 Still open (defaults apply if not answered)

| Decision                                                                      | Default if unanswered                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace repo and the app repos: ignore, submodule, or absorb? (section 6.1) | **Decided 2026-08-19:** no workspace repo; tool and template are each their own repo, apps keep theirs                                                                                                                 |
| Tool name                                                                     | Keep `store-shots` as the directory/package name                                                                                                                                                                       |
| Brand fonts per app                                                           | **Decided 2026-08-19:** any Google Fonts family. `fonts add <family>` downloads the files once into the app's `store/assets/fonts/`; export never fetches. Inter + Noto fallbacks bundled with the tool as the default |
| The three template designs                                                    | The three in section 10.2 (hero-top, split-caption, full-bleed-card), refined against Braele's five screens                                                                                                            |
| Google Play output in v1?                                                     | No — Phase 8 (after v1); the target registry is designed for it from day one                                                                                                                                           |

## 4. Goals and non-goals

### 4.1 v1 goals

Screenshots:

- Generate exact-size, no-alpha PNGs for every enabled screen × locale × target from raw captures.
- Two or three fixed, direction-aware templates with a small set of semantic controls.
- Copy per store locale without duplicating design configuration.
- Preview every screen and locale before export; flag missing copy, overflow, missing sources.
- Deterministic CLI generation, safe cleanup of tool-owned outputs only.

Store management:

- Edit all `fastlane/metadata/<locale>/*.txt` fields per app in the UI, with live character-limit validation identical to the `validate_metadata` lane.
- Per-app readiness dashboard: locales complete, screenshot count per target/locale, metadata within limits, version alignment, icon present and correct size, credentials present.
- Run the app's own fastlane lanes from the UI/CLI (`validate_metadata`, `metadata`, `screenshots`) with explicit confirmation; stream the log.
- Multi-app: switch between every app in the workspace from one running instance.

Template integration:

- `starter-template/` ships the `store/` scaffold and config so a new app is wired to the tool at creation.

### 4.2 Non-goals for v1

- Drag-and-drop canvas, arbitrary layers, video/App Preview generation.
- Holding App Store Connect or Play credentials, or calling their APIs directly.
- Building binaries (`beta`, `internal` lanes stay manual and are never triggered by the tool).
- Submitting for review. Ever, from this tool.
- ASO research or AI translation inside the tool (those stay with the Claude Code ASO skill; the tool validates the result).
- Google Play images (planned Phase 8), Android metadata, hosted/cloud/multi-user anything.
- Automatic Apple-spec scraping; the device registry is maintained by hand and reviewed on Xcode/App Store Connect changes.

## 5. System boundary

The tool owns: per-app config discovery, content and metadata loading, templates and brand theme, source-image mapping, preview, rendering, validation, tool-owned output files, and _invoking_ fastlane.

fastlane (per app) owns: credentials, `deliver` uploads, builds, release lanes, submission.

Change from revision 1: the tool may **run** an app's fastlane lanes as a subprocess from an explicit user action. It never reads the key files, never sets ASC environment variables, and never adds lanes that upload binaries or submit. This gives "manage the store from one place" without moving credentials out of `fastlane/`.

## 6. Repository layout

### 6.1 The tool repository

Decided 2026-08-19: **the tool is a git repository and the template is a git repository.**
The workspace root is a plain folder that groups repos (and may hold unrelated docs); every
app keeps its own repo.

```text
<workspace>/                           plain folder (not a repo)
├── tools/
│   └── store-shots/                   git repo: the tool
│       ├── .nvmrc  CLAUDE.md  README.md
│       ├── docs/store-tool-plan.md    this document
│       ├── app/  cli/  lib/  templates/  schema/  fixtures/  tests/  scripts/  bin/
│       └── package.json
├── starter-template/                  git repo: the app template; ships store/ + store-shots.config.json
├── breathe/                           own repo (enso-works/braele)
├── invoicer/  mycv/  bed-time-stories/  outloud/   own repos
```

The tool finds apps by scanning the workspace root (three levels above `lib/`, or
`STORE_SHOTS_WORKSPACE`). Nothing outside `tools/store-shots/` is tracked by it. The
template's scaffold references the tool by relative path (`../tools/store-shots/...`), so the
two repos must sit side by side in the workspace as shown.

### 6.2 Per-app layout (owned by the app, read/written by the tool)

```text
<app>/
├── store-shots.config.json            # discovered by walking up from cwd, or --project <path>
├── store/
│   ├── manifest.json                  # screens, order, template, source mapping
│   ├── content/
│   │   ├── en-US.json                 # screenshot copy per store locale
│   │   └── de-DE.json
│   ├── raw/                           # raw captures; never written by the generator
│   │   ├── iphone/                    # one folder per source device class
│   │   │   ├── en-US/01-home.png
│   │   │   └── de-DE/01-home.png
│   │   └── ipad/
│   ├── assets/
│   │   ├── fonts/  logos/  backgrounds/
│   └── generated/                     # non-store outputs (contact sheets, reports); gitignored
└── fastlane/
    ├── metadata/<locale>/*.txt        # edited by the tool's metadata editor
    ├── screenshots/<locale>/*.png     # written by the generator (tool-owned files only)
    └── screenshots/.store-shots-manifest.json
```

Braele already has `store/` with ASO notes and `store/screenshots/raw-ios/`. Phase 6 moves its raw captures into `store/raw/iphone/en-US/` (or points the config at the existing path via `rawScreenshotsPath`) — the config makes both work; the scaffold in the template uses the layout above.

## 7. Architecture

### 7.1 Components

| Component         | Responsibility                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Project registry  | Discover apps in the workspace (any directory with `store-shots.config.json`); switch between them in the UI |
| Config loader     | Read and validate `store-shots.config.json`; resolve all paths against the app root; refuse escapes          |
| Content loader    | Load `store/content/<locale>.json`; fallback rules; direction                                                |
| Metadata store    | Read/write `fastlane/metadata/<locale>/*.txt` with the same limits table the `validate_metadata` lane uses   |
| Source resolver   | Map screen id × locale × target to exactly one raw PNG                                                       |
| Template registry | Fixed templates with declared fields, supported targets, override schema                                     |
| Preview renderer  | Scaled in-browser render using the same components as export                                                 |
| Export renderer   | Playwright Chromium, exact viewport, isolated export route                                                   |
| Image processor   | Sharp: flatten, RGB, dimension/format inspection                                                             |
| Validator         | Schema, files, translations, overflow, output, and store readiness checks                                    |
| Fastlane runner   | Spawn `fastlane ios <lane>` in the app directory, stream output, never pass secrets                          |
| Capture helper    | List booted simulators, capture into `store/raw/<device>/<locale>/` with the right name                      |
| CLI               | `init`, `validate`, `generate`, `clean`, `capture`, `metadata`, `readiness`, `lane`, `fonts`                 |
| Output writer     | Temp file → validate → atomic move; cleanup only files listed in the previous generated manifest             |

### 7.2 Dependencies

Next.js + TypeScript (one codebase for UI, API routes and export route), React, Playwright (Chromium), Sharp, Zod, Vitest, Playwright Test, ESLint + Prettier. Pin exact versions in Phase 1 and commit the lockfile. The tool runs on Node 22 with npm, matching the apps.

### 7.3 Why HTML/CSS templates

Same reasoning as revision 1: preview and export share React components; CSS handles responsive type, gradients, RTL; Playwright gives exact-pixel captures; local fonts load in the same environment used for export. The export route renders only the artwork root; editor chrome never appears in it.

### 7.4 Capture helper (replaces `snapshot`)

There is no XCUITest harness in these Expo apps and adding one is not worth it for a handful of screens. Instead:

```sh
store-shots capture --device iphone --locale en-US --screen home
```

- Lists booted simulators via `xcrun simctl list devices booted --json`; picks the one whose screen size matches the source device class (`iphone` → 1320×2868 = iPhone 16 Pro Max class; `ipad` → 2064×2752 = iPad Pro 13").
- Runs `xcrun simctl io <udid> screenshot` into `store/raw/<device>/<locale>/<order>-<screen>.png`.
- Optionally sets the simulator's status bar to a clean 9:41 / full battery / full signal via `simctl status_bar override` before capturing.
- The user navigates the app by hand; the helper only names and files the capture. Localized captures mean switching the simulator language and re-running per locale — the helper prints the exact `simctl` commands to do that.

Raw captures at a smaller device (Braele's 1206×2622) remain usable: templates place the capture inside a shell at template-defined scale, so the raw pixel size only needs a matching aspect ratio.

## 8. Configuration

### 8.1 `store-shots.config.json` (per app)

```json
{
  "$schema": "../tools/store-shots/schema/project.schema.json",
  "projectName": "Braele",
  "bundleId": "com.bavrk.braele",
  "defaultLocale": "en-US",
  "locales": ["en-US", "de-DE", "es-ES", "es-MX", "fr-FR", "nl-NL", "da"],
  "paths": {
    "manifest": "store/manifest.json",
    "content": "store/content",
    "raw": "store/raw",
    "assets": "store/assets",
    "outputScreenshots": "fastlane/screenshots",
    "metadata": "fastlane/metadata",
    "generated": "store/generated"
  },
  "targets": ["iphone-6.9-1320x2868", "ipad-13-2064x2752"],
  "sourceDevices": {
    "iphone-6.9-1320x2868": "iphone",
    "ipad-13-2064x2752": "ipad"
  },
  "brand": {
    "font": { "family": "Inter", "source": "google", "weights": [400, 600, 700] },
    "primary": "#B2DCD5",
    "onPrimary": "#0F1F1D"
  },
  "output": { "format": "png", "backgroundColor": "#FFFFFF", "cleanBeforeRender": true },
  "validation": {
    "strictTranslations": true,
    "failOnOverflow": true,
    "failOnAlpha": true,
    "screensPerTarget": { "min": 3, "max": 10 }
  },
  "metadata": {
    "manage": true,
    "fields": [
      "name",
      "subtitle",
      "keywords",
      "promotional_text",
      "description",
      "release_notes",
      "support_url",
      "marketing_url",
      "privacy_url"
    ]
  },
  "fastlane": {
    "enabled": true,
    "lanes": { "validate": "ios validate_metadata", "metadata": "ios metadata", "screenshots": "ios screenshots" }
  }
}
```

All relative paths resolve from the app root (the directory containing the config), never from the shell cwd. Paths that resolve outside the app root are rejected at load time.

### 8.2 `store/manifest.json`, `store/content/<locale>.json`

Unchanged from revision 1 in shape (screens with `id`, `order`, `enabled`, `template`, `source.filePattern`, `overrides`; content with `locale`, `direction`, `screens.<id>.<field>`). Two additions:

- `source.filePattern` interpolates `{device}` and `{locale}` and defaults to `{order}-{id}.png` inside `raw/<device>/<locale>/`, so most manifests need no pattern at all.
- `source.localized: false` lets a screen use the default-locale capture for every locale (useful when the UI is not translated yet or the screen is language-neutral, like Braele's orb).

Screenshot copy (`store/content`) and store metadata (`fastlane/metadata`) stay separate files with separate keys. Both are edited in the UI; the tool never copies one into the other.

### 8.3 Device profile registry

```ts
export const targetProfiles = {
  "iphone-6.9-1320x2868": {
    platform: "ios",
    family: "iphone",
    displayClass: "6.9-inch",
    orientation: "portrait",
    width: 1320,
    height: 2868,
  },
  "ipad-13-2064x2752": {
    platform: "ios",
    family: "ipad",
    displayClass: "13-inch",
    orientation: "portrait",
    width: 2064,
    height: 2752,
  },
  // Phase 8:
  // "play-phone-1080x1920": { platform: "android", family: "phone", ... },
  // "play-feature-1024x500": { platform: "android", family: "feature-graphic", ... }
} as const;
```

Registry changes go through a review of Apple's screenshot specification page (section 26). As of the verification date Apple accepts 1–10 screenshots per device class per locale and rejects alpha channels.

## 9. Rendering pipeline

Preview: load validated config → render template at real aspect ratio → CSS scale-down → in-page overflow observation → badges.

Export, for every enabled target × locale × screen:

1. Resolve and validate the source PNG.
2. Reuse one Playwright Chromium; open an isolated export route with an opaque job id.
3. Viewport = target width × height, device scale factor 1.
4. Await `document.fonts.ready` and image decode; await the page's render-ready marker.
5. Run in-page overflow and missing-asset checks.
6. Capture the artwork element only.
7. Sharp: flatten onto the configured background, force RGB, no alpha.
8. Write temp file → inspect width/height/format/channels → atomic move into `fastlane/screenshots/<locale>/`.
9. Record checksum, inputs and result in `.store-shots-manifest.json`.

Determinism: committed lockfile, local fonts, no network during export, explicit sort order for locales/targets/screens, fixed viewport/timezone, animations disabled in export mode, no timestamps in artwork. Incremental rendering (skip when input checksums match the previous manifest) is Phase 7.

## 10. Templates

### 10.1 Contract

```ts
type TemplateProps = {
  target: TargetProfile;
  locale: LocaleContent;
  screen: ScreenDefinition;
  sourceImageUrl: string;
  brand: BrandTheme;
  mode: "preview" | "export";
};
```

Each template publishes: stable id, display name, required/optional text fields, supported families and orientations, default style values, an override schema (Zod), safe text-area bounds, and an overflow-check strategy.

### 10.2 The three v1 templates

1. **Hero Top** — eyebrow + headline at top, device shell centered below, gradient/solid background. Braele screens 1, 2, 4.
2. **Split Caption** — text block upper-left (upper-right in RTL), device shell entering from the opposite lower corner. Braele screen 3 (settings/health).
3. **Full Bleed Card** — capture fills most of the canvas, headline on a high-contrast card. Braele's orb screen.

Controls (decided 2026-08-19 after reviewing Braele's hand-made store art): background colour/gradient, background image (`asset:` under `store/assets/` or built-in `pattern:waves|dots|grid`), phone scale, phone X/Y offset (fractions of canvas width so values carry across targets), tilt, text column width/side/vertical offset, text alignment, text colour, shell. Numeric values are sliders in the editor; no drag-and-drop canvas, but enough freedom to reproduce existing designs. Text overlapping the device is a warning unless `validation.failOnTextOverlap` is set.

Both targets are portrait with different aspect ratios (0.46 vs 0.75); every template must declare and test its iPad layout, not just scale the phone one.

## 11. Output conventions

```text
fastlane/screenshots/en-US/01_home_IPHONE_69.png
fastlane/screenshots/en-US/01_home_IPAD_PRO_129.png
```

`deliver` recognises the device class from image dimensions, so the suffix is for humans and collision avoidance. The exact `deliver` filename expectations for 6.9"/13" are verified against fastlane 2.236.1 in Phase 2 (a quick `deliver --skip_metadata --skip_binary_upload` dry run against Braele's existing files, which are already accepted, is the reference).

`fastlane/screenshots/.store-shots-manifest.json` lists every tool-generated file. `clean` and `cleanBeforeRender` remove only files listed there. Braele's five hand-made `en-US/0N.png` files are not in the manifest and are therefore never touched until the user deletes them.

## 12. Localization workflow

- Locale and screen selectors; inputs generated from the template's declared fields; reference locale side by side; character count and overflow state; badges: complete / missing / fallback / overflow / missing-source.
- Default locale defines the key set. Unknown keys in other locales are errors in strict mode. Missing strings block production generation. Preview may show fallback copy, marked as fallback.
- Font fitting only within a template's declared range; if the minimum size still overflows, generation fails. No ellipsis truncation, ever.
- RTL support is built in from Phase 3 even though the seven v1 locales are all LTR; the fixture project carries one RTL locale so it stays tested.
- Fonts: default Inter (OFL) with Noto Sans fallbacks for Cyrillic/Greek/Arabic/Hebrew/CJK, bundled under `tools/store-shots/assets/fonts/`. Per app, `brand.font.family` names any Google Fonts family; `store-shots fonts add "Space Grotesk" --project <app>` downloads the static TTF/WOFF2 files (and the OFL license text) from Google Fonts into `store/assets/fonts/<family>/` once, and `fonts.lock.json` records the exact files. Export and preview load only those local files — no request to fonts.googleapis.com at render time, so output stays deterministic and works offline. Glyph coverage check in Phase 3.
- CSV round-trip is out of v1. JSON is canonical.

## 13. Metadata and store management

This section is new in revision 2.

### 13.1 Metadata editor

- Reads/writes `fastlane/metadata/<locale>/<field>.txt` for the fields listed in config.
- The limits table is a single source of truth in the tool and is the same table the Fastfile lane uses: name 30, subtitle 30, keywords 100, promotional_text 170, description 4000, release_notes 4000, URLs 255. Character count is code-point based, matching Ruby `String#length`.
- Keywords field: shows a chip view (split on `,`), flags spaces after commas, duplicates, and words already present in name/subtitle (Apple ignores those; the space is wasted).
- Missing locale directories are created only when the user adds that locale explicitly; the tool never invents a locale.
- Diff view before writing when the file changed since load; atomic write; trailing newline normalized.
- Release notes: an "apply to all locales" helper for the common case of an identical technical note, marked so it can be revisited.

### 13.2 Readiness dashboard (per app)

| Check        | Rule                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locales      | every locale in config has a metadata directory and every managed field is present and non-empty                                                                                            |
| Limits       | every field within its limit                                                                                                                                                                |
| Screenshots  | for each target and locale, count within `screensPerTarget`, dimensions exact, no alpha                                                                                                     |
| Consistency  | the same screen set exists in every locale (no locale missing screen 3)                                                                                                                     |
| Version      | `app.json` `expo.version` matches what `Deliverfile` will send (it reads app.json, so this checks release_notes was updated since the last version bump, tracked in the generated manifest) |
| Icon         | `assets/icon.png` exists, 1024×1024, no alpha                                                                                                                                               |
| Credentials  | `fastlane/asc_api_key.json` and `AuthKey_*.p8` exist (existence only; contents never read)                                                                                                  |
| Placeholders | no `__APP_SLUG__`-style tokens left in `app.json`, `Fastfile`, metadata                                                                                                                     |

Each check yields pass / warn / fail with a one-line fix hint. `readiness --json` is CI-friendly.

### 13.3 Fastlane runner

- Buttons/commands: `validate` (`ios validate_metadata`), `upload metadata` (`ios metadata`), `upload screenshots` (`ios screenshots`).
- Runs `fastlane <lane>` with cwd = app root, inherits the user's PATH (Homebrew fastlane, rbenv Ruby), streams stdout to the UI log, exit code shown.
- Upload actions require a confirmation that names the app, bundle id and lane. `readiness` fails block the upload buttons unless the user overrides with a stated reason (logged).
- The runner has an allowlist of lanes from config; it never runs `beta`, `internal`, or anything not listed.

## 14. Validation

Pre-render, in-page and post-render checks are as in revision 1 §13, plus the readiness checks above. Modes:

- `preview` — warnings visible, non-blocking.
- `generate` — per-job failure, complete summary, non-zero exit if any job failed.
- `generate --strict` — any strict-configured warning blocks all new output.
- `validate` — everything possible without writing screenshots.
- `readiness` — the store checks only.

## 15. CLI

```sh
# From the workspace root; --project defaults to the app found by walking up from cwd
npm --prefix tools/store-shots run dev                                  # start the UI (all apps discoverable)
npm --prefix tools/store-shots run cli -- init      --project breathe   # scaffold store/ + config in an app
npm --prefix tools/store-shots run cli -- capture   --project breathe --device iphone --locale en-US --screen home
npm --prefix tools/store-shots run cli -- validate  --project breathe
npm --prefix tools/store-shots run cli -- generate  --project breathe [--strict] [--locale de-DE] [--screen home] [--target ipad-13-2064x2752]
npm --prefix tools/store-shots run cli -- clean     --project breathe
npm --prefix tools/store-shots run cli -- metadata  --project breathe validate|diff|write
npm --prefix tools/store-shots run cli -- readiness --project breathe [--json]
npm --prefix tools/store-shots run cli -- lane      --project breathe validate|metadata|screenshots [--yes]
npm --prefix tools/store-shots run cli -- fonts     --project breathe add "Space Grotesk" | list | check
```

Requirements: `--json` for CI, non-zero exit on failure, no prompts in CI mode, `--dry-run` prints the plan, errors name project/target/locale/screen/file/rule. A `store-shots` bin alias is added in Phase 1 so `npx store-shots ...` works from any app directory.

## 16. Web UI

- Top bar: app switcher (every discovered app), target, readiness summary, Generate.
- Left: ordered screens with badges. Main: scaled preview. Right: locale, template, copy fields, allowed overrides.
- Second view "Store": metadata editor per locale with limits, readiness dashboard, fastlane runner log.
- Explicit Save; server routes validate before writing; atomic writes; path traversal rejected; conflict on stale file.
- Localhost only.

## 17. Fastlane integration (per app)

Nothing new is required in the Fastfile for v1: the tool writes where `screenshots_path` already points and the `screenshots`/`metadata` lanes upload it. Two optional additions, added by `init` when missing:

```ruby
desc "Validate store readiness with store-shots (screenshots + metadata), no upload"
lane :store_validate do
  sh("npx --prefix ../tools/store-shots store-shots readiness --project . --json")
  validate_metadata
end
```

`invoicer/`, `mycv/` and `outloud/` lack a `Deliverfile`; Phase 6 copies the template's. Nothing changes in `beta`/`internal`. `submit_for_review(false)` stays.

## 18. Testing

- Unit (Vitest): config/paths/root boundary, locale completeness and fallback, manifest uniqueness, source interpolation, output naming, render plan, metadata limits and keyword checks, manifest-based cleanup, readiness rules.
- Template contract: fields declared, targets declared, LTR/RTL render, long copy overflows, missing image fails actionably, export root has no editor UI, both target aspect ratios.
- Golden images: fixture project (2 screens, 2 locales incl. one RTL, both targets, bundled fonts), tolerant pixel diff, pinned Chromium.
- End-to-end (Playwright Test): open fixture app, edit headline, save, change template, generate, verify files/manifest, strict fails on missing translation, cleanup leaves foreign files, metadata edit blocked at 31 chars.
- Fastlane smoke (manual, on this Mac, Braele): `readiness`, `generate`, then `fastlane ios screenshots` against a non-live version, inspect in App Store Connect. Never `submit_for_review`.

## 19. Security and safety

- No credentials read, stored, requested or logged. Existence checks only.
- Server binds to localhost.
- All paths resolved and validated against the app root; `..` and symlink escapes rejected.
- Fastlane runner: allowlisted lanes only, no shell interpolation of user input, cwd pinned to the app root.
- Never delete outside the generated manifest; never wipe `fastlane/screenshots/` or `fastlane/metadata/`.
- No remote assets during export. PNG logos only.

## 20. Performance targets

Preview update < 300 ms after debounce; project load < 2 s; export < 2 s per screenshot after browser start; 10 screens × 7 locales × 2 targets (140 images) in a few minutes on a laptop without unbounded memory; incremental rendering in Phase 7.

## 21. Observability

Job key `<project>/<target>/<locale>/<screen>`; human-readable failures name the file and key to edit; generation summary with planned/rendered/skipped/warned/failed/duration; stable JSON report.

## 22. Implementation phases

Each phase ends in working, testable behavior and a commit set. Claude Code executes; the user approves before the next phase starts (section 25).

### Phase 0 — Discovery and decisions (done in this document)

Sections 2 and 3. Remaining open decisions default as stated in 3.2.

### Phase 1 — Workspace repo, tool skeleton, schemas, fixture

- `git init` in `tools/store-shots/` and in `starter-template/`; `.gitignore`, `.nvmrc`, `README.md`, `CLAUDE.md` for the tool.
- `tools/store-shots/`: Next.js + TS, ESLint/Prettier, Vitest, lockfile, `store-shots` bin.
- Zod schemas + generated JSON Schemas for config, manifest, content, target registry.
- Project registry (workspace scan) and config discovery (walk up / `--project`).
- Fixture project under `tools/store-shots/fixtures/demo-app/` with both targets, `en-US` + one RTL locale, two screens, bundled fonts.
- `validate` and `readiness` (schema + file presence subset) commands.
- `init` scaffolds `store/` + config into an app; run it on `starter-template/` and update `NEW-APP.md` section 10.

Acceptance: fresh `npm ci` works on Node 22; `validate` passes for the fixture and fails actionably on a broken copy; `readiness` reports correctly on Braele (which will show missing screenshots for six locales); the tool repo has clean atomic commits.

### Phase 2 — First template and exact PNG export

- Template registry + `hero-top` (both targets), neutral device shell.
- `fonts add/list/check`: Google Fonts download into `store/assets/fonts/`, `fonts.lock.json`, `@font-face` generation from local files; `readiness` warns when a configured family has no local files.
- Isolated export route, local fonts, Playwright worker, Sharp flatten/inspect, output naming, atomic write, generated manifest, `clean`.
- Verify `deliver` naming/dimension expectations against fastlane 2.236.1 with Braele's accepted files.

Acceptance: one command renders valid PNGs for the fixture in both locales and both targets; exact dimensions; no alpha; repeat runs stable; `clean` removes only manifest-listed files.

### Phase 3 — Localization and overflow safety

- Strict locale loading, fallback marking, RTL, bounded font fitting, overflow detection, glyph coverage check.
- Long-copy, CJK, RTL fixtures; locale-specific actionable failures.

Acceptance: strict generation fails on missing translation/overflow; LTR/RTL fixtures render correctly; nothing truncates.

### Phase 4 — Editor UI (screenshots)

- App switcher, screen list, locale/target selectors, preview canvas, property panel, badges, save endpoints, generate current/all, summary panel.

Acceptance: edit → save → preview → generate without touching JSON by hand; UI and CLI share the renderer; invalid edits rejected with field-level messages.

### Phase 5 — Store management

- Metadata editor with limits/keyword checks/diff/atomic write.
- Full readiness dashboard.
- Fastlane runner with allowlist, confirmation, streaming log; `lane` CLI command.

Acceptance: Braele's seven locales are editable with live limits; readiness matches the `validate_metadata` lane's verdict exactly; `lane validate` runs the real lane and shows its output; upload lanes require confirmation and are blocked by readiness failures.

### Phase 6 — Remaining templates, brand controls, and the Braele pilot

- `split-caption`, `full-bleed-card`, brand theme, semantic overrides, template contract tests, golden images, all-screens/all-locales grids.
- Braele: config, manifest, content for seven locales (copy from `store/aso-metadata.md` and existing screenshots), raw captures moved or referenced, iPad captures taken with the `capture` helper, full generation, `fastlane ios screenshots` smoke test.
- Add `Deliverfile` to `invoicer/`, `mycv/` and run `init` on them.

Acceptance: 3 templates × 2 targets × 7 locales generate for Braele; a safe `deliver` preview/upload of screenshots succeeds; nothing is submitted.

### Phase 7 — Hardening

- Incremental rendering by checksum, CI JSON, security/path tests, capture helper polish, troubleshooting and template-authoring docs, `README.md` for the tool and workspace.

Acceptance: full Braele matrix regenerates reproducibly; all tests pass; a new developer can follow the READMEs.

### Phase 8 — Google Play (post-v1)

- `play-phone-1080x1920` (or reuse iPhone output where accepted) and `play-feature-1024x500` targets, `fastlane/metadata/android/<locale>/images/` output, Play short/full description limits in the metadata editor, `supply` lane wiring.

## 23. Definition of Done for v1

- Three fixed templates working for iPhone 6.9" and iPad 13".
- Seven store locales supported end to end for screenshots and metadata.
- Local UI: copy editing, template selection, preview, save, generate, metadata editing, readiness, lane runner.
- Headless CLI for `validate`, `generate`, `readiness`, `metadata`, `lane`, `capture`, `fonts`.
- Exact-dimension, no-alpha PNGs; strict missing-translation and overflow failures; deterministic order; manifest-owned cleanup.
- Braele fully generated and uploaded via its own `screenshots` lane; `starter-template/` scaffolded; the other apps `init`-ed.
- Unit, template, golden, e2e tests green; Fastlane smoke test performed on Braele.
- No credentials handled by the tool; no binaries built; nothing submitted.

## 24. Risks and mitigations

| Risk                                                    | Mitigation                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Browser text rendering drift between runs/machines      | Pinned Chromium via Playwright, bundled fonts, tolerant goldens                      |
| Long DE/FR/NL copy breaks layouts                       | Safe regions, bounded fitting, strict overflow, locale grid                          |
| Hand captures are inconsistent (status bar, dev labels) | `capture` helper with status-bar override; readiness warns on odd raw dimensions     |
| iPad layouts treated as scaled phone layouts            | Every template declares and tests an iPad layout                                     |
| Tool overwrites human-made screenshots                  | Manifest-owned cleanup only; Braele's existing files untouched until deleted by hand |
| Running fastlane from a UI invites accidental uploads   | Allowlist, confirmation naming app + lane, readiness gate, no build/submit lanes     |
| Tool, template and apps live in different repos         | Tool finds apps by folder layout, not git; documented in `CLAUDE.md`/README          |
| Apple changes accepted sizes                            | Central registry, spec link, review on change                                        |
| Scope creep into a design tool                          | Fixed templates and semantic controls only                                           |

## 25. Claude Code execution protocol

Replaces revision 1 §27 (Codex kickoff prompt).

### 25.1 Tool `CLAUDE.md` (created in Phase 1)

Contents, in brief:

- Layout: this repo is `tools/store-shots/` inside a plain workspace folder; `../../starter-template/` is the app template; sibling app directories are independent git repositories — never commit inside them as a side effect of tool work.
- The plan is `docs/store-tool-plan.md`; work proceeds one phase at a time; do not start the next phase without approval.
- Never touch `fastlane/*.p8`, `asc_api_key.json`, `play_service_account.json`; existence checks only.
- Never add or run lanes that build or submit; `submit_for_review` stays false.
- Commits: atomic, one logical change each, no emojis; ask before committing (per the user's global rules).
- After each phase: run the phase tests, run `/code-review`, report changed files, commands, results, remaining risks, and update the phase checklist in this plan.
- npm, Node 22 (`.nvmrc`), fastlane via Homebrew, Ruby via rbenv/homebrew (not system Ruby, see `starter-template/NEW-APP.md` gotchas).

### 25.2 Phase kickoff prompt

> Read `docs/store-tool-plan.md` and `CLAUDE.md`. Verify the current state against the acceptance criteria of all earlier phases. Implement only Phase N. Do not modify files inside app directories except where the phase explicitly says so (and then only the `store/`, `store-shots.config.json`, `fastlane/metadata`, `fastlane/screenshots`, `fastlane/Deliverfile` paths named in the plan). Run the phase's tests, then `/code-review`. Report changed files, commands, results and remaining risks, and propose the atomic commit set. Do not commit until I confirm.

### 25.3 Where the ASO skill fits

Keyword research, competitor analysis and per-market copy stay with the `app-store-optimization` skill and `aso-*` agents (already used for Braele's `store/aso-*.md`). Their output is pasted into the tool's metadata editor and content files, where it is validated and shipped. The tool does not call those agents; that separation keeps generation deterministic.

## 26. Authoritative references

- Fastlane `deliver`: https://docs.fastlane.tools/actions/deliver/
- Fastlane `snapshot` (not used; reference for naming): https://docs.fastlane.tools/actions/snapshot/
- Fastlane `supply` (Phase 8): https://docs.fastlane.tools/actions/supply/
- Apple screenshot specifications: https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- `xcrun simctl` (`io screenshot`, `status_bar override`): `xcrun simctl help`
- Expo SDK 56 docs (per app `AGENTS.md`): https://docs.expo.dev/versions/v56.0.0/

Recheck Apple and fastlane docs when bumping the device registry or the fastlane version.

## 27. Phase checklist

- [x] Phase 0 — discovery and decisions (this document)
- [x] Approval of revision 2 (2026-08-19: defaults accepted; fonts from Google Fonts)
- [x] Phase 1 — tool + template repos, skeleton, schemas, fixture, `init` on template (2026-08-19; also `init` on Braele so readiness could be verified against a real app)
- [x] Phase 2 — hero-top + exact export (2026-08-19: Playwright + Sharp, `generate`/`clean`, `fonts add|list|check` from Google Fonts, Inter bundled; Braele en-US iPhone set generated from its existing captures)
- [x] Phase 3 — localization + overflow (2026-08-19: in-page font fitting within template range, line-based overflow check, glyph coverage via opentype.js, font fallback stack, Noto Sans Arabic bundled)
- [x] Phase 4 — editor UI (2026-08-19: app switcher, screen list with badges, live iframe preview using the export HTML, copy fields with reference locale, semantic overrides, add/remove/reorder screens, atomic save with etag conflicts, generate screen/all with log)
- [x] Phase 5 — store management (2026-08-19: Store tab with readiness dashboard, metadata editor with limits/keyword hygiene/etag conflicts/explicit locale creation, fastlane runner with allowlist, confirmation, readiness gate and streamed log; CLI `metadata validate|show`, `lane <key> [--yes] [--override]`)
- [x] Phase 6 — remaining templates + Braele pilot (2026-08-19: split-caption and full-bleed-card; free phone positioning (scale, X/Y offset, tilt), text column width/side/offset, headline font (Google Fonts), background images and built-in patterns, text colour; Braele en-US iPhone set recreated in its existing store style; Deliverfile + init for invoicer and mycv. Still open for Braele: iPad captures, the six other locales' copy, `deliver` smoke test)
- [ ] Phase 7 — hardening
- [ ] Phase 8 — Google Play (post-v1)
