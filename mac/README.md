# Store Shots for Mac

A native window around the store-shots editor. The editor itself (templates, rendering,
validation) is the Next.js app in this repo; the Mac app runs it and adds the parts a
browser tab cannot: a project switcher, menus and shortcuts, Finder integration and a
server that starts with the app and stops with it.

```bash
brew install xcodegen      # once
sh mac/build.sh --open     # builds mac/build/Store Shots.app and launches it
```

- An editor already running on ports 3000-3009 (`store-shots open`, `npm run dev`) is
  attached to and left running on quit. Otherwise the app runs `next dev` (a git
  checkout) or `next start` (an installed copy with a build) from the store-shots folder,
  in its own process group, and stops it on quit.
- The store-shots folder defaults to the checkout the app was built from; change it in
  Settings. `node` is found through your login shell's PATH.
- Server log: Server > Show Server Log (Shift-Command-L), also written to
  `~/Library/Logs/Store Shots/editor.log`.

| Shortcut        | Action                               |
| --------------- | ------------------------------------ |
| Command-O       | Import an app folder                 |
| Command-0       | All apps                             |
| Command-1 to 9  | Open an app                          |
| Command-R       | Reload the editor                    |
| Shift-Command-B | Open the current page in the browser |
| Shift-Command-L | Server log                           |

The Xcode project is generated from `project.yml` and not committed.
