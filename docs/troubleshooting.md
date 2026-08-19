# Troubleshooting

## `validate` / `generate`

| Message                                                | Meaning / fix                                                                                                                                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No store-shots.config.json found`                     | Run from inside an app, pass `--project <app-dir>`, or `store-shots init --project <app-dir>`                                                                                       |
| `content.missing-locale`                               | Create `store/content/<locale>.json` (`{"locale":"de-DE","screens":{}}`) or remove the locale from `config.locales`                                                                 |
| `content.missing-field` / `content.missing-screen`     | Copy is missing for that locale/screen; strict mode blocks the job. Edit in the UI or the JSON                                                                                      |
| `content.glyph-missing`                                | A character is not covered by any local font. `store-shots fonts add "<family>"` (the message suggests one) and list it in `brand.font.fallbacks`                                   |
| `font.missing`                                         | `brand.font.family` (or `headlineFont`) is not downloaded: `store-shots fonts add "<family>" --project <app>`                                                                       |
| `source.missing`                                       | Raw capture not found at `store/raw/<device>/<locale>/<file>`; capture it (`store-shots capture --screen <id> --device iphone --locale <l>`) or fix `source.filePattern`            |
| `source.aspect` (warning)                              | Capture aspect ratio differs from the target; the shell uses `object-fit: cover`, so it still renders, but use the right simulator (6.9" iPhone Pro Max, 13" iPad Pro) for fidelity |
| `render.overflow ... even at the minimum allowed size` | Copy is too long for the box at the template's minimum font scale; shorten it or widen `textWidth`                                                                                  |
| `render.text-overlaps-device` (warning)                | Text box intersects the device. Intentional designs can ignore it; set `validation.failOnTextOverlap` to make it an error                                                           |
| `plan.too-few` / `plan.too-many`                       | Screens per target/locale outside `validation.screensPerTarget` (Apple: 1–10)                                                                                                       |
| `manifest.override-invalid`                            | An override key/value is outside the template's schema; see the allowed list in the hint                                                                                            |
| `React is not defined`                                 | The CLI was run with a tsconfig other than the tool's. Use `bin/store-shots.mjs` / `npx store-shots`, which pin it                                                                  |
| Playwright: `Executable doesn't exist`                 | `npx playwright install chromium` inside `tools/store-shots`                                                                                                                        |

## Readiness

- `Metadata present for every locale` fails → the Store tab edits `fastlane/metadata/<locale>/*.txt`; create missing locale dirs there (explicit button).
- `Screenshots complete` fails → generate; the check wants exact target dimensions and no alpha. Hand-made files that match a target count too; files of other sizes are listed as "matches no configured target" (warning).
- `App icon ... has an alpha channel` is a warning: Expo prebuild flattens the iOS icon.

## Fastlane runner

- Upload lanes are disabled while readiness fails; enter an override reason to force them (logged).
- `lane "<name>" not found in fastlane/Fastfile` → the app's Fastfile lacks the lane; copy it from `starter-template/fastlane/Fastfile`.
- Output is the real `fastlane` output; credentials and ASC behaviour are fastlane's, not the tool's.
- fastlane is found at `/opt/homebrew/bin/fastlane`, `/usr/local/bin/fastlane`, `$STORE_SHOTS_FASTLANE`, or on `PATH`.

## Capture

- `No booted simulator` → boot one in Simulator.app. `store-shots capture --list` shows what is booted.
- `already exists; pass --force` → captures are never overwritten silently.
- Non-localized screens (`source.localized: false`) only accept the default locale.
- Clean status bar: `--clean-status-bar` (9:41, full battery/signal). Other locales: the command prints the `simctl` commands to switch the simulator language.

## Determinism

Outputs are byte-identical for identical inputs (fonts bundled/locally downloaded, fixed viewport,
animations disabled, Sharp flatten). If a second `generate` re-renders everything, something in
`inputsSha256` changed: the capture, copy, overrides, brand, output settings, fonts or the tool
version. `--force` re-renders regardless.
