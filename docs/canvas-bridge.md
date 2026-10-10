# Canvas bridge (version 1)

The Mac app draws every control natively and embeds one web view showing
`/projects/<app>/canvas`: the screenshots, exactly as they render. The app owns
every draft; the canvas renders what it is given and reports what the user did
on it. Types live in `lib/editor/bridge.ts`; the editing maths the canvas uses
is in `lib/editor/drag.ts` (shared with the web editor).

## App to canvas

`window.storeShots.update(state)`, with the whole state each time anything in it
changes:

| Field                                 | Meaning                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `v`                                   | `1`                                                                           |
| `manifest`, `content`                 | The drafts being edited (manifest, and the copy per locale)                   |
| `targets`                             | The project's target profiles, from `GET /api/projects/<app>`                 |
| `targetId`, `locale`                  | What to show                                                                  |
| `pageId`                              | `""` for the default page, or a named set's id                                |
| `screenId`                            | The selected screen                                                           |
| `mode`                                | `single`, `strip` (the page's screens) or `locales` (the screen in every one) |
| `storeLook`, `guides`                 | App Store look; layout guides                                                 |
| `selected`                            | `phone`, `background`, `text:<slice>` or `layer:<id>`                         |
| `issues`                              | Validation issues, for the badges under each frame                            |
| `failOnOverflow`, `failOnTextOverlap` | The project's validation settings                                             |
| `liveCountry`                         | Show the live App Store listing under the strip, from that storefront         |
| `revisions`                           | Per screen, bumped when its capture changes on disk: render that screen again |

`window.storeShots.command({ action })` with `zoomIn`, `zoomOut`, `fit`,
`actual` or `toggleWrap`, from the native toolbar and menus.

## Canvas to app

Posted to `window.webkit.messageHandlers.storeShots` (in a browser: to the
parent window and as a `store-shots-canvas` DOM event, for tests).

| Message                                                                             | When                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `ready { v }`                                                                       | The page is listening; send the state                                 |
| `patchScreen { screenId, patch }`                                                   | A drag ended or an arrow key nudged: apply the patch as one undo step |
| `select { element }`                                                                | An element was clicked in the artwork                                 |
| `selectItem { id }`                                                                 | A frame was clicked in Strip (a screen id) or Languages (a locale)    |
| `openItem { id }`                                                                   | A frame was double-clicked                                            |
| `deleteLayer { screenId, layerId }`                                                 | Delete or Backspace with a layer selected                             |
| `toggleGuides`                                                                      | The g key                                                             |
| `preview { screenId, locale, loading, error, sourceExists, budgets, checks, fits }` | The single preview's state, for the inspector                         |
| `live { version, error }`                                                           | The live listing loaded, or why not                                   |
| `view { scale, wrap, canWrap }`                                                     | Zoom and wrap changed                                                 |

Zoom keys (+, -, 0, 1), pinch and scroll stay inside the canvas.
