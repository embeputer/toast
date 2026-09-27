// toast — toast:// internal page scheme.

#include "tests/ceftoast/toast_scheme.h"

#include <sstream>
#include <string>

#include "include/base/cef_bind.h"
#include "include/base/cef_callback.h"
#include "include/cef_parser.h"
#include "include/cef_request.h"
#include "include/cef_task.h"
#include "include/cef_version.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_stream_resource_handler.h"
#include "tests/ceftoast/toast_downloads.h"
#include "tests/ceftoast/toast_settings.h"
#include "tests/ceftoast/toast_tabs.h"

namespace {

// Minimal chrome for internal pages; follows the same look as the Electron
// shell's generated pages (dark-aware, system font).
const char kPageCss[] = R"CSS(
  :root { color-scheme: light dark; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
    margin: 0; padding: 48px 40px;
    background: #f5f5f7; color: #1d1d1f;
  }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; }
  table { border-collapse: collapse; margin-top: 16px; }
  td { padding: 6px 18px 6px 0; font-size: 14px; }
  td:first-child { opacity: 0.55; }
  a { color: #0066cc; }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1c1e; color: #f2f2f7; }
    a { color: #4d9fff; }
  }
)CSS";

std::string WrapPage(const std::string& title, const std::string& body) {
  std::stringstream ss;
  ss << "<!doctype html><html><head><meta charset=\"utf-8\">"
        "<title>" << title << "</title><style>" << kPageCss
     << "</style></head><body><h1>" << title << "</h1>" << body
     << "</body></html>";
  return ss.str();
}

std::string VersionPage() {
  std::stringstream ss;
  ss << "<table>"
     << "<tr><td>Toast</td><td>ceftoast spike</td></tr>"
     << "<tr><td>CEF</td><td>" << CEF_VERSION << "</td></tr>"
     << "<tr><td>Chromium</td><td>" << CHROME_VERSION_MAJOR << "."
     << CHROME_VERSION_MINOR << "." << CHROME_VERSION_BUILD << "."
     << CHROME_VERSION_PATCH << "</td></tr>"
     << "</table>";
  return WrapPage("toast://version", ss.str());
}

std::string DownloadsPage() {
  return WrapPage("toast://downloads", toast::DownloadsHtml());
}

// Injects the runtime config pages read: window.__toast = {...}.
std::string ConfigJs() {
  std::stringstream ss;
  ss << "window.__toast={engine:\"" << toast::SearchEngineQueryBase()
     << "\",engineName:\"" << toast::SearchEngineName() << "\",glass:"
     << (toast::GlassEnabled() ? "true" : "false")
     << ",glassLevel:" << toast::GlassLevel() << "};";
  return ss.str();
}

// Generic redirect page (meta refresh — simplest reliable redirect for a
// custom scheme).
std::string RedirectPage(const std::string& target) {
  return "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"refresh\" "
         "content=\"0;url=" +
         target + "\">";
}

std::string QueryParam(const CefString& query, const std::string& key) {
  const std::string q = query.ToString();
  const std::string prefix = key + "=";
  size_t pos = q.find(prefix);
  if (pos == std::string::npos) {
    return "";
  }
  pos += prefix.size();
  const size_t end = q.find('&', pos);
  return CefURIDecode(q.substr(pos, end == std::string::npos
                                          ? std::string::npos
                                          : end - pos),
                      true, static_cast<cef_uri_unescape_rule_t>(
                                UU_REPLACE_PLUS_WITH_SPACE))
      .ToString();
}

