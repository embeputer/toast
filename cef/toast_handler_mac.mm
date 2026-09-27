// toast — macOS helpers for the client handler.
// Adapted from cefsimple (BSD license, Chromium Embedded Framework Authors).

#include "tests/ceftoast/toast_handler.h"

#import <Cocoa/Cocoa.h>

#include "include/base/cef_bind.h"
#include "include/base/cef_callback.h"
#include "include/cef_browser.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "tests/ceftoast/toast_tabs.h"

namespace {

// Modifier keyups never reach CefKeyboardHandler (they're NSEvent flags
// changes, not key events), so ⌃ release is detected natively here.
void InstallControlReleaseMonitor() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged
                                          handler:^NSEvent*(NSEvent* e) {
      if (!(e.modifierFlags & NSEventModifierFlagControl) &&
          toast::SwitcherOpen()) {
        CefPostTask(TID_UI,
                    base::BindOnce(&toast::HideSwitcher, true));
      }
      return e;
    }];
  });
}

NSWindow* GetNSWindowForBrowser(CefRefPtr<CefBrowser> browser) {
  NSView* view =
      CAST_CEF_WINDOW_HANDLE_TO_NSVIEW(browser->GetHost()->GetWindowHandle());
  return [view window];
}

}  // namespace

void ToastHandler::PlatformInstallHooks() {
  InstallControlReleaseMonitor();
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
