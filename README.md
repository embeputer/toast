# toast

A minimal Chromium browser — just a floating address pill and the macOS traffic lights.

## Run

```sh
npm install
npm start
```

Requires macOS and Node + npm for development. Electron supplies the Chromium engine.

## What it is

- Pages fill the entire window. There is no toolbar, no tab strip, no sidebar.
- Top center: a liquid-glass pill showing the tab's favicon + title. Click it (or `⌘K`, the future command toast) to edit the address; `Enter` navigates, `Esc` cancels.
- Top left: the native macOS traffic lights, bare.
- Tabs exist but have no UI — keyboard only. `⌘T` opens a tab focused into the pill.
- Pages render in sandboxed `<webview>`s; links that want a new window open as tabs; downloads go to `~/Downloads`.
- On macOS 26+ the pill is real Liquid Glass (`NSGlassEffectView` via `electron-liquid-glass`, in a transparent child window so the DOM content stays crisp); older macOS falls back to CSS glass.

## Shortcuts

| Keys | Action |
| --- | --- |
| `⌘K` | Command toast (edit address) |
| `⌘T` / `⌘W` | New tab / close tab |
| `⌘[` / `⌘]` | Back / forward |
| `⌘R` / `⇧⌘R` | Reload / force reload |
| `Ctrl+Tab`, `⇧⌘]` `⇧⌘[` | Next / previous tab |
| `⌘1`–`⌘9` | Jump to tab |
| `⌘N` | New window |
| `⌥⌘I` | DevTools for the page |

## Install (dmg)

```sh
npm run dist
```

Produces `dist/Toast-<version>-arm64.dmg` with a drag-to-Applications layout.
