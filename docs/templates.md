# Writing a template

Templates live in `templates/` and are plain React components rendered the same way for
the editor preview and for export (`renderToStaticMarkup` → Playwright). A template module
exports three things:

```ts
export const descriptor: TemplateDescriptor; // id, name, fields, targets, override keys
export const overridesSchema: z.ZodTypeAny; // validates screen.overrides (zod, strictObject)
export function render(input: TemplateRenderInput): ReactElement;
export default { descriptor, overridesSchema, render } satisfies TemplateModule;
```

Register it in `templates/index.ts`. Validation, the editor's override controls and the
render pipeline pick it up from there.

## Rules the render pipeline relies on

- Return exactly one root element carrying `data-artwork`, sized `target.width` ×
  `target.height` px. Use `<Artwork input={input}>` from `templates/shared.tsx`; it sets the
  size, background (incl. `backgroundImage` assets/patterns), text colour, font stack and
  `dir`.
- Put the capture inside `<DeviceShell>` (or any element with `data-device`). The overlap
  check measures text against that element's bounding box.
- Put every piece of copy in `<TextBlock>`. It emits `data-check`, `data-line-height`,
  `data-max-lines`, `data-font-size`, `data-line-ratio`, `data-fit-min`, which drive:
  - the in-page **fitter** (`lib/render/fit.ts`): shrinks the font down to
    `fitMinScale × fontSize` until the text fits `maxLines`;
  - the in-page **checker** (`lib/render/checks.ts`): overflow (line based), overlap with
    the device, missing images, failed font faces.
- Scale every metric from `target.width` (and branch on `target.family` for iPad) so one
  template serves both aspect ratios. Never hard-code pixels.
- Use `input.brand.headlineFontStack` for headlines (falls back to the body stack when no
  `brand.headlineFont` is configured).
- Load assets only through `input.assetUrl(rel)` and the capture through
  `input.sourceImageUrl`; they become `file://` URLs for export and `/api/...` URLs in the
  editor. No remote URLs, ever.
- No state, no effects, no animations, no `Date`/`Math.random`. Output must be
  deterministic for a given input.

## Overrides

Extend `commonOverridesSchema` with `.extend({...})` for template-specific keys and list
them in `descriptor.overrideKeys`. The editor renders controls for known keys (see
`OVERRIDE_CONTROLS` in `app/projects/[name]/editor.tsx`); add an entry there for a new key
to get a slider/select instead of a plain text box. Control kinds: `text`, `number`
(slider + numeric input), `select`, `color`, `boolean` (default / on / off — the key is
removed for "default", so the template's own fallback applies). Put the key in the right
`EL_GROUPS` bucket (`background`, `phone`, `text`) so it shows up when that element is
selected on the canvas; anything unlisted still appears under "All overrides".

`stackLayout()` in `shared.tsx` computes the text column and device boxes for the
"text + phone" family of templates, honouring all positional overrides (`textWidth`,
`textSide`, `textOffsetY`, `screenshotScale`, `screenshotOffsetX/Y`) and RTL mirroring.
`hero-top` and `split-caption` both use it with different defaults.

## Full-strip templates

A strip template composes 2-3 consecutive store screenshots as one artwork: the
headline, the background and the shapes run unbroken from one screenshot into the
next. Mechanically it is a panorama screen — the renderer draws one canvas of
`slices x target.width` and slices it into consecutive files — wearing a template
that declares `strip: true` on its descriptor.

- `templateModules` exposes `stripTemplateIds` and `screenTemplateIds`. The editor
  offers strip templates only in the **Full strip** tab (`app/projects/[name]/strip-panel.tsx`),
  and hides them from the per-screen template picker.
- `panorama.perSliceSources: true` gives each slice its own raw capture: slice i
  resolves `source.filePattern` with `order + i` and `{slice}` = i + 1, so the
  default `{order}-{id}.png` on a strip at order 1 reads `01-<id>.png`,
  `02-<id>.png`, `03-<id>.png`. Without the flag every slice repeats slice 1's
  capture (the old behaviour, unchanged).
- Templates read the per-slice captures through `sliceImage(input, i)` and the
  slice count through `sliceCount(input)`, both from `shared.tsx`; `sliceField`
  maps `headline`/`headline2`/`headline3`. `DeviceShell` takes `imageUrl` to draw
  a specific slice's capture.
- Every slice's device is checked for text overlap (the in-page check walks all
  `[data-device]` elements), so copy on slice 3 is checked against slice 3's phone.
- `store-shots capture --screen <id> --slice 2` writes slice 2's capture; without
  `--slice` the command targets slice 1, as before.
- A strip template must still render sensibly at one slice: the contract test
  renders it at `canvasWidth === target.width`.

`store-shots capture` still writes per-screen files; a strip just consumes several
of them.

