# UX refresh: native Mac app around the web canvas (draft, 2026-10-10)

The tool does the work well; the editor is hard to use. Decision (the user, 2026-10-10): every
piece of UI becomes native SwiftUI for the Mac feel; the canvas stays the web render it is
today, so what you see is still exactly what gets exported. The engine (`lib/`), templates,
CLI, API routes and file formats do not change. Nothing here starts until this plan is approved.

## What is wrong today (from screenshots of every view)

1. **No clear workflow.** Design, store text, checks, generating and uploading are spread over
   three tabs (Screens, Store, Release), a readiness page, a page dropdown and two collapsible
   panels.
2. **The top bar does too much.** Twelve controls in one row, cut off at 1440 px.
3. **The right panel is one long scroll** of product page, App Store Connect, screen settings,
   element inspector, overrides and copy; the copy, edited most, is at the bottom.
4. **Things live in odd places.** Fonts under the screen list; custom pages and experiments in a
   dropdown; readiness in three places.
5. **Developer wording.** `promotional_text`, `empty (null)`, `set empty`, `~47`.
6. **Empty and error states do not help.** 24 grey "missing" boxes instead of one Generate
   button; blocked uploads in red with the reason in small grey text.
7. **Home is a wall of checklists** with no thumbnails, no App Store state, no actions.
8. **Web controls that do not feel like a Mac app.** No menus or shortcuts worth the name, no
   native pickers, sheets, sidebars or inspector, no drag and drop from Finder.

## Architecture

```
Store Shots.app (SwiftUI, macOS 14+)
├── Native UI: sidebar, toolbar, filmstrip, inspector, forms, sheets, menus, settings
├── Canvas: one WKWebView showing /projects/<app>/canvas (a page that is only the canvas)
│     Swift -> canvas: what to show (screen draft, device, language, page, view, zoom, guides)
│     canvas -> Swift: selection, drags (move, scale, tilt), inline text edits, render status
└── Engine: the existing Next.js server on localhost (started by the app as today)
      JSON API for everything else: manifest, copy, metadata, preview, generate, readiness,
      release, App Store Connect, fonts, assets, presets
```

- **One source of truth for drafts: Swift.** The app holds the manifest and copy being edited,
  pushes the current screen draft to the canvas (the preview endpoint already renders unsaved
  drafts) and autosaves through the existing PUT routes, with the same "only what was sent is
  marked saved" rule the web editor uses.
- **Undo and redo** through `UndoManager`, so Cmd+Z and the Edit menu work everywhere.
- **Model types** generated from `schema/*.schema.json` (Codable), with template overrides kept
  as a JSON value dictionary so new template options need no Swift change.
- **Two small engine additions:** the canvas-only route with a documented message bridge, and a
  progress stream for Generate (server-sent events) so the toolbar can show real progress.
- The web editor keeps working during the move and is retired once the native app covers it;
  the canvas route, API and CLI stay.

## The app

A standard Mac window: sidebar on the left, content in the middle, inspector on the right, a
toolbar on top, the menu bar doing real work.

### Sidebar

- **Apps** with icon, version and App Store state (live, in review, draft) and a badge for
  things to fix. Import with the + button or by dropping an app folder on the window.
- Under the selected app: **Design, Pages, Listing, Ship, Settings**.

### Design

- **Filmstrip** (top or left of the canvas): the current page's screens as thumbnails; drag to
  reorder, context menu for duplicate, hide, delete and "use on another page"; header, search
  and event images in their own group.
- **Canvas** (web) with click-to-select and drag to move, scale and tilt, as today.
- **Toolbar**: page picker (Default, custom pages, treatments), device segmented control with
  Apple's names (iPhone 6.9", iPhone 6.1", iPad 13", Duo, Header, Search), language picker
  with completeness dots, view (One, Strip, All languages), zoom, guides, and one Generate
  button with progress.
