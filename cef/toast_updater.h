// toast — self-updater: checks GitHub Releases for a newer build,
// downloads the dmg asset, swaps the app in place and relaunches.
// Files our own process downloads don't get the browser's quarantine
// xattr, so updates never hit the "damaged" Gatekeeper dialog.

#ifndef TOAST_CEF_TOAST_UPDATER_H_
#define TOAST_CEF_TOAST_UPDATER_H_

namespace toast {

// Running build version — bump for every release; compared against the
// newest GitHub release tag (vX.Y.Z).
const char* ToastVersion();

// Fetches the latest GitHub release on a background thread. When it is
// newer than ToastVersion() the dmg asset is downloaded, a swap script
// is staged, and the app restarts into the new build. `interactive`
// surfaces every step through the HUD toast; the launch-time call uses
// it quietly (only a HUD note once the update is ready).
void CheckForUpdate(bool interactive);

}  // namespace toast

#endif  // TOAST_CEF_TOAST_UPDATER_H_
