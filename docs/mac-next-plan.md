# Mac app: next (roadmap Mac item 4)

Status: **approved 2026-10-13**; phase 1 done 2026-10-14 (`GET /asc/versions`, `store-shots asc versions`,
the line on the cards and in the toolbar). The open questions below are for phase 2.

## Where item 4 stands

The roadmap row ("App Store Connect status, metadata and screenshot upload from the app,
notifications when renders finish, app icon") is mostly done already, in other work:

| Part                            | State                                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| Notifications when jobs finish  | Done (d7c7741): generate, lanes and uploads notify when the Mac app is in the background |
| Metadata and screenshot uploads | Done: Ship runs the metadata and screenshot lanes; Pages uploads drafts (`asc push`)     |
| App icon                        | Done: the Apps overview shows each app's icon                                            |
| App Store Connect status        | Partly: only inside Pages, fetched when you open it, for the app that is open            |

What is missing is the status **at a glance**, and hearing when it **changes**: today you
learn that a build went into review, was approved or was rejected from email or App Store
Connect, not from the tool you release with.

## Proposal

### Phase 1: status at a glance (S)

- Engine: `GET /api/projects/<name>/asc/versions`, the app's versions and their states only
  (one App Store Connect call, not the pages and experiments `asc/status` also fetches),
  cached on the engine for 5 minutes. Read-only. An app without a key answers
  `{ "connected": false }`, not an error.
- Apps overview: each card shows the live version and the one in progress, in the words
  Pages already uses: "2.1.0 Live · 2.2.0 Draft", "1.0 Waiting for review".
- Main window: the same line beside the app's name in the toolbar, with the time it was
  read; clicking it opens Pages.

### Phase 2: hear when it changes (M)

- While the Mac app is open it reads the versions of every app with a key every
  15 minutes (seven apps is under 30 calls an hour; Apple allows 3600).
- When a version's state changes, a notification: "Braele 2.2.0 is in review",
  "...approved", "...live", "...rejected". These notify even when the app is in front,
  unlike job notifications, because nothing on screen says it.
- The last state seen is kept in the app's preferences, so a change that happened while
  the Mac app was closed is reported once at the next launch, not missed and not repeated.
- A **Check now** item in the Apps menu, and a setting to turn the watching off.

### Phase 3: housekeeping (S)

- Roadmap: tick item 4's parts as above and link this plan.
- Docs: the App Store Connect page on the site gets the overview line and the notifications.

## Not in this plan

- Submitting anything. The rules stay: the tool never submits versions, pages or
  experiments (CLAUDE.md).
- Reading reviews, ratings or sales. Possible later, separate plan.
- Watching TestFlight build processing. Possible as a phase 4 if wanted: "build 17 is ready
  to test" is the same mechanism on `builds` instead of `appStoreVersions`.

## Open questions

1. Watch every app with a key, or only apps you have opened in the last N days?
2. Fifteen minutes, or a different interval?
3. Phase 4 (TestFlight builds ready) now or later?
