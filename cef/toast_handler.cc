// toast — CEF client handler.
// Adapted from cefsimple (BSD license, Chromium Embedded Framework Authors).

#include "tests/ceftoast/toast_handler.h"

#include <sstream>
#include <cstdio>
#include <string>

#include "include/base/cef_callback.h"
#include "include/cef_app.h"
#include "include/cef_parser.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "tests/ceftoast/toast_downloads.h"
#include "tests/ceftoast/toast_tabs.h"

namespace {

ToastHandler* g_instance = nullptr;

std::string DownloadsDir() {
  const char* home = getenv("HOME");
  return home ? std::string(home) + "/Downloads" : ".";
}

std::string GetDataURI(const std::string& data, const std::string& mime_type) {
  return "data:" + mime_type + ";base64," +
         CefURIEncode(CefBase64Encode(data.data(), data.size()), false)
             .ToString();
}

}  // namespace

ToastHandler::ToastHandler(bool is_alloy_style)
    : is_alloy_style_(is_alloy_style) {
  PlatformInstallHooks();
  DCHECK(!g_instance);
  g_instance = this;
}

ToastHandler::~ToastHandler() {
  g_instance = nullptr;
}

// static
ToastHandler* ToastHandler::GetInstance() {
  return g_instance;
}

void ToastHandler::OnTitleChange(CefRefPtr<CefBrowser> browser,
                                 const CefString& title) {
  CEF_REQUIRE_UI_THREAD();

  toast::NoteTitle(browser, title.ToString());

  if (auto browser_view = CefBrowserView::GetForBrowser(browser)) {
    CefRefPtr<CefWindow> window = browser_view->GetWindow();
    if (window) {
      window->SetTitle(title);
    }
  } else if (is_alloy_style_) {
    PlatformTitleChange(browser, title);
  }
}

void ToastHandler::OnLoadingProgressChange(CefRefPtr<CefBrowser> browser,
                                           double progress) {
  CEF_REQUIRE_UI_THREAD();
  toast::LoadingProgress(browser, (float)progress);
}

bool ToastHandler::OnBeforeDownload(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefDownloadItem> download_item,
    const CefString& suggested_name,
    CefRefPtr<CefBeforeDownloadCallback> callback) {
  CEF_REQUIRE_UI_THREAD();

  // No picker dialog — files land in ~/Downloads, name dedup left to CEF.
  callback->Continue(DownloadsDir() + "/" + suggested_name.ToString(),
                     /*show_dialog=*/false);
  return true;
}

void ToastHandler::OnDownloadUpdated(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefDownloadItem> download_item,
    CefRefPtr<CefDownloadItemCallback> callback) {
  CEF_REQUIRE_UI_THREAD();
  toast::TrackDownload(download_item);
}

