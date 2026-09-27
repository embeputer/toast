// toast — persisted settings (default search engine, later more).

#ifndef TOAST_CEF_TOAST_SETTINGS_H_
#define TOAST_CEF_TOAST_SETTINGS_H_

#include <string>

namespace toast {

// Called once at startup with the app's data dir (root_cache_path).
void SetSettingsDir(const std::string& dir);

// PNG snapshot of the desktop wallpaper (written at startup); the glassy
// new-tab page serves it via toast://wallpaper.
std::string WallpaperPath();

// True once the user has completed the setup screen (settings file exists).
bool HasCompletedSetup();

// Search engine choice: "google" | "duckduckgo" | "bing" | "brave".
std::string SearchEngineId();
std::string SearchEngineName();   // "DuckDuckGo", for placeholders
std::string SearchEngineQueryBase();  // "https://duckduckgo.com/?q="
void SetSearchEngine(const std::string& id);

// Liquid-glass window mode ("glassy toast"): level 0-100, 0 = plain.
bool GlassEnabled();
int GlassLevel();
void SetGlassLevel(int level);

}  // namespace toast

#endif  // TOAST_CEF_TOAST_SETTINGS_H_
