// toast — tab model + ⌃Tab switcher overlay for the Views window.

#include "tests/ceftoast/toast_tabs.h"

#include <sstream>

#include "include/base/cef_bind.h"
#include "include/base/cef_callback.h"
#include "include/cef_app.h"
#include "include/cef_task.h"
#include "include/views/cef_panel.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"

namespace toast {
namespace {

CefRefPtr<CefWindow> g_window;
std::vector<Tab> g_tabs;
// The window's content view — the BrowserView CreateTopLevelWindow was built
// with. Detaching or closing it tears down the whole window, so its tab is
// hidden rather than closed.
CefRefPtr<CefBrowserView> g_primary_view;
int g_active = -1;
int g_prev_active = -1;

// Switcher + toast are plain child views (NOT CefWindow overlays — overlay
// BrowserViews keep eating mouse clicks even when hidden). They stay at the
// top of the z-order via KeepChromeOnTop().
CefRefPtr<CefBrowserView> g_switcher_view;
CefRefPtr<CefBrowserView> g_toast_view;
CefRefPtr<CefView> g_progress_view;
CefRefPtr<CefClient> g_ui_client;
bool g_switcher_open = false;
int g_switcher_sel = -1;
uint64_t g_toast_gen = 0;
int g_glass_level = 0;  // 0 = plain, 1-100 = tinted -> liquid

// Page inset while glass mode is on — leaves a glass border around content.
const int kGlassMargin = 12;

const char kSwitcherURL[] = "toast://switcher/";
const char kToastURL[] = "toast://dltoast/";

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

CefRect TabBounds(int w, int h) {
  if (g_glass_level > 0) {
    const int m = kGlassMargin;
    return CefRect(m, m, w - 2 * m, h - 2 * m);
  }
  return CefRect(0, 0, w, h);
}

void LayoutTabs(int w, int h) {
  for (auto& t : g_tabs) {
    t.view->SetBounds(TabBounds(w, h));
  }
}

// Glass needs a live browser to find the NSWindow; before the first one
// exists the flag alone is stored and applied on RegisterBrowser.
void ApplyGlassNow() {
  for (auto& t : g_tabs) {
    if (t.browser) {
      PlatformSetGlass(t.browser, g_glass_level);
      return;
    }
  }
}

// Toggles the transparent-body class on internal pages live.
void PushGlassToPages() {
  const char* js = g_glass_level > 0
      ? "document.body&&document.body.classList.add('glass')"
      : "document.body&&document.body.classList.remove('glass')";
  for (auto& t : g_tabs) {
    if (t.browser && t.browser->GetMainFrame() &&
        t.browser->GetMainFrame()->GetURL().ToString().rfind("toast://", 0) ==
            0) {
      t.browser->GetMainFrame()->ExecuteJavaScript(js, "toast://glass", 0);
    }
  }
}

void LayoutSwitcher() {
  if (!g_switcher_view || !g_window || !g_switcher_view->IsVisible()) {
    return;
  }
  CefRect wb_client = g_window->GetBounds();
  const int w = wb_client.width, h = wb_client.height;
  const int sw = w > 640 ? 560 : w - 80;
  const int sh = 120;
  g_switcher_view->SetBounds(
      CefRect((w - sw) / 2, (int)(h * 0.38), sw, sh));
}

void LayoutToast() {
  if (!g_toast_view || !g_window || !g_toast_view->IsVisible()) {
    return;
  }
  CefRect wb = g_window->GetBounds();
  const int tw = 460, th = 60;
  g_toast_view->SetBounds(
      CefRect((wb.width - tw) / 2, wb.height - th - 60, tw, th));
}

void HideToastNow(uint64_t gen) {
  if (gen != g_toast_gen || !g_toast_view) {
    return;  // superseded by a newer toast
  }
  CefRefPtr<CefBrowser> b = g_toast_view->GetBrowser();
  if (b) {
    b->GetMainFrame()->ExecuteJavaScript("window.__toastHide&&__toastHide()",
                                         kToastURL, 0);
  }
  g_toast_view->SetVisible(false);
}

// Chrome UI views must float above tab content; tabs added later sit on
// top unless we re-order the chrome children back to the end of the list.
void KeepChromeOnTop() {
  if (!g_window) {
    return;
  }
  const int top = (int)g_window->GetChildViewCount() - 1;
  if (g_progress_view) {
    g_window->ReorderChildView(g_progress_view, top);
  }
  if (g_switcher_view) {
    g_window->ReorderChildView(g_switcher_view, top);
  }
  if (g_toast_view) {
    g_window->ReorderChildView(g_toast_view, top);
  }
}

}  // namespace

void AttachWindow(CefRefPtr<CefWindow> window) {
  g_window = window;
}

void DetachWindow() {
  g_window = nullptr;
  g_tabs.clear();
  g_primary_view = nullptr;
  g_active = g_prev_active = -1;
  g_switcher_view = nullptr;
  g_toast_view = nullptr;
  g_progress_view = nullptr;
  g_ui_client = nullptr;
  g_switcher_open = false;
}

void AddTabView(CefRefPtr<CefWindow> window, CefRefPtr<CefBrowserView> view,
                CefRefPtr<CefBrowser> browser) {
  if (!g_primary_view) {
    g_primary_view = view;
  }
  Tab t{view, browser, "New Tab"};
  g_tabs.push_back(t);
  g_active = (int)g_tabs.size() - 1;

  view->SetBackgroundColor(CefColorSetARGB(0, 0, 0, 0));
  window->AddChildView(view);
  CefSize s = window->GetSize();
  view->SetBounds(TabBounds(s.width, s.height));
  KeepChromeOnTop();

  ShowActiveOnly();
  if (browser) {
    browser->GetHost()->SetFocus(true);
  }
}

void ResizeTabViews(int width, int height) {
  LayoutTabs(width, height);
  LayoutSwitcher();
  LayoutToast();
}

void EnsureProgress() {
  if (g_progress_view || !g_window) {
    return;
  }
  g_progress_view = CefPanel::CreatePanel(nullptr);
  // System blue, 3px tall strip pinned to the top edge.
  g_progress_view->SetBackgroundColor(CefColorSetARGB(255, 10, 132, 255));
  g_window->AddChildView(g_progress_view);
  g_progress_view->SetVisible(false);
  KeepChromeOnTop();
}

void LoadingProgress(CefRefPtr<CefBrowser> browser, float progress) {
  CEF_REQUIRE_UI_THREAD();
  if (!g_window || !browser ||
      (g_active >= 0 && g_active < (int)g_tabs.size() &&
       g_tabs[g_active].browser &&
       !g_tabs[g_active].browser->IsSame(browser))) {
    return;  // background tab loading — bar tracks the visible tab only
  }
  EnsureProgress();
  if (!g_progress_view) {
    return;
  }
  if (progress >= 1.0f || progress <= 0.0f) {
    g_progress_view->SetVisible(false);
    return;
  }
  KeepChromeOnTop();
  const int w = g_window->GetBounds().width;
  g_progress_view->SetBounds(
      CefRect(0, 0, (int)(w * progress), 3));
  g_progress_view->SetVisible(true);
}

void EnsureSwitcher(CefRefPtr<CefClient> client,
                    cef_runtime_style_t runtime_style) {
  if (g_switcher_view || !g_window) {
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
  g_window->AddChildView(g_switcher_view);
  g_switcher_view->SetVisible(false);

  // HUD toast: bottom-center, transparent, hidden until a download event.
  CefBrowserSettings toast_settings;
  toast_settings.background_color = CefColorSetARGB(0, 0, 0, 0);
  g_toast_view = CefBrowserView::CreateBrowserView(
      g_ui_client, kToastURL, toast_settings, nullptr, nullptr,
      new AlloyViewDelegate);
  g_window->AddChildView(g_toast_view);
  g_toast_view->SetVisible(false);

  EnsureProgress();
}

void NewTab(const CefString& url, CefRefPtr<CefClient> client,
            cef_runtime_style_t runtime_style) {
  if (!g_window) {
    return;
  }
  CefBrowserSettings settings;
  // Transparent backing so toast:// pages can show the window glass.
  settings.background_color = CefColorSetARGB(0, 0, 0, 0);
  CefRefPtr<CefBrowserView> view = CefBrowserView::CreateBrowserView(
      client, url, settings, nullptr, nullptr, new AlloyViewDelegate);
  AddTabView(g_window, view, view->GetBrowser());
}

void CloseActiveTab() {
  if (g_active < 0 || (int)g_tabs.size() <= g_active) {
    return;
  }
  CefRefPtr<CefBrowser> b = g_tabs[g_active].browser;
  if (!b) {
    return;
  }
  if (g_tabs.size() == 1) {
    // Last tab — don't close the window, reset it to the new-tab page.
    b->GetMainFrame()->LoadURL("toast://newtab/");
    g_tabs[g_active].title = "New Tab";
    if (g_window) {
      g_window->SetTitle("New Tab");
    }
    return;
  }
  // CloseBrowser() on a BrowserView-hosted browser cascades to
  // CefWindow::Close() and destroys every browser in the window. Instead
  // detach the view — CefBrowserView teardown closes its own browser and
  // fires OnBeforeClose, which runs RemoveBrowser bookkeeping.
  int next = g_active + 1;
  if (next >= (int)g_tabs.size()) {
    next = g_active - 1;
  }
  int closing = g_active;
  ActivateTab(next);

  if (g_tabs[closing].view == g_primary_view) {
    // The window's primary browser view anchors the window — keep the
    // browser alive but hidden, and drop only the tab entry.
    g_tabs[closing].view->SetVisible(false);
    g_tabs.erase(g_tabs.begin() + closing);
    g_active = next > closing ? next - 1 : next;
    return;
  }
  if (g_tabs[closing].view && g_window) {
    g_window->RemoveChildView(g_tabs[closing].view);
  }
  g_tabs[closing].view = nullptr;  // Detached; CEF destroys it async.
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
      if (g_glass_level > 0) {
        PlatformSetGlass(browser, g_glass_level);
      }
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
  if (!g_switcher_view || g_tabs.size() < 1) {
    return;
  }
  if (!g_switcher_open) {
    g_switcher_open = true;
    g_prev_active = g_active;
    g_switcher_sel = g_active;
  }
  KeepChromeOnTop();
  g_switcher_view->SetVisible(true);
  LayoutSwitcher();
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
  g_switcher_view->SetVisible(false);
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

void SetGlassMode(int level) {
  CEF_REQUIRE_UI_THREAD();
  if (level < 0) {
    level = 0;
  } else if (level > 100) {
    level = 100;
  }
  const bool was_off = g_glass_level == 0;
  g_glass_level = level;
  if (!g_window) {
    return;
  }
  CefSize s = g_window->GetSize();
  LayoutTabs(s.width, s.height);
  ApplyGlassNow();
  PushGlassToPages();
  if (was_off != (level == 0)) {
    LayoutSwitcher();
    LayoutToast();
  }
}

bool IsGlassMode() {
  return g_glass_level > 0;
}

void ShowToast(const std::string& msg, const std::string& kind) {
  if (!CefCurrentlyOn(TID_UI)) {
    CefPostTask(TID_UI,
                base::BindOnce(&toast::ShowToast, msg, kind));
    return;
  }
  if (!g_toast_view) {
    return;
  }
  KeepChromeOnTop();
  g_toast_view->SetVisible(true);
  LayoutToast();
  CefRefPtr<CefBrowser> b =
      g_toast_view ? g_toast_view->GetBrowser() : nullptr;
  if (b) {
    std::stringstream js;
    js << "window.__toastMsg&&__toastMsg(\"" << EscapeJS(msg) << "\",\""
       << EscapeJS(kind) << "\")";
    b->GetMainFrame()->ExecuteJavaScript(js.str(), kToastURL, 0);
  }
  const uint64_t gen = ++g_toast_gen;
  CefPostDelayedTask(TID_UI, base::BindOnce(&HideToastNow, gen), 3500);
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
      // ActivateTab (SetVisible + SetFocus on the sibling BrowserView) must
      // not run reentrantly inside OnBeforeClose — it tears down the other
      // tab's browser. Defer to the next UI tick.
      if (g_active >= 0) {
        CefPostTask(TID_UI,
                    base::BindOnce(&ActivateTab, g_active));
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
