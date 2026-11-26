import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { Track } from "../types";

export interface NativeTrackPayload {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  thumbnail: string;
  durationSeconds?: number;
}

export interface NativePlaybackStateEvent {
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  ended?: boolean;
  error?: string | null;
  currentTrack?: Track | null;
}

export interface WavePrepProgressEvent {
  videoId: string;
  progress: number;
  stage: "downloading" | "cached";
}

export interface XoneAudioPlugin {
  playTrack(
    options: NativeTrackPayload
  ): Promise<{ started: boolean; cached?: boolean; resolutionMs?: number }>;
  togglePlayPause(options?: { playing?: boolean }): Promise<{ isPlaying: boolean }>;
  seekTo(options: { positionMs: number }): Promise<void>;
  setQueue(options: {
    tracks: NativeTrackPayload[];
    startIndex?: number;
  }): Promise<void>;
  searchSongs(options: {
    query: string;
  }): Promise<{ topResult: Track | null; songs: Track[] }>;
  getRadioQueue(options: {
    videoId: string;
    limit?: number;
  }): Promise<{ tracks: Track[] }>;
  downloadTrack(options: {
    videoId: string;
    title?: string;
    artist?: string;
  }): Promise<{ localPath: string; sizeBytes: number }>;
  prepareWaveAudio(options: {
    videoId: string;
  }): Promise<{ localFilePath: string; cached: boolean }>;
  deleteDownload(options: {
    videoId: string;
  }): Promise<{ deleted?: boolean; videoId?: string }>;
  openDownloadsFolder(): Promise<{ opened: boolean }>;
  scanOfflineDownloads(): Promise<{ tracks: Track[] }>;
  setVolume(options: { volume: number }): Promise<void>;
  setAudioEffects(options: {
    eightD: boolean;
    slowedReverb: boolean;
  }): Promise<{ eightD: boolean; slowedReverb: boolean }>;
  addListener(
    eventName: "playbackState",
    listenerFunc: (event: NativePlaybackStateEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "wavePrepProgress",
    listenerFunc: (event: WavePrepProgressEvent) => void
  ): Promise<PluginListenerHandle>;
}

export const XoneAudio = registerPlugin<XoneAudioPlugin>("XoneAudio");

export function toNativeTrackPayload(track: Track): NativeTrackPayload {
  return {
    videoId: track.video_id,
    title: track.title,
    artist: track.artist,
    album: track.album || "Xone",
    thumbnail: track.thumbnail || "",
    durationSeconds: track.duration_seconds || 0,
  };
}
