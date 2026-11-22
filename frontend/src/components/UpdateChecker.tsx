import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  AlertCircle,
  Download,
  ExternalLink,
  Loader2,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { AppUpdater } from "../plugins/appUpdater";

export const GITHUB_REPO_SLUG = "JaiKishore-x17/xone";
const FALLBACK_INSTALLED_VERSION = "1.2.0";

interface GithubReleaseAsset {
  name?: string;
  size?: number;
  browser_download_url?: string;
}

interface GithubLatestRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  assets?: GithubReleaseAsset[];
}

export interface AvailableUpdateInfo {
  tagName: string;
  version: string;
  installedVersion: string;
  apkUrl: string;
  apkName: string;
  apkSizeBytes: number;
  releaseNotes: string;
  htmlUrl: string;
}

export interface UpdateCheckSummary {
  status: "available" | "up-to-date" | "no-release" | "error";
  version?: string;
  message: string;
}

let autoCheckedThisSession = false;
let manualCheckHandler: (() => Promise<UpdateCheckSummary>) | null = null;

export function normalizeVersion(rawVersion: string): string {
  return rawVersion.trim().replace(/^v/i, "");
}

function parseSemverParts(rawVersion: string): [number, number, number] {
  const core = normalizeVersion(rawVersion).split(/[-+]/)[0];
  const segments = core.split(".");
  const major = parseInt(segments[0] ?? "0", 10) || 0;
  const minor = parseInt(segments[1] ?? "0", 10) || 0;
  const patch = parseInt(segments[2] ?? "0", 10) || 0;
  return [major, minor, patch];
}

export function compareSemver(remoteTag: string, localVersion: string): number {
  const [rMaj, rMin, rPatch] = parseSemverParts(remoteTag);
  const [lMaj, lMin, lPatch] = parseSemverParts(localVersion);

  if (rMaj !== lMaj) return rMaj > lMaj ? 1 : -1;
  if (rMin !== lMin) return rMin > lMin ? 1 : -1;
  if (rPatch !== lPatch) return rPatch > lPatch ? 1 : -1;
  return 0;
}

export async function getInstalledAppVersion(): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    return FALLBACK_INSTALLED_VERSION;
  }
  try {
    const info = await AppUpdater.getInstalledVersion();
    return info.versionName || FALLBACK_INSTALLED_VERSION;
  } catch {
    return FALLBACK_INSTALLED_VERSION;
  }
}

