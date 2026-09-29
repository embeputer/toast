#!/bin/sh
# release.sh — build toast, package the installer dmg, refresh the update feed.
#
# Usage: ./cef/release.sh <version>          e.g. ./cef/release.sh 0.2.1
#
# What it does:
#   1. stamps kVersion in cef/toast_updater.mm
#   2. builds via cef/build.sh (CEF_DISTRO env or ~/cef/distro)
#   3. packages /tmp/toast.dmg (icon-view installer with Applications link)
#   4. uploads the dmg to catbox and writes latest.json into ~/toast-feed/
# After it runs: `deploy frontend ~/toast-feed` republishes the feed so
# installed toasts pick the release up on their next launch check.
# ALWAYS bump the version — two different builds must never share one,
# or the updater can't tell them apart.
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
hdiutil convert /tmp/toast-rw.dmg -format UDBZ -o "$DMG" -ov
rm -f /tmp/toast-rw.dmg
rm -rf /tmp/toast-stage

# 4. publish: dmg -> catbox (devinapps deploy can't carry ~130MB),
#    latest.json -> feed dir pointing at the hosted dmg
DMG_URL="$(curl -s --max-time 600 -F 'reqtype=fileupload' \
  -F "fileToUpload=@$DMG" https://catbox.moe/user/api.php)"
case "$DMG_URL" in
  https://files.catbox.moe/*) ;;
  *) echo "catbox upload failed: $DMG_URL"; exit 1 ;;
esac

mkdir -p "$FEED"
cat > "$FEED/latest.json" <<JSON
{"tag_name":"v$VER","assets":[{"browser_download_url":"$DMG_URL","name":"toast.dmg"}]}
JSON

echo
echo "built toast $VER -> $DMG"
echo "dmg hosted at $DMG_URL"
echo "wrote $FEED/latest.json — redeploy the feed to publish."
