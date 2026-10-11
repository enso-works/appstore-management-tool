# Docs site plan

The README is the front door; the docs site is the manual. Phases 1 to 3 are built (`site/`);
phase 4, hosting, is not.

## Where it lives and how it is built

- **Source in this repo**, under `site/`, so docs change in the same commit as the feature.
  Pages are MDX; the reference pages that can be generated are (see below).
- **Fumadocs on Next.js**, exported as static files. Same stack as the engine, search built
  in, Geist like the other bavrk sites, no server to run.
- **Served at `store-shots.bavrk.com`** from the bavrk server (Caddy `file_server`, like the
  landing sites), deployed by a GitHub workflow on push to `main` when `site/` or `docs/`
  changes. The DNS record, Caddy block and workflow come from the workspace's site tooling,
  not by hand.
- **Images** come from scripts, never by hand: `mac/docs-shots.sh` for the Mac app, the
  engine's own renders for screenshots and devices, so every image can be retaken after a UI
  change in one run.

## What it covers

| Section           | Pages                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start             | What it is; install (Mac app, CLI only, browser editor); import your first app; your first generate                                                             |
| Design            | Screens and order; the canvas (select, drag, tilt, scale, nudge); copy and fit; captures (drop, simulator capture); views; layers and art; backgrounds; presets |
| Devices           | Every device with its size and rules; the iPhone body and official frames; landscape; iPad; iPhone Duo; header and search images; in-app events; Google Play    |
| Pages             | Default page; custom product pages; optimization tests; per-page text and keywords; generating a page                                                           |
| Listing           | Fields and limits; languages; starting a language; what's new                                                                                                   |
| Ship              | Every check, what it means and how to fix it; review and contact sheets; fastlane lanes; CI with `check`                                                        |
| App Store Connect | The key; status; drafts for pages and treatments; the default page; Asset Library; submitting header and search images; what the tool never does                |
| Templates         | Writing a template (moved from `docs/templates.md`); fields, budgets and overrides                                                                              |
| Art pipeline      | Scenes: Blender and post-processing steps, inputs, quick renders                                                                                                |
| Reference         | CLI (generated from the commands' own help); config, manifest and content files (generated from `schema/`); devices table (from the registry); shortcuts        |
| Help              | Troubleshooting (moved from `docs/troubleshooting.md`); FAQ; changelog                                                                                          |

Generated pages stay true by construction: the CLI reference, the file reference and the
devices table are built from the code at site build time, so they cannot drift.

## Phases

| #   | What lands                                                                                                             | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Done: `site/` with Fumadocs, theme, navigation; Start and Design pages; local preview with `npm run site`              | M    |
| 2   | Done: Devices, Pages, Listing, Ship, App Store Connect; the existing `docs/*.md` moved in (the repo links to the site) | M    |
| 3   | Done: generated reference: CLI, files, devices; a test that fails when a command or schema has no page                 | S    |
| 4   | Hosting: DNS, Caddy, deploy workflow; the README and package homepage link to the site                                 | S    |

## Running it

```sh
npm ci --prefix site     # once: the site has its own install
npm run site             # http://localhost:3120, with docs/images copied in
npm run site:build       # the static site in site/out
```

Its own `package.json` keeps Fumadocs out of the engine's dependencies; the root `tsconfig`,
ESLint and Prettier ignore what the site builds.

## Open questions

Phase 1 went ahead on the defaults below; each is one line to change.

- The domain: `store-shots.bavrk.com`, or a path on bavrk.com (`bavrk.com/store-shots`)? A path
  needs `basePath` in `site/next.config.mjs`. Decided in phase 4.
- The product name on the site: "store-shots", as in the README, for now (`appName` in
  `site/lib/shared.ts`). "Store Shots" is the Mac app's name.
- The Mac app as a download: the site says build from source until the app is signed and
  notarized.
