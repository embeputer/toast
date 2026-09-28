// toast — self-updater implementation (macOS).
// Flow: GET api.github.com latest release -> compare tag -> curl the dmg
// asset -> write /tmp/toast-update.sh (waits for our pid, mounts, swaps
// /Applications/toast.app, strips quarantine, relaunches) -> nohup it ->
// quit. The script owns the swap because a process can't replace itself.

#import <Cocoa/Cocoa.h>

#include <sys/stat.h>

#include <sstream>
#include <string>
#include <vector>

#include "include/base/cef_callback.h"
#include "include/cef_app.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_closure_task.h"
#include "tests/ceftoast/toast_handler.h"
#include "tests/ceftoast/toast_tabs.h"
#include "tests/ceftoast/toast_updater.h"

namespace {

const char* kVersion = "0.2.0";
const char* kLatestRelease =
    "https://api.github.com/repos/embeputer/toast/releases/latest";
const char* kDmgPath = "/tmp/toast-update.dmg";
const char* kSwapScript = "/tmp/toast-update.sh";

bool g_checking = false;

void PostToast(const std::string& msg, const std::string& kind) {
  CefPostTask(TID_UI, base::BindOnce(&toast::ShowToast, msg, kind));
}

void QuitForUpdate() {
  if (!CefCurrentlyOn(TID_UI)) {
    CefPostTask(TID_UI, base::BindOnce(&QuitForUpdate));
    return;
  }
  if (ToastHandler::GetInstance()) {
    ToastHandler::GetInstance()->CloseAllBrowsers(true);
  }
}

bool IsNewerTag(const std::string& tag, const std::string& cur) {
  auto split = [](std::string v) {
    if (!v.empty() && (v[0] == 'v' || v[0] == 'V')) {
      v = v.substr(1);
    }
    std::vector<int> out;
    std::stringstream ss(v);
    std::string part;
    while (std::getline(ss, part, '.')) {
      out.push_back(std::atoi(part.c_str()));
    }
    return out;
  };
  const auto a = split(tag), b = split(cur);
  const size_t n = std::max(a.size(), b.size());
  for (size_t i = 0; i < n; ++i) {
    const int x = i < a.size() ? a[i] : 0;
    const int y = i < b.size() ? b[i] : 0;
    if (x != y) {
      return x > y;
    }
  }
  return false;
}

// Stage + spawn the detached swap script, then quit so it can replace us.
void StageSwapAndQuit(const std::string& tag, bool interactive) {
  std::stringstream sh;
  sh << "#!/bin/sh\n"
        "while pgrep -f 'toast.app/Contents/MacOS/toast' >/dev/null 2>&1;"
        " do sleep 0.5; done\n"
        "hdiutil attach "
     << kDmgPath
     << " -nobrowse -quiet || exit 1\n"
        "rm -rf /Applications/toast.app\n"
        "cp -R /Volumes/toast/toast.app /Applications/ || exit 1\n"
        "xattr -dr com.apple.quarantine /Applications/toast.app "
        "2>/dev/null\n"
        "hdiutil detach /Volumes/toast -quiet 2>/dev/null\n"
        "rm -f "
     << kDmgPath << " " << kSwapScript
     << "\nopen -n /Applications/toast.app\n";
  const std::string script = sh.str();
  NSData* data =
      [NSData dataWithBytes:script.data() length:script.size()];
  if (![data writeToFile:@(kSwapScript) atomically:YES]) {
    PostToast("update staged failed — can't write swap script", "fail");
    g_checking = false;
    return;
  }
  chmod(kSwapScript, 0755);
  // Detached so it survives our own shutdown.
  std::string cmd = std::string("nohup /bin/sh ") + kSwapScript +
                    " >/dev/null 2>&1 &";
  if (system(cmd.c_str()) != 0) {
    PostToast("update failed — swap didn't start", "fail");
    g_checking = false;
    return;
  }
  PostToast("restarting into toast " + tag, "done");
  CefPostDelayedTask(TID_UI, base::BindOnce(&QuitForUpdate), 800);
}

// curl the dmg asset down, then stage the swap.
void DownloadAndInstall(const std::string& url,
                        const std::string& tag,
                        bool interactive) {
  PostToast("downloading toast " + tag + "…", "start");
  NSTask* task = [[NSTask alloc] init];
  [task setLaunchPath:@"/usr/bin/curl"];
  [task setArguments:@[
    @"-fL", @"--retry", @"3", @"-o", @(kDmgPath), @(url.c_str())
  ]];
  @try {
    [task launch];
    [task waitUntilExit];
  } @catch (NSException* e) {
    PostToast("update failed — download error", "fail");
    g_checking = false;
    return;
  }
  const int code = [task terminationStatus];
  if (code != 0) {
    PostToast("update failed — download error", "fail");
    g_checking = false;
    return;
  }
  StageSwapAndQuit(tag, interactive);
}

// Parse the release JSON off-main; kicks the download when newer.
void HandleReleaseJson(NSData* json, bool interactive) {
  NSError* err = nil;
  NSDictionary* rel =
      [NSJSONSerialization JSONObjectWithData:json options:0 error:&err];
  if (!rel) {
    if (interactive) {
      PostToast("update check failed — bad response", "fail");
    }
    g_checking = false;
    return;
  }
  NSString* tag = rel[@"tag_name"];
  if (!tag || !IsNewerTag([tag UTF8String], kVersion)) {
    if (interactive) {
      PostToast(std::string("toast ") + kVersion + " is up to date",
                "done");
    }
    g_checking = false;
    return;
  }
  NSString* dmgURL = nil;
  for (NSDictionary* asset in rel[@"assets"]) {
    NSString* u = asset[@"browser_download_url"];
    if (u && [[u lowercaseString] hasSuffix:@".dmg"]) {
      dmgURL = u;
      break;
    }
  }
  if (!dmgURL) {
    PostToast("update found but no dmg asset", "fail");
    g_checking = false;
    return;
  }
  PostToast(std::string("toast ") + [tag UTF8String] + " available",
            "start");
  DownloadAndInstall([dmgURL UTF8String], [tag UTF8String], interactive);
}

void FetchLatest(bool interactive) {
  NSMutableURLRequest* req = [NSMutableURLRequest
      requestWithURL:[NSURL URLWithString:@(kLatestRelease)]];
  [req setValue:@"application/vnd.github+json"
      forHTTPHeaderField:@"Accept"];
  [req setValue:@"toast-updater" forHTTPHeaderField:@"User-Agent"];
  NSURLSessionDataTask* task = [[NSURLSession sharedSession]
      dataTaskWithRequest:req
        completionHandler:^(NSData* data, NSURLResponse* resp,
                            NSError* error) {
          dispatch_async(dispatch_get_global_queue(
                             DISPATCH_QUEUE_PRIORITY_DEFAULT, 0),
                         ^{
                           if (error || !data) {
                             if (interactive) {
                               PostToast(
                                   "update check failed — offline?",
                                   "fail");
                             }
                             g_checking = false;
                             return;
                           }
                           HandleReleaseJson(data, interactive);
                         });
        }];
  [task resume];
}

}  // namespace

namespace toast {

const char* ToastVersion() {
  return kVersion;
}

void CheckForUpdate(bool interactive) {
  if (g_checking) {
    return;
  }
  g_checking = true;
  if (!CefCurrentlyOn(TID_UI)) {
    // fine — network work is dispatched anyway
  }
  dispatch_async(dispatch_get_global_queue(
                     DISPATCH_QUEUE_PRIORITY_DEFAULT, 0),
                 ^{ FetchLatest(interactive); });
}

}  // namespace toast
