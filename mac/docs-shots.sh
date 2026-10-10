#!/bin/sh
# Retakes the Mac app's images in docs/images/app-*.png from a real app.
#
#   sh mac/docs-shots.sh [app] [app2] [country] [screen]
#
# app (default Rallo) is shown in most images. app2 (default: app) should be on the App Store
# and in several languages: it shows the strip with the live listing under it (from the
# storefront country, default us) and one screen in every language (screen, default the one
# selected: pick a single-slide one).
# Settings is left out: it shows the app's folder and the App Store Connect key's name.
#
# Runs the Debug build, whose debug hooks drive the window and photograph it as the window
# server draws it: no screen-recording rights needed, but the screen must be unlocked (a
# locked screen captures blank). Quits a running Store Shots first, the normal way, so its
# edits are saved. Changes nothing in the app.
set -e
cd "$(dirname "$0")"
APP="${1:-Rallo}"
APP2="${2:-$APP}"
COUNTRY="${3:-us}"
SCREEN="${4:-}"
OUT="$(cd .. && pwd)/docs/images"
TMP="$(mktemp -d)"

if ioreg -n Root -d1 -a | grep -A1 CGSSessionScreenIsLocked | grep -q true; then
  echo "The screen is locked: unlock it and run this again." >&2
  exit 1
fi
command -v pngquant >/dev/null || { echo "Needs pngquant (brew install pngquant)." >&2; exit 1; }

xcodegen generate --quiet
xcodebuild -project StoreShots.xcodeproj -scheme StoreShots -configuration Debug \
  -derivedDataPath build/DerivedData -quiet build
osascript -e 'tell application "Store Shots" to quit' 2>/dev/null || true
while pgrep -x "Store Shots" >/dev/null; do sleep 1; done
open "build/DerivedData/Build/Products/Debug/Store Shots.app"

hook() {
  osascript -l JavaScript -e "ObjC.import('Foundation'); \$.NSDistributedNotificationCenter.defaultCenter
    .postNotificationNameObjectUserInfoDeliverImmediately('com.bavrk.storeshots.debug', '$1', \$(), true)" >/dev/null
}

# Waits until the window's state (the dump hook) matches a pattern, for at most a minute.
wait_for() {
  i=0
  while [ $i -lt 60 ]; do
    hook "dump:$TMP/state.txt"
    sleep 1
    grep -q "$1" "$TMP/state.txt" 2>/dev/null && return 0
    i=$((i + 1))
  done
  echo "Timed out waiting for: $1" >&2
  cat "$TMP/state.txt" >&2
  exit 1
}

# Settles in front (a window behind others is not redrawn), photographs at full resolution
# (once more if it caught the window mid-change), and writes a 2000 px wide, palette PNG.
shot() {
  osascript -e 'tell application "Store Shots" to activate'
  hook "size:1440:900"
  sleep "${2:-2}"
  for try in 1 2 3; do
    rm -f "$TMP/$1.png"
    hook "snapshot:$TMP/$1.png"
    sleep 2
    [ "$(sips -g pixelWidth "$TMP/$1.png" 2>/dev/null | awk '/pixelWidth/ { print $2 }')" = 2880 ] && break
    sleep 3
  done
  sips --resampleWidth 2000 "$TMP/$1.png" --out "$TMP/$1-s.png" >/dev/null
  pngquant --force --quality 70-95 --output "$OUT/app-$1.png" "$TMP/$1-s.png"
  echo "docs/images/app-$1.png"
}

sleep 5
wait_for "selection:"
hook "size:1440:900"
hook "open:$APP:design"
wait_for "preview: loading=false"
wait_for "queued=0 running=false"
hook "mode:single"
shot design 4

for section in pages listing ship; do
  hook "open:$APP:$section"
  shot "$section" 5
done

hook "open:$APP2:design"
wait_for "preview: loading=false"
[ -n "$SCREEN" ] && hook "screen:$SCREEN"
hook "mode:locales"
shot languages 10
hook "mode:strip"
hook "live:$COUNTRY"
shot strip-live 20
hook "live:off"
hook "mode:single"

# Last: once the app list is in, the window reopens the app shown last time.
hook "apps"
shot apps 6

rm -rf "$TMP"
