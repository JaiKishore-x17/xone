import React, { useEffect, useRef } from "react";
import { fetchStreamInfo } from "../api";
import { usePlayerStore } from "../store/usePlayerStore";

export const AudioEngine: React.FC = () => {
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
              // Autoplay policies or temporary abort
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
  }, [currentTrack?.video_id]);

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
    usePlayerStore.getState().playNextTrack(true);
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
