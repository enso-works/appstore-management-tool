# Hosted store-shots — plan

Status: revision 1, **draft for approval** (2026-08-28). Nothing built yet.
Relationship to `store-tool-plan.md`: that plan describes the local tool (v1.1.0, shipped). This
one describes putting the same engine online for people outside this workspace. The local tool
keeps working exactly as it does; nothing here removes a capability from it.
Executor: Claude Code, phase by phase, with approval between phases.

## 1. Executive summary

The local tool already does the hard part: it turns raw captures plus localized copy into
exact-size, deterministic store artwork, and it checks the result (overflow, glyph coverage,
device overlap, metadata limits) before anything ships. What it cannot do is serve anyone who is
not sitting in this workspace with Node, Xcode and fastlane installed.

Hosting it means three changes and nothing else of substance:

1. **Storage** moves from the filesystem to Postgres + object storage.
2. **Captures** arrive by upload (and later from a small local agent) instead of `xcrun simctl`.
3. **Delivery** hands back a ZIP the customer uploads themselves, instead of running their
   fastlane lanes for them.

Everything else — templates, the renderer, validation, the editor UI — ports as-is.

**The wedge is localization, not prettiness.** Any of the existing screenshot services will make
one nice-looking image. None of them will tell a solo developer that their German headline
overflows on the 6.9-inch canvas at the minimum allowed font size, that Arabic needs a fallback
family for three glyphs, or that the third screenshot in a Play set is stale relative to its
capture. That is what this codebase is for, and it is what a hosted version should sell.

## 2. Where the value already is

Verified against the code on 2026-08-28.

| Piece                                                                       | Hosted status                                                     |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `templates/` (15 layouts, decor toolkit, contract tests)                    | ports unchanged                                                   |
| `lib/render/html.tsx`, `ssr.ts`, `fit.ts`, `checks.ts`                      | ports unchanged                                                   |
| `lib/render/export.ts` (Playwright + sharp)                                 | ports; runs in a worker container instead of the CLI process      |
| `lib/validate.ts`, `lib/metadata.ts`, `lib/glyphs.ts`, `lib/locales.ts`     | ports; only the file reads at the edges change                    |
| `app/` editor UI                                                            | ports; every `fs` read behind it becomes an API call              |
| `lib/config.ts`, `lib/content.ts`, `lib/paths.ts`, `lib/server/projects.ts` | **replaced** by a repository layer over Postgres + object storage |
| `lib/capture.ts` (`xcrun simctl`)                                           | stays local; becomes the sync agent                               |
| `lib/fastlane.ts` (lane runner)                                             | stays local; the hosted product hands back files                  |

**The seam that makes this cheap.** `ArtworkUrls` in `lib/render/html.tsx` already injects every
external reference the artwork needs — capture, per-slice captures, fonts, assets, device frames —
as functions returning URLs. The export path passes `file://` URLs; the editor preview already
passes `/api/...` URLs. Pointing them at signed object-storage URLs is a configuration change, not
a refactor. This is the single reason the estimate below is weeks and not months.

Measured on this machine for sizing: the fixture project renders 8 exact-size PNGs in 3.0 s
including Chromium start-up; the 15 catalogue previews (three of them 3-slice strips at
3960×2868) render in about the same order of magnitude.

## 3. Scope

### 3.1 In scope for v1

- Accounts, one organisation per account, several apps per organisation.
- Upload raw captures (drag and drop, one device class at a time).
- The existing editor: screens, templates, overrides, per-locale copy with overflow feedback.
- Render on demand; download the result as a ZIP laid out exactly as `deliver`/`supply` expect
  (`fastlane/screenshots/<locale>/…`, `fastlane/metadata/android/<locale>/images/…`).
- Import and export the `store/` JSON so a project can move between the hosted app and the CLI in
  either direction.
- Metadata editing with the same limits and keyword hygiene as the local Store tab.
- The Listing preview (product page + fold), which is the thing people will screenshot and share.

### 3.2 Explicitly out of scope for v1

- **Holding App Store Connect keys or Google service accounts.** No submission, no upload on the
  customer's behalf. See §10 for the bar that must be met before this changes.
