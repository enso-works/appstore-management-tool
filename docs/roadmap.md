# Roadmap (post-v1)

Agreed 2026-08-19. Executed in order; each item lands as its own commit with tests and is
ticked here when done. Plan context: `store-tool-plan.md`.

| #   | Item                           | What lands                                                                                                                                                                                                    | Status          |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Panorama screens               | `screen.panorama.slices` (2–3): one wide artwork rendered once and sliced into consecutive exact-size files (`order`, `order+1`, …); strip preview shows the slice boundaries; validation reserves the orders | done 2026-08-19 |
| 2   | Drag the phone in the preview  | Direct manipulation in Single mode: drag the device to set `screenshotOffsetX/Y`; ⌥-drag tilts, ⇧-drag scales; smooth in-iframe feedback, one save-able override change at the end                            | done 2026-08-19 |
| 3   | Locale grid                    | Canvas mode `Locales`: one screen across every locale, per-locale status (overflow / missing / shrunk)                                                                                                        | done 2026-08-19 |
| 4   | Live vs new                    | Fetch the current App Store listing's screenshots (public iTunes lookup by bundle id) and show them under the strip for comparison                                                                            | done 2026-08-19 |
| 5   | Contact sheet + change summary | `store-shots sheet` writes one PNG per locale/target of the generated set into `store/generated/sheets/`; `generate` reports which files changed since the previous manifest                                  | done 2026-08-19 |
| 6   | Duplicate + presets            | "Duplicate screen" (id, copy in every locale); named override presets in `store-shots.config.json` (`presets`), "apply preset" / "save as preset" in the editor (config PUT with etag)                        | done 2026-08-19 |
| 7   | Copy helpers                   | Per-field budget hint (≈ chars per line × lines for the current template/target); "prefill from <default locale>" for a locale's screen (explicit, editable)                                                  | done 2026-08-19 |
| 8   | One-command captures           | `source.deepLink` per screen + `capture --all [--clean-status-bar]`: opens each deep link in the booted simulator, waits, captures every screen in order                                                      | done 2026-08-19 |
| 9   | frameit device frames          | `frames setup` (runs `fastlane frameit download_frames`), `frames list`; `shell: "frame:<Device> <Colour>"` uses the official frame PNG + `offsets.json` so the capture sits exactly in the screen cut-out    | done 2026-08-19 |
| 10  | CI gate                        | `store-shots check [--json]` = validate + readiness + metadata limits in one exit code; GitHub Actions workflow for the tool (tests, lint, typecheck)                                                         | done 2026-08-19 |
| 11  | Google Play completion         | `play-feature-1024x500` target + `feature-graphic` template; Play text metadata (title 30 / short 80 / full 4000) in the Store tab; optional `play` lane key                                                  | done 2026-08-19 |
| 12  | App Preview poster             | `appreview-6.9-886x1920` poster target written to `store/generated/posters/<locale>/` (not a deliver screenshot) with the existing templates                                                                  | done 2026-08-19 |

Out of scope for this pass: video rendering, hosted/cloud anything, credentials in the tool.

## Follow-up (2026-08-20)

- Panorama per-slide copy: `headline2/caption2/eyebrow2` (and `...3`) render one text stack per
  slide while the device spans the artwork — reproduces hand-made multi-slide listings exactly.
- Drag the text block too (sets `textOffsetX/Y`); new `textOffsetX` override.
- Editor UX: live thumbnails in the screens sidebar, per-slide copy groups (SLIDE 1 / SLIDE 2).
- Autosave: content and manifest edits (including drags) save ~1s after the last change; the
  Save button is now a Saved/Saving indicator that can force a flush.
- Selection-based inspector: click the phone, a text block or the background in the preview
  (or the Background / Phone / Text chips) and the Style panel shows only that element's
  controls, with the rest behind "All overrides". The selected element gets a dashed outline.
- Selects keep unknown values (e.g. shell "frame:...") visible instead of silently resetting.
- Top bar UX: grouped clusters with separators, no wrapping; compact readiness pill; transient
  status moved to a dismissible toast (with a Reload action on conflicts).
