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

// HUD toast (download started/finished/failed), bottom-center, auto-hides.
// kind: "start" | "done" | "fail"
void ShowToast(const std::string& msg, const std::string& kind);

// Top-edge loading bar driven by CefDisplayHandler::OnLoadingProgressChange.
void LoadingProgress(CefRefPtr<CefBrowser> browser, float progress);

// Called from the client's display handler to keep chip titles fresh.
void NoteTitle(CefRefPtr<CefBrowser> browser, const std::string& title);

// Liquid-glass window mode — applies the native backdrop, insets tab
// views and makes toast:// pages transparent. level 0-100, 0 = plain.
// UI thread only.
void SetGlassMode(int level);
bool IsGlassMode();

// Implemented per-platform (toast_handler_mac.mm). Retries briefly while
// the browser's view attaches to its window.
void PlatformSetGlass(CefRefPtr<CefBrowser> any_browser,
                      int level,
                      int retries_left = 20);

CefRefPtr<CefBrowser> ActiveBrowser();

}  // namespace toast

#endif  // TOAST_CEF_TOAST_TABS_H_
