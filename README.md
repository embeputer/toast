# toast

A minimal Chromium browser that wears Safari's compact-mode chrome.

## Run

```sh
npm install
npm start
```

Requires macOS (the chrome is built around native traffic lights) and Node + npm for development. Electron supplies the Chromium engine.

## What it is

- One slim toolbar: real macOS traffic lights on the left, a compact URL pill centered on the window. No tab strip, no extra buttons.
- The pill shows just the domain (with favicon) while browsing; click or `⌘L` for the full URL, type to search or enter an address.
- Tabs live in a left sidebar (`⇧⌘L`), Safari-style. `⌘T` opens a tab and drops you straight into the pill.
- Pages render in sandboxed `WebContentsView`s; links that want a new window open as tabs instead; downloads go to `~/Downloads`.

## Shortcuts

| Keys | Action |
| --- | --- |
| `⌘L` | Focus address bar |
| `⌘T` / `⌘W` | New tab / close tab |
| `⇧⌘L` | Toggle tab sidebar |
| `⌘[` / `⌘]` | Back / forward |
| `⌘R` / `⇧⌘R` | Reload / force reload |
| `Ctrl+Tab` / `⇧⌘]` `⇧⌘[` | Next / previous tab |
| `⌘1`–`⌘9` | Jump to tab |
| `⌘N` | New window |
| `⌥⌘I` | DevTools for the page |
