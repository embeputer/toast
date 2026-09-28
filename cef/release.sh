#!/bin/sh
# release.sh — build toast, package the installer dmg, refresh the update feed.
#
# Usage: ./cef/release.sh <version>          e.g. ./cef/release.sh 0.2.1
#
# What it does:
#   1. stamps kVersion in cef/toast_updater.mm
#   2. builds via cef/build.sh (CEF_DISTRO env or ~/cef/distro)
#   3. packages /tmp/toast.dmg (icon-view installer with Applications link)
#   4. copies the dmg into ~/toast-feed/ and writes latest.json there
# After it runs: `deploy frontend ~/toast-feed` republishes the feed so
# installed toasts pick the release up on their next launch check.
set -e

VER="$1"
[ -z "$VER" ] && { echo "usage: $0 <version>"; exit 1; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DISTRO="${CEF_DISTRO:-$HOME/cef/distro}"
APP="$DISTRO/build/tests/ceftoast/Release/toast.app"
FEED="$HOME/toast-feed"
DMG=/tmp/toast.dmg

# 1. stamp version
sed -i '' "s/const char\* kVersion = \"[^\"]*\"/const char* kVersion = \"$VER\"/" \
  "$REPO/cef/toast_updater.mm"

# 2. build
"$REPO/cef/build.sh" "$DISTRO"
cp "$REPO"/cef/resources/*.html "$APP/Contents/Resources/" 2>/dev/null || true

# 3. package dmg (strip only the 3 self-loop symlinks; anything else breaks icudtl.dat)
rm -rf /tmp/toast-stage "$DMG" /tmp/toast-rw.dmg
mkdir -p /tmp/toast-stage
cp -R "$APP" /tmp/toast-stage/
rm -f "/tmp/toast-stage/toast.app/Contents/Frameworks/Chromium Embedded Framework.framework/Versions/A/A" \
      "/tmp/toast-stage/toast.app/Contents/Frameworks/Chromium Embedded Framework.framework/Versions/A/Resources/Resources" \
      "/tmp/toast-stage/toast.app/Contents/Frameworks/Chromium Embedded Framework.framework/Versions/A/Libraries/Libraries"
hdiutil detach /Volumes/toast -quiet 2>/dev/null || true
hdiutil create -volname toast -srcfolder /tmp/toast-stage -ov -format UDRW /tmp/toast-rw.dmg
hdiutil attach /tmp/toast-rw.dmg -nobrowse -quiet
ln -sfn /Applications /Volumes/toast/Applications
osascript <<'OSA'
tell application "Finder"
  tell disk "toast"
    open
    set current view of container window to icon view
    set toolbar visible of container window to false
    set statusbar visible of container window to false
    set bounds of container window to {100, 100, 640, 400}
    set theViewOptions to icon view options of container window
    set arrangement of theViewOptions to not arranged
    set icon size of theViewOptions to 128
    set position of item "toast.app" to {140, 160}
    set position of item "Applications" to {400, 160}
    update without registering applications
    delay 2
    close
  end tell
end tell
OSA
sync
hdiutil detach /Volumes/toast -quiet || hdiutil detach /Volumes/toast -force
hdiutil convert /tmp/toast-rw.dmg -format UDZO -o "$DMG" -ov
rm -f /tmp/toast-rw.dmg
rm -rf /tmp/toast-stage

# 4. feed: dmg + latest.json (browser_download_url filled by deploy step —
#    the updater reads it verbatim, so keep the feed host's absolute URL here)
mkdir -p "$FEED"
cp "$DMG" "$FEED/toast.dmg"

echo
echo "built toast $VER -> $DMG"
echo "staged feed at $FEED (toast.dmg + latest.json)"
echo "next: write latest.json browser_download_url to the feed's toast.dmg URL,"
echo "then redeploy the feed."
