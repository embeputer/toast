// toast — sub-process entry point.
// From cefsimple (BSD license, Chromium Embedded Framework Authors).

#include "include/cef_app.h"
#include "include/cef_scheme.h"
#include "include/wrapper/cef_library_loader.h"

namespace {

// Minimal app for sub-processes: registers the toast:// scheme so renderers
// can resolve it (OnRegisterCustomSchemes must run in every process).
class ToastHelperApp : public CefApp {
 public:
  void OnRegisterCustomSchemes(
      CefRawPtr<CefSchemeRegistrar> registrar) override {
    registrar->AddCustomScheme("toast", CEF_SCHEME_OPTION_STANDARD |
                                           CEF_SCHEME_OPTION_SECURE |
                                           CEF_SCHEME_OPTION_CORS_ENABLED |
                                           CEF_SCHEME_OPTION_FETCH_ENABLED);
  }

 private:
  IMPLEMENT_REFCOUNTING(ToastHelperApp);
};

}  // namespace

// When generating projects with CMake the CEF_USE_SANDBOX value will be defined
// automatically. Pass -DUSE_SANDBOX=OFF to the CMake command-line to disable
// use of the sandbox.
#if defined(CEF_USE_SANDBOX)
#include "include/cef_sandbox_mac.h"
#endif

int main(int argc, char* argv[]) {
#if defined(CEF_USE_SANDBOX)
  CefScopedSandboxContext sandbox_context;
  if (!sandbox_context.Initialize(argc, argv)) {
    return 1;
  }
#endif

  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInHelper()) {
    return 1;
  }

  CefMainArgs main_args(argc, argv);

  CefRefPtr<CefApp> app(new ToastHelperApp);
  return CefExecuteProcess(main_args, app.get(), nullptr);
}
