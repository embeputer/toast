// toast — CEF browser process app.
// Adapted from cefsimple (BSD license, Chromium Embedded Framework Authors).

#ifndef TOAST_CEF_TOAST_APP_H_
#define TOAST_CEF_TOAST_APP_H_

#include "include/cef_app.h"
#include "include/cef_scheme.h"

#include <string>

// Application-level callbacks for the browser process.
class ToastApp : public CefApp, public CefBrowserProcessHandler {
 public:
  ToastApp(std::string start_url, std::string resources_dir);

  // CefApp methods:
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
    return this;
  }
  void OnRegisterCustomSchemes(
      CefRawPtr<CefSchemeRegistrar> registrar) override;
  void OnBeforeCommandLineProcessing(
      const CefString& process_type,
      CefRefPtr<CefCommandLine> command_line) override;

  // CefBrowserProcessHandler methods:
  void OnContextInitialized() override;
  CefRefPtr<CefClient> GetDefaultClient() override;

 private:
  const std::string start_url_;
  const std::string resources_dir_;

  IMPLEMENT_REFCOUNTING(ToastApp);
};

#endif  // TOAST_CEF_TOAST_APP_H_