bool ToastHandler::OnPreKeyEvent(CefRefPtr<CefBrowser> browser,
                                 const CefKeyEvent& event,
                                 CefEventHandle os_event,
                                 bool* is_keyboard_shortcut) {
  CEF_REQUIRE_UI_THREAD();

  const bool ctrl = (event.modifiers & EVENTFLAG_CONTROL_DOWN) != 0;
  const bool cmd = (event.modifiers & EVENTFLAG_COMMAND_DOWN) != 0;
  const bool shift = (event.modifiers & EVENTFLAG_SHIFT_DOWN) != 0;
  const int kTab = 0x09, kEsc = 0x1B, kEnter = 0x0D;
  const int kLeft = 0x25, kRight = 0x27;

  // ⌃Tab opens the switcher (sticky) / steps the selection.
  if (event.type == KEYEVENT_RAWKEYDOWN && ctrl &&
      event.windows_key_code == kTab) {
    if (toast::SwitcherOpen()) {
      toast::SwitcherStep(shift ? -1 : 1);
    } else {
      toast::ShowSwitcher();
    }
    *is_keyboard_shortcut = true;
    return true;
  }

  // While the switcher is open it owns navigation keys.
  if (toast::SwitcherOpen()) {
    if (event.type == KEYEVENT_RAWKEYDOWN &&
        (event.windows_key_code == kLeft ||
         event.windows_key_code == kRight)) {
      toast::SwitcherStep(event.windows_key_code == kRight ? 1 : -1);
      *is_keyboard_shortcut = true;
      return true;
    }
    if (event.type == KEYEVENT_RAWKEYDOWN &&
        event.windows_key_code == kEsc) {
      toast::HideSwitcher(false);
      *is_keyboard_shortcut = true;
      return true;
    }
    // Enter commits the selection and closes.
    if (event.type == KEYEVENT_RAWKEYDOWN &&
        event.windows_key_code == kEnter) {
      toast::HideSwitcher(true);
      *is_keyboard_shortcut = true;
      return true;
    }
  }

  // ⌘T new tab, ⌘W close tab, ⌘1-9 jump.
  if (event.type == KEYEVENT_RAWKEYDOWN && cmd) {
    const int kc = event.windows_key_code;
    if (kc == 'T') {
      toast::NewTab("toast://newtab/", this,
                    is_alloy_style_ ? CEF_RUNTIME_STYLE_ALLOY
                                    : CEF_RUNTIME_STYLE_CHROME);
      *is_keyboard_shortcut = true;
      return true;
    }
    if (kc == 'W') {
      toast::CloseActiveTab();
      *is_keyboard_shortcut = true;
      return true;
    }
    if (kc >= '1' && kc <= '9') {
      toast::ActivateTab(kc - '1');
      *is_keyboard_shortcut = true;
      return true;
    }
  }

  return false;
}

void ToastHandler::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();

  CHECK_EQ(is_alloy_style_ ? CEF_RUNTIME_STYLE_ALLOY : CEF_RUNTIME_STYLE_CHROME,
           browser->GetHost()->GetRuntimeStyle());

  browser_list_.push_back(browser);

  toast::RegisterBrowser(browser, CefBrowserView::GetForBrowser(browser));
}

bool ToastHandler::DoClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();

  if (browser_list_.size() == 1) {
    is_closing_ = true;
  }
  return false;
}

void ToastHandler::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();

  BrowserList::iterator bit = browser_list_.begin();
  for (; bit != browser_list_.end(); ++bit) {
    if ((*bit)->IsSame(browser)) {
      browser_list_.erase(bit);
      break;
    }
  }

  toast::RemoveBrowser(browser);

  if (browser_list_.empty()) {
    CefQuitMessageLoop();
  }
}

void ToastHandler::OnLoadError(CefRefPtr<CefBrowser> browser,
                               CefRefPtr<CefFrame> frame,
                               ErrorCode errorCode,
                               const CefString& errorText,
                               const CefString& failedUrl) {
  CEF_REQUIRE_UI_THREAD();

  if (!is_alloy_style_) {
    return;  // Chrome style shows its own error page.
  }

  if (errorCode == ERR_ABORTED) {
    return;
  }

  std::stringstream ss;
  ss << "<html><body bgcolor=\"white\">"
        "<h2>Failed to load URL "
     << std::string(failedUrl) << " with error " << std::string(errorText)
     << " (" << errorCode << ").</h2></body></html>";

  frame->LoadURL(GetDataURI(ss.str(), "text/html"));
}

void ToastHandler::ShowMainWindow() {
  if (!CefCurrentlyOn(TID_UI)) {
    CefPostTask(TID_UI, base::BindOnce(&ToastHandler::ShowMainWindow, this));
    return;
  }

  if (browser_list_.empty()) {
    return;
  }

  auto main_browser = browser_list_.front();

  if (auto browser_view = CefBrowserView::GetForBrowser(main_browser)) {
    if (auto window = browser_view->GetWindow()) {
      window->Show();
    }
  } else if (is_alloy_style_) {
    PlatformShowWindow(main_browser);
  }
}

void ToastHandler::CloseAllBrowsers(bool force_close) {
  if (!CefCurrentlyOn(TID_UI)) {
    CefPostTask(TID_UI, base::BindOnce(&ToastHandler::CloseAllBrowsers, this,
                                       force_close));
    return;
  }

  if (browser_list_.empty()) {
    return;
  }

  for (const auto& browser : browser_list_) {
    browser->GetHost()->CloseBrowser(force_close);
  }
}
