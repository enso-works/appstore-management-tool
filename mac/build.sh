#!/bin/sh
# Builds Store Shots.app into mac/build/. Needs Xcode and XcodeGen (brew install xcodegen).
#
#   sh mac/build.sh          # build
#   sh mac/build.sh --open   # build and launch
set -e
cd "$(dirname "$0")"
xcodegen generate --quiet
xcodebuild -project StoreShots.xcodeproj -scheme StoreShots -configuration Release \
  -derivedDataPath build/DerivedData -quiet build
rm -rf "build/Store Shots.app"
cp -R "build/DerivedData/Build/Products/Release/Store Shots.app" build/
echo "build/Store Shots.app"
[ "$1" = "--open" ] && open "build/Store Shots.app"
exit 0
