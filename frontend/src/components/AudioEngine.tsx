import React, { useEffect, useRef } from "react";
import { toNativeTrackPayload, XoneAudio } from "../plugins/xoneAudio";
import { fetchStreamInfo, isNativePlatform } from "../services/musicApi";
import { usePlayerStore } from "../store/usePlayerStore";

const NativeAudioController: React.FC = () => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const repeat = usePlayerStore((s) => s.repeat);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const seekRequest = usePlayerStore((s) => s.seekRequest);
  const jamActive = usePlayerStore((s) => s.jamState.active);
  const jamRole = usePlayerStore((s) => s.jamState.role);
  const jamActiveSpeakers = usePlayerStore((s) => s.jamState.activeSpeakers);
  const jamLocalDeviceId = usePlayerStore((s) => s.jamState.localDeviceId);

  const pendingTrackRef = useRef<{ videoId: string; untilMs: number } | null>(null);
  const pendingPlayIntentRef = useRef<{ target: boolean; untilMs: number } | null>(null);
  const skipNextPlayCallForRef = useRef<string | null>(null);
  const suppressNextToggleForRef = useRef<boolean | null>(null);
  const handledEndedTrackRef = useRef<string | null>(null);

  // Subscribe to native MediaController playbackState updates
  useEffect(() => {
    let active = true;
    const handlePromise = XoneAudio.addListener("playbackState", (event) => {
      if (!active) return;
      const store = usePlayerStore.getState();
      const now = Date.now();
      const eventVideoId = event.currentTrack?.video_id ?? null;

      // Guard against stale snapshots while UI track switch is propagating to MediaController
      if (pendingTrackRef.current) {
        if (eventVideoId === pendingTrackRef.current.videoId) {
          pendingTrackRef.current = null;
        } else if (now < pendingTrackRef.current.untilMs) {
          return;
        } else {
          pendingTrackRef.current = null;
        }
      }

      // Sync track change initiated natively (notification / lock screen / gapless queue advance)
      if (
        event.currentTrack &&
        event.currentTrack.video_id &&
        event.currentTrack.video_id !== store.currentTrack?.video_id
      ) {
        skipNextPlayCallForRef.current = event.currentTrack.video_id;
        handledEndedTrackRef.current = null;
        store.syncTrackFromNative(event.currentTrack);
      }

      // Sync time and buffering state
      store.setTimeProgress(
        Number.isFinite(event.currentTime) ? event.currentTime : 0,
        Number.isFinite(event.duration) && event.duration > 0
          ? event.duration
          : undefined
      );
      store.setIsBuffering(Boolean(event.isBuffering));

      // Guard against stale play/pause snapshots while UI intent propagates
      if (pendingPlayIntentRef.current) {
        if (event.isPlaying === pendingPlayIntentRef.current.target) {
          pendingPlayIntentRef.current = null;
        } else if (now >= pendingPlayIntentRef.current.untilMs) {
          pendingPlayIntentRef.current = null;
          if (event.isPlaying !== store.isPlaying) {
            suppressNextToggleForRef.current = event.isPlaying;
            store.setIsPlaying(event.isPlaying);
          }
        }
      } else if (event.isPlaying !== store.isPlaying) {
        suppressNextToggleForRef.current = event.isPlaying;
        store.setIsPlaying(event.isPlaying);
      }

      if (event.error) {
        store.setPlaybackError(event.error);
      }

      if (
        event.ended &&
        store.currentTrack &&
        !store.jamState.active &&
        !store.dashTrack
      ) {
        const endKey = `${store.currentTrack.video_id}:${store.queueIndex}`;
        if (handledEndedTrackRef.current !== endKey) {
          handledEndedTrackRef.current = endKey;
          void store.playNextTrack(true);
        }
      } else if (!event.ended) {
        handledEndedTrackRef.current = null;
      }
    });

    return () => {
      active = false;
      void handlePromise.then((h) => h.remove());
    };
  }, []);

  // Load new track when currentTrack changes from React UI
  useEffect(() => {
    const store = usePlayerStore.getState();
    if (jamActive || store.jamState.active) {
      return;
    }

    if (!currentTrack) {
      pendingTrackRef.current = null;
      void XoneAudio.togglePlayPause({ playing: false }).catch(() => {});
      return;
    }

    handledEndedTrackRef.current = null;

    if (skipNextPlayCallForRef.current === currentTrack.video_id) {
      skipNextPlayCallForRef.current = null;
      return;
    }

    pendingTrackRef.current = {
      videoId: currentTrack.video_id,
      untilMs: Date.now() + 2500,
    };
    pendingPlayIntentRef.current = {
      target: store.isPlaying,
      untilMs: Date.now() + 1500,
    };

    store.setIsBuffering(true);
    store.setPlaybackError(null);

    void XoneAudio.playTrack(toNativeTrackPayload(currentTrack))
      .then((res) => {
        if (usePlayerStore.getState().currentTrack?.video_id !== currentTrack.video_id) {
          return;
        }
        if (res.resolutionMs !== undefined) {
          usePlayerStore.getState().setStreamStats({
            cached: Boolean(res.cached),
            resolutionMs: res.resolutionMs,
          });
        }
      })
      .catch((err) => {
        if (usePlayerStore.getState().currentTrack?.video_id !== currentTrack.video_id) {
          return;
        }
        const s = usePlayerStore.getState();
        s.setIsBuffering(false);
        s.setIsPlaying(false);
        s.setPlaybackError(
          err instanceof Error ? err.message : "Unable to start native playback"
        );
      });
  }, [currentTrack?.video_id, currentTrack?.queueItemId]);

  // Keep native ExoPlayer queue synchronized for gapless background & lock-screen skips
  useEffect(() => {
    if (jamActive || usePlayerStore.getState().jamState.active) {
      return;
    }

    if (!currentTrack || queue.length === 0) return;

    const safeStart =
      queueIndex >= 0 && queueIndex < queue.length
        ? queueIndex
        : Math.max(
            0,
            queue.findIndex((t) => t.video_id === currentTrack.video_id)
          );

    const payload = {
      tracks: queue.map(toNativeTrackPayload),
      startIndex: safeStart,
      repeatMode: repeat,
    };

    void XoneAudio.setQueue(payload).catch(() => {
      // ignore transient controller connection errors
    });
  }, [
    queue,
    queueIndex,
    repeat,
    currentTrack?.video_id,
    jamActive,
  ]);

  // Synchronize play/pause toggles from React UI
  useEffect(() => {
    if (jamActive && jamRole === "guest") return;
    if (!currentTrack) return;
    if (suppressNextToggleForRef.current === isPlaying) {
      suppressNextToggleForRef.current = null;
      return;
    }

    pendingPlayIntentRef.current = {
      target: isPlaying,
      untilMs: Date.now() + 1500,
    };
    void XoneAudio.togglePlayPause({ playing: isPlaying }).catch(() => {});
  }, [isPlaying, currentTrack?.video_id, jamActive, jamRole]);

  // Synchronize seek bar scrubs
  useEffect(() => {
    if (jamActive && jamRole === "guest") return;
    if (!seekRequest || !Number.isFinite(seekRequest.seconds)) return;
    void XoneAudio.seekTo({
      positionMs: Math.max(0, Math.round(seekRequest.seconds * 1000)),
    }).catch(() => {});
  }, [seekRequest, jamActive, jamRole]);

  // Synchronize player volume / mute (respecting BLE Jam speaker toggles)
  useEffect(() => {
    if (jamActive && !jamActiveSpeakers.includes(jamLocalDeviceId)) {
      void XoneAudio.setVolume({ volume: 0 }).catch(() => {});
      return;
    }
    void XoneAudio.setVolume({ volume: isMuted ? 0 : volume }).catch(() => {});
  }, [volume, isMuted, jamActive, jamActiveSpeakers, jamLocalDeviceId]);

  return null;
};

