#!/usr/bin/env bash
# Build toast (CEF) inside a CEF binary distribution.
#
# Usage:
#   ./cef/build.sh [path-to-cef-distro]
#
# The CEF binary distribution is a ~300MB download that is NOT committed to
# this repo. Grab the macosarm64 "Standard" build from
# https://cef-builds.spotifycdn.com/index.html and extract it, then point this
# script at it (default: ~/cef/distro).
#
# The script copies this directory into <distro>/tests/ceftoast, hooks
# add_subdirectory(tests/ceftoast) into the distro CMakeLists if needed,
# then configures and builds the `toast` target with Ninja.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CEF_DIR="${1:-${CEF_DIR:-$HOME/cef/distro}}"
TARGET_DIR="$CEF_DIR/tests/ceftoast"
BUILD_DIR="$CEF_DIR/build"

if [[ ! -f "$CEF_DIR/CMakeLists.txt" ]]; then
  echo "error: '$CEF_DIR' does not look like a CEF binary distribution" >&2
  echo "download one from https://cef-builds.spotifycdn.com/index.html" >&2
  exit 1
fi

# Inject our sources.
rsync -a --delete --exclude 'build.sh' --exclude 'README.md' "$REPO_ROOT/cef/" "$TARGET_DIR/"

# Web resources shared with the Electron shell (single source of truth).
mkdir -p "$TARGET_DIR/resources"
cp "$REPO_ROOT/src/newtab.html" "$TARGET_DIR/resources/newtab.html"

# App icon: reuse the Electron build's icon if present.
if [[ -f "$REPO_ROOT/build/icon.icns" ]]; then
  cp "$REPO_ROOT/build/icon.icns" "$TARGET_DIR/mac/toast.icns"
fi

# Hook the subdirectory into the distro build.
if ! grep -q 'add_subdirectory(tests/ceftoast)' "$CEF_DIR/CMakeLists.txt"; then
  # Insert right after the cefsimple subdirectory line.
  if grep -q 'add_subdirectory(tests/cefsimple)' "$CEF_DIR/CMakeLists.txt"; then
    sed -i '' 's|add_subdirectory(tests/cefsimple)|add_subdirectory(tests/cefsimple)\n  add_subdirectory(tests/ceftoast)|' "$CEF_DIR/CMakeLists.txt"
  else
    echo 'add_subdirectory(tests/ceftoast)' >> "$CEF_DIR/CMakeLists.txt"
  fi
fi

cmake -S "$CEF_DIR" -B "$BUILD_DIR" -GNinja -DCMAKE_BUILD_TYPE=Release -DPROJECT_ARCH=arm64
ninja -C "$BUILD_DIR" toast

echo
echo "built: $BUILD_DIR/tests/ceftoast/Release/toast.app"
