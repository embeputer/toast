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
const char* g_glass_backend = "pending";  // diagnostic for toast://settings

}  // namespace

namespace toast {

// Liquid-glass window: Apple's NSGlassEffectView pinned behind everything
// (NSVisualEffectView fallback pre-26), window non-opaque with rounded
// corners so the glass frame shows around the inset page content.
// level 1-100 maps tinted -> liquid: low adds a heavier tintColor fill,
// 100 leaves the glass clear.
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
      Class glassCls = NSClassFromString(@"NSGlassEffectView");
      NSView* glass = nil;
      if (glassCls) {
        glass = [[glassCls alloc] initWithFrame:content.bounds];
      }
      if (glass) {
        g_glass_backend = "NSGlassEffectView";
      } else {
        NSVisualEffectView* vev =
            [[NSVisualEffectView alloc] initWithFrame:content.bounds];
        vev.material = NSVisualEffectMaterialUnderWindowBackground;
        vev.blendingMode = NSVisualEffectBlendingModeBehindWindow;
        vev.state = NSVisualEffectStateActive;
        glass = vev;
        g_glass_backend = "NSVisualEffectView (fallback)";
      }
      glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      g_glass_view = glass;
      NSLog(@"toast: glass backing = %s", g_glass_backend);
    }
    if (g_glass_view.superview != content) {
      g_glass_view.frame = content.bounds;
      [content addSubview:g_glass_view
               positioned:NSWindowBelow
               relativeTo:nil];
    }
    g_glass_view.hidden = NO;
    // Transparent window FIRST — if any of the glass tuning below throws
    // on a newer macOS, the border must still not fall back to opaque
    // white.
    win.opaque = NO;
    win.backgroundColor = [NSColor clearColor];
    content.wantsLayer = YES;
    content.layer.cornerRadius = 18.0;
    content.layer.masksToBounds = YES;
    @try {
      // Tinted -> liquid: fill fades out as the level rises, and the top
      // end flips NSGlassEffectView to its clear (fully liquid) style.
      const CGFloat tint = (100.0 - level) / 100.0 * 0.45;
      if ([g_glass_view respondsToSelector:@selector(setTintColor:)]) {
        [g_glass_view setValue:[NSColor colorWithWhite:1.0 alpha:tint]
                        forKey:@"tintColor"];
      }
      if ([g_glass_view respondsToSelector:@selector(setStyle:)]) {
        // NSGlassEffectViewStyle: 0 regular (tinted), 1 clear (liquid).
        [g_glass_view setValue:@(level >= 80 ? 1 : 0) forKey:@"style"];
      }
      if ([g_glass_view isKindOfClass:[NSVisualEffectView class]]) {
        [(NSVisualEffectView*)g_glass_view
            setAlphaValue:0.45 + 0.55 * (level / 100.0)];
      }
    } @catch (NSException* e) {
      g_glass_backend = "NSGlassEffectView (config failed)";
      NSLog(@"toast: glass config threw: %@", e);
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
