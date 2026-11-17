import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { Track } from "../types";

export interface JamParticipant {
  deviceAddress: string;
  deviceName: string;
  isHost: boolean;
  isSpeakerEnabled: boolean;
}

export interface JamQueueTrack extends Track {
  addedBy: string;
}

export interface JamState {
  active: boolean;
  isActive: boolean;
  role: "none" | "host" | "guest";
  jamCode: string;
  localDeviceId: string;
  localDeviceName: string;
  clockOffsetMs: number;
  isMultiSpeakerMode: boolean;
  currentTrackIndex: number;
  currentVideoId: string;
  participants: JamParticipant[];
  jamQueue: JamQueueTrack[];
  activeSpeakers: string[];
  currentTrack: JamQueueTrack | null;
  isPlaying: boolean;
  positionMs: number;
}

export const EMPTY_JAM_STATE: JamState = {
  active: false,
  isActive: false,
  role: "none",
  jamCode: "",
  localDeviceId: "HOST",
  localDeviceName: "",
  clockOffsetMs: 0,
  isMultiSpeakerMode: false,
  currentTrackIndex: -1,
  currentVideoId: "",
  participants: [],
  jamQueue: [],
  activeSpeakers: [],
  currentTrack: null,
  isPlaying: false,
  positionMs: 0,
};

function normalizeJamState(raw?: Partial<JamState> | null): JamState {
  const isActive = Boolean(raw?.active ?? raw?.isActive ?? false);
  const currentTrack = raw?.currentTrack ?? null;
  return {
    ...EMPTY_JAM_STATE,
    ...(raw ?? {}),
    active: isActive,
    isActive,
    isMultiSpeakerMode: Boolean(raw?.isMultiSpeakerMode ?? false),
    currentTrackIndex:
      typeof raw?.currentTrackIndex === "number" ? raw.currentTrackIndex : -1,
    currentVideoId: raw?.currentVideoId ?? currentTrack?.video_id ?? "",
    participants: raw?.participants ?? [],
    jamQueue: raw?.jamQueue ?? [],
    activeSpeakers: raw?.activeSpeakers ?? [],
    currentTrack,
  };
}

interface XoneJamPlugin {
  createJam(options?: { deviceName?: string }): Promise<JamState>;
  joinJam(options: { code: string; deviceName?: string }): Promise<JamState>;
  leaveJam(): Promise<void>;
  addTrackToJam(options: {
    videoId: string;
    title: string;
    artist: string;
    album: string;
    thumbnail: string;
    duration: string;
    durationSeconds: number;
    addedBy?: string;
  }): Promise<void>;
  setSpeakerDevices(options: { deviceIds: string[] }): Promise<void>;
  setMultiSpeakerMode(options: { enabled: boolean }): Promise<void>;
  playJamTrack(options: { videoId: string }): Promise<void>;
  getJamState(): Promise<JamState>;
  addListener(
    eventName: "jamStateUpdated",
    listenerFunc: (state: JamState) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "jamEnded",
    listenerFunc: (event: { reason?: string }) => void
  ): Promise<PluginListenerHandle>;
}

const XoneJamNative = registerPlugin<XoneJamPlugin>("XoneJam");

const NOOP_HANDLE: PluginListenerHandle = {
  remove: async () => {},
};

function requireNativeJam(): void {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("BLE Jam requires the Xone Android app.");
  }
}

export async function createJam(deviceName?: string): Promise<JamState> {
  requireNativeJam();
  const state = await XoneJamNative.createJam({
    deviceName: deviceName?.trim() || undefined,
  });
  return normalizeJamState(state);
}

export async function joinJam(options: {
  code: string;
  deviceName?: string;
}): Promise<JamState> {
  requireNativeJam();
  const state = await XoneJamNative.joinJam({
    code: options.code.trim(),
    deviceName: options.deviceName?.trim() || undefined,
  });
  return normalizeJamState(state);
}

export async function leaveJam(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await XoneJamNative.leaveJam();
}

export async function addTrackToJam(
  track: Track,
  addedBy?: string
): Promise<void> {
  requireNativeJam();
  await XoneJamNative.addTrackToJam({
    videoId: track.video_id,
    title: track.title,
    artist: track.artist,
    album: track.album || "",
    thumbnail: track.thumbnail || "",
    duration: track.duration || "0:00",
    durationSeconds: track.duration_seconds || 0,
    addedBy: addedBy?.trim() || undefined,
  });
}

export async function setSpeakerDevices(deviceIds: string[]): Promise<void> {
  requireNativeJam();
  await XoneJamNative.setSpeakerDevices({ deviceIds });
}

export async function setMultiSpeakerMode(enabled: boolean): Promise<void> {
  requireNativeJam();
  await XoneJamNative.setMultiSpeakerMode({ enabled });
}

export async function playJamTrack(videoId: string): Promise<void> {
  requireNativeJam();
  await XoneJamNative.playJamTrack({ videoId });
}

export async function getJamState(): Promise<JamState> {
  if (!Capacitor.isNativePlatform()) {
    return EMPTY_JAM_STATE;
  }
  const state = await XoneJamNative.getJamState();
  return normalizeJamState(state);
}

export async function onJamStateUpdated(
  cb: (state: JamState) => void
): Promise<PluginListenerHandle> {
  if (!Capacitor.isNativePlatform()) {
    return NOOP_HANDLE;
  }
  return XoneJamNative.addListener("jamStateUpdated", (state) => {
    cb(normalizeJamState(state));
  });
}

export async function onJamEnded(
  cb: (event: { reason?: string }) => void
): Promise<PluginListenerHandle> {
  if (!Capacitor.isNativePlatform()) {
    return NOOP_HANDLE;
  }
  return XoneJamNative.addListener("jamEnded", cb);
}