- Building or archiving apps; anything that needs Xcode on our side.
- App Preview video rendering.
- Real-time multiplayer editing (optimistic concurrency with etags is enough; the local tool
  already works this way).
- Custom template authoring by customers (presets and overrides only — see §16, D-6).

## 4. Who it is for

Solo developers and two-to-five person teams shipping to more than one locale, who already have
fastlane in the repo and do not want a design tool. Not enterprises (they have designers), not
people shipping one English screenshot (a free web tool is fine for them).

Consequence for the product: **the first five minutes must end in a downloaded ZIP.** Sign up,
upload five captures, pick a template, type one headline, download. Everything else — locales,
strips, the Listing view — is discovered afterwards.

## 5. Architecture

### 5.1 Components

```text
browser ── Next.js app (UI + API)          container, 1 instance to start
              │
              ├── Postgres            projects, screens, copy, jobs, accounts   (bavrk-db, existing)
              ├── R2                  captures, generated PNGs, fonts, frames   (Cloudflare, existing)
              └── job queue           pg-boss on the same Postgres
                        │
                        └── render worker   container with Chromium + sharp, N replicas
```

Deployed on bavrk-server alongside the other properties: same VPS, same Postgres instance, same
GitHub Actions deploy shape, Cloudflare in front. No new vendor for v1.

### 5.2 What has to change in the code

1. **A repository interface.** `lib/server/projects.ts` and `lib/content.ts` become one interface
   (`loadProject`, `saveManifest`, `saveContent`, `listAssets`, …) with two implementations: the
   existing filesystem one (used by the CLI and the local UI) and a Postgres one. The zod schemas
   in `lib/schema.ts` stay the single source of truth for shape and validation in both.
2. **Asset URLs.** `ArtworkUrls` implementations that return signed R2 URLs, plus a font resolver
   that reads from R2 instead of `assets/fonts`.
3. **Render jobs.** `generateProject` splits into "plan" (pure, already is) and "execute one job"
   so the worker can take a single render off the queue. The inputs hash that drives incremental
   rendering becomes the cache key — it already includes tool version, template source hash,
   fonts, copy, overrides and captures, so it works unchanged.
4. **No `resolveWithin` at the edges.** Path-escape guards exist because paths come from a
   manifest; with object storage the equivalent guard is "asset ids belong to this org".

### 5.3 Repository split

Recommended: extract a **core package** from this repo and consume it from both sides.

```text
store-shots-core/     templates, lib/render, lib/validate, lib/schema, lib/targets, lib/locales
store-shots/          the CLI + local UI (this repo), depends on core
store-shots-web/      the hosted app + worker, depends on core
```

The alternative — one repo with a `web/` directory — is less work now and worse later, because
the hosted app will want to deploy on a different cadence than the local tool. Decision D-1.

## 6. Data model (first cut)

Mapped one-to-one from the existing schemas, so import/export is mechanical.

| Table             | Columns (essentials)                                                                                             | From                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `orgs`            | id, name, plan, created_at                                                                                       | new                               |
| `users`           | id, email, org_id, role                                                                                          | new                               |
| `projects`        | id, org_id, slug, name, bundle_id, default_locale, locales[], targets[], brand jsonb, validation jsonb           | `store-shots.config.json`         |
| `screens`         | id, project_id, screen_id, order, enabled, template, source jsonb, panorama jsonb, overrides jsonb, layers jsonb | `store/manifest.json`             |
| `content`         | project_id, locale, direction, screens jsonb                                                                     | `store/content/<locale>.json`     |
| `assets`          | id, project_id, kind (capture/background/logo/font), device, locale, name, r2_key, bytes, sha256                 | `store/raw/**`, `store/assets/**` |
| `metadata_fields` | project_id, locale, field, value                                                                                 | `fastlane/metadata/**`            |
| `renders`         | id, project_id, target, locale, screen_id, slice, inputs_sha256, r2_key, sha256, created_at                      | `.store-shots-manifest.json`      |
| `jobs`            | pg-boss tables                                                                                                   | new                               |

`renders.inputs_sha256` is the existing incremental-render hash: same value means the stored PNG
is still correct, which gives caching and the Release tab's staleness view for free.

## 7. Object storage layout

