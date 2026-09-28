# toast

A minimal Chromium browser for macOS, built on the Chromium Embedded Framework (CEF).

No toolbar, no tab strip, no title bar — pages fill the window under just the
macOS traffic lights. `toast://` hosts the internal pages.

- **New tab:** centered search bar; `toast://newtab/`
- **Tabs:** `⌘T` new, `⌘W` close tab, `⇧⌘W` close window
- **Switcher:** `⌃Tab` opens it, `←`/`→` (or more `⌃Tab`) step, `Enter` commits, `Esc` cancels
- **Internals:** `toast://settings` (engine + plain/glassy), `toast://downloads`, `toast://version`
- **Glass:** `NSGlassEffectView` behind the window — liquid-glass border around
  the page; the new-tab page renders as a milky pane inside it. Slider in
  `toast://settings` runs tinted → liquid. Plain mode gets a solid border.

## Build

See `cef/` — it injects the app into a prebuilt CEF binary distribution
(`./cef/build.sh <path-to-cef-distro>`) and produces `toast.app`.
