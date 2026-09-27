// toast — persisted settings (default search engine, later more).

#include "tests/ceftoast/toast_settings.h"

#include <fstream>
#include <mutex>

namespace toast {
namespace {

std::mutex g_mu;
std::string g_dir;
std::string g_engine;  // empty = default
int g_glass = -1;      // -1 = unread, else 0-100 (0 = plain)

const char* kEngines[][2] = {
    {"google", "https://www.google.com/search?q="},
    {"duckduckgo", "https://duckduckgo.com/?q="},
    {"bing", "https://www.bing.com/search?q="},
    {"brave", "https://search.brave.com/search?q="},
};

const char* kEngineNames[][2] = {
    {"google", "Google"},
    {"duckduckgo", "DuckDuckGo"},
    {"bing", "Bing"},
    {"brave", "Brave"},
};

std::string SettingsPath() {
  return g_dir + "/settings.txt";
}

void LoadUnlocked() {
  if (g_engine.empty()) {
    g_engine = "duckduckgo";
  }
  if (g_glass < 0) {
    g_glass = 0;
  }
  std::ifstream f(SettingsPath());
  std::string line;
  while (std::getline(f, line)) {
    if (line.rfind("engine=", 0) == 0) {
      g_engine = line.substr(7);
    } else if (line.rfind("glass=", 0) == 0) {
      const std::string v = line.substr(6);
      g_glass = v == "1" ? 100 : std::atoi(v.c_str());
      if (g_glass < 0 || g_glass > 100) {
        g_glass = g_glass < 0 ? 0 : 100;
      }
    }
  }
}

void SaveUnlocked() {
  std::ofstream f(SettingsPath(), std::ios::trunc);
  f << "engine=" << g_engine << "\n";
  f << "glass=" << g_glass << "\n";
}

const char* Lookup(const char* table[][2], const std::string& id) {
  for (size_t i = 0; i < 4; ++i) {
    if (id == table[i][0]) {
      return table[i][1];
    }
  }
  return table[1][1];  // DuckDuckGo default
}

}  // namespace

void SetSettingsDir(const std::string& dir) {
  std::lock_guard<std::mutex> lock(g_mu);
  g_dir = dir;
}

std::string WallpaperPath() {
  std::lock_guard<std::mutex> lock(g_mu);
  return g_dir + "/wallpaper.png";
}

bool HasCompletedSetup() {
  std::lock_guard<std::mutex> lock(g_mu);
  std::ifstream f(SettingsPath());
  return f.good();
}

std::string SearchEngineId() {
  std::lock_guard<std::mutex> lock(g_mu);
  LoadUnlocked();
  return g_engine;
}

std::string SearchEngineName() {
  std::lock_guard<std::mutex> lock(g_mu);
  LoadUnlocked();
  return Lookup(kEngineNames, g_engine);
}

std::string SearchEngineQueryBase() {
  std::lock_guard<std::mutex> lock(g_mu);
  LoadUnlocked();
  return Lookup(kEngines, g_engine);
}

bool GlassEnabled() {
  std::lock_guard<std::mutex> lock(g_mu);
  LoadUnlocked();
  return g_glass > 0;
}

int GlassLevel() {
  std::lock_guard<std::mutex> lock(g_mu);
  LoadUnlocked();
  return g_glass;
}

void SetGlassLevel(int level) {
  if (level < 0) {
    level = 0;
  } else if (level > 100) {
    level = 100;
  }
  std::lock_guard<std::mutex> lock(g_mu);
  LoadUnlocked();
  g_glass = level;
  SaveUnlocked();
}

void SetSearchEngine(const std::string& id) {
  // Whitelist to known engines.
  bool known = false;
  for (size_t i = 0; i < 4; ++i) {
    if (id == kEngines[i][0]) {
      known = true;
    }
  }
  if (!known) {
    return;
  }
  std::lock_guard<std::mutex> lock(g_mu);
  LoadUnlocked();
  g_engine = id;
  SaveUnlocked();
}

}  // namespace toast
