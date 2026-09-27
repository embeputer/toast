// toast — tab model + ⌃Tab switcher overlay for the Views window.

#include "tests/ceftoast/toast_tabs.h"

#include <sstream>

#include "include/cef_app.h"
#include "include/wrapper/cef_helpers.h"

namespace toast {
namespace {

CefRefPtr<CefWindow> g_window;
std::vector<Tab> g_tabs;
int g_active = -1;
int g_prev_active = -1;

CefRefPtr<CefBrowserView> g_switcher_view;
CefRefPtr<CefOverlayController> g_overlay;
CefRefPtr<CefClient> g_ui_client;
bool g_switcher_open = false;
int g_switcher_sel = -1;

const char kSwitcherURL[] = "toast://switcher/";

// Client for the overlay browser: lifespan only, it never hosts real tabs.
class UIClient : public CefClient {
 public:
  IMPLEMENT_REFCOUNTING(UIClient);
};

// Chrome-style windows host at most one BrowserView, so tabs and overlays
// use Alloy views (bare content, no native strip).
class AlloyViewDelegate : public CefBrowserViewDelegate {
 public:
  cef_runtime_style_t GetBrowserRuntimeStyle() override {
    return CEF_RUNTIME_STYLE_ALLOY;
  }

  IMPLEMENT_REFCOUNTING(AlloyViewDelegate);
};

std::string EscapeJS(const std::string& s) {
  std::string out;
  out.reserve(s.size());
  for (char c : s) {
    if (c == '\\' || c == '"') {
      out.push_back('\\');
    } else if (c == '\n') {
      out += "\\n";
    }
    out.push_back(c);
  }
  return out;
}

void PushSwitcherState() {
  if (!g_switcher_view || !g_switcher_open) {
    return;
  }
  CefRefPtr<CefBrowser> b = g_switcher_view->GetBrowser();
  if (!b) {
    return;
  }
  std::stringstream ss;
  ss << "window.__setTabs&&window.__setTabs([";
  for (size_t i = 0; i < g_tabs.size(); ++i) {
    ss << (i ? "," : "") << "{\"title\":\"" << EscapeJS(g_tabs[i].title)
       << "\"}";
  }
  ss << "]," << g_switcher_sel << ");";
  b->GetMainFrame()->ExecuteJavaScript(ss.str(), kSwitcherURL, 0);
}

void ShowActiveOnly() {
  for (size_t i = 0; i < g_tabs.size(); ++i) {
    g_tabs[i].view->SetVisible((int)i == g_active);
  }
}

void LayoutSwitcher() {
  if (!g_overlay || !g_window) {
    return;
  }
  CefRect wb_client = g_window->GetBounds();
  const int w = wb_client.width, h = wb_client.height;
  const int sw = w > 640 ? 560 : w - 80;
  const int sh = 120;
  g_overlay->SetBounds(CefRect((w - sw) / 2, (int)(h * 0.38), sw, sh));
}

}  // namespace

void AttachWindow(CefRefPtr<CefWindow> window) {
  g_window = window;
}

void DetachWindow() {
  g_window = nullptr;
  g_tabs.clear();
  g_active = g_prev_active = -1;
  g_switcher_view = nullptr;
  g_overlay = nullptr;
  g_ui_client = nullptr;
  g_switcher_open = false;
}

void AddTabView(CefRefPtr<CefWindow> window, CefRefPtr<CefBrowserView> view,
                CefRefPtr<CefBrowser> browser) {
  Tab t{view, browser, "New Tab"};
  g_tabs.push_back(t);
  g_active = (int)g_tabs.size() - 1;

  window->AddChildView(view);
  CefSize s = window->GetSize();
  view->SetBounds(CefRect(0, 0, s.width, s.height));

  ShowActiveOnly();
  if (browser) {
    browser->GetHost()->SetFocus(true);
  }
}

void ResizeTabViews(int width, int height) {
  for (auto& t : g_tabs) {
    t.view->SetBounds(CefRect(0, 0, width, height));
  }
  LayoutSwitcher();
}

void EnsureSwitcher(CefRefPtr<CefClient> client,
                    cef_runtime_style_t runtime_style) {
  if (g_overlay || !g_window) {
    return;
  }
  if (!g_ui_client) {
    g_ui_client = new UIClient;
  }
  CefBrowserSettings settings;
  settings.background_color = CefColorSetARGB(0, 0, 0, 0);
  g_switcher_view = CefBrowserView::CreateBrowserView(
      g_ui_client, kSwitcherURL, settings, nullptr, nullptr,
      new AlloyViewDelegate);
  g_overlay = g_window->AddOverlayView(g_switcher_view,
                                     CEF_DOCKING_MODE_CUSTOM,
                                     /*can_activate=*/false);
  LayoutSwitcher();
}

void NewTab(const CefString& url, CefRefPtr<CefClient> client,
            cef_runtime_style_t runtime_style) {
  if (!g_window) {
    return;
  }
  CefBrowserSettings settings;
  CefRefPtr<CefBrowserView> view = CefBrowserView::CreateBrowserView(
      client, url, settings, nullptr, nullptr, new AlloyViewDelegate);
  AddTabView(g_window, view, view->GetBrowser());
}

void CloseActiveTab() {
  if (g_active < 0 || (int)g_tabs.size() <= g_active) {
    return;
  }
  CefRefPtr<CefBrowser> b = g_tabs[g_active].browser;
  if (b) {
    b->GetHost()->CloseBrowser(true);
  }
}

void ActivateTab(int index) {
  if (index < 0 || index >= (int)g_tabs.size() || !g_window) {
    return;
  }
  g_active = index;
  ShowActiveOnly();
  if (g_tabs[g_active].browser) {
    g_tabs[g_active].browser->GetHost()->SetFocus(true);
  }
  g_window->SetTitle(CefString(g_tabs[g_active].title));
}

void CycleTab(int delta) {
  if (g_tabs.empty()) {
    return;
  }
  int n = (int)g_tabs.size();
  ActivateTab((g_active + delta + n) % n);
}

void RegisterBrowser(CefRefPtr<CefBrowser> browser,
                     CefRefPtr<CefBrowserView> view) {
  // Called once the browser exists (OnAfterCreated) — fill in the view entry.
  for (auto& t : g_tabs) {
    if (t.view && t.view->GetBrowser() &&
        t.view->GetBrowser()->IsSame(browser)) {
      t.browser = browser;
      return;
    }
  }
  // Overlay or popup browser — not a tab.
  (void)view;
}

void NoteTitle(CefRefPtr<CefBrowser> browser, const std::string& title) {
  for (size_t i = 0; i < g_tabs.size(); ++i) {
    if (g_tabs[i].browser && g_tabs[i].browser->IsSame(browser)) {
      g_tabs[i].title = title;
      if ((int)i == g_active && g_window) {
        g_window->SetTitle(CefString(title));
      }
      PushSwitcherState();
      return;
    }
  }
}

CefRefPtr<CefBrowser> ActiveBrowser() {
  if (g_active < 0 || g_active >= (int)g_tabs.size()) {
    return nullptr;
  }
  return g_tabs[g_active].browser;
}

void ShowSwitcher() {
  if (!g_overlay || g_tabs.size() < 1) {
    return;
  }
  if (!g_switcher_open) {
    g_switcher_open = true;
    g_prev_active = g_active;
    g_switcher_sel = g_active;
  }
  LayoutSwitcher();
  g_overlay->SetVisible(true);
  PushSwitcherState();
}

void HideSwitcher(bool commit) {
  if (!g_switcher_open) {
    return;
  }
  if (commit) {
    ActivateTab(g_switcher_sel);
  } else {
    g_active = g_prev_active;
    ShowActiveOnly();
  }
  g_switcher_open = false;
  g_overlay->SetVisible(false);
}

void SwitcherStep(int delta) {
  if (!g_switcher_open || g_tabs.empty()) {
    return;
  }
  int n = (int)g_tabs.size();
  g_switcher_sel = (g_switcher_sel + delta + n) % n;
  PushSwitcherState();
}

bool SwitcherOpen() {
  return g_switcher_open;
}

void RemoveBrowser(CefRefPtr<CefBrowser> browser) {
  for (size_t i = 0; i < g_tabs.size(); ++i) {
    if (g_tabs[i].browser && g_tabs[i].browser->IsSame(browser)) {
      if (g_tabs[i].view && g_window) {
        g_window->RemoveChildView(g_tabs[i].view);
      }
      g_tabs.erase(g_tabs.begin() + i);
      if (g_active >= (int)g_tabs.size()) {
        g_active = (int)g_tabs.size() - 1;
      }
      if (g_active >= 0) {
        ActivateTab(g_active);
      }
      return;
    }
  }
}

CefRefPtr<CefWindow> MainWindow() {
  return g_window;
}

// Called from the window delegate's OnWindowCreated.
void CreateOverlayIfNeeded(CefRefPtr<CefWindow> window,
                           CefRefPtr<CefClient> client,
                           cef_runtime_style_t runtime_style) {
  AttachWindow(window);
  EnsureSwitcher(client, runtime_style);
}

}  // namespace toast
