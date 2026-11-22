import { create } from "zustand";
import { Capacitor } from "@capacitor/core";
import { XoneAudio } from "../plugins/xoneAudio";
import * as api from "../services/musicApi";
import {
  EMPTY_JAM_STATE,
  type JamState,
  addTrackToJam as jamAddTrackApi,
  createJam as jamCreateApi,
  joinJam as jamJoinApi,
  leaveJam as jamLeaveApi,
  playJamTrack as jamPlayTrackApi,
  setMultiSpeakerMode as jamSetMultiSpeakerModeApi,
  setSpeakerDevices as jamSetSpeakersApi,
} from "../services/xoneJam";
import type { ActiveView, Playlist, RepeatMode, SearchResponse, Track } from "../types";

function syncNativeAudioEffects(eightD: boolean, slowedReverb: boolean): void {
  if (!Capacitor.isNativePlatform()) return;
  void XoneAudio.setAudioEffects({ eightD, slowedReverb }).catch(() => {});
}

const VOLUME_STORAGE_KEY = "xone_volume";
const RECENT_SEARCHES_STORAGE_KEY = "xone_recent_searches";
const MAX_RECENT_SEARCHES = 15;

function readInitialVolume(): number {
  try {
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        return parsed;
      }
    }
  } catch {
    // ignore storage failures
  }
  return 0.85;
}

function readInitialRecentSearches(): Track[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is Track =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof item.video_id === "string" &&
          item.video_id.length > 0 &&
          typeof item.title === "string"
      )
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

function persistRecentSearches(tracks: Track[]): void {
  try {
    localStorage.setItem(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify(tracks.slice(0, MAX_RECENT_SEARCHES))
    );
  } catch {
    // ignore storage failures
  }
}

function shuffleKeepingFirst(tracks: Track[], firstTrack: Track): Track[] {
  const rest = tracks.filter((t) => t.video_id !== firstTrack.video_id);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = rest[i];
    rest[i] = rest[j];
    rest[j] = tmp;
  }
  return [firstTrack, ...rest];
}

function viewsEqual(a: ActiveView, b: ActiveView): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "playlist" && b.type === "playlist") {
    return a.playlistId === b.playlistId;
  }
  return true;
}

interface PlayerState {
  // Playback & Queue
  currentTrack: Track | null;
  queue: Track[];
  queueIndex: number;
  originalQueue: Track[];
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  prefetchedVideoId: string | null;
  streamStats: { cached: boolean; resolutionMs: number } | null;
  playbackError: string | null;
  seekRequest: { seconds: number; nonce: number } | null;
  autoplayRadio: boolean;
  isFetchingRadio: boolean;
  radioSeedVideoId: string | null;
  eightDEnabled: boolean;
  srEnabled: boolean;

  // Navigation & Search
  activeView: ActiveView;
  history: ActiveView[];
  historyIndex: number;
  searchQuery: string;
  searchResults: SearchResponse | null;
  recentSearches: Track[];
  isSearching: boolean;
  searchError: string | null;

  // Library
  playlists: Playlist[];
  activePlaylist: Playlist | null;
  likedSongs: Track[];
  likedIds: Record<string, boolean>;
  downloadedTracks: Track[];
  downloadedIds: Record<string, boolean>;
  downloadingIds: Record<string, boolean>;

  // Modal / UI Feedback
  isNewPlaylistModalOpen: boolean;
  isJamModalOpen: boolean;
  isMobilePlayerExpanded: boolean;
  isKeyboardOpen: boolean;
  isJamBusy: boolean;
  jamState: JamState;
  toastMessage: string | null;

  // Playback Actions
  playTrack: (track: Track, contextQueue?: Track[]) => void;
  togglePlay: () => void;
  setIsPlaying: (playing: boolean) => void;
  setIsBuffering: (buffering: boolean) => void;
  setTimeProgress: (currentTime: number, duration?: number) => void;
  seekTo: (seconds: number) => void;
  playNextTrack: (fromEnded?: boolean) => void;
  playPreviousTrack: () => void;
  playNextInQueue: (track: Track) => void;
  addToQueue: (track: Track) => void;
  addTracksToQueue: (tracks: Track[]) => Promise<void>;
  removeFromQueue: (index: number) => void;
  clearUpcomingQueue: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  setPrefetchedVideoId: (videoId: string | null) => void;
  setStreamStats: (stats: { cached: boolean; resolutionMs: number } | null) => void;
  setPlaybackError: (err: string | null) => void;
  toggleAutoplayRadio: () => void;
  toggleEightD: () => void;
  toggleSlowedReverb: () => void;
  fetchAndAppendRadio: (seedVideoId: string, replaceUpcoming: boolean) => Promise<Track[]>;
  syncTrackFromNative: (track: Track) => void;

  // Navigation & Search Actions
  navigate: (view: ActiveView) => void;
  goBack: () => void;
  goForward: () => void;
  setSearchQuery: (q: string) => void;
  runSearch: (q: string) => Promise<void>;
  addRecentSearchTrack: (track: Track) => void;
  removeRecentSearchTrack: (videoId: string) => void;
  clearRecentSearches: () => void;

