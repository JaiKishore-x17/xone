import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface InstalledVersionInfo {
  versionName: string;
  versionCode: number;
  canInstallPackages: boolean;
}

export interface DownloadAndInstallResult {
  started: boolean;
  permissionRequired: boolean;
  filePath?: string;
}

export interface ApkDownloadProgressEvent {
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
}

export interface AppUpdaterPlugin {
  getInstalledVersion(): Promise<InstalledVersionInfo>;
  downloadAndInstallApk(options: {
    url: string;
  }): Promise<DownloadAndInstallResult>;
  setScreenOrientation(options: {
    orientation: "landscape" | "portrait" | "unspecified";
  }): Promise<{ applied: boolean; orientation: string }>;
  setImmersiveMode(options: {
    enabled: boolean;
  }): Promise<{ applied: boolean; enabled: boolean }>;
  addListener(
    eventName: "downloadProgress",
    listenerFunc: (event: ApkDownloadProgressEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const AppUpdater = registerPlugin<AppUpdaterPlugin>("AppUpdater");