const WebAudioController: React.FC = () => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const standbyRef = useRef<{ videoId: string; audio: HTMLAudioElement } | null>(null);
  const activeLoadIdRef = useRef<number>(0);
  const hasPrefetchedForRef = useRef<string | null>(null);
  const retriedTrackRef = useRef<string | null>(null);
  const pendingSeekAfterRefreshRef = useRef<number | null>(null);

  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const seekRequest = usePlayerStore((s) => s.seekRequest);

  // Keep volume & mute synchronized
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = isMuted ? 0 : volume;
    audio.muted = isMuted;
  }, [volume, isMuted]);

  // Handle explicit seek requests from UI or keyboard
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !seekRequest) return;
    if (Number.isFinite(seekRequest.seconds)) {
      try {
        audio.currentTime = seekRequest.seconds;
      } catch {
        // ignore if metadata not yet loaded
      }
    }
  }, [seekRequest]);

  // Load new track stream into primary <audio> when currentTrack changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentTrack) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      return;
    }

    const loadId = ++activeLoadIdRef.current;
    const videoId = currentTrack.video_id;
    hasPrefetchedForRef.current = null;
    retriedTrackRef.current = null;
    pendingSeekAfterRefreshRef.current = null;

    const { setIsBuffering, setStreamStats, setPlaybackError, setIsPlaying } =
      usePlayerStore.getState();

    const startPlayback = async () => {
      setIsBuffering(true);
      setPlaybackError(null);

      // Clear any previous standby instance if it does not match the incoming track
      if (standbyRef.current && standbyRef.current.videoId !== videoId) {
        standbyRef.current.audio.src = "";
        standbyRef.current = null;
      }

      try {
        const info = await fetchStreamInfo(videoId);
        if (activeLoadIdRef.current !== loadId) return;

        setStreamStats({
          cached: info.cached,
          resolutionMs: info.resolution_ms,
        });

        // Release standby ref once handed off to primary player
        if (standbyRef.current?.videoId === videoId) {
          standbyRef.current.audio.src = "";
          standbyRef.current = null;
        }

        audio.src = `/api/proxy/${encodeURIComponent(videoId)}`;
        audio.load();

        if (usePlayerStore.getState().isPlaying) {
          try {
            await audio.play();
          } catch (playErr) {
            if (activeLoadIdRef.current === loadId) {
              if (playErr instanceof DOMException && playErr.name === "NotAllowedError") {
                setIsPlaying(false);
              }
            }
          }
        }
      } catch (err) {
        if (activeLoadIdRef.current !== loadId) return;
        setIsBuffering(false);
        setPlaybackError(
          err instanceof Error ? err.message : "Unable to load audio stream"
        );
      }
    };

    void startPlayback();
  }, [currentTrack?.video_id, currentTrack?.queueItemId]);

  // Sync play/pause toggle on existing loaded track
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack || !audio.src) return;

    if (isPlaying) {
      if (audio.paused) {
        audio.play().catch(() => {
          // handled via audio events
        });
      }
    } else if (!audio.paused) {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  // Media Session API integration (hardware keys, lock screen, Bluetooth controls)
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    if (!currentTrack) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
      return;
    }

    const artworkUrl = currentTrack.thumbnail || "";
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album || "Xone",
      artwork: artworkUrl
        ? [
            { src: artworkUrl, sizes: "96x96", type: "image/jpeg" },
            { src: artworkUrl, sizes: "256x256", type: "image/jpeg" },
            { src: artworkUrl, sizes: "544x544", type: "image/jpeg" },
          ]
        : [],
    });

    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }

    const safeSetHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // unsupported MediaSessionAction in browser
      }
    };

    safeSetHandler("play", () => {
      usePlayerStore.getState().setIsPlaying(true);
    });
    safeSetHandler("pause", () => {
      usePlayerStore.getState().setIsPlaying(false);
    });
    safeSetHandler("previoustrack", () => {
      usePlayerStore.getState().playPreviousTrack();
    });
    safeSetHandler("nexttrack", () => {
      usePlayerStore.getState().playNextTrack(false);
    });
    safeSetHandler("seekbackward", (details) => {
      const offset = details.seekOffset ?? 5;
      const cur = audioRef.current?.currentTime ?? 0;
      usePlayerStore.getState().seekTo(Math.max(0, cur - offset));
    });
    safeSetHandler("seekforward", (details) => {
      const offset = details.seekOffset ?? 5;
      const cur = audioRef.current?.currentTime ?? 0;
      const dur = audioRef.current?.duration ?? usePlayerStore.getState().duration;
      usePlayerStore.getState().seekTo(Math.min(dur || cur + offset, cur + offset));
    });
    safeSetHandler("seekto", (details) => {
      if (details.seekTime !== undefined) {
        usePlayerStore.getState().seekTo(details.seekTime);
      }
    });

    return () => {
      safeSetHandler("play", null);
      safeSetHandler("pause", null);
      safeSetHandler("previoustrack", null);
      safeSetHandler("nexttrack", null);
      safeSetHandler("seekbackward", null);
      safeSetHandler("seekforward", null);
      safeSetHandler("seekto", null);
    };
  }, []);

  // Global keyboard shortcuts (Space, ArrowLeft, ArrowRight, Ctrl/Cmd + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        usePlayerStore.getState().navigate({ type: "search" });
        window.requestAnimationFrame(() => {
          const searchInput = document.getElementById(
            "xone-search-input"
          ) as HTMLInputElement | null;
          searchInput?.focus();
          searchInput?.select();
        });
        return;
      }

      const active = document.activeElement as HTMLElement | null;
      const isTyping =
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT" ||
          active.isContentEditable);
      if (isTyping) return;

      if (e.code === "Space") {
        e.preventDefault();
        usePlayerStore.getState().togglePlay();
      } else if (e.key === "ArrowLeft") {
        const audio = audioRef.current;
        if (!audio || !usePlayerStore.getState().currentTrack) return;
        e.preventDefault();
        usePlayerStore.getState().seekTo(Math.max(0, audio.currentTime - 5));
      } else if (e.key === "ArrowRight") {
        const audio = audioRef.current;
        if (!audio || !usePlayerStore.getState().currentTrack) return;
        e.preventDefault();
        const maxDur = audio.duration || usePlayerStore.getState().duration || 0;
        usePlayerStore
          .getState()
          .seekTo(maxDur > 0 ? Math.min(maxDur, audio.currentTime + 5) : audio.currentTime + 5);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;

    const state = usePlayerStore.getState();
    state.setTimeProgress(audio.currentTime, audio.duration);

    // Smart data-conscious prefetching: ONLY prefetch Track N+1 once Track N passes 15 seconds
    const activeTrack = state.currentTrack;
    if (
      activeTrack &&
      audio.currentTime >= 15 &&
      hasPrefetchedForRef.current !== activeTrack.video_id
    ) {
      hasPrefetchedForRef.current = activeTrack.video_id;

      let nextTrack = null;
      if (state.queueIndex >= 0 && state.queueIndex + 1 < state.queue.length) {
        nextTrack = state.queue[state.queueIndex + 1];
      } else if (state.repeat === "all" && state.queue.length > 0) {
        nextTrack = state.queue[0];
      }

      if (nextTrack && nextTrack.video_id !== activeTrack.video_id) {
        const nextVideoId = nextTrack.video_id;
        void fetchStreamInfo(nextVideoId)
          .then(() => {
            if (standbyRef.current) {
              standbyRef.current.audio.src = "";
            }
            const standby = new Audio(`/api/proxy/${encodeURIComponent(nextVideoId)}`);
            standby.preload = "auto";
            standby.volume = 0;
            standby.load();
            standbyRef.current = { videoId: nextVideoId, audio: standby };
            usePlayerStore.getState().setPrefetchedVideoId(nextVideoId);
          })
          .catch(() => {
            // Do not disrupt active playback if background prefetch fails
          });
      }
    }
  };

  const handleLoadedMetadata = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (pendingSeekAfterRefreshRef.current !== null) {
      try {
        audio.currentTime = pendingSeekAfterRefreshRef.current;
      } catch {
        // ignore seek error
      }
      pendingSeekAfterRefreshRef.current = null;
    }
    usePlayerStore.getState().setTimeProgress(audio.currentTime, audio.duration);
  };

  const handleCanPlay = () => {
    usePlayerStore.getState().setIsBuffering(false);
  };

  const handleWaiting = () => {
    usePlayerStore.getState().setIsBuffering(true);
  };

  const handlePlaying = () => {
    const state = usePlayerStore.getState();
    state.setIsBuffering(false);
    state.setPlaybackError(null);
    if (!state.isPlaying) {
      state.setIsPlaying(true);
    }
  };

  const handleEnded = () => {
    const state = usePlayerStore.getState();
    if (state.dashTrack) return;
    state.playNextTrack(true);
  };

  const handleAudioError = async () => {
    const audio = audioRef.current;
    const state = usePlayerStore.getState();
    const track = state.currentTrack;
    if (!audio || !track || !audio.getAttribute("src")) return;

    // Resilient recovery: invalidate cache & re-extract a fresh stream URL once
    if (retriedTrackRef.current === track.video_id) {
      state.setIsBuffering(false);
      state.setIsPlaying(false);
      state.setPlaybackError("Stream expired or unavailable. Try playing again.");
      return;
    }

    retriedTrackRef.current = track.video_id;
    const resumeAt = audio.currentTime > 1 ? audio.currentTime : 0;
    pendingSeekAfterRefreshRef.current = resumeAt > 0 ? resumeAt : null;

    try {
      state.setIsBuffering(true);
      const refreshed = await fetchStreamInfo(track.video_id, true);
      if (usePlayerStore.getState().currentTrack?.video_id !== track.video_id) {
        return;
      }
      state.setStreamStats({
        cached: refreshed.cached,
        resolutionMs: refreshed.resolution_ms,
      });
      audio.src = `/api/proxy/${encodeURIComponent(track.video_id)}?retry=${Date.now()}`;
      audio.load();
      await audio.play();
    } catch {
      state.setIsBuffering(false);
      state.setIsPlaying(false);
      state.setPlaybackError("Failed to recover audio stream.");
    }
  };

  return (
    <audio
      ref={audioRef}
      preload="auto"
      onTimeUpdate={handleTimeUpdate}
      onLoadedMetadata={handleLoadedMetadata}
      onCanPlay={handleCanPlay}
      onWaiting={handleWaiting}
      onPlaying={handlePlaying}
      onEnded={handleEnded}
      onError={() => {
        void handleAudioError();
      }}
      className="hidden"
    />
  );
};

export const AudioEngine: React.FC = () => {
  return isNativePlatform() ? <NativeAudioController /> : <WebAudioController />;
};