```text
r2://store-shots/
  orgs/<org>/projects/<project>/captures/<device>/<locale>/<file>.png
  orgs/<org>/projects/<project>/assets/<rel>
  orgs/<org>/projects/<project>/renders/<inputs_sha256>.png
  fonts/<family>/<file>.ttf                     shared, OFL only
  frames/<name>.png                             shared, from fastlane frameit
```

Renders are keyed by their inputs hash, so identical inputs across projects share nothing (keys
are org-scoped) but re-rendering the same project is free.

## 8. Phase 1 deliverable: the render service

Built first, standalone, and useful even if the rest is never built (CI, a hosted preview, the
local tool offloading work).

```http
POST /v1/render
{
  "target":   "iphone-6.9-1320x2868",
  "locale":   "de-DE",
  "direction":"ltr",
  "template": "hero-top",
  "canvasWidth": 1320,
  "fields":   { "headline": "…", "caption": "…" },
  "overrides":{ "background": "#5B4BF0" },
  "brand":    { "font": …, "primary": "#5B4BF0", "onPrimary": "#ffffff" },
  "assets":   { "capture": "https://…signed", "slices": ["…"], "fonts": [...] }
}
→ 200 { "png": "https://…signed", "width": 1320, "height": 2868,
        "checks": { "overflow": [], "textOverlapsDevice": [], "fits": [...] } }
```

Guarantees it must keep, because they are the product:

- byte-identical output for identical inputs (pinned Chromium version, pinned fonts, no
  `Date`/`Math.random` in templates — already enforced by the template contract);
- the in-page checks run and are returned, never silently dropped;
- a render that cannot fit its copy fails loudly instead of shipping ellipses.

Limits: one Chromium context per render, hard timeout, max canvas 3× target width (panorama), max
20 renders per request batch, no outbound network from the page except our own signed URLs.

## 9. Captures

**v1 — upload.** Drag five PNGs onto the project; they are matched to screens by order, or by
filename if it matches the manifest pattern. Validation already checks aspect ratio against the
target and warns on mismatch, which is most of what a person needs.

**v2 — the local agent.** `store-shots sync --project . --remote <token>` uses the existing
`capture` code (deep links, clean status bar, per-locale language switching, all already working)
and pushes raw captures to the hosted project. The simulator stays on their Mac; everything else
is hosted.

This is the piece nobody else has, and it is why the hosted product should not try to replace the
CLI: the CLI becomes the capture client.

## 10. Delivery

**v1: a ZIP.** Laid out exactly as `deliver` and `supply` expect, so the customer's existing lane
works untouched. This keeps us out of the credential business entirely.

**Later, only if demand is real.** Uploading on the customer's behalf needs App Store Connect API
keys (`.p8`) or Google service accounts. The bar before that ships, all of it, not some of it:

- keys encrypted with a KMS-held key, never in the database in plaintext, never in logs;
- scoped to the minimum ASC role that can upload media;
- revocable from the UI, with an audit trail of every use;
- a documented incident path and a stated retention window;
- penetration-tested upload path.

Until every line above is true, the ZIP is the answer.

## 11. Security and tenancy

What we hold is unreleased product imagery, which customers treat as confidential. That sets the
baseline:

- Org-scoped everything; asset ids are opaque and checked against the requesting org on every
  read. No path-derived access.
- Signed, short-lived URLs for captures and renders. No public buckets.
- The render worker treats copy and images as **untrusted**: no network egress from the page
  besides our signed URLs, no filesystem access, a fresh context per render, hard timeouts. The
  existing templates never execute user script — HTML is rendered from React, not interpolated —
  but the worker must assume a future template bug.
