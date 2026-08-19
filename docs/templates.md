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
to get a slider/select instead of a plain text box.

`stackLayout()` in `shared.tsx` computes the text column and device boxes for the
"text + phone" family of templates, honouring all positional overrides (`textWidth`,
`textSide`, `textOffsetY`, `screenshotScale`, `screenshotOffsetX/Y`) and RTL mirroring.
`hero-top` and `split-caption` both use it with different defaults.

## Tests to add

`tests/templates.test.ts` iterates every registered template: it renders both targets in LTR
and RTL, checks the artwork root size, the presence of `data-check="headline"` and
`data-device`, and that overrides apply. Add template-specific assertions next to it.