  // Library Actions
  fetchLibrary: () => Promise<void>;
  syncOfflineDownloads: () => Promise<void>;
  loadPlaylistDetail: (playlistId: number) => Promise<void>;
  toggleLike: (track: Track) => Promise<void>;
  downloadTrack: (track: Track) => Promise<void>;
  removeDownload: (videoId: string) => Promise<void>;
  toggleDownload: (track: Track) => Promise<void>;
  openDownloadsFolder: () => Promise<void>;
  createPlaylist: (name: string, description: string, coverColor: string) => Promise<Playlist>;
  deletePlaylist: (playlistId: number) => Promise<void>;
  addTrackToPlaylist: (playlistId: number, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: number, videoId: string) => Promise<void>;
  reorderPlaylistTracks: (playlistId: number, fromIndex: number, toIndex: number) => Promise<void>;

  // UI Helpers
  setNewPlaylistModalOpen: (open: boolean) => void;
  setJamModalOpen: (open: boolean) => void;
  setMobilePlayerExpanded: (open: boolean) => void;
  setKeyboardOpen: (open: boolean) => void;
  setJamState: (state: JamState) => void;
  startJamSession: (deviceName?: string) => Promise<void>;
  joinJamSession: (code: string, deviceName?: string) => Promise<void>;
  leaveJamSession: () => Promise<void>;
  addTrackToJamSession: (track: Track) => Promise<void>;
  setJamSpeakerDevices: (deviceIds: string[]) => Promise<void>;
  setJamMultiSpeakerMode: (enabled: boolean) => Promise<void>;
  showToast: (msg: string) => void;
}