- Encryption at rest for the database and the bucket; TLS everywhere.
- A stated retention policy (delete an org's objects within N days of cancellation) and a data
  export button, both cheap now and expensive to retrofit.
- Subprocessor list and a DPA before the first EU customer, not after.

## 12. Determinism and versioning

The tool's promise is that the same inputs produce the same PNG. Hosted, that promise now spans
deployments, so:

- the renderer records `toolVersion`, `templatesHash` and the Chromium build in every render row;
- a template change bumps `templatesHash`, which invalidates the cache for artwork using it —
  customers see "12 screenshots are stale" rather than silently different output;
- template changes ship behind a version pin per project, so an app that has shipped a listing can
  keep rendering the artwork it shipped. Decision D-4.

## 13. Cost

Rough, to check the model is not upside down. A generate for a seven-locale, two-target,
five-screen project is 70 renders ≈ 30–60 s of one worker CPU, and about 25 MB of PNG before
compression. On the existing VPS that is noise; the cost driver is storage of captures and renders
over time, which retention and hash-keyed dedupe both bound.

The honest risk is not infrastructure cost, it is support: every customer's first upload will be
the wrong resolution, and that is a human answering emails.

## 14. Phases

Each phase ends with something usable; approval between phases as with the local tool.

| Phase | What lands                                                                                                                 | Acceptance                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| H0    | Core package extracted (`templates`, `lib/render`, `lib/validate`, `lib/schema`); this repo consumes it; tests still green | `npm test` green in both packages; local tool behaviour unchanged                                        |
| H1    | Render service: HTTP API above, container image, deployed on bavrk-server, no auth beyond a shared token                   | renders every catalogue example byte-identically to the local run; refuses oversized and malformed input |
| H2    | Repository interface + Postgres implementation; import a `store/` folder into a project row set and export it back         | round-trip of the Braele project produces an identical `store/` tree                                     |
| H3    | Hosted editor: sign-in, one org, upload captures, edit screens and copy, preview, render, download ZIP                     | a new user reaches a downloaded ZIP in under five minutes without reading documentation                  |
| H4    | Accounts and billing: plans, quotas, Stripe, retention and export                                                          | a paid signup, a cancellation and a data export all work end to end                                      |
| H5    | `store-shots sync`: the local agent pushes captures into a hosted project                                                  | Braele's seven locales captured locally appear in the hosted project without manual upload               |
| H6    | Optional: delivery on the customer's behalf, only if §10's bar is met                                                      | —                                                                                                        |

H0–H2 are the engineering; H3–H4 are the product; H5 is the differentiator. If interest dies after
H1, the render service still pays for itself in CI.

## 15. Risks

| Risk                                                                   | Mitigation                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| The first five minutes are worse than the local tool ("upload 5 PNGs") | Sample project preloaded so a visitor can reach a ZIP before uploading anything                       |
| Templates are the visible value and the easiest thing to copy          | Compete on localization and checks, not on layouts; keep the strip/panorama work as the showpiece     |
| Two products to maintain                                               | Core package shared; the CLI becomes the capture client rather than a parallel implementation         |
| Holding customers' unreleased artwork                                  | §11 in full, from H3 rather than later                                                                |
| Chromium drift changes rendering between deploys                       | Pin the image digest; record the build per render; treat a bump as a template-hash-style invalidation |
| Support load from wrong-sized captures                                 | Aspect check on upload with a plain-language fix, not a validation code                               |
| Scope creep into a design tool                                         | Same guard as the local plan: fixed templates and semantic controls                                   |

## 16. Open decisions

| #   | Decision                                                                | Default if unanswered                                |
| --- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| D-1 | Three repos (core / CLI / web) or one repo with a `web/` directory      | Three repos, core published to a private registry    |
| D-2 | Host: bavrk-server VPS, or a platform (Fly/Render) for the worker fleet | bavrk-server first; move the worker if it saturates  |
| D-3 | Domain and name (`shots.bavrk.com`? a standalone brand?)                | `shots.bavrk.com` to start                           |
| D-4 | Template versioning per project, or everyone always on latest           | Pin per project from H3                              |
| D-5 | Free tier shape: watermark, locale cap, or render cap                   | One project, two locales, unlimited renders          |
| D-6 | Customer-authored templates ever?                                       | No; presets and overrides only                       |
| D-7 | Does the local tool stay free and open, or become the paid client?      | Stays as it is; the hosted product is the paid thing |

## 17. Checklist

- [ ] Approval of this plan (revision 1)
- [ ] H0 — core package extracted, both sides green
- [ ] H1 — render service deployed and byte-identical
- [ ] H2 — Postgres repository, `store/` import/export round-trip
- [ ] H3 — hosted editor to a downloaded ZIP
- [ ] H4 — accounts, billing, retention, export
- [ ] H5 — capture sync agent
- [ ] H6 — delivery on the customer's behalf (only if §10's bar is met)
