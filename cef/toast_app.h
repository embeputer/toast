// toast — CEF browser process app.
// Adapted from cefsimple (BSD license, Chromium Embedded Framework Authors).

#ifndef TOAST_CEF_TOAST_APP_H_
#define TOAST_CEF_TOAST_APP_H_

#include "include/cef_app.h"

#include <string>

// Application-level callbacks for the browser process.
class ToastApp : public CefApp, public CefBrowserProcessHandler {
 public:
  explicit ToastApp(std::string start_url);

  // CefApp methods:
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override {
    return this;
  }

  // CefBrowserProcessHandler methods:
  void OnContextInitialized() override;
  CefRefPtr<CefClient> GetDefaultClient() override;

 private:
  const std::string start_url_;

  IMPLEMENT_REFCOUNTING(ToastApp);
};

#endif  // TOAST_CEF_TOAST_APP_H_
