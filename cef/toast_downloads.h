// toast — download registry + toast notifications.

#ifndef TOAST_CEF_TOAST_DOWNLOADS_H_
#define TOAST_CEF_TOAST_DOWNLOADS_H_

#include "include/cef_download_item.h"

namespace toast {

// Records/updates a download item and fires the HUD toast for state
// transitions. Called from CefDownloadHandler callbacks (UI thread).
void TrackDownload(CefRefPtr<CefDownloadItem> item);

// Renders the toast://downloads page body (HTML rows).
std::string DownloadsHtml();

}  // namespace toast

#endif  // TOAST_CEF_TOAST_DOWNLOADS_H_
