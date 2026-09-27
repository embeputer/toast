// toast — toast:// internal page scheme.
// Serves the bundled new-tab page and generated internal pages.

#ifndef TOAST_CEF_TOAST_SCHEME_H_
#define TOAST_CEF_TOAST_SCHEME_H_

#include <string>

#include "include/cef_scheme.h"

class ToastSchemeHandlerFactory : public CefSchemeHandlerFactory {
 public:
  explicit ToastSchemeHandlerFactory(std::string resources_dir);

  // CefSchemeHandlerFactory:
  CefRefPtr<CefResourceHandler> Create(CefRefPtr<CefBrowser> browser,
                                     CefRefPtr<CefFrame> frame,
                                     const CefString& scheme_name,
                                     CefRefPtr<CefRequest> request) override;

 private:
  const std::string resources_dir_;

  IMPLEMENT_REFCOUNTING(ToastSchemeHandlerFactory);
};

#endif  // TOAST_CEF_TOAST_SCHEME_H_
