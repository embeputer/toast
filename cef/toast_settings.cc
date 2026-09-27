// toast — persisted settings (default search engine, later more).

#include "tests/ceftoast/toast_settings.h"

#include <fstream>
#include <mutex>

namespace toast {
namespace {

std::mutex g_mu;
std::string g_dir;
std::string g_engine;  // empty = default

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

std::string LoadEngineUnlocked() {
  if (!g_engine.empty()) {
    return g_engine;
  }
  std::ifstream f(SettingsPath());
  std::string line;
  while (std::getline(f, line)) {
    if (line.rfind("engine=", 0) == 0) {
      g_engine = line.substr(7);
      break;
    }
  }
  if (g_engine.empty()) {
    g_engine = "duckduckgo";
  }
  return g_engine;
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

bool HasCompletedSetup() {
  std::lock_guard<std::mutex> lock(g_mu);
  std::ifstream f(SettingsPath());
  return f.good();
}

std::string SearchEngineId() {
  std::lock_guard<std::mutex> lock(g_mu);
  return LoadEngineUnlocked();
}

std::string SearchEngineName() {
  std::lock_guard<std::mutex> lock(g_mu);
  return Lookup(kEngineNames, LoadEngineUnlocked());
}

std::string SearchEngineQueryBase() {
  std::lock_guard<std::mutex> lock(g_mu);
  return Lookup(kEngines, LoadEngineUnlocked());
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
  g_engine = id;
  std::ofstream f(SettingsPath(), std::ios::trunc);
  f << "engine=" << g_engine << "\n";
}

}  // namespace toast
