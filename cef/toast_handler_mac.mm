// toast — macOS helpers for the client handler.
// Adapted from cefsimple (BSD license, Chromium Embedded Framework Authors).

#include "tests/ceftoast/toast_handler.h"

#import <Cocoa/Cocoa.h>

#include "include/cef_browser.h"
#include "include/wrapper/cef_helpers.h"
#include "tests/ceftoast/toast_tabs.h"

namespace {

NSWindow* GetNSWindowForBrowser(CefRefPtr<CefBrowser> browser) {
  NSView* view =
      CAST_CEF_WINDOW_HANDLE_TO_NSVIEW(browser->GetHost()->GetWindowHandle());
  return [view window];
}

}  // namespace

void ToastHandler::PlatformInstallHooks() {
  // The switcher is sticky (Enter commits), so no ⌃-release monitor needed.
}

void ToastHandler::PlatformTitleChange(CefRefPtr<CefBrowser> browser,
                                       const CefString& title) {
  NSWindow* window = GetNSWindowForBrowser(browser);
  std::string titleStr(title);
  NSString* str = [NSString stringWithUTF8String:titleStr.c_str()];
  [window setTitle:str];
}

void ToastHandler::PlatformShowWindow(CefRefPtr<CefBrowser> browser) {
  NSWindow* window = GetNSWindowForBrowser(browser);
  [window makeKeyAndOrderFront:window];
}
