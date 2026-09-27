// toast — CEF browser process app.
// Adapted from cefsimple (BSD license, Chromium Embedded Framework Authors).

#include "tests/ceftoast/toast_app.h"

#include <string>

#include "include/cef_browser.h"
#include "include/cef_command_line.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"
#include "tests/ceftoast/toast_handler.h"
#include "tests/ceftoast/toast_scheme.h"
#include "tests/ceftoast/toast_settings.h"
#include "tests/ceftoast/toast_tabs.h"

namespace {

// CefWindow delegate hosting the Views-based browser.
class ToastWindowDelegate : public CefWindowDelegate {
 public:
  ToastWindowDelegate(CefRefPtr<CefBrowserView> browser_view,
                      cef_runtime_style_t runtime_style,
                      cef_show_state_t initial_show_state,
                      CefRefPtr<CefClient> client = nullptr)
      : browser_view_(browser_view),
        runtime_style_(runtime_style),
        initial_show_state_(initial_show_state),
        client_(client) {}

  ToastWindowDelegate(const ToastWindowDelegate&) = delete;
  ToastWindowDelegate& operator=(const ToastWindowDelegate&) = delete;

  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    if (initial_show_state_ != CEF_SHOW_STATE_HIDDEN) {
      window->Show();
    }

    // Register the tab and stack the (hidden) switcher overlay on top.
    toast::AddTabView(window, browser_view_, browser_view_->GetBrowser());
    if (client_) {
      toast::CreateOverlayIfNeeded(window, client_, runtime_style_);
    }
    // Persisted look — applied natively once the first browser exists.
    toast::SetGlassMode(toast::GlassLevel());
  }

  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override {
    toast::DetachWindow();
    browser_view_ = nullptr;
  }

  bool CanClose(CefRefPtr<CefWindow> window) override {
    CefRefPtr<CefBrowser> browser = browser_view_->GetBrowser();
    if (browser) {
      return browser->GetHost()->TryCloseBrowser();
    }
    return true;
  }

  CefSize GetPreferredSize(CefRefPtr<CefView> view) override {
    return CefSize(1100, 720);
  }

  // Window resizes propagate to all stacked tab views + the overlay.
  void OnLayoutChanged(CefRefPtr<CefView> view,
                       const CefRect& new_bounds) override {
    toast::ResizeTabViews(new_bounds.width, new_bounds.height);
  }

  cef_show_state_t GetInitialShowState(CefRefPtr<CefWindow> window) override {
    return initial_show_state_;
  }

  cef_runtime_style_t GetWindowRuntimeStyle() override {
    return runtime_style_;
  }

 private:
  CefRefPtr<CefBrowserView> browser_view_;
  const cef_runtime_style_t runtime_style_;
  const cef_show_state_t initial_show_state_;
  CefRefPtr<CefClient> client_;

  IMPLEMENT_REFCOUNTING(ToastWindowDelegate);
};

class ToastBrowserViewDelegate : public CefBrowserViewDelegate {
 public:
  explicit ToastBrowserViewDelegate(cef_runtime_style_t runtime_style)
      : runtime_style_(runtime_style) {}

  ToastBrowserViewDelegate(const ToastBrowserViewDelegate&) = delete;
  ToastBrowserViewDelegate& operator=(const ToastBrowserViewDelegate&) = delete;

  bool OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView> browser_view,
                                 CefRefPtr<CefBrowserView> popup_browser_view,
                                 bool is_devtools) override {
    CefWindow::CreateTopLevelWindow(new ToastWindowDelegate(
        popup_browser_view, runtime_style_, CEF_SHOW_STATE_NORMAL));
    return true;
  }

  cef_runtime_style_t GetBrowserRuntimeStyle() override {
    return runtime_style_;
  }

 private:
  const cef_runtime_style_t runtime_style_;

  IMPLEMENT_REFCOUNTING(ToastBrowserViewDelegate);
};

}  // namespace

ToastApp::ToastApp(std::string start_url, std::string resources_dir)
    : start_url_(std::move(start_url)),
      resources_dir_(std::move(resources_dir)) {}

void ToastApp::OnRegisterCustomSchemes(
    CefRawPtr<CefSchemeRegistrar> registrar) {
  registrar->AddCustomScheme("toast", CEF_SCHEME_OPTION_STANDARD |
                                         CEF_SCHEME_OPTION_SECURE |
                                         CEF_SCHEME_OPTION_CORS_ENABLED |
                                         CEF_SCHEME_OPTION_FETCH_ENABLED);
}

void ToastApp::OnBeforeCommandLineProcessing(
    const CefString& process_type,
    CefRefPtr<CefCommandLine> command_line) {
  if (process_type.empty()) {
    // Browser process: dev build is unsigned, so avoid the login-keychain
    // prompt Chromium raises for cookie encryption.
    command_line->AppendSwitch("use-mock-keychain");
  }
}

void ToastApp::OnContextInitialized() {
  CEF_REQUIRE_UI_THREAD();

  CefRefPtr<CefCommandLine> command_line =
      CefCommandLine::GetGlobalCommandLine();

  // toast is a bare-content window (no native strip/omnibox), so it always
  // uses the Alloy runtime. Chrome-style windows also refuse stacked
  // BrowserViews, which the tab model relies on.
  const cef_runtime_style_t runtime_style = CEF_RUNTIME_STYLE_ALLOY;
  const bool use_alloy_style = true;

  // toast://<page> serves internal pages from bundle resources.
  CefRegisterSchemeHandlerFactory(
      "toast", "", new ToastSchemeHandlerFactory(resources_dir_));

  CefRefPtr<ToastHandler> handler(new ToastHandler(use_alloy_style));

  CefBrowserSettings browser_settings;
  // Transparent backing so toast:// pages can show the window glass.
  browser_settings.background_color = CefColorSetARGB(0, 0, 0, 0);

  std::string url = command_line->GetSwitchValue("url");
  if (url.empty()) {
    // First run lands on the engine-picker setup screen; afterwards the
    // normal start page.
    url = toast::HasCompletedSetup()
              ? (start_url_.empty() ? "toast://newtab/" : start_url_)
              : "toast://setup/";
  }

  const bool use_views = !command_line->HasSwitch("use-native");

  if (use_views) {
    CefRefPtr<CefBrowserView> browser_view = CefBrowserView::CreateBrowserView(
        handler, url, browser_settings, nullptr, nullptr,
        new ToastBrowserViewDelegate(runtime_style));

    cef_show_state_t initial_show_state = CEF_SHOW_STATE_NORMAL;
    const std::string& show_state_value =
        command_line->GetSwitchValue("initial-show-state");
    if (show_state_value == "minimized") {
      initial_show_state = CEF_SHOW_STATE_MINIMIZED;
    } else if (show_state_value == "maximized") {
      initial_show_state = CEF_SHOW_STATE_MAXIMIZED;
    }
#if defined(OS_MAC)
    else if (show_state_value == "hidden") {
      initial_show_state = CEF_SHOW_STATE_HIDDEN;
    }
#endif

    CefWindow::CreateTopLevelWindow(new ToastWindowDelegate(
        browser_view, runtime_style, initial_show_state, handler));
  } else {
    CefWindowInfo window_info;
    window_info.runtime_style = runtime_style;
    CefBrowserHost::CreateBrowser(window_info, handler, url, browser_settings,
                                  nullptr, nullptr);
  }
}

CefRefPtr<CefClient> ToastApp::GetDefaultClient() {
  return ToastHandler::GetInstance();
}