// toast://settings — engine re-picker (grows as settings do).
std::string SettingsPage() {
  const std::string cur = toast::SearchEngineId();
  struct E { const char* id; const char* name; };
  const E engines[] = {{"duckduckgo", "DuckDuckGo"},
                       {"google", "Google"},
                       {"bing", "Bing"},
                       {"brave", "Brave Search"}};
  std::stringstream ss;
  ss << "<style>.engines{display:flex;flex-direction:column;gap:10px;"
        "max-width:320px}a.engine{display:flex;justify-content:space-between;"
        "padding:12px 16px;border-radius:12px;text-decoration:none;color:"
        "inherit;background:rgba(127,127,127,0.12);border:0.5px solid "
        "rgba(127,127,127,0.25)}a.engine.cur{border-color:#0066cc}</style>"
        "<h2 style=\"font-size:15px;margin-top:8px\">Default search engine</h2>"
        "<div class=\"engines\">";
  for (const auto& e : engines) {
    ss << "<a class=\"engine" << (e.id == cur ? " cur" : "")
       << "\" href=\"toast://pickengine?e=" << e.id << "\">" << e.name
       << (e.id == cur ? "<span>✓</span>" : "<span>→</span>") << "</a>";
  }
  const int glass = toast::GlassLevel();
  ss << "</div>"
        "<h2 style=\"font-size:15px;margin-top:28px\">Window style</h2>"
        "<div class=\"engines\">"
        "<a class=\"engine" << (glass == 0 ? " cur" : "")
     << "\" href=\"toast://pickglass?v=0\">Plain toast"
     << (glass == 0 ? "<span>✓</span>" : "<span>→</span>") << "</a>"
        "<a class=\"engine" << (glass > 0 ? " cur" : "")
     << "\" href=\"toast://pickglass?v="
     << (glass > 0 ? glass : 100) << "\">Glassy toast"
     << (glass > 0 ? "<span>✓</span>" : "<span>→</span>") << "</a>"
        "</div>"
        "<div style=\"max-width:320px;margin-top:6px;display:"
     << (glass > 0 ? "block" : "none") << "\" id=\"glassrow\">"
        "<label style=\"font-size:12px;opacity:.6;display:flex;"
        "justify-content:space-between\"><span>tinted</span>"
        "<span>liquid</span></label>"
        "<input type=\"range\" min=\"10\" max=\"100\" value=\"" << glass
     << "\" style=\"width:100%\" "
        "oninput=\"gout.value=this.value\" "
        "onchange=\"location='toast://pickglass?v='+this.value\">"
        "<output id=\"gout\" style=\"font-size:11px;opacity:.55\">" << glass
     << "</output></div>";
  return WrapPage("toast://settings", ss.str());
}

std::string StubPage(const std::string& host) {
  return WrapPage("toast://" + host,
                  "<p>Internal page <code>toast://" + host +
                      "</code> is not implemented yet.</p>");
}

CefRefPtr<CefResourceHandler> HtmlHandler(const std::string& html) {
  auto stream = CefStreamReader::CreateForData(
      static_cast<void*>(const_cast<char*>(html.data())), html.size());
  return new CefStreamResourceHandler("text/html", stream);
}

}  // namespace

ToastSchemeHandlerFactory::ToastSchemeHandlerFactory(
    std::string resources_dir)
    : resources_dir_(std::move(resources_dir)) {}

CefRefPtr<CefResourceHandler> ToastSchemeHandlerFactory::Create(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    const CefString& scheme_name,
    CefRefPtr<CefRequest> request) {
  CefURLParts parts;
  if (!CefParseURL(request->GetURL(), parts)) {
    return nullptr;
  }

  const std::string host = CefString(&parts.host).ToString();

  if (host == "newtab" || host == "switcher" || host == "setup" ||
      host == "dltoast") {
    CefRefPtr<CefStreamReader> stream = CefStreamReader::CreateForFile(
        resources_dir_ + "/" + host + ".html");
    if (stream) {
      return new CefStreamResourceHandler("text/html", stream);
    }
    return HtmlHandler(WrapPage("toast://" + host,
                                "<p>" + host +
                                    ".html missing from bundle.</p>"));
  }
  if (host == "wallpaper") {
    CefRefPtr<CefStreamReader> stream =
        CefStreamReader::CreateForFile(toast::WallpaperPath());
    if (stream) {
      return new CefStreamResourceHandler("image/png", stream);
    }
    return nullptr;
  }
  if (host == "config") {
    const std::string js = ConfigJs();
    auto stream = CefStreamReader::CreateForData(
        static_cast<void*>(const_cast<char*>(js.data())), js.size());
    return new CefStreamResourceHandler("text/javascript", stream);
  }
  if (host == "pickengine") {
    toast::SetSearchEngine(QueryParam(CefString(&parts.query), "e"));
    return HtmlHandler(RedirectPage("toast://newtab/"));
  }
  if (host == "pickglass") {
    const int level = std::atoi(
        QueryParam(CefString(&parts.query), "v").c_str());
    toast::SetGlassLevel(level);
    CefPostTask(TID_UI,
                base::BindOnce(&toast::SetGlassMode, toast::GlassLevel()));
    return HtmlHandler(RedirectPage("toast://settings"));
  }
  if (host == "settings") {
    return HtmlHandler(SettingsPage());
  }
  if (host == "version") {
    return HtmlHandler(VersionPage());
  }
  if (host == "downloads") {
    return HtmlHandler(DownloadsPage());
  }

  return HtmlHandler(StubPage(host));
}
