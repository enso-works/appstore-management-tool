@AGENTS.md

# store-shots

App Store screenshot generator + store management for the Expo apps that live next to
this repo. Plan and phase status: `docs/store-tool-plan.md`. Work proceeds one phase at a
time; do not start the next phase without approval.

## Where this repo sits

```text
<workspace>/                 plain folder that groups repos (not a repo itself)
├── tools/store-shots/       THIS repo
├── starter-template/        Expo app template, its own repo; ships the store/ scaffold
└── breathe/ invoicer/ ...   apps, each its own repo
```

The tool discovers apps by scanning the workspace root (three levels up from `lib/`, or
`STORE_SHOTS_WORKSPACE`). Nothing outside this directory is tracked here.

## Rules

- App changes the tool legitimately makes are limited to `store-shots.config.json`,
  `store/`, `fastlane/metadata/`, `fastlane/screenshots/` and `fastlane/Deliverfile` inside
  that app, and only when the plan phase says so. Never commit inside an app as a side
  effect of tool work.
- Never read, copy or log `fastlane/*.p8`, `asc_api_key.json`, `play_service_account.json`.
  Existence checks only.
- Never add or run fastlane lanes that build (`beta`, `internal`) or submit.
  `submit_for_review` stays `false` everywhere.
- After a phase: run `npm test`, `npm run typecheck`, `npm run lint`, then `/code-review`;
  report changed files, commands, results and remaining risks; tick the checklist at the
  end of `docs/store-tool-plan.md`.
- Commits: atomic, one logical change each, no emojis. Ask before committing.
- No emojis in code, docs or messages.

## Toolchain

- Node 22 (`.nvmrc`), npm: `npm ci`.
- `npm test` (vitest), `npm run typecheck`, `npm run lint`, `npm run format`,
  `npm run schemas` (regenerate `schema/*.schema.json` from `lib/schema.ts`),
  `npm run fixtures` (regenerate `fixtures/demo-app`).
- CLI: `npx store-shots <cmd>` here, or `node tools/store-shots/bin/store-shots.mjs <cmd>`
  from the workspace.
- fastlane via Homebrew; Ruby via rbenv/Homebrew, not system Ruby
  (see `../../starter-template/NEW-APP.md`, "iOS build gotchas").
- Next.js 16: read `AGENTS.md` (above) before touching `app/`.