let toastTimer: number | null = null;
let radioRequestNonce = 0;

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: null,
  queue: [],
  queueIndex: -1,
  originalQueue: [],
  isPlaying: false,
  isBuffering: false,
  currentTime: 0,
  duration: 0,
  volume: readInitialVolume(),
  isMuted: false,
  shuffle: false,
  repeat: "off",
  prefetchedVideoId: null,
  streamStats: null,
  playbackError: null,
  seekRequest: null,
  autoplayRadio: true,
  isFetchingRadio: false,
  radioSeedVideoId: null,
  eightDEnabled: false,
  srEnabled: false,

  activeView: { type: "home" },
  history: [{ type: "home" }],
  historyIndex: 0,
  searchQuery: "",
  searchResults: null,
  recentSearches: readInitialRecentSearches(),
  isSearching: false,
  searchError: null,

  playlists: [],
  activePlaylist: null,
  likedSongs: [],
  likedIds: {},
  downloadedTracks: [],
  downloadedIds: {},
  downloadingIds: {},

  isNewPlaylistModalOpen: false,
  isJamModalOpen: false,
  isMobilePlayerExpanded: false,
  isKeyboardOpen: false,
  isJamBusy: false,
  jamState: EMPTY_JAM_STATE,
  toastMessage: null,

  showToast: (msg) => {
    if (toastTimer !== null) {
      window.clearTimeout(toastTimer);
    }
    set({ toastMessage: msg });
    toastTimer = window.setTimeout(() => {
      set({ toastMessage: null });
    }, 2600);
  },

  setNewPlaylistModalOpen: (open) => set({ isNewPlaylistModalOpen: open }),
  setJamModalOpen: (open) => set({ isJamModalOpen: open }),
  setMobilePlayerExpanded: (open) => set({ isMobilePlayerExpanded: open }),
  setKeyboardOpen: (open) => set({ isKeyboardOpen: open }),
  setJamState: (jamState) => {
    const isActive = Boolean(jamState.active || jamState.isActive);
    const normalized: JamState = {
      ...jamState,
      active: isActive,
      isActive,
    };

    if (isActive) {
      ++radioRequestNonce;
      const jamQueue = normalized.jamQueue ?? [];
      const activeId =
        normalized.currentTrack?.video_id ?? get().currentTrack?.video_id ?? null;
      const reportedIdx = normalized.currentTrackIndex;
      const foundIdx =
        reportedIdx >= 0 &&
        reportedIdx < jamQueue.length &&
        (!activeId || jamQueue[reportedIdx]?.video_id === activeId)
          ? reportedIdx
          : activeId
          ? jamQueue.findIndex((t) => t.video_id === activeId)
          : -1;

      if (get().eightDEnabled || get().srEnabled) {
        syncNativeAudioEffects(false, false);
      }
      set({
        jamState: normalized,
        queue: jamQueue,
        originalQueue: jamQueue,
        queueIndex: foundIdx >= 0 ? foundIdx : jamQueue.length > 0 ? 0 : -1,
        isFetchingRadio: false,
        prefetchedVideoId: null,
        repeat: "all",
        eightDEnabled: false,
        srEnabled: false,
        ...(normalized.currentTrack
          ? {
              currentTrack: normalized.currentTrack,
              isPlaying: normalized.isPlaying,
              duration:
                normalized.currentTrack.duration_seconds || get().duration || 0,
            }
          : {}),
      });
      return;
    }

    const prevJam = get().jamState;
    const wasActive = prevJam.active;
    const wasGuest = wasActive && prevJam.role === "guest";
    set({
      jamState: normalized,
      ...(wasActive ? { repeat: "off", isFetchingRadio: false } : {}),
      ...(wasGuest
        ? {
            isPlaying: false,
            isBuffering: false,
            currentTrack: null,
            queue: [],
            originalQueue: [],
            queueIndex: -1,
            currentTime: 0,
            duration: 0,
            playbackError: null,
          }
        : {}),
    });
  },

  startJamSession: async (deviceName) => {
    if (get().isJamBusy) return;
    set({ isJamBusy: true, eightDEnabled: false, srEnabled: false });
    syncNativeAudioEffects(false, false);
    try {
      const next = await jamCreateApi(deviceName);
      get().setJamState(next);
      get().showToast(`Jam started • Code ${next.jamCode}`);
    } catch (err) {
      get().showToast(
        err instanceof Error ? err.message : "Failed to start BLE Jam"
      );
      throw err;
    } finally {
      set({ isJamBusy: false });
    }
  },

  joinJamSession: async (code, deviceName) => {
    if (get().isJamBusy) return;
    set({ isJamBusy: true, eightDEnabled: false, srEnabled: false });
    syncNativeAudioEffects(false, false);
    try {
      const next = await jamJoinApi({ code, deviceName });
      get().setJamState(next);
      get().showToast(`Joined Jam ${next.jamCode}`);
    } catch (err) {
      get().showToast(
        err instanceof Error ? err.message : "Failed to join BLE Jam"
      );
      throw err;
    } finally {
      set({ isJamBusy: false });
    }
  },

  leaveJamSession: async () => {
    try {
      await jamLeaveApi();
    } finally {
      get().setJamState(EMPTY_JAM_STATE);
      get().showToast("Left Jam session");
    }
  },

  addTrackToJamSession: async (track) => {
    const state = get();
    if (!state.jamState.active) {
      state.showToast("Start or join a Jam first");
      return;
    }
    try {
      await jamAddTrackApi(track, state.jamState.localDeviceName || undefined);
      state.showToast(`Added "${track.title}" to Jam queue`);
    } catch (err) {
      state.showToast(
        err instanceof Error ? err.message : "Failed to add track to Jam"
      );
    }
  },

  setJamSpeakerDevices: async (deviceIds) => {
    try {
      await jamSetSpeakersApi(deviceIds);
    } catch (err) {
      get().showToast(
        err instanceof Error ? err.message : "Failed to update speakers"
      );
    }
  },

  setJamMultiSpeakerMode: async (enabled) => {
    try {
      await jamSetMultiSpeakerModeApi(enabled);
    } catch (err) {
      get().showToast(
        err instanceof Error ? err.message : "Failed to update Multi-Speaker Mode"
      );
    }
  },

  toggleAutoplayRadio: () => {
    if (get().jamState.active) {
      get().showToast("Autoplay Radio is disabled during a Jam");
      return;
    }
    const nextEnabled = !get().autoplayRadio;
    set({ autoplayRadio: nextEnabled });
    const { currentTrack, queue, queueIndex, repeat } = get();
    if (
      nextEnabled &&
      currentTrack &&
      repeat === "off" &&
      queueIndex >= queue.length - 1
    ) {
      void get().fetchAndAppendRadio(currentTrack.video_id, false);
    }
    get().showToast(
      nextEnabled ? "Autoplay Radio enabled" : "Autoplay Radio paused"
    );
  },

  toggleEightD: () => {
    const state = get();
    if (state.jamState.active) {
      state.showToast("Audio effects are disabled during a Jam");
      return;
    }
    const next = !state.eightDEnabled;
    set({ eightDEnabled: next });
    syncNativeAudioEffects(next, state.srEnabled);
    state.showToast(next ? "8D Spatial Audio ON" : "8D Spatial Audio OFF");
  },

  toggleSlowedReverb: () => {
    const state = get();
    if (state.jamState.active) {
      state.showToast("Audio effects are disabled during a Jam");
      return;
    }
    const next = !state.srEnabled;
    set({ srEnabled: next });
    syncNativeAudioEffects(state.eightDEnabled, next);
    state.showToast(next ? "Slowed + Reverb ON" : "Slowed + Reverb OFF");
  },

  fetchAndAppendRadio: async (seedVideoId, replaceUpcoming) => {
    if (get().jamState.active) {
      return [];
    }
    const myNonce = ++radioRequestNonce;
    set({ isFetchingRadio: true, radioSeedVideoId: seedVideoId });

    try {
      const tracks = await api.fetchRadioQueue(seedVideoId, 20);
      if (myNonce !== radioRequestNonce) {
        return [];
      }

      const latest = get();
      if (replaceUpcoming && latest.currentTrack?.video_id !== seedVideoId) {
        set({ isFetchingRadio: false });
        return [];
      }

      const keptPrefix = replaceUpcoming
        ? latest.queue.slice(0, Math.max(0, latest.queueIndex) + 1)
        : latest.queue;

      const existingIds = new Set(keptPrefix.map((t) => t.video_id));
      const freshTracks = tracks.filter((t) => {
        if (existingIds.has(t.video_id)) return false;
        existingIds.add(t.video_id);
        return true;
      });

      if (replaceUpcoming) {
        set({
          queue: [...keptPrefix, ...freshTracks],
          originalQueue: [...keptPrefix, ...freshTracks],
          isFetchingRadio: false,
          prefetchedVideoId: null,
        });
      } else {
        set({
          queue: [...latest.queue, ...freshTracks],
          originalQueue: [...latest.originalQueue, ...freshTracks],
          isFetchingRadio: false,
        });
      }
      return freshTracks;
    } catch {
      if (myNonce === radioRequestNonce) {
        set({ isFetchingRadio: false });
      }
      return [];
    }
  },

  playTrack: (track, contextQueue) => {
    const state = get();
    if (state.activeView.type === "search") {
      state.addRecentSearchTrack(track);
    }

    // When a BLE Jam is active, route track clicks into the Jam queue and suppress solo/radio playback
    if (state.jamState.active) {
      const jamQueue = state.jamState.jamQueue;
      const existingIdx = jamQueue.findIndex((t) => t.video_id === track.video_id);
      if (state.jamState.role === "host" && existingIdx >= 0) {
        if (state.currentTrack?.video_id === track.video_id && !contextQueue) {
          set({ isPlaying: !state.isPlaying, playbackError: null });
          return;
        }
        const selected = jamQueue[existingIdx];
        set({
          currentTrack: selected,
          originalQueue: jamQueue,
          queue: jamQueue,
          queueIndex: existingIdx,
          isPlaying: true,
          isBuffering: true,
          currentTime: 0,
          duration: selected.duration_seconds || 0,
          prefetchedVideoId: null,
          playbackError: null,
          repeat: "all",
        });
        void jamPlayTrackApi(selected.video_id);
        return;
      }

      void state.addTrackToJamSession(track);
      return;
    }

    // If clicking the exact currently active track without a different queue override, toggle play/pause
    if (
      state.currentTrack?.video_id === track.video_id &&
      !contextQueue
    ) {
      set({ isPlaying: !state.isPlaying, playbackError: null });
      return;
    }

    let nextOriginalQueue = state.originalQueue;
    let nextQueue = state.queue;
    let nextIndex = state.queueIndex;
    let shouldFetchRadioReplace = false;
    let shouldFetchRadioExtend = false;

    if (contextQueue && contextQueue.length > 0) {
      const hasTrack = contextQueue.some((t) => t.video_id === track.video_id);
      const baseList = hasTrack ? contextQueue : [track, ...contextQueue];
      nextOriginalQueue = baseList;
      if (state.shuffle) {
        nextQueue = shuffleKeepingFirst(baseList, track);
        nextIndex = 0;
      } else {
        nextQueue = baseList;
        nextIndex = baseList.findIndex((t) => t.video_id === track.video_id);
      }

      if (
        state.repeat === "off" &&
        state.autoplayRadio &&
        nextIndex === nextQueue.length - 1
      ) {
        shouldFetchRadioExtend = true;
      }
    } else {
      // Seed playback from Search: play clicked track immediately, clear remaining queue, & trigger Vibe Radio
      nextOriginalQueue = [track];
      nextQueue = [track];
      nextIndex = 0;
      shouldFetchRadioReplace = state.autoplayRadio;
    }

    set({
      currentTrack: track,
      originalQueue: nextOriginalQueue,
      queue: nextQueue,
      queueIndex: nextIndex,
      isPlaying: true,
      isBuffering: true,
      currentTime: 0,
      duration: track.duration_seconds || 0,
      prefetchedVideoId: null,
      playbackError: null,
    });

    if (shouldFetchRadioReplace) {
      void get().fetchAndAppendRadio(track.video_id, true);
    } else if (shouldFetchRadioExtend) {
      void get().fetchAndAppendRadio(track.video_id, false);
    }
  },

  syncTrackFromNative: (track) => {
    const state = get();
    if (state.jamState.active) {
      const baseQueue =
        state.jamState.jamQueue.length > 0 ? state.jamState.jamQueue : state.queue;
      const matchIndex = baseQueue.findIndex((t) => t.video_id === track.video_id);
      const resolvedTrack = matchIndex >= 0 ? baseQueue[matchIndex] : track;
      const nextQueue = matchIndex >= 0 ? baseQueue : [...baseQueue, track];
      const nextIndex = matchIndex >= 0 ? matchIndex : nextQueue.length - 1;

      set({
        currentTrack: resolvedTrack,
        queue: nextQueue,
        originalQueue: nextQueue,
        queueIndex: nextIndex,
        currentTime: 0,
        duration: resolvedTrack.duration_seconds || track.duration_seconds || 0,
        prefetchedVideoId: null,
        playbackError: null,
      });
      return;
    }

    const matchIndex = state.queue.findIndex((t) => t.video_id === track.video_id);
    const resolvedTrack = matchIndex >= 0 ? state.queue[matchIndex] : track;
    const nextQueue =
      matchIndex >= 0
        ? state.queue
        : state.queue.length > 0
          ? [...state.queue, track]
          : [track];
    const nextIndex = matchIndex >= 0 ? matchIndex : nextQueue.length - 1;

    set({
      currentTrack: resolvedTrack,
      queue: nextQueue,
      queueIndex: nextIndex,
      currentTime: 0,
      duration: resolvedTrack.duration_seconds || track.duration_seconds || 0,
      prefetchedVideoId: null,
      playbackError: null,
    });

    if (
      state.repeat === "off" &&
      state.autoplayRadio &&
      nextIndex === nextQueue.length - 1
    ) {
      void get().fetchAndAppendRadio(resolvedTrack.video_id, false);
    }
  },

  togglePlay: () => {
    const { currentTrack, isPlaying } = get();
    if (!currentTrack) return;
    set({ isPlaying: !isPlaying });
  },

  setIsPlaying: (playing) => set({ isPlaying: playing }),
  setIsBuffering: (buffering) => set({ isBuffering: buffering }),

  setTimeProgress: (currentTime, duration) => {
    const prev = get();
    const nextDuration =
      duration !== undefined && !Number.isNaN(duration) && duration > 0
        ? duration
        : prev.duration;
    const isResetToZero = currentTime === 0 && prev.currentTime > 0;
    if (
      !isResetToZero &&
      Math.abs(currentTime - prev.currentTime) < 0.05 &&
      Math.abs(nextDuration - prev.duration) < 0.05
    ) {
      return;
    }
    set({
      currentTime,
      duration: nextDuration,
    });
  },

  seekTo: (seconds) => {
    const clamped = Math.max(0, seconds);
    set((prev) => ({
      currentTime: clamped,
      seekRequest: {
        seconds: clamped,
        nonce: (prev.seekRequest?.nonce ?? 0) + 1,
      },
    }));
  },

  playNextTrack: async (fromEnded = false) => {
    const {
      queue,
      queueIndex,
      repeat,
      seekTo,
      autoplayRadio,
      currentTrack,
      jamState,
    } = get();
    if (queue.length === 0) return;

    if (jamState.active) {
      if (jamState.role === "guest") {
        if (!fromEnded) {
          get().showToast("Host controls track skipping in a Jam");
        }
        return;
      }
      const nextIdx = (Math.max(0, queueIndex) + 1) % queue.length;
      const nextTrack = queue[nextIdx];
      set({
        currentTrack: nextTrack,
        queueIndex: nextIdx,
        isPlaying: true,
        isBuffering: true,
        currentTime: 0,
        duration: nextTrack.duration_seconds || 0,
        prefetchedVideoId: null,
        playbackError: null,
      });
      void jamPlayTrackApi(nextTrack.video_id);
      return;
    }

    if (fromEnded && repeat === "one") {
      seekTo(0);
      set({ isPlaying: true });
      return;
    }

    const nextIdx = queueIndex + 1;
    if (nextIdx < queue.length) {
      const nextTrack = queue[nextIdx];
      set({
        currentTrack: nextTrack,
        queueIndex: nextIdx,
        isPlaying: true,
        isBuffering: true,
        currentTime: 0,
        duration: nextTrack.duration_seconds || 0,
        prefetchedVideoId: null,
        playbackError: null,
      });

      if (
        nextIdx === queue.length - 1 &&
        repeat === "off" &&
        autoplayRadio
      ) {
        void get().fetchAndAppendRadio(nextTrack.video_id, false);
      }
      return;
    }

    if (repeat === "all") {
      const firstTrack = queue[0];
      set({
        currentTrack: firstTrack,
        queueIndex: 0,
        isPlaying: true,
        isBuffering: true,
        currentTime: 0,
        duration: firstTrack.duration_seconds || 0,
        prefetchedVideoId: null,
        playbackError: null,
      });
      return;
    }

    if (repeat === "off" && autoplayRadio && currentTrack) {
      const added = await get().fetchAndAppendRadio(
        currentTrack.video_id,
        false
      );
      const updated = get();
      if (added.length > 0 && updated.queue.length > nextIdx) {
        const radioTrack = updated.queue[nextIdx];
        set({
          currentTrack: radioTrack,
          queueIndex: nextIdx,
          isPlaying: true,
          isBuffering: true,
          currentTime: 0,
          duration: radioTrack.duration_seconds || 0,
          prefetchedVideoId: null,
          playbackError: null,
        });
        return;
      }
    }

    set({ isPlaying: false });
  },

  playPreviousTrack: () => {
    const { currentTime, queue, queueIndex, repeat, seekTo, jamState } = get();
    if (queue.length === 0) return;

    if (jamState.active) {
      if (jamState.role === "guest") {
        get().showToast("Host controls track skipping in a Jam");
        return;
      }
      if (currentTime > 3) {
        seekTo(0);
        return;
      }
      const prevIdx = (Math.max(0, queueIndex) - 1 + queue.length) % queue.length;
      const prevTrack = queue[prevIdx];
      set({
        currentTrack: prevTrack,
        queueIndex: prevIdx,
        isPlaying: true,
        isBuffering: true,
        currentTime: 0,
        duration: prevTrack.duration_seconds || 0,
        prefetchedVideoId: null,
        playbackError: null,
      });
      void jamPlayTrackApi(prevTrack.video_id);
      return;
    }

    if (currentTime > 3) {
      seekTo(0);
      return;
    }

    const prevIdx = queueIndex - 1;
    if (prevIdx >= 0) {
      const prevTrack = queue[prevIdx];
      set({
        currentTrack: prevTrack,
        queueIndex: prevIdx,
        isPlaying: true,
        isBuffering: true,
        currentTime: 0,
        duration: prevTrack.duration_seconds || 0,
        prefetchedVideoId: null,
        playbackError: null,
      });
      return;
    }

    if (repeat === "all") {
      const lastIdx = queue.length - 1;
      const lastTrack = queue[lastIdx];
      set({
        currentTrack: lastTrack,
        queueIndex: lastIdx,
        isPlaying: true,
        isBuffering: true,
        currentTime: 0,
        duration: lastTrack.duration_seconds || 0,
        prefetchedVideoId: null,
        playbackError: null,
      });
      return;
    }

    seekTo(0);
  },

  playNextInQueue: (track) => {
    const state = get();
    if (state.jamState.active) {
      void state.addTrackToJamSession(track);
      return;
    }
    if (!state.currentTrack || state.queue.length === 0) {
      state.playTrack(track, [track]);
      state.showToast(`Playing "${track.title}"`);
      return;
    }

    const insertAt = Math.max(0, state.queueIndex + 1);
    const beforeQueue = state.queue.slice(0, insertAt);
    const afterQueue = state.queue
      .slice(insertAt)
      .filter((t) => t.video_id !== track.video_id);
    const updatedQueue = [...beforeQueue, track, ...afterQueue];

    const origIdx = state.originalQueue.findIndex(
      (t) => t.video_id === state.currentTrack?.video_id
    );
    const origInsertAt = origIdx >= 0 ? origIdx + 1 : state.originalQueue.length;
    const beforeOrig = state.originalQueue.slice(0, origInsertAt);
    const afterOrig = state.originalQueue
      .slice(origInsertAt)
      .filter((t) => t.video_id !== track.video_id);
    const updatedOriginal = [...beforeOrig, track, ...afterOrig];

    set({
      queue: updatedQueue,
      originalQueue: updatedOriginal,
      prefetchedVideoId: null,
    });
    state.showToast(`"${track.title}" will play next`);
  },

  addToQueue: (track) => {
    get().playNextInQueue(track);
  },

  addTracksToQueue: async (tracks) => {
    if (!tracks || tracks.length === 0) {
      get().showToast("No songs to add");
      return;
    }
    const state = get();
    const count = tracks.length;
    const noun = count === 1 ? "song" : "songs";

    if (state.jamState.active) {
      const localName = state.jamState.localDeviceName || undefined;
      for (const track of tracks) {
        try {
          await jamAddTrackApi(track, localName);
        } catch {
          // ignore individual track errors in bulk add
        }
      }
      state.showToast(`Added ${count} ${noun} to Jam`);
      return;
    }

    if (!state.currentTrack || state.queue.length === 0) {
      state.playTrack(tracks[0], tracks);
      state.showToast(`Added ${count} ${noun} to queue`);
      return;
    }

    set({
      queue: [...state.queue, ...tracks],
      originalQueue: [...state.originalQueue, ...tracks],
    });
    state.showToast(`Added ${count} ${noun} to queue`);
  },

  removeFromQueue: (index) => {
    const state = get();
    if (index < 0 || index >= state.queue.length || index === state.queueIndex) {
      return;
    }
    const updated = state.queue.filter((_, i) => i !== index);
    const nextIndex = index < state.queueIndex ? state.queueIndex - 1 : state.queueIndex;
    set({
      queue: updated,
      queueIndex: nextIndex,
      prefetchedVideoId: null,
    });
  },

  clearUpcomingQueue: () => {
    const { currentTrack, queue, queueIndex } = get();
    if (!currentTrack || queueIndex < 0) return;
    const trimmed = [queue[queueIndex]];
    set({
      queue: trimmed,
      originalQueue: trimmed,
      queueIndex: 0,
      prefetchedVideoId: null,
    });
  },

  toggleShuffle: () => {
    const { shuffle, currentTrack, queue, originalQueue } = get();
    const nextShuffle = !shuffle;
    if (queue.length <= 1 || !currentTrack) {
      set({ shuffle: nextShuffle });
      return;
    }

    if (nextShuffle) {
      const shuffled = shuffleKeepingFirst(originalQueue.length ? originalQueue : queue, currentTrack);
      set({
        shuffle: true,
        queue: shuffled,
        queueIndex: 0,
        prefetchedVideoId: null,
      });
    } else {
      const restored = originalQueue.length ? originalQueue : queue;
      const newIdx = Math.max(
        0,
        restored.findIndex((t) => t.video_id === currentTrack.video_id)
      );
      set({
        shuffle: false,
        queue: restored,
        queueIndex: newIdx,
        prefetchedVideoId: null,
      });
    }
  },

  cycleRepeat: () => {
    const { repeat } = get();
    const order: RepeatMode[] = ["off", "all", "one"];
    const next = order[(order.indexOf(repeat) + 1) % order.length];
    set({ repeat: next });
  },

  setVolume: (vol) => {
    const clamped = Math.min(1, Math.max(0, vol));
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(clamped));
    } catch {
      // ignore storage errors
    }
    set({ volume: clamped, isMuted: clamped === 0 });
  },

  toggleMute: () => {
    const { isMuted, volume } = get();
    if (isMuted && volume === 0) {
      set({ isMuted: false, volume: 0.7 });
      return;
    }
    set({ isMuted: !isMuted });
  },

  setPrefetchedVideoId: (videoId) => set({ prefetchedVideoId: videoId }),
  setStreamStats: (stats) => set({ streamStats: stats }),
  setPlaybackError: (err) => set({ playbackError: err }),

  navigate: (view) => {
    const { activeView, history, historyIndex, loadPlaylistDetail } = get();
    if (view.type === "downloads" || view.type === "library") {
      void get().syncOfflineDownloads();
    }
    if (viewsEqual(activeView, view)) {
      if (view.type === "playlist") {
        void loadPlaylistDetail(view.playlistId);
      }
      return;
    }
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push(view);
    set({
      activeView: view,
      history: nextHistory,
      historyIndex: nextHistory.length - 1,
    });
    if (view.type === "playlist") {
      void loadPlaylistDetail(view.playlistId);
    }
  },

  goBack: () => {
    const { history, historyIndex, loadPlaylistDetail } = get();
    if (historyIndex <= 0) return;
    const nextIdx = historyIndex - 1;
    const view = history[nextIdx];
    set({ activeView: view, historyIndex: nextIdx });
    if (view.type === "playlist") {
      void loadPlaylistDetail(view.playlistId);
    }
  },

  goForward: () => {
    const { history, historyIndex, loadPlaylistDetail } = get();
    if (historyIndex >= history.length - 1) return;
    const nextIdx = historyIndex + 1;
    const view = history[nextIdx];
    set({ activeView: view, historyIndex: nextIdx });
    if (view.type === "playlist") {
      void loadPlaylistDetail(view.playlistId);
    }
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  runSearch: async (q) => {
    const trimmed = q.trim();
    if (!trimmed) {
      set({ searchResults: null, isSearching: false, searchError: null });
      return;
    }
    set({ isSearching: true, searchError: null });
    try {
      const results = await api.searchTracks(trimmed);
      // Ensure response corresponds to latest query if user typed fast
      if (get().searchQuery.trim() === trimmed || trimmed.length > 0) {
        set({ searchResults: results, isSearching: false });
      }
    } catch (err) {
      set({
        isSearching: false,
        searchError: err instanceof Error ? err.message : "Search failed",
      });
    }
  },

  addRecentSearchTrack: (track) => {
    if (!track.video_id) return;
    const deduped = [
      track,
      ...get().recentSearches.filter((t) => t.video_id !== track.video_id),
    ].slice(0, MAX_RECENT_SEARCHES);
    persistRecentSearches(deduped);
    set({ recentSearches: deduped });
  },

  removeRecentSearchTrack: (videoId) => {
    const updated = get().recentSearches.filter((t) => t.video_id !== videoId);
    persistRecentSearches(updated);
    set({ recentSearches: updated });
  },

  clearRecentSearches: () => {
    persistRecentSearches([]);
    set({ recentSearches: [] });
  },

  syncOfflineDownloads: async () => {
    try {
      const syncedTracks = await api.syncOfflineDownloads();
      const downloadedIds: Record<string, boolean> = {};
      for (const song of syncedTracks) {
        downloadedIds[song.video_id] = true;
      }
      set({ downloadedTracks: syncedTracks, downloadedIds });
    } catch {
      // ignore offline scan failure
    }
  },

  fetchLibrary: async () => {
    try {
      const [playlists, likedSongs, downloadedTracks] = await Promise.all([
        api.fetchPlaylists(),
        api.fetchLikedSongs(),
        api.getDownloadedTracks(),
      ]);
      const likedIds: Record<string, boolean> = {};
      for (const song of likedSongs) {
        likedIds[song.video_id] = true;
      }
      const downloadedIds: Record<string, boolean> = {};
      for (const song of downloadedTracks) {
        downloadedIds[song.video_id] = true;
      }
      set({ playlists, likedSongs, likedIds, downloadedTracks, downloadedIds });
      void get().syncOfflineDownloads();
    } catch {
      // silent background fetch fallback
    }
  },

  loadPlaylistDetail: async (playlistId) => {
    try {
      const detail = await api.fetchPlaylistDetail(playlistId);
      set({ activePlaylist: detail });
    } catch (err) {
      get().showToast(
        err instanceof Error ? err.message : "Failed to load playlist"
      );
    }
  },

  toggleLike: async (track) => {
    const state = get();
    const currentlyLiked = Boolean(state.likedIds[track.video_id]);
    // Optimistic update
    const nextLikedIds = { ...state.likedIds };
    let nextLikedSongs = [...state.likedSongs];
    if (currentlyLiked) {
      delete nextLikedIds[track.video_id];
      nextLikedSongs = nextLikedSongs.filter((t) => t.video_id !== track.video_id);
    } else {
      nextLikedIds[track.video_id] = true;
      nextLikedSongs = [track, ...nextLikedSongs];
    }
    set({ likedIds: nextLikedIds, likedSongs: nextLikedSongs });

    try {
      const res = await api.toggleLikeTrack(track);
      state.showToast(
        res.liked ? "Added to Liked Songs" : "Removed from Liked Songs"
      );
      const freshLikes = await api.fetchLikedSongs();
      const syncedIds: Record<string, boolean> = {};
      for (const s of freshLikes) syncedIds[s.video_id] = true;
      set({ likedSongs: freshLikes, likedIds: syncedIds });
    } catch {
      // revert on error
      set({ likedIds: state.likedIds, likedSongs: state.likedSongs });
      state.showToast("Failed to update Liked Songs");
    }
  },

  downloadTrack: async (track) => {
    const vid = track.video_id;
    if (!vid || get().downloadingIds[vid]) return;

    set((prev) => ({
      downloadingIds: { ...prev.downloadingIds, [vid]: true },
    }));

    try {
      await api.downloadTrack(track);
      const freshDownloads = await api.getDownloadedTracks();
      const syncedIds: Record<string, boolean> = {};
      for (const s of freshDownloads) {
        syncedIds[s.video_id] = true;
      }
      set({
        downloadedTracks: freshDownloads,
        downloadedIds: syncedIds,
      });
      get().showToast(`Saved "${track.title}" offline`);
    } catch (err) {
      get().showToast(
        err instanceof Error ? err.message : "Failed to download track"
      );
    } finally {
      set((prev) => {
        const nextDownloading = { ...prev.downloadingIds };
        delete nextDownloading[vid];
        return { downloadingIds: nextDownloading };
      });
    }
  },

  removeDownload: async (videoId) => {
    if (!videoId || get().downloadingIds[videoId]) return;
    try {
      await api.removeDownload(videoId);
      const freshDownloads = await api.getDownloadedTracks();
      const syncedIds: Record<string, boolean> = {};
      for (const s of freshDownloads) {
        syncedIds[s.video_id] = true;
      }
      set({
        downloadedTracks: freshDownloads,
        downloadedIds: syncedIds,
      });
      get().showToast("Removed from Downloads");
    } catch {
      get().showToast("Failed to remove download");
    }
  },

  toggleDownload: async (track) => {
    const vid = track.video_id;
    if (!vid || get().downloadingIds[vid]) return;
    if (get().downloadedIds[vid]) {
      await get().removeDownload(vid);
    } else {
      await get().downloadTrack(track);
    }
  },

  openDownloadsFolder: async () => {
    try {
      await api.openDownloadsFolder();
    } catch (err) {
      get().showToast(
        err instanceof Error ? err.message : "Unable to open Music/Xone folder"
      );
    }
  },

  createPlaylist: async (name, description, coverColor) => {
    const created = await api.createPlaylist(name, description, coverColor);
    const playlists = await api.fetchPlaylists();
    set({
      playlists,
      activePlaylist: created,
    });
    get().navigate({ type: "playlist", playlistId: created.id });
    get().showToast(`Created playlist "${created.name}"`);
    return created;
  },

  deletePlaylist: async (playlistId) => {
    await api.deletePlaylist(playlistId);
    const playlists = await api.fetchPlaylists();
    const { activeView, navigate } = get();
    set({
      playlists,
      activePlaylist:
        get().activePlaylist?.id === playlistId ? null : get().activePlaylist,
    });
    if (activeView.type === "playlist" && activeView.playlistId === playlistId) {
      navigate({ type: "home" });
    }
    get().showToast("Playlist deleted");
  },

  addTrackToPlaylist: async (playlistId, track) => {
    const res = await api.addTrackToPlaylist(playlistId, track);
    const playlists = await api.fetchPlaylists();
    set((prev) => ({
      playlists,
      activePlaylist:
        prev.activePlaylist?.id === playlistId ? res.playlist : prev.activePlaylist,
    }));
    get().showToast(
      res.already_exists
        ? `Already in "${res.playlist.name}"`
        : `Added to "${res.playlist.name}"`
    );
  },

  removeTrackFromPlaylist: async (playlistId, videoId) => {
    const res = await api.removeTrackFromPlaylist(playlistId, videoId);
    const playlists = await api.fetchPlaylists();
    set((prev) => ({
      playlists,
      activePlaylist:
        prev.activePlaylist?.id === playlistId ? res.playlist : prev.activePlaylist,
    }));
    get().showToast("Removed from playlist");
  },

  reorderPlaylistTracks: async (playlistId, fromIndex, toIndex) => {
    const { activePlaylist } = get();
    if (
      !activePlaylist ||
      activePlaylist.id !== playlistId ||
      !activePlaylist.tracks ||
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= activePlaylist.tracks.length ||
      toIndex >= activePlaylist.tracks.length
    ) {
      return;
    }

    const updatedTracks = [...activePlaylist.tracks];
    const [moved] = updatedTracks.splice(fromIndex, 1);
    updatedTracks.splice(toIndex, 0, moved);

    // Optimistic UI update
    set({
      activePlaylist: {
        ...activePlaylist,
        tracks: updatedTracks,
        thumbnails: updatedTracks
          .map((t) => t.thumbnail)
          .filter(Boolean)
          .slice(0, 4),
      },
    });

    try {
      const persisted = await api.reorderPlaylistTracks(
        playlistId,
        updatedTracks.map((t) => t.video_id)
      );
      const playlists = await api.fetchPlaylists();
      set({ activePlaylist: persisted, playlists });
    } catch {
      // Reload canonical order on failure
      await get().loadPlaylistDetail(playlistId);
      get().showToast("Failed to reorder playlist");
    }
  },
}));
