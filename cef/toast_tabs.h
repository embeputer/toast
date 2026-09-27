// toast — tab model + ⌃Tab switcher overlay for the Views window.

#ifndef TOAST_CEF_TOAST_TABS_H_
#define TOAST_CEF_TOAST_TABS_H_

#include <string>
#include <vector>

#include "include/cef_browser.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_overlay_controller.h"
#include "include/views/cef_window.h"

namespace toast {

struct Tab {
  CefRefPtr<CefBrowserView> view;
  CefRefPtr<CefBrowser> browser;
  std::string title;
};

void AttachWindow(CefRefPtr<CefWindow> window);
void DetachWindow();

// Wire-up for the window delegate: registers the window, records the first
// tab and creates the (hidden) switcher overlay on top.
void CreateOverlayIfNeeded(CefRefPtr<CefWindow> window,
                           CefRefPtr<CefClient> client,
                           cef_runtime_style_t runtime_style);
void AddTabView(CefRefPtr<CefWindow> window, CefRefPtr<CefBrowserView> view,
                CefRefPtr<CefBrowser> browser);
void ResizeTabViews(int width, int height);
void RegisterBrowser(CefRefPtr<CefBrowser> browser,
                     CefRefPtr<CefBrowserView> view);
void RemoveBrowser(CefRefPtr<CefBrowser> browser);
void SwitcherStep(int delta);

// Navigation.
void NewTab(const CefString& url, CefRefPtr<CefClient> client,
            cef_runtime_style_t runtime_style);
void CloseActiveTab();
void ActivateTab(int index);
void CycleTab(int delta);

// Switcher overlay (⌃Tab).
void ShowSwitcher();
void HideSwitcher(bool commit);  // commit=false restores the previous tab
bool SwitcherOpen();
CefRefPtr<CefWindow> MainWindow();

// Called from the client's display handler to keep chip titles fresh.
void NoteTitle(CefRefPtr<CefBrowser> browser, const std::string& title);

CefRefPtr<CefBrowser> ActiveBrowser();

}  // namespace toast

#endif  // TOAST_CEF_TOAST_TABS_H_
