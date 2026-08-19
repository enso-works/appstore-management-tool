# store-shots

App Store screenshot generation and store management for the Expo apps that live next to
this repo. Plan and phase status: `docs/store-tool-plan.md`.

This repo is `tools/store-shots/` inside a plain workspace folder:

```text
<workspace>/
├── tools/store-shots/     this repo
├── starter-template/      Expo SDK 56 app shell, its own repo -- see its NEW-APP.md; ships the store/ scaffold
└── breathe/ invoicer/ ... apps, each its own repo

The workspace folder itself is not a repo; it only groups repos (and may hold unrelated docs).
```

Apps are discovered by scanning the workspace root (three levels up, or `STORE_SHOTS_WORKSPACE`).

Status: Phases 1-4 done — config, schemas, validation, readiness, `init`, `generate`
(Playwright + Sharp, exact-size no-alpha PNGs), `clean`, fonts from Google Fonts, glyph
coverage, in-page font fitting, one template (`hero-top`), the editor UI (live preview,
copy + overrides editing with sliders, save, generate), the Store tab (readiness, metadata
editor with limits, fastlane runner), three templates (hero-top, split-caption, full-bleed-card)
with free phone positioning, headline font, background images/patterns. Phase 7 (hardening,
capture helper, incremental rendering) is next.

## Requirements

Node 22 (`.nvmrc`), npm. No global installs.

```sh
cd tools/store-shots
npm ci
```

## Commands

Run from anywhere; `--project` is an app directory or its `store-shots.config.json`.
Without `--project` the CLI walks up from the current directory.

```sh
npx store-shots projects                          # apps in the workspace that have a config
npx store-shots init      --project ../../breathe # scaffold store/ + config (never overwrites)
npx store-shots validate  --project ../../breathe [--dry-run] [--json]
npx store-shots readiness --project ../../breathe [--json]
npx store-shots generate  --project ../../breathe [--locale en-US] [--screen home] [--target iphone-6.9-1320x2868] [--strict] [--dry-run] [--json]
npx store-shots clean     --project ../../breathe # delete only files listed in .store-shots-manifest.json
npx store-shots fonts add "Space Grotesk" --project ../../breathe   # download once from Google Fonts into store/assets/fonts/
npx store-shots fonts list|check --project ../../breathe
npx store-shots metadata validate|show --locale de-DE --project ../../breathe
npx store-shots lane validate|metadata|screenshots --project ../../breathe [--yes] [--override "<reason>"] [--dry-run]
npm run dev                                       # UI at http://localhost:3000
```

Exit codes: 0 ok, 1 validation/readiness failed, 2 usage or config error.

From an app directory the same thing is:

```sh
npx --prefix ../tools/store-shots store-shots validate
```

## Development

```sh
npm test            # vitest unit tests
npm run typecheck
npm run lint
npm run format
npm run schemas     # regenerate schema/*.schema.json from lib/schema.ts
npm run fixtures    # regenerate fixtures/demo-app
```

## Layout

```text
app/              Next.js UI: project list, /projects/<name> editor (live preview, edit, save, generate), /projects/<name>/readiness; /api/projects/* route handlers
cli/index.ts      commander CLI
lib/
  schema.ts       Zod schemas: project config, manifest, locale content, generated manifest, fonts lock
  targets.ts      device profile registry (iPhone 6.9" 1320x2868, iPad 13" 2064x2752)
  locales.ts      App Store Connect locale codes, RTL table, app-language -> store-locale map
  config.ts       config discovery (walk up / --project), loading, root-bound path resolution
  registry.ts     workspace scan for apps with a config
  content.ts      manifest + per-locale content loaders
  metadata.ts     fastlane/metadata limits (same table as the Fastfile lane), keyword hygiene
  render-plan.ts  target x locale x screen job list, source/output naming
  validate.ts     pre-render validation (plan §13.1)
  readiness.ts    store readiness checks (plan §13.2)
  init.ts         store/ scaffold
  png.ts          PNG header reader; png-write.ts solid-PNG writer for fixtures
  fonts.ts        Google Fonts download (once, into the app), fonts.lock.json, @font-face CSS; Inter bundled in assets/fonts
  generate.ts     generate orchestration: validate -> plan -> render -> flatten -> verify -> atomic write -> manifest
  generated-manifest.ts  .store-shots-manifest.json read/write and manifest-only cleanup
  render/html.tsx render a template to a self-contained HTML document (fonts + image via file:// or /api URLs)
  render/checks.ts in-page checks (fonts loaded, images decoded, text overflow, text/device overlap)
  render/export.ts Playwright Chromium worker + Sharp flatten/inspect
  fastlane.ts     lane allowlist, preflight (readiness gate), spawn with streamed output; never build/submit
  server/         project lookup, atomic JSON saves with etags, HTTP error mapping
  templates/registry.ts  thin adapter over ../templates
templates/        React templates: types, shared pieces (artwork root, device shell, text block, stack layout, patterns), hero-top, split-caption, full-bleed-card
assets/fonts/     bundled Inter (OFL)
schema/           generated JSON Schemas referenced by $schema in app files
fixtures/demo-app two screens, en-US + ar-SA, both targets; used by tests
tests/            vitest
```

## Per-app files (owned by the app)

```text
<app>/store-shots.config.json
<app>/store/manifest.json
<app>/store/content/<locale>.json
<app>/store/raw/<device>/<locale>/<order>-<id>.png   raw simulator captures
<app>/store/assets/{fonts,logos,backgrounds}/
<app>/fastlane/metadata/<locale>/*.txt              read by readiness, edited in Phase 5
<app>/fastlane/screenshots/<locale>/                 output (Phase 2+)
```

The tool never reads credential files (`*.p8`, `asc_api_key.json`) — readiness only checks
that they exist — and never runs lanes that build or submit.
