# toast

toast's browser, built on the [Chromium Embedded Framework](https://bitbucket.org/chromiumembedded/cef) —
real Chromium, including its multi-process model and helper app bundles, in an
Alloy-runtime Views window with no native Chrome UI.

## Status

Shipping on `main`: bare window (no title bar), `toast://` internal pages
(newtab, settings, downloads, switcher HUD, download toast), per-tab ⌘W,
⌃Tab switcher, top loading bar, plain/glassy window modes with a real
`NSGlassEffectView` liquid-glass border.

## Build

Requires macOS arm64, CMake, and Ninja:

```sh
brew install cmake ninja

# one-time: download a CEF "Standard" binary distribution (macosarm64) from
# https://cef-builds.spotifycdn.com/index.html and extract it
./cef/build.sh /path/to/cef_binary_*_macosarm64   # or set CEF_DIR; default ~/cef/distro

open /path/to/distro/build/tests/ceftoast/Release/toast.app
```

The script injects this directory as `tests/ceftoast` inside the distribution
(CEF's build system expects apps to live in its tree) and builds the `toast`
target. The distro itself is not committed.

Useful flags: `--url=<url>` overrides the start page, `--use-alloy-style` and
`--use-native` switch off the Chrome-runtime window style.

## Layout

| file | role |
| --- | --- |
| `toast_mac.mm` | entry point: `NSApplication` subclass, CEF init, message loop |
| `toast_app.{h,cc}` | `CefApp`/`CefBrowserProcessHandler`; creates the first window |
| `toast_handler.{h,cc}` | `CefClient` — display/lifespan/load callbacks, browser list |
| `toast_handler_mac.mm` | NSWindow-level title/show helpers |
| `process_helper_mac.cc` | entry point for renderer/GPU/plugin helper processes |
| `mac/` | Info.plist templates, MainMenu.xib, icon |

## Not yet

No toast chrome (the glass pill, tab switcher, setup screen) — this spike
proves the shell boots and renders on real CEF. UI parity, `toast://` scheme
registration, extension loading, and Linux/Windows ports come next if we
commit to this path.
