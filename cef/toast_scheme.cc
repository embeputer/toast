// toast — toast:// internal page scheme.

#include "tests/ceftoast/toast_scheme.h"

#include <sstream>
#include <string>

#include "include/cef_parser.h"
#include "include/cef_request.h"
#include "include/cef_version.h"
#include "include/wrapper/cef_stream_resource_handler.h"

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
  // Real download tracking lands with the CefDownloadHandler wiring; for now
  // this is the internal-page shell, same as the Electron version grew from.
  return WrapPage("toast://downloads",
                  "<p>Downloads will be listed here.</p>");
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

  if (host == "newtab") {
    CefRefPtr<CefStreamReader> stream = CefStreamReader::CreateForFile(
        resources_dir_ + "/newtab.html");
    if (stream) {
      return new CefStreamResourceHandler("text/html", stream);
    }
    return HtmlHandler(WrapPage("toast://newtab",
                                "<p>newtab.html missing from bundle.</p>"));
  }
  if (host == "version") {
    return HtmlHandler(VersionPage());
  }
  if (host == "downloads") {
    return HtmlHandler(DownloadsPage());
  }

  return HtmlHandler(StubPage(host));
}
