# Starter themes plan

Importing an app today gives one `home` screen with a placeholder headline, Inter, the default
colours and no background: every app starts from a blank page, and getting to something that
looks like a store listing takes an afternoon of sliders. Braele and Rallo look good because
someone made each of those choices by hand.

A theme makes those choices up front. You pick one when you import an app (or later, for an app
you already have), and the app starts with a page of screens that already look like a finished
listing in your app's colours. Then you drop in captures and write the copy.

Approved 2026-10-11 with all six themes, five starting screens and a headline font per theme.

## What a theme is

A theme is data in the engine (`lib/themes.ts`, like `lib/background-presets.ts`), not a new
kind of file in the app. Applying one writes ordinary config and manifest values, so everything
it does can be changed afterwards with the controls that exist today, and an app never depends on
the theme staying the same.

A theme sets:

- **Fonts**: body and headline, from Google Fonts (downloaded once, as today).
- **Colours**: `primary`, `onPrimary`, `accent`, all worked out from one accent colour.
- **The app's default background**: fill, pattern, and whether it spans the strip.
- **A screen recipe**: template and layout for each position on the page (first screen, then a
  repeating pattern), so screens vary the way good listings do: phones that alternate sides,
  glows that move, a bigger first screen.
- **The frame**: dark, light or none per device family.

It never touches copy, captures, layers, screen ids or their order.

## The accent colour

Every theme is drawn in one accent colour, so the same theme looks like a different app's own:

1. the app's colour if it states one (Expo `primaryColor`, the splash `backgroundColor`, the
   asset catalog's `AccentColor`);
2. otherwise the most vivid colour in the app icon (sampled with sharp, ignoring near-white,
   near-black and grey);
3. otherwise a neutral blue.

The import sheet shows the colour it found and where from, like the other proposed values, and
you can change it. From the accent the theme derives its tones (a dark base, a light tint, glow
colours, a text colour with enough contrast) in OKLCH, so light and dark themes both stay
readable.

## The first themes

Six, each working in portrait, landscape, iPad, header and search images, and right to left. The
names are working titles.

| Theme  | Look                                                                                   | Close to       |
| ------ | -------------------------------------------------------------------------------------- | -------------- |
| Aurora | Near-black, two soft glows in the accent that move from screen to screen; white text   | Braele         |
| Bold   | The accent as a solid fill, heavy white headline, a big phone running off the bottom   | Most top apps  |
| Paper  | Warm off-white, dark text, faint grain, accent eyebrow; light frame                    | Editorial apps |
| Swing  | Phones alternate left and right with a slight tilt, text follows; gradient spans strip | Rallo          |
| Split  | Text beside the phone, sides alternate; made for iPad and landscape                    |                |
| Card   | The capture fills the screen, the copy on an accent card; for games and photo apps     |                |

## Starting screens

A theme on import also gives the page a starting set of screens, so the strip looks like a
listing from the first minute:

- five screens, `hero` and four more (see the open questions for their ids);
- copy to replace: the hero's headline from the app's `subtitle.txt` when there is one, the rest
  short prompts ("What does this screen let you do?") that a new check reports as
  placeholders, so they cannot ship by mistake;
- a capture placeholder that looks like a phone screen in the theme's colours, instead of today's
  grey "raw capture missing", so the page reads well before any capture is in.

An app that already has screens keeps them; applying a theme only restyles.

## Where you pick one

- **Import App** gets a **Look** step after **What Was Found**: a thumbnail strip of each theme
  in the app's accent, with the accent swatch to change. **Plain** (today's start) stays an
  option.
- **Design > Theme...** (and Command-K) restyles an app you already have: the strip before and
  after, then **Apply**. One step for Command-Z.
- On the command line:

  ```sh
  store-shots init --theme aurora [--accent "#3FA69F"]
  store-shots theme list
  store-shots theme apply bold [--accent "#E5484D"] [--dry-run]
  ```

Previews come from the engine, rendered like any screen: with the app's own captures where it has
them, otherwise with demo captures from `fixtures/`.

## Phases

| #   | What lands                                                                                                                                                                                                                                                           | Size |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Done: engine: `lib/themes.ts` with the six themes, accent from the app and its icon, `applyTheme`, `init --theme`, `theme list/apply`, the placeholder capture; tests that every theme validates and renders on every device family, left to right and right to left | M    |
| 2   | Done: Mac app: the Look step in Import App, **Theme...** in Design and Command-K, previews from the engine                                                                                                                                                           | M    |
| 3   | Done: docs: a Themes page with a contact sheet per theme, rendered by a script; README and the browser editor's import                                                                                                                                               | S    |

## Decisions (2026-10-11)

- All six themes in the first round.
- New apps start with five screens: `hero`, then `feature-1` to `feature-4`.
- Each theme brings its own headline font; body text stays Inter. The fonts are bundled with the
  tool (as Inter is), so themes work offline and previews need no download. Headlines use the
  heaviest weight listed for the headline font instead of a fixed 700, so a single-weight
  display face is never drawn in a faked bold.

## Phase 1 notes (2026-10-11)

- Split is a diagonal layout (text on one side, the phone off the opposite corner), not text
  beside the phone: a side column is too narrow on a portrait phone canvas.
- Paper has no grain: the noise pattern turned the off-white grey.
- Copy for a field the screen's template does not show (an eyebrow under Full Bleed Card) is
  now a warning (`content.unused-field`), kept for switching back, instead of an error that
  stopped the screen rendering. A name no template knows is still an error.
- The capture placeholder is a sketch of an app screen in the app's colours, in the editor
  only; generating still needs real captures.

## Phase 2 notes (2026-10-11)

- The engine renders the previews: `GET /api/themes/preview?theme=&accent=` draws the first
  three screens in the theme, from the app's own captures and copy (`&project=`) or, before
  an app is imported, the five starter screens with sample copy and the capture sketch.
  One Chromium serves every preview; each takes about two seconds.
- `POST /api/projects/<name>/theme` applies a theme and answers with the config and manifest
  from before; `PUT` puts them back. The Mac app's Command-Z is that `PUT`, registered after
  the reload a theme causes.
- Import App's Look step offers Plain (one screen, as before) and the six themes, Aurora
  selected, in the colour found in the app.
- The Mac UI was built and its calls tested against the engine, but not seen on screen yet:
  the screen was locked. `notify theme` (the `theme` debug hook) opens the sheet for a check.
