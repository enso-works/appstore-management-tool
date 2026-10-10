# Store Shots for Mac

The native app for store-shots. Every control is SwiftUI; the canvas is the same web render
the engine exports, embedded through a small bridge (`docs/canvas-bridge.md`), so what you
see is exactly what gets generated. The engine (templates, rendering, validation, App Store
Connect, fastlane) is the Node app in this repo; the Mac app starts it, or attaches to one
already running, and talks to its API.

```bash
brew install xcodegen      # once
sh mac/build.sh --open     # builds mac/build/Store Shots.app and launches it
cd mac && swift test       # the model's tests (JSON, document, edits and undo)
```

## The window

- **Sidebar**: All Apps, then each app with its sections. Import with + or Command-O.
- **Design**: the page's screens as thumbnails (drag to reorder, right-click for more), the
  canvas, and the inspector in tabs: Text, Layout, Background, Layers, Screen. Click the
  phone or text on the canvas to select it, drag to move, Option-drag to tilt, Shift-drag to
  scale, arrow keys to nudge.
- **Pages**: the default page, custom product pages and optimization tests, each with its
  App Store Connect state, text, keywords, header, search and Duo images, and Check / Upload
  Draft. The default page can also submit its header and search images for review.
- **Listing**: name, subtitle, keywords and the rest of the store text, per language.
- **Ship**: checks with the way to fix each, a review of every generated file (Quick Look on
  click), and the fastlane uploads.
- **Settings**: devices, languages, brand colours, fonts, the App Store Connect key.

Edits save themselves a moment after you stop; Command-Z undoes them. Unsaved edits are
written before the engine restarts or the app quits.

## Shortcuts

| Shortcut                          | Action                                    |
| --------------------------------- | ----------------------------------------- |
| Command-1 to 5                    | Design, Pages, Listing, Ship, Settings    |
| Option-Command-0                  | All apps                                  |
| Option-Command-1 to 9             | Open an app                               |
| Command-O                         | Import an app                             |
| Command-G / Shift-Command-G       | Generate / generate this screen           |
| Option-Command-Up / Down          | Previous / next screen                    |
| Command-[ / Command-]             | Previous / next language                  |
| Option-Command-]                  | Next device                               |
| Shift-Command-1, 2, 3             | One screen, strip, all languages          |
| Command-= / Command-- / Command-0 | Zoom in, out, actual size; Command-9 fits |
| Option-Command-G                  | Layout guides                             |
| Shift-Command-L                   | Engine log                                |

## Engine

An engine already running on ports 3000-3009 (`store-shots open`, `npm run dev`) is attached
to and left running on quit. Otherwise the app runs `next dev` (a git checkout) or
`next start` (an installed copy with a build) from the store-shots folder and stops it on
quit. The folder defaults to the checkout the app was built from; change it in Settings.
The log is under Engine > Show Engine Log and in `~/Library/Logs/Store Shots/editor.log`.

The Xcode project is generated from `project.yml` and not committed.