Seven strip templates ship: `strip-banner` (one headline across the set), `strip-story`
(numbered path), `strip-arc` (devices on a curve under one ring), `strip-alternate`
(zig-zag copy over a diagonal band), `strip-quote` (a review spanning the set),
`strip-hero` (one hero shot, the rest supporting) and `strip-marquee` (a repeated phrase
behind the devices). They differ in what carries across the seam — type, a path, a curve, a
band, a quote, emphasis, a marquee — which is the only thing that makes a set read as one
composition in the store's gallery. A hard edge that lands exactly on a seam is invisible on
the store, because the gallery puts a gap between the screenshots.

## Templates that do not use the capture

Set `usesCapture: false` on the descriptor for pure typography slides (`statement`).
`validate` then skips the `source.missing` error for screens using it, `generate` skips the
capture existence check and leaves the capture out of the incremental-render hash, so such a
screen needs no PNG under `store/raw/`. Everything else — locales, fonts, overflow checks —
is unchanged.

## Decor toolkit (`templates/decor.tsx`)

Deterministic vector decoration shared by the graphic templates; no assets, no randomness,
no remote URLs. The shapes live in a 0..100 viewBox and are emitted as inline SVG data
URIs, so they scale with the canvas.

- `Decor({ kind, color, opacity, left, top, size, rotate })` — `arc`, `blob`, `burst`,
  `rings`, `wave`, `confetti`, `grid` (and `none`). Shapes that run into the edge of their
  box are faded with a radial mask so they read as light falling off, not a cropped square.
- `Glow({ color, cx, cy, spread, strength })` — soft radial light, typically behind a device.
- `Halo({ color, cx, cy, diameter, width, opacity })` — thin ring; pair two for concentric rings.
- `lighten(hex, factor)` — mirror of `darken` in `shared.tsx`.

`DeviceShell` takes `overlapAllowed` for templates that compose text over the device on
purpose (`stat-hero`, `overlap-headline`); it sets `data-device-overlap="allowed"`, which
turns off the text/device overlap check for that screen.

## The templates

| id                 | shape                                                      | fields beyond headline/eyebrow/caption | notable overrides                                                        |
| ------------------ | ---------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `hero-top`         | copy on top, device centred below                          | —                                      | the common set                                                           |
| `split-caption`    | copy column beside a large tilted device                   | —                                      | the common set                                                           |
| `full-bleed-card`  | capture fills the canvas, copy on a card                   | —                                      | `cardPosition`, `cardColor`                                              |
| `feature-graphic`  | 1024x500 Play banner                                       | —                                      | the common set                                                           |
| `zoom-detail`      | a cropped part of the capture in a floating card or circle | —                                      | `zoom`, `focusX/Y`, `detailShape`, `detailAspect`, `backdrop`, `locator` |
| `statement`        | typographic interstitial, no capture                       | `index`                                | `decor`, `decorPlacement`, `accentColor`, `indexStyle`, `rule`, `anchor` |
| `stat-hero`        | oversized figure behind the device                         | `stat`, `statLabel`                    | `statStyle`, `statScale`, `statOffsetY`, `glow`, `decor`                 |
| `diagonal-band`    | angled colour field or ribbon the device crosses           | —                                      | `band`, `bandColor`, `bandAngle`, `bandPosition`, `bandWidth`            |
| `spotlight`        | device in a pool of light under a row of chips             | `chip1`, `chip2`, `chip3`              | `chipStyle`, `glow`, `glowColor`, `halo`, `decor`                        |
| `overlap-headline` | oversized headline running behind (or over) the device     | —                                      | `headlineScale`, `headlineTop`, `blend`, `devicePlacement`, `deviceDim`  |

`zoom-detail` at `zoom: 1` keeps the app's full width and crops a horizontal slice, which
never cuts through a word; higher values magnify around `focusX/focusY`. With a backdrop,
`locator: true` frames exactly the region the card shows.

## The catalogue at /templates

`app/templates` lists every registered template with an example, its copy fields and
its own override keys, and adds a screen using it to a chosen project ("Use in <app>",
`POST /api/projects/<name>/screens` -> `addScreenFromTemplate`). The examples are
committed JPEGs under `public/template-previews/`, rendered through the real pipeline by
`npm run previews` (`scripts/template-previews.ts`) against a synthetic demo app.

When you add or restyle a template:

1. give the descriptor a one-line `summary` (the catalogue reads it from the registry);
2. add an example to `EXAMPLES` in `scripts/template-previews.ts`;
3. run `npm run previews` and commit the JPEG.

`tests/templates.test.ts` fails if either is missing. The preview script also fails when an
example overflows, overlaps the device or misses an image, so the catalogue can never show
artwork the renderer would reject.

## Tests to add

`tests/templates.test.ts` iterates every registered template: it renders both targets in LTR
and RTL, checks the artwork root size, the presence of `data-check="headline"` and
`data-device` (skipped when `usesCapture` is false), and that overrides apply. Add
template-specific assertions next to it — every template above has a `describe` block
covering its own overrides.
