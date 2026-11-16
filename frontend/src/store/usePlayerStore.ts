import { create } from "zustand";
import * as api from "../services/musicApi";
import type { ActiveView, Playlist, RepeatMode, SearchResponse, Track } from "../types";

const VOLUME_STORAGE_KEY = "xone_volume";

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

  // Navigation & Search
  activeView: ActiveView;
  history: ActiveView[];
  historyIndex: number;
  searchQuery: string;
  searchResults: SearchResponse | null;
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
  fetchAndAppendRadio: (seedVideoId: string, replaceUpcoming: boolean) => Promise<Track[]>;
  syncTrackFromNative: (track: Track) => void;

  // Navigation & Search Actions
  navigate: (view: ActiveView) => void;
  goBack: () => void;
  goForward: () => void;
  setSearchQuery: (q: string) => void;
  runSearch: (q: string) => Promise<void>;

  // Library Actions
  fetchLibrary: () => Promise<void>;
  loadPlaylistDetail: (playlistId: number) => Promise<void>;
  toggleLike: (track: Track) => Promise<void>;
  downloadTrack: (track: Track) => Promise<void>;
  removeDownload: (videoId: string) => Promise<void>;
  toggleDownload: (track: Track) => Promise<void>;
  createPlaylist: (name: string, description: string, coverColor: string) => Promise<Playlist>;
  deletePlaylist: (playlistId: number) => Promise<void>;
  addTrackToPlaylist: (playlistId: number, track: Track) => Promise<void>;
  removeTrackFromPlaylist: (playlistId: number, videoId: string) => Promise<void>;
  reorderPlaylistTracks: (playlistId: number, fromIndex: number, toIndex: number) => Promise<void>;

  // UI Helpers
  setNewPlaylistModalOpen: (open: boolean) => void;
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

  activeView: { type: "home" },
  history: [{ type: "home" }],
  historyIndex: 0,
  searchQuery: "",
  searchResults: null,
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

  toggleAutoplayRadio: () => {
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

  fetchAndAppendRadio: async (seedVideoId, replaceUpcoming) => {
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
    const matchIndex = state.queue.findIndex((t) => t.video_id === track.video_id);
    const resolvedTrack = matchIndex >= 0 ? state.queue[matchIndex] : track;
    const nextQueue = matchIndex >= 0 ? state.queue : [track];
    const nextIndex = matchIndex >= 0 ? matchIndex : 0;

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
    set((prev) => ({
      currentTime,
      duration:
        duration !== undefined && !Number.isNaN(duration) && duration > 0
          ? duration
          : prev.duration,
    }));
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
    const { queue, queueIndex, repeat, seekTo, autoplayRadio, currentTrack } =
      get();
    if (queue.length === 0) return;

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
    const { currentTime, queue, queueIndex, repeat, seekTo } = get();
    if (queue.length === 0) return;

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
    if (!state.currentTrack || state.queue.length === 0) {
      state.playTrack(track, [track]);
      state.showToast(`Playing "${track.title}"`);
      return;
    }

    const insertAt = Math.max(0, state.queueIndex + 1);
    const updatedQueue = [...state.queue];
    updatedQueue.splice(insertAt, 0, track);

    const updatedOriginal = [...state.originalQueue];
    const origIdx = state.originalQueue.findIndex(
      (t) => t.video_id === state.currentTrack?.video_id
    );
    updatedOriginal.splice(origIdx >= 0 ? origIdx + 1 : updatedOriginal.length, 0, track);

    set({
      queue: updatedQueue,
      originalQueue: updatedOriginal,
      prefetchedVideoId: null,
    });
    state.showToast(`"${track.title}" will play next`);
  },

  addToQueue: (track) => {
    const state = get();
    if (!state.currentTrack || state.queue.length === 0) {
      state.playTrack(track, [track]);
      state.showToast(`Playing "${track.title}"`);
      return;
    }

    set({
      queue: [...state.queue, track],
      originalQueue: [...state.originalQueue, track],
    });
    state.showToast(`Added "${track.title}" to queue`);
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
