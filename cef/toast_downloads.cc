// toast — download registry + toast notifications.

#include "tests/ceftoast/toast_downloads.h"

#include <algorithm>
#include <sstream>
#include <string>
#include <vector>

#include "include/wrapper/cef_helpers.h"
#include "tests/ceftoast/toast_tabs.h"

namespace toast {
namespace {

struct Entry {
  uint32_t id;
  std::string name;
  std::string path;
  std::string state;  // "downloading" | "done" | "failed" | "cancelled"
  int percent;
};

std::vector<Entry> g_downloads;

std::string Esc(const std::string& s) {
  std::string out;
  for (char c : s) {
    switch (c) {
      case '&': out += "&amp;"; break;
      case '<': out += "&lt;"; break;
      case '>': out += "&gt;"; break;
      default: out.push_back(c);
    }
  }
  return out;
}

std::string StateOf(CefRefPtr<CefDownloadItem> item) {
  if (item->IsComplete()) {
    return "done";
  }
  if (item->IsCanceled()) {
    return "cancelled";
  }
  if (item->IsInterrupted()) {
    return "failed";
  }
  return "downloading";
}

}  // namespace

void TrackDownload(CefRefPtr<CefDownloadItem> item) {
  CEF_REQUIRE_UI_THREAD();

  const uint32_t id = item->GetId();
  const std::string state = StateOf(item);

  Entry* e = nullptr;
  for (auto& d : g_downloads) {
    if (d.id == id) {
      e = &d;
      break;
    }
  }
  const bool is_new = !e;
  if (is_new) {
    g_downloads.push_back(Entry{id, "", "", "downloading", 0});
    e = &g_downloads.back();
  }
  const std::string prev = e->state;
  e->name = item->GetFullPath().ToString();
  const size_t slash = e->name.find_last_of('/');
  if (slash != std::string::npos) {
    e->name = e->name.substr(slash + 1);
  }
  e->path = item->GetFullPath().ToString();
  e->state = state;
  e->percent = item->GetPercentComplete();

  if (is_new || prev != state) {
    if (state == "downloading") {
      ShowToast("Downloading " + e->name, "start");
    } else if (state == "done") {
      ShowToast("Downloaded " + e->name, "done");
    } else if (state == "failed") {
      ShowToast("Download failed: " + e->name, "fail");
    }
  }
}

std::string DownloadsHtml() {
  std::stringstream ss;
  if (g_downloads.empty()) {
    ss << "<p>No downloads yet.</p>";
    return ss.str();
  }
  ss << "<table>";
  for (auto it = g_downloads.rbegin(); it != g_downloads.rend(); ++it) {
    ss << "<tr><td>" << Esc(it->name) << "</td><td>" << it->state;
    if (it->state == "downloading") {
      ss << " (" << it->percent << "%)";
    }
    ss << "</td><td style=\"opacity:.4;font-size:12px\">" << Esc(it->path)
       << "</td></tr>";
  }
  ss << "</table>";
  return ss.str();
}

}  // namespace toast
