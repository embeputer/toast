// toast — macOS helpers for the client handler.
// Adapted from cefsimple (BSD license, Chromium Embedded Framework Authors).

#include "tests/ceftoast/toast_handler.h"

#import <Cocoa/Cocoa.h>

#include "include/base/cef_callback.h"
#include "include/cef_browser.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/wrapper/cef_helpers.h"
#include "tests/ceftoast/toast_tabs.h"

namespace {

NSWindow* GetNSWindowForBrowser(CefRefPtr<CefBrowser> browser) {
  NSView* view =
      CAST_CEF_WINDOW_HANDLE_TO_NSVIEW(browser->GetHost()->GetWindowHandle());
  return [view window];
}

NSView* g_glass_view = nil;
NSView* g_glass_tint = nil;  // white wash layered over the blur = "tint"
const char* g_glass_backend = "pending";  // diagnostic for toast://settings

}  // namespace

namespace toast {

// Simulated "liquid glass" window: a real behind-window vibrancy blur
// (NSVisualEffectView) pinned behind everything, with a white tint wash
// layered on top. The window is non-opaque with rounded corners so the
// glass border shows around the inset page content. level 1-100 maps
// tinted -> liquid: low adds a heavier wash, 100 leaves the blur clear.
void PlatformSetGlass(CefRefPtr<CefBrowser> any_browser,
                      int level,
                      int retries_left) {
  if (!any_browser) {
    return;
  }
  NSWindow* win = GetNSWindowForBrowser(any_browser);
  if (!win) {
    // The browser view may not be inside a window yet — retry shortly.
    if (retries_left > 0) {
      CefPostDelayedTask(
          TID_UI,
          base::BindOnce(&PlatformSetGlass, any_browser, level,
                         retries_left - 1),
          100);
    }
    return;
  }
  NSView* content = win.contentView;
  if (level > 0) {
    if (!g_glass_view) {
      NSVisualEffectView* vev =
          [[NSVisualEffectView alloc] initWithFrame:content.bounds];
      vev.material = NSVisualEffectMaterialUnderWindowBackground;
      vev.blendingMode = NSVisualEffectBlendingModeBehindWindow;
      vev.state = NSVisualEffectStateActive;
      vev.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      // Tint wash on top of the blur — this is what sells "tinted
      // glass" vs "liquid glass" as the level slides.
      NSView* tint = [[NSView alloc] initWithFrame:vev.bounds];
      tint.wantsLayer = YES;
      tint.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [vev addSubview:tint];
      g_glass_view = vev;
      g_glass_tint = tint;
      g_glass_backend = "NSVisualEffectView (tinted glass)";
      NSLog(@"toast: glass backing = %s", g_glass_backend);
    }
    if (g_glass_view.superview != content) {
      g_glass_view.frame = content.bounds;
      [content addSubview:g_glass_view
               positioned:NSWindowBelow
               relativeTo:nil];
    }
    g_glass_view.hidden = NO;
    // Transparent window so the glass border shows through.
    win.opaque = NO;
    win.backgroundColor = [NSColor clearColor];
    content.wantsLayer = YES;
    content.layer.cornerRadius = 18.0;
    content.layer.masksToBounds = YES;
    // level 1 -> heavy frosted wash; 100 -> nearly clear blur.
    const CGFloat wash =
        0.05 + (100.0 - level) / 100.0 * 0.45;  // 0.05 .. 0.50
    g_glass_tint.layer.backgroundColor =
        [[NSColor colorWithWhite:1.0 alpha:wash] CGColor];
    // Re-apply shortly — on some macOS versions the first pass lands
    // before the window server honors the transparent flags, leaving a
    // one-shot opaque window. Idempotent, so a second pass is cheap.
    if (retries_left > 38) {
      CefPostDelayedTask(TID_UI,
          base::BindOnce(&PlatformSetGlass, any_browser, level, 0),
          1200);
    }
  } else {
    // Plain toast: opaque window with a solid border edge around the
    // inset page, same rounded shape as glass mode.
    if (g_glass_view) {
      g_glass_view.hidden = YES;
    }
    win.opaque = YES;
    win.backgroundColor = [NSColor windowBackgroundColor];
    content.wantsLayer = YES;
    content.layer.cornerRadius = 18.0;
    content.layer.masksToBounds = YES;
  }
}

void PlatformHideTitlebar(CefRefPtr<CefWindow> window, int retries_left) {
  if (!window) {
    return;
  }
  NSView* view = CAST_CEF_WINDOW_HANDLE_TO_NSVIEW(window->GetWindowHandle());
  NSWindow* win = [view window];
  if (!win) {
    if (retries_left > 0) {
      CefPostDelayedTask(TID_UI,
                         base::BindOnce(&PlatformHideTitlebar, window,
                                        retries_left - 1),
                         100);
    }
    return;
  }
  // No visible title bar: transparent chrome + content underlapping the
  // frame, so the page (and the plain/glass border) fills the window.
  win.titleVisibility = NSWindowTitleHidden;
  win.titlebarAppearsTransparent = YES;
  win.styleMask |= NSWindowStyleMaskFullSizeContentView;
  win.movableByWindowBackground = YES;
}

const char* PlatformGlassBackend() {
  return g_glass_backend;
}

void PlatformRoundView(CefRefPtr<CefBrowser> browser, double radius) {
  if (!browser) {
    return;
  }
  NSView* view =
      CAST_CEF_WINDOW_HANDLE_TO_NSVIEW(browser->GetHost()->GetWindowHandle());
  view.wantsLayer = YES;
  view.layer.cornerRadius = radius;
  view.layer.masksToBounds = YES;
}

}  // namespace toast

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
  // No visible title bar: transparent chrome + content underlapping the
  // frame, so the page fills the window under just the traffic lights.
  window.titleVisibility = NSWindowTitleHidden;
  window.titlebarAppearsTransparent = YES;
  window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  window.movableByWindowBackground = YES;
  [window makeKeyAndOrderFront:window];
}