- The "live" comparison toggle is always visible and works in Single mode too (live row under
  the current screen).
- Save conflicts (409, file changed on disk) auto-reload etags and retry once — the editor's
  version wins; no more dead-end "reload before saving" error.
- Element inspector moved above the copy section (Background editor no longer buried).
- Layers v1 (asset library elements): freely positioned image elements from store/assets
  (with upload) and extra text elements per screen — draggable in the preview, per-element
  inspector (width, size, weight, font, colour, align, rotate, opacity), localized text via
  content fields, validated (missing assets, duplicate ids) and hashed for incremental renders.

## UX pass (2026-08-20)

- Undo/redo (cmd+Z / shift+cmd+Z) across manifest and copy edits, drags included; autosave
  persists whatever undo restores. Text inputs keep their native undo.
- Arrow keys nudge the selected element (phone / text / layer); shift = coarse steps.
- Hover shows a faint dashed outline on anything draggable in the preview.
- Screen settings (template, order, capture, panorama) collapsed behind a summary; the panel
  now leads with Element inspector and Copy.
- Layer stacking controls (back/front) in the element inspector.
- Double-click a frame in Strip/Locales to open it in Single mode.

Known further UX debt, in priority order: rotate/scale handles on layers and text (phone has
them); marquee-select and multi-nudge; per-slice text offsets on panoramas; bulk "create
missing locale files" action; generation progress inline on the canvas; empty-state guidance
for new apps (no captures yet).

## Mac app (agreed 2026-10-08)

A native macOS app around the existing editor, not a rewrite: the editor, templates and
renderer stay in Next.js and Playwright, which need the Mac's disk, Chromium, simctl and
fastlane anyway (so it can never be a hosted web app or an iOS app). Lives in `mac/`
(SwiftUI, XcodeGen), built with `mac/build.sh`.

| #   | Item          | What lands                                                                                                                                                                                                                                | Status          |
| --- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Shell         | Window with the editor in a web view; attaches to a running editor (ports 3000-3009) or starts `next` itself in its own process group and stops it on quit; JS dialogs, file inputs, external links                                       | done 2026-10-08 |
| 2   | Native chrome | Toolbar project picker with readiness, reload, open in browser, reveal app in Finder; Project and Server menus with shortcuts; server log window; settings for the tool folder and port                                                   | done 2026-10-08 |
| 3   | Import        | File > Import App... (Command-O) picks a folder; the editor's Import page reads the app (Expo, Capacitor, native iOS), proposes name, locales, orientation, iPad and Play, and writes the config on Import. `init` uses the same proposal | done 2026-10-08 |
| 4   | Next          | App Store management features (to be agreed): App Store Connect status, metadata and screenshot upload from the app, notifications when renders finish, app icon                                                                          | open            |

## App Store asset guidelines (agreed 2026-10-08)

