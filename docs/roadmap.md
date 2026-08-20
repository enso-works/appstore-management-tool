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