- **Inspector** (`.inspector`), opening on what was clicked, in tabs:
  - **Text**: headline, caption, eyebrow; length meters instead of `26/~47`; per-language
    status; "same in all languages" where it applies.
  - **Layout**: template, phone position, scale, tilt, frame (native picker with device
    pictures), Reset.
  - **Background**: gradient and image editor with the native colour panel.
  - **Layers**: list with visibility, order, per-device toggles.
  - **Screen**: capture file, panorama, Dark Mode, devices it renders for.

### Pages

- A board: the default page, then custom pages, then each experiment with its treatments. Each
  card shows thumbnails, App Store Connect state, deep link or icon, keywords, header, search
  and Duo, and Check / Upload. Check opens a sheet with the plan; Upload asks once and shows
  progress.
- New page and new test as toolbar buttons.

### Listing

- Native form per language: name, subtitle, keywords as tokens with the 100-byte meter,
  promotional text, description, release notes; Apple's names and limits; language list with
  completeness; "copy to all languages".

### Ship

- **Checks** as a table grouped Must fix / Should fix / Fine, each row with its fix action
  (Generate missing screenshots, Open Listing, Add a Duo set).
- **Review** grid of every generated file per language and device, Quick Look on space,
  per-language "reviewed".
- **Upload**: fastlane metadata and screenshots, App Store Connect pages, Asset Library
  submission, each with what it sends and why it is blocked, in plain words; a notification
  when a long upload finishes.

### Settings (the app's Settings window and a per-app Settings section)

- App: devices as toggles with which Apple requires, languages, fonts (native font picker plus
  Google Fonts), brand colours, scenes, App Store Connect key status.
- Tool: where the engine lives, port, start the server at launch.

### Mac details that make it feel native

Menus with shortcuts for every action (Generate Cmd+G, next/previous screen, device Cmd+1..6,
language Cmd+[ ]); a command palette; drag and drop of captures and app folders from Finder;
Quick Look; system notifications; dark mode and accent colour from the system; window state
restored on launch; standard sheets and alerts; SF Symbols.

## Phases

Each phase ships on its own: the tool keeps working, the 341 engine tests stay green, Swift
tests cover the model and API client, and each ends with before/after screenshots and
`/code-review`.

| #   | Phase                    | What lands                                                                                                                                                                 | Size |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 0   | Foundations              | Canvas-only route and message bridge (with tests); Generate progress stream; Swift model from the schemas, API client, draft store with autosave and undo; window skeleton | L    |
| 1   | Apps and Design          | Sidebar with apps and status; Design: filmstrip, canvas, toolbar, inspector (Text, Layout, Screen); Generate with progress                                                 | L    |
| 2   | Design, rest             | Background and Layers inspectors, presets, fonts, assets, drag and drop of captures                                                                                        | M    |
| 3   | Pages                    | Pages board, App Store Connect state, plan sheet, upload and submit with progress                                                                                          | M    |
| 4   | Listing                  | Metadata forms per language with meters and completeness                                                                                                                   | S    |
| 5   | Ship                     | Checks with fix actions, review grid with Quick Look, uploads explained, notifications                                                                                     | M    |
| 6   | Settings, polish, retire | Settings window, menus and shortcuts, command palette, window restore; the web editor UI removed (canvas route, API and CLI stay)                                          | M    |

Phases 0 and 1 are the big ones and fix most of the daily pain; 2 to 5 can be reordered.

## Not changing

The engine and templates, CLI commands, API routes (only added to), file formats
(`store-shots.config.json`, manifest, content), App Store Connect behaviour and its rules in
`CLAUDE.md`.

## Risks

- **Two languages for one model.** Swift types come from the JSON schemas the engine already
  generates, and a test round-trips every fixture through them.
- **The bridge between Swift and the canvas** is new surface: a small, versioned message
  contract with tests on both sides.
- **The web editor's behaviour** (autosave races, undo, drag maths, page-only copy) has to be
  carried over, not reinvented; each is ported with the test that covers it today.
- **Size.** This is several weeks of work; the phases keep the tool usable throughout.

## Decisions needed

1. Start with phases 0 and 1 (recommended).
2. Retire the web editor UI at the end (recommended), or keep it as a fallback.
3. macOS 14 as the minimum (the app already targets it; needed for the native inspector).