export async function triggerManualUpdateCheck(): Promise<UpdateCheckSummary> {
  if (!manualCheckHandler) {
    return {
      status: "error",
      message: "Updater is not ready yet.",
    };
  }
  return manualCheckHandler();
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderReleaseNotes(body: string): React.ReactNode {
  const trimmed = body.trim();
  if (!trimmed) {
    return (
      <p className="text-xs text-[#B3B3B3]">
        Bug fixes and performance improvements.
      </p>
    );
  }

  const lines = trimmed.split(/\r?\n/);
  return (
    <div className="space-y-1.5 text-xs leading-relaxed text-[#D4D4D4]">
      {lines.map((line, idx) => {
        const clean = line.trim();
        if (!clean) {
          return <div key={idx} className="h-1" />;
        }
        if (/^#{1,3}\s+/.test(clean)) {
          return (
            <p key={idx} className="text-xs font-bold text-white pt-1">
              {clean.replace(/^#{1,3}\s+/, "")}
            </p>
          );
        }
        if (/^[-*•]\s+/.test(clean)) {
          return (
            <div key={idx} className="flex items-start gap-2">
              <span className="text-[#FF5E4D] font-bold mt-[1px]">•</span>
              <span className="flex-1">{clean.replace(/^[-*•]\s+/, "")}</span>
            </div>
          );
        }
        return <p key={idx}>{clean}</p>;
      })}
    </div>
  );
}

export const UpdateChecker: React.FC = () => {
  const [updateInfo, setUpdateInfo] = useState<AvailableUpdateInfo | null>(null);
  const [sheetEntered, setSheetEntered] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [bytesDownloaded, setBytesDownloaded] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [permissionNotice, setPermissionNotice] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const runUpdateCheck = useCallback(
    async (silent: boolean): Promise<UpdateCheckSummary> => {
      try {
        const installedVersion = await getInstalledAppVersion();
        const url = `https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/latest`;
        const res = await fetch(url, {
          headers: {
            Accept: "application/vnd.github+json",
          },
        });

        if (res.status === 404) {
          return {
            status: "no-release",
            version: installedVersion,
            message: "No published releases found yet.",
          };
        }

        if (!res.ok) {
          throw new Error(`GitHub returned ${res.status}`);
        }

        const release = (await res.json()) as GithubLatestRelease;
        const remoteTag = release.tag_name?.trim() || "";
        if (!remoteTag) {
          return {
            status: "no-release",
            version: installedVersion,
            message: "No release version tag found.",
          };
        }

        if (compareSemver(remoteTag, installedVersion) <= 0) {
          return {
            status: "up-to-date",
            version: installedVersion,
            message: `You're on the latest version (v${normalizeVersion(installedVersion)}).`,
          };
        }

        const apkAsset = (release.assets ?? []).find(
          (asset) =>
            asset.name?.toLowerCase().endsWith(".apk") &&
            Boolean(asset.browser_download_url)
        );

        if (!apkAsset || !apkAsset.browser_download_url) {
          return {
            status: "up-to-date",
            version: installedVersion,
            message: `Release ${remoteTag} has no Android APK asset yet.`,
          };
        }

        const info: AvailableUpdateInfo = {
          tagName: remoteTag.startsWith("v") ? remoteTag : `v${remoteTag}`,
          version: normalizeVersion(remoteTag),
          installedVersion: normalizeVersion(installedVersion),
          apkUrl: apkAsset.browser_download_url,
          apkName: apkAsset.name || `xone-${remoteTag}.apk`,
          apkSizeBytes: apkAsset.size || 0,
          releaseNotes: release.body || "",
          htmlUrl:
            release.html_url ||
            `https://github.com/${GITHUB_REPO_SLUG}/releases/latest`,
        };

        setInstallError(null);
        setPermissionNotice(false);
        setDownloadProgress(0);
        setBytesDownloaded(0);
        setTotalBytes(info.apkSizeBytes);
        setUpdateInfo(info);

        return {
          status: "available",
          version: info.version,
          message: `Update ${info.tagName} is available.`,
        };
      } catch (err) {
        if (!silent) {
          return {
            status: "error",
            message:
              err instanceof Error
                ? "Unable to check for updates. Check your internet connection."
                : "Failed to check for updates.",
          };
        }
        return {
          status: "error",
          message: "Silent update check skipped.",
        };
      }
    },
    []
  );

  useEffect(() => {
    manualCheckHandler = () => runUpdateCheck(false);
    return () => {
      if (manualCheckHandler) {
        manualCheckHandler = null;
      }
    };
  }, [runUpdateCheck]);

  // Silent background check once per session shortly after app launch
  useEffect(() => {
    if (autoCheckedThisSession) return;
    autoCheckedThisSession = true;
    const timer = window.setTimeout(() => {
      void runUpdateCheck(true);
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [runUpdateCheck]);

  useLayoutEffect(() => {
    if (!updateInfo) {
      setSheetEntered(false);
      return;
    }
    setSheetEntered(false);
    let cancelled = false;
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (!cancelled) setSheetEntered(true);
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [updateInfo]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    const handlePromise = AppUpdater.addListener("downloadProgress", (ev) => {
      if (!active) return;
      setDownloadProgress(ev.progress);
      setBytesDownloaded(ev.bytesDownloaded);
      if (ev.totalBytes > 0) {
        setTotalBytes(ev.totalBytes);
      }
    });
    return () => {
      active = false;
      void handlePromise.then((h) => h.remove());
    };
  }, []);

  if (!updateInfo) return null;

  const apkSizeLabel = formatFileSize(updateInfo.apkSizeBytes);
  const progressTotal = totalBytes > 0 ? totalBytes : updateInfo.apkSizeBytes;

  const handleUpdateNow = async () => {
    if (isDownloading) return;
    setInstallError(null);
    setPermissionNotice(false);

    if (!Capacitor.isNativePlatform()) {
      window.open(updateInfo.apkUrl, "_blank", "noopener,noreferrer");
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      const result = await AppUpdater.downloadAndInstallApk({
        url: updateInfo.apkUrl,
      });
      if (result.permissionRequired) {
        setPermissionNotice(true);
      } else if (result.started) {
        setDownloadProgress(100);
      }
    } catch (err) {
      setInstallError(
        err instanceof Error ? err.message : "Failed to download APK update."
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDismiss = () => {
    if (isDownloading) return;
    setUpdateInfo(null);
  };

  return (
    <div
      data-no-tab-swipe="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="xone-update-title"
      onClick={handleDismiss}
      style={{
        backgroundColor: `rgba(0, 0, 0, ${sheetEntered ? 0.8 : 0})`,
      }}
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 select-none transition-colors duration-200 ease-out"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          transform: sheetEntered
            ? "translate3d(0, 0, 0)"
            : "translate3d(0, 36px, 0)",
          opacity: sheetEntered ? 1 : 0,
          transition: "transform 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out",
        }}
        className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-[#141414] border-t sm:border border-white/10 shadow-2xl p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-6 space-y-4 text-white"
      >
        {/* Mobile Handle Pill */}
        <div className="sm:hidden -mt-2 mb-1">
          <div className="w-10 h-1 rounded-full bg-white/25 mx-auto" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#FF5E4D]/15 border border-[#FF5E4D]/40 flex items-center justify-center shrink-0 text-[#FF5E4D]">
              <Sparkles size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center flex-wrap gap-2">
                <h2
                  id="xone-update-title"
                  className="text-lg font-extrabold tracking-tight text-white"
                >
                  Update Available
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-[#FF5E4D] text-black text-[11px] font-black">
                  {updateInfo.tagName}
                </span>
                {apkSizeLabel && (
                  <span className="px-2 py-0.5 rounded-full bg-[#1E1E1E] border border-white/10 text-[11px] font-semibold text-[#B3B3B3]">
                    {apkSizeLabel}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#B3B3B3] mt-0.5">
                Installed: v{updateInfo.installedVersion} &rarr; New:{" "}
                {updateInfo.tagName}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isDownloading}
            onClick={handleDismiss}
            aria-label="Dismiss update"
            className="min-w-[36px] min-h-[36px] -mr-1 -mt-1 flex items-center justify-center rounded-full text-[#B3B3B3] hover:text-white hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Release Notes */}
        <div className="rounded-xl bg-[#0B0B0B] border border-white/10 p-3.5 max-h-48 overflow-y-auto xone-modal-scroll overscroll-y-contain touch-pan-y">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#B3B3B3] mb-2">
            What&apos;s New
          </p>
          {renderReleaseNotes(updateInfo.releaseNotes)}
        </div>

        {/* Permission Notice */}
        {permissionNotice && (
          <div className="rounded-xl bg-[#FF5E4D]/10 border border-[#FF5E4D]/40 p-3 flex items-start gap-2.5 text-xs text-white">
            <ShieldAlert size={16} className="text-[#FF5E4D] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Enable <strong>&ldquo;Allow from this source&rdquo;</strong> in
              Android Settings, then return and tap <strong>Update Now</strong>{" "}
              again.
            </p>
          </div>
        )}

        {/* Download Error */}
        {installError && (
          <div className="rounded-xl bg-red-500/10 border border-red-500/35 p-3 flex items-start gap-2.5 text-xs text-red-200">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-1">
              <p>{installError}</p>
              <a
                href={updateInfo.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-[#FF5E4D] hover:underline"
              >
                <span>Open release on GitHub</span>
                <ExternalLink size={12} />
              </a>
            </div>
          </div>
        )}

        {/* Live Download Progress Bar */}
        {isDownloading && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-white flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin text-[#FF5E4D]" />
                <span>Downloading APK...</span>
              </span>
              <span className="text-[#FF5E4D] tabular-nums">
                {downloadProgress}%
                {bytesDownloaded > 0 && progressTotal > 0
                  ? ` (${formatFileSize(bytesDownloaded)} / ${formatFileSize(progressTotal)})`
                  : ""}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#FF5E4D] transition-all duration-150 ease-out"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2.5 pt-1">
          <button
            type="button"
            disabled={isDownloading}
            onClick={handleDismiss}
            className="flex-1 min-h-[46px] rounded-full bg-[#1E1E1E] hover:bg-[#282828] disabled:opacity-40 text-sm font-bold text-[#B3B3B3] hover:text-white transition-colors"
          >
            Later
          </button>
          <button
            type="button"
            disabled={isDownloading}
            onClick={() => void handleUpdateNow()}
            className="flex-[1.5] min-h-[46px] px-5 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] active:scale-[0.98] disabled:opacity-60 text-black text-sm font-extrabold flex items-center justify-center gap-2 shadow-lg transition-all"
          >
            {isDownloading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Downloading...</span>
              </>
            ) : (
              <>
                <Download size={16} />
                <span>Update Now</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
