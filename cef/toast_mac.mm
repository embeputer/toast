// toast — macOS entry point. Boots CEF, opens the first window on our bundled
// new-tab page.
// Adapted from cefsimple (BSD license, Chromium Embedded Framework Authors).

#import <Cocoa/Cocoa.h>

#include "include/cef_application_mac.h"
#include "include/cef_command_line.h"
#include "include/wrapper/cef_helpers.h"
#include "include/wrapper/cef_library_loader.h"
#include "tests/ceftoast/toast_app.h"
#include "tests/ceftoast/toast_handler.h"

@interface ToastAppDelegate : NSObject <NSApplicationDelegate>
- (void)createApplication:(id)object;
- (void)tryToTerminateApplication:(NSApplication*)app;
@end

@interface ToastApplication : NSApplication <CefAppProtocol> {
 @private
  BOOL handlingSendEvent_;
}
@end

@implementation ToastApplication
- (BOOL)isHandlingSendEvent {
  return handlingSendEvent_;
}

- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
  handlingSendEvent_ = handlingSendEvent;
}

- (void)sendEvent:(NSEvent*)event {
  CefScopedSendingEvent sendingEventScoper;
  [super sendEvent:event];
}

// Route orderly termination through the handler so Chromium can shut down.
- (void)terminate:(id)sender {
  ToastAppDelegate* delegate = static_cast<ToastAppDelegate*>([NSApp delegate]);
  [delegate tryToTerminateApplication:self];
}
@end

@implementation ToastAppDelegate

- (void)createApplication:(id)object {
  [[NSBundle mainBundle] loadNibNamed:@"MainMenu"
                                owner:NSApp
                      topLevelObjects:nil];
  [[NSApplication sharedApplication] setDelegate:self];
}

- (void)tryToTerminateApplication:(NSApplication*)app {
  ToastHandler* handler = ToastHandler::GetInstance();
  if (handler && !handler->IsClosing()) {
    handler->CloseAllBrowsers(false);
  }
}

- (NSApplicationTerminateReply)applicationShouldTerminate:
    (NSApplication*)sender {
  return NSTerminateNow;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication*)theApplication
                    hasVisibleWindows:(BOOL)flag {
  ToastHandler* handler = ToastHandler::GetInstance();
  if (handler && !handler->IsClosing()) {
    handler->ShowMainWindow();
  }
  return NO;
}

- (BOOL)applicationSupportsSecureRestorableState:(NSApplication*)app {
  return YES;
}
@end

// file:// URL for the bundled new-tab page (empty string if missing).
static std::string StartURL() {
  NSString* res =
      [[NSBundle mainBundle] pathForResource:@"newtab" ofType:@"html"];
  if (!res) {
    return "";
  }
  return std::string("file://") + [[res stringByStandardizingPath] UTF8String];
}

int main(int argc, char* argv[]) {
  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInMain()) {
    return 1;
  }

  CefMainArgs main_args(argc, argv);

  @autoreleasepool {
    [ToastApplication sharedApplication];
    CHECK([NSApp isKindOfClass:[ToastApplication class]]);

    CefRefPtr<CefCommandLine> command_line =
        CefCommandLine::CreateCommandLine();
    command_line->InitFromArgv(argc, argv);

    CefSettings settings;
#if !defined(CEF_USE_SANDBOX)
    settings.no_sandbox = true;
#endif

    // Isolate our profile/cache so we don't share a process singleton with
    // other CEF apps (e.g. cefsimple) that use the default cache path.
    NSString* cacheDir = [NSHomeDirectory()
        stringByAppendingPathComponent:@"Library/Application Support/toast"];
    CefString(&settings.root_cache_path) = [cacheDir UTF8String];

    CefRefPtr<ToastApp> app(new ToastApp(StartURL()));

    if (!CefInitialize(main_args, settings, app.get(), nullptr)) {
      return CefGetExitCode();
    }

    ToastAppDelegate* delegate = [[ToastAppDelegate alloc] init];
    NSApp.delegate = delegate;
    [delegate performSelectorOnMainThread:@selector(createApplication:)
                               withObject:nil
                            waitUntilDone:NO];

    CefRunMessageLoop();
    CefShutdown();

#if !__has_feature(objc_arc)
    [delegate release];
#endif
    delegate = nil;
  }

  return 0;
}