From Apple's [asset best practices](https://developer.apple.com/app-store/asset-best-practices/),
[screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
and [product page](https://developer.apple.com/app-store/product-page/) guidance, read 2026-10-08.

| #   | Item                    | What lands                                                                                                                                                          | Status          |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Required sizes          | `iphone-6.1-1206x2622` and `iphone-6.1-2622x1206` targets (same raw captures as 6.9"); `init` scaffolds 6.9" + 6.1" + iPad 13"; readiness `required-sizes`          | done 2026-10-08 |
| 2   | Store claims            | Validation warning `content.store-claims`: prices, discounts, URLs, ©, other platforms or marketplaces, Apple recognitions in screenshot copy                       | done 2026-10-08 |
| 3   | Keyword guidance        | Readiness `metadata-keywords` and the Store view: 100-byte limit, plurals, repeated words, "app", category names, `#`/`@`, terms of two characters or fewer         | done 2026-10-08 |
| 4   | JPEG screenshots        | Readiness and raw-capture validation read JPEG as well as PNG                                                                                                       | done 2026-10-08 |
| 5   | Dark Mode screenshot    | Screen `appearance: "dark"` (editor: Screen settings > Dark Mode); readiness `dark-mode` warns when the app follows the system appearance and no screen is dark     | done 2026-10-09 |
| 6   | First three screens     | Strip mode tags the screens App Store search shows: the first three in portrait, the first one in landscape                                                         | done 2026-10-09 |
| 7   | Icon variants           | Readiness `icon-variants`: Expo `ios.icon` { light, dark, tinted } or an Icon Composer `.icon`, or the AppIcon set's appearances                                    | done 2026-10-09 |
| 8   | App preview checks      | Readiness `app-previews` on `store/previews/<locale>/`: 886x1920 / 1200x1600 (either way round), 15-30 s, at most 30 fps, 500 MB, 3 per device and locale           | done 2026-10-09 |
| 9   | Event and header images | `event-card-1920x1080` and `event-detail-1080x1920` targets into `store/generated/events/<locale>/`. Header and search results images: see App Store Connect item 4 | done 2026-10-09 |
| 10  | Named screenshot sets   | Manifest `sets` (custom up to 70, ppo up to 3), validated; `generate --set` renders them renumbered into `store/generated/sets/<id>/<locale>/`                      | done 2026-10-09 |

## Editor and art pipeline (agreed 2026-10-08)

| #   | Item                  | What lands                                                                                                                                                                                   | Status          |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | JSON in the app style | Editor saves, `init`, fonts lock and sign-off write JSON the way the app's Prettier would                                                                                                    | done 2026-10-09 |
| 2   | Non-Expo readiness    | Version, icon and iPad from the Xcode project and asset catalog, so Capacitor and native apps pass                                                                                           | done 2026-10-09 |
| 3   | Layers per target     | The Elements panel shows the targets each layer draws on, toggles them, dims layers not on the shown target, and splits a layer into its own copy for one target; art picker with thumbnails | done 2026-10-09 |
| 4   | Strip wrap            | Strip mode wraps screens into the rows that show them largest (on by default for landscape sets), with a Wrap toggle                                                                         | done 2026-10-09 |
| 5   | Scenes                | `store-shots scenes list`, `scenes render [steps] [--force] [--quick]`: the config's Blender and Python steps, skipped while unchanged, `needs` for re-runs, a log per step                  | done 2026-10-09 |

## App Store Connect: product pages, Asset Library, Duo (agreed 2026-10-09)

The tool talks to the App Store Connect API itself with the app's key (user decision
2026-10-09; rule in `CLAUDE.md`): drafts only, never a submission.

| #   | Item                      | What lands                                                                                                                                                                                                                                                                                         | Status          |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Product page variants     | Pages in the editor (page menu, page screens in the sidebar, page-only copy, deep link, promotional text, keywords from the app's field, treatment icon); `sets.<id>` in content files; validation per kind                                                                                        | done 2026-10-09 |
| 2   | `asc status`              | Versions, custom product pages and experiments, matched to the manifest's sets (read-only)                                                                                                                                                                                                         | done 2026-10-09 |
| 3   | `asc push`                | A set as a draft custom page or treatment: page, version, localizations, promotional text, keywords, screenshots by checksum; plan first, `--yes` to apply; editor Check / Upload draft                                                                                                            | done 2026-10-09 |
| 4   | Creative assets           | `header-3840x1646`, `search-3840x2560`, `universal-5244x2950` targets with the banner layout in the universal crops' safe area, one of each per page, readiness `creative-assets`, `asc push` to the Asset Library and the page's placements (custom pages and treatments; checked live on Braele) | done 2026-10-09 |
| 5   | iPhone Duo                | 1398x2034 (outer) and 2007x2853 (inner) targets, either way round; required from April 2027, App Store Connect upload later in 2026                                                                                                                                                                | open            |
| 6   | Default page and previews | `asc push` for the default product page's screenshots, header and search images (on an editable version) and for app previews (deliver does screenshots and previews today)                                                                                                                        | open            |
