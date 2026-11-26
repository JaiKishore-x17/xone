import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AudioWaveform,
  ChevronDown,
  Heart,
  ListMusic,
  Loader2,
  Mic2,
  MoreVertical,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Speaker,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { formatTime } from "../utils/format";
import { DownloadStatusIcon } from "./DownloadStatusIcon";
import { LyricsPanel } from "./LyricsPanel";
import { TrackArtwork } from "./TrackArtwork";
import { TrackContextMenu, type ContextMenuState } from "./TrackContextMenu";

const MiniPlayerProgressBar: React.FC<{ fallbackDuration?: number }> =
  React.memo(({ fallbackDuration = 0 }) => {
    const isWaveOpen = usePlayerStore((s) => Boolean(s.waveTrack));
    const currentTime = usePlayerStore((s) => (s.waveTrack ? 0 : s.currentTime));
    const duration = usePlayerStore((s) => s.duration);
    if (isWaveOpen) return null;
    const effectiveDuration = duration > 0 ? duration : fallbackDuration;
    const progressPct =
      effectiveDuration > 0
        ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100))
        : 0;

    return (
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/10 pointer-events-none">
        <div
          className="h-full bg-[#FF5E4D]"
          style={{ width: `${progressPct}%` }}
        />
      </div>
    );
  });

MiniPlayerProgressBar.displayName = "MiniPlayerProgressBar";

const computeBarRatio = (
  clientX: number,
  el: HTMLDivElement | null
): number => {
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
};

const MobileSeekSection: React.FC<{
  hasTrack: boolean;
  fallbackDuration?: number;
}> = React.memo(({ hasTrack, fallbackDuration = 0 }) => {
  const isWaveOpen = usePlayerStore((s) => Boolean(s.waveTrack));
  const currentTime = usePlayerStore((s) => (s.waveTrack ? 0 : s.currentTime));
  const duration = usePlayerStore((s) => s.duration);
  const seekTo = usePlayerStore((s) => s.seekTo);

  const barRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [dragSeekValue, setDragSeekValue] = useState(0);

  if (isWaveOpen) return null;

  const effectiveDuration = duration > 0 ? duration : fallbackDuration;
  const displayedTime = isDraggingSeek ? dragSeekValue : currentTime;
  const progressPct =
    effectiveDuration > 0
      ? Math.min(100, Math.max(0, (displayedTime / effectiveDuration) * 100))
      : 0;

  return (
    <div>
      <div
        ref={barRef}
        data-no-tab-swipe="true"
        onPointerDown={(e) => {
          if (!hasTrack || effectiveDuration <= 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ratio = computeBarRatio(e.clientX, barRef.current);
          setIsDraggingSeek(true);
          setDragSeekValue(ratio * effectiveDuration);
        }}
        onPointerMove={(e) => {
          if (!isDraggingSeek || effectiveDuration <= 0) return;
          const ratio = computeBarRatio(e.clientX, barRef.current);
          setDragSeekValue(ratio * effectiveDuration);
        }}
        onPointerUp={(e) => {
          if (!isDraggingSeek) return;
          const ratio = computeBarRatio(e.clientX, barRef.current);
          setIsDraggingSeek(false);
          seekTo(ratio * effectiveDuration);
        }}
        onPointerCancel={() => setIsDraggingSeek(false)}
        role="slider"
        aria-label="Seek audio position"
        aria-valuemin={0}
        aria-valuemax={Math.round(effectiveDuration)}
        aria-valuenow={Math.round(displayedTime)}
        className="relative w-full h-8 flex items-center cursor-pointer touch-none"
      >
        <div className="w-full h-1.5 rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full rounded-full bg-[#FF5E4D]"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div
          className="absolute w-4 h-4 rounded-full bg-[#FF5E4D] shadow-lg pointer-events-none -translate-x-1/2"
          style={{ left: `${progressPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs tabular-nums text-[#B3B3B3] -mt-1">
        <span>{formatTime(displayedTime)}</span>
        <span>{formatTime(effectiveDuration)}</span>
      </div>
    </div>
  );
});

MobileSeekSection.displayName = "MobileSeekSection";

const DesktopSeekSection: React.FC<{
  hasTrack: boolean;
  fallbackDuration?: number;
}> = React.memo(({ hasTrack, fallbackDuration = 0 }) => {
  const isWaveOpen = usePlayerStore((s) => Boolean(s.waveTrack));
  const currentTime = usePlayerStore((s) => (s.waveTrack ? 0 : s.currentTime));
  const duration = usePlayerStore((s) => s.duration);
  const seekTo = usePlayerStore((s) => s.seekTo);

  const barRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [dragSeekValue, setDragSeekValue] = useState(0);

  if (isWaveOpen) return null;

  const effectiveDuration = duration > 0 ? duration : fallbackDuration;
  const displayedTime = isDraggingSeek ? dragSeekValue : currentTime;
  const progressPct =
    effectiveDuration > 0
      ? Math.min(100, Math.max(0, (displayedTime / effectiveDuration) * 100))
      : 0;

  return (
    <div className="w-full flex items-center gap-2.5">
      <span className="text-[11px] tabular-nums text-[#A7A7A7] w-10 text-right">
        {formatTime(displayedTime)}
      </span>
      <div
        ref={barRef}
        data-no-tab-swipe="true"
        onPointerDown={(e) => {
          if (!hasTrack || effectiveDuration <= 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ratio = computeBarRatio(e.clientX, barRef.current);
          setIsDraggingSeek(true);
          setDragSeekValue(ratio * effectiveDuration);
        }}
        onPointerMove={(e) => {
          if (!isDraggingSeek || effectiveDuration <= 0) return;
          const ratio = computeBarRatio(e.clientX, barRef.current);
          setDragSeekValue(ratio * effectiveDuration);
        }}
        onPointerUp={(e) => {
          if (!isDraggingSeek) return;
          const ratio = computeBarRatio(e.clientX, barRef.current);
          setIsDraggingSeek(false);
          seekTo(ratio * effectiveDuration);
        }}
        onPointerCancel={() => setIsDraggingSeek(false)}
        role="slider"
        aria-label="Seek audio position"
        aria-valuemin={0}
        aria-valuemax={Math.round(effectiveDuration)}
        aria-valuenow={Math.round(displayedTime)}
        className="group relative flex-1 h-4 flex items-center cursor-pointer touch-none"
      >
        <div className="w-full h-1 rounded-full bg-[#4D4D4D] overflow-hidden">
          <div
            className="h-full rounded-full bg-white group-hover:bg-[#FF5E4D] transition-colors"
            style={{
              width: `${progressPct}%`,
              backgroundColor: isDraggingSeek ? "#FF5E4D" : undefined,
            }}
          />
        </div>
        <div
          className="absolute left-0 h-1 rounded-full bg-[#FF5E4D] pointer-events-none"
          style={{ width: `${progressPct}%` }}
        />
        <div
          className="absolute w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none -translate-x-1/2"
          style={{
            left: `${progressPct}%`,
            opacity: isDraggingSeek ? 1 : undefined,
          }}
        />
      </div>
      <span className="text-[11px] tabular-nums text-[#A7A7A7] w-10">
        {formatTime(effectiveDuration)}
      </span>
    </div>
  );
});

DesktopSeekSection.displayName = "DesktopSeekSection";

export const PlayerBar: React.FC = () => {
  const isWaveOpen = usePlayerStore((s) => Boolean(s.waveTrack));
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const likedIds = usePlayerStore((s) => s.likedIds);
  const downloadedIds = usePlayerStore((s) => s.downloadedIds);
  const downloadingIds = usePlayerStore((s) => s.downloadingIds);
  const prefetchedVideoId = usePlayerStore((s) => s.prefetchedVideoId);
  const playbackError = usePlayerStore((s) => s.playbackError);
  const activeView = usePlayerStore((s) => s.activeView);
  const jamState = usePlayerStore((s) => s.jamState);
  const isKeyboardOpen = usePlayerStore((s) => s.isKeyboardOpen);
  const eightDEnabled = usePlayerStore((s) => s.eightDEnabled);
  const srEnabled = usePlayerStore((s) => s.srEnabled);

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playNextTrack = usePlayerStore((s) => s.playNextTrack);
  const playPreviousTrack = usePlayerStore((s) => s.playPreviousTrack);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const toggleDownload = usePlayerStore((s) => s.toggleDownload);
  const toggleEightD = usePlayerStore((s) => s.toggleEightD);
  const toggleSlowedReverb = usePlayerStore((s) => s.toggleSlowedReverb);
  const openXoneWave = usePlayerStore((s) => s.openXoneWave);
  const setJamModalOpen = usePlayerStore((s) => s.setJamModalOpen);
  const navigate = usePlayerStore((s) => s.navigate);
  const isMobileExpanded = usePlayerStore((s) => s.isMobilePlayerExpanded);
  const setIsMobileExpanded = usePlayerStore((s) => s.setMobilePlayerExpanded);
  const isLyricsOpen = usePlayerStore((s) => s.isLyricsOpen);
  const setIsLyricsOpen = usePlayerStore((s) => s.setLyricsOpen);

  const [nowPlayingMenu, setNowPlayingMenu] = useState<ContextMenuState | null>(
    null
  );
  const [npEntered, setNpEntered] = useState(false);

  const volumeBarRef = useRef<HTMLDivElement | null>(null);
  const miniBarRef = useRef<HTMLDivElement | null>(null);
  const miniTrackRef = useRef<HTMLDivElement | null>(null);
  const npSheetRef = useRef<HTMLDivElement | null>(null);
  const npArtworkRef = useRef<HTMLDivElement | null>(null);
  const npMetaRef = useRef<HTMLDivElement | null>(null);

  const miniTouchRef = useRef<{
    startX: number;
    startY: number;
    maxMove: number;
    lockedAxis: "x" | "y" | null;
  } | null>(null);
  const miniDragXRef = useRef(0);
  const miniDragYRef = useRef(0);
  const miniDragRafRef = useRef<number | null>(null);
  const pendingMiniDragRef = useRef<{ axis: "x" | "y"; value: number } | null>(
    null
  );

  const npTouchRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    canDragDown: boolean;
    allowTrackSwipe: boolean;
    lockedAxis: "x" | "y" | null;
    dragging: boolean;
  } | null>(null);
  const npDragYRef = useRef(0);
  const npTrackDragXRef = useRef(0);
  const npDragRafRef = useRef<number | null>(null);
  const pendingNpDragRef = useRef<
    { axis: "x"; x: number } | { axis: "y"; y: number } | null
  >(null);

  const miniAnimTimerRef = useRef<number | null>(null);
  const miniRafRef = useRef<number | null>(null);
  const npDismissTimerRef = useRef<number | null>(null);
  const npTrackAnimTimerRef = useRef<number | null>(null);
  const npTrackRafRef = useRef<number | null>(null);
  const suppressExpandClickRef = useRef(false);

  useEffect(() => {
    if (!currentTrack) {
      setIsMobileExpanded(false);
      setNowPlayingMenu(null);
      setIsLyricsOpen(false);
    }
  }, [currentTrack, setIsLyricsOpen, setIsMobileExpanded]);

  useLayoutEffect(() => {
    if (npTrackAnimTimerRef.current !== null) {
      window.clearTimeout(npTrackAnimTimerRef.current);
      npTrackAnimTimerRef.current = null;
    }
    if (npTrackRafRef.current !== null) {
      window.cancelAnimationFrame(npTrackRafRef.current);
      npTrackRafRef.current = null;
    }
    if (npDragRafRef.current !== null) {
      window.cancelAnimationFrame(npDragRafRef.current);
      npDragRafRef.current = null;
    }
    pendingNpDragRef.current = null;
    npDragYRef.current = 0;
    npTrackDragXRef.current = 0;

    if (npArtworkRef.current) {
      npArtworkRef.current.style.transition = "none";
      npArtworkRef.current.style.transform = "translate3d(0px, 0, 0)";
      npArtworkRef.current.style.opacity = "1";
    }
    if (npMetaRef.current) {
      npMetaRef.current.style.transition = "none";
      npMetaRef.current.style.transform = "translate3d(0px, 0, 0)";
      npMetaRef.current.style.opacity = "1";
    }

    if (!isMobileExpanded) {
      setNpEntered(false);
      setNowPlayingMenu(null);
      return;
    }

    if (npSheetRef.current) {
      npSheetRef.current.scrollTo({ top: 0, behavior: "instant" });
      npSheetRef.current.style.transition =
        "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";
      npSheetRef.current.style.transform = "";
    }

    setNpEntered(false);
    let cancelled = false;
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (!cancelled) {
          setNpEntered(true);
        }
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [isMobileExpanded]);

  useEffect(() => {
    return () => {
      if (miniAnimTimerRef.current !== null) {
        window.clearTimeout(miniAnimTimerRef.current);
      }
      if (miniRafRef.current !== null) {
        window.cancelAnimationFrame(miniRafRef.current);
      }
      if (miniDragRafRef.current !== null) {
        window.cancelAnimationFrame(miniDragRafRef.current);
      }
      if (npDismissTimerRef.current !== null) {
        window.clearTimeout(npDismissTimerRef.current);
      }
      if (npTrackAnimTimerRef.current !== null) {
        window.clearTimeout(npTrackAnimTimerRef.current);
      }
      if (npTrackRafRef.current !== null) {
        window.cancelAnimationFrame(npTrackRafRef.current);
      }
      if (npDragRafRef.current !== null) {
        window.cancelAnimationFrame(npDragRafRef.current);
      }
    };
  }, []);

  const effectiveVolume = isMuted ? 0 : volume;
  const volumePct = Math.round(effectiveVolume * 100);
  const isLiked = currentTrack ? Boolean(likedIds[currentTrack.video_id]) : false;
  const isDownloaded = currentTrack
    ? Boolean(downloadedIds[currentTrack.video_id])
    : false;
  const isDownloading = currentTrack
    ? Boolean(downloadingIds[currentTrack.video_id])
    : false;

  const handleVolumePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ratio = computeBarRatio(e.clientX, volumeBarRef.current);
    setVolume(ratio);
  };

  const handleVolumePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    const ratio = computeBarRatio(e.clientX, volumeBarRef.current);
    setVolume(ratio);
  };

  const cancelMiniDragRaf = () => {
    if (miniDragRafRef.current !== null) {
      window.cancelAnimationFrame(miniDragRafRef.current);
      miniDragRafRef.current = null;
    }
    pendingMiniDragRef.current = null;
  };

  const applyMiniHorizontalVisuals = (
    x: number,
    opacity: number,
    transition: string
  ) => {
    miniDragXRef.current = x;
    const el = miniTrackRef.current;
    if (!el) return;
    el.style.transition = transition;
    el.style.transform = `translate3d(${x}px, 0, 0)`;
    el.style.opacity = String(opacity);
  };

  const applyMiniVerticalVisuals = (y: number, transition: string) => {
    miniDragYRef.current = y;
    const el = miniBarRef.current;
    if (!el) return;
    el.style.transition =
      transition !== "none"
        ? `${transition}, opacity 150ms ease-out`
        : "opacity 150ms ease-out";
    el.style.transform = y < 0 ? `translate3d(0, ${y}px, 0)` : "";
  };

  const resetMiniDragPosition = () => {
    cancelMiniDragRaf();
    applyMiniHorizontalVisuals(
      0,
      1,
      "transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out"
    );
    applyMiniVerticalVisuals(0, "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)");
  };

  const handleMiniTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) return;
    if (miniAnimTimerRef.current !== null) {
      window.clearTimeout(miniAnimTimerRef.current);
      miniAnimTimerRef.current = null;
    }
    if (miniRafRef.current !== null) {
      window.cancelAnimationFrame(miniRafRef.current);
      miniRafRef.current = null;
    }
    cancelMiniDragRaf();
    miniTouchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      maxMove: 0,
      lockedAxis: null,
    };
    suppressExpandClickRef.current = false;
  };

  const handleMiniTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const drag = miniTouchRef.current;
    if (!drag || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - drag.startX;
    const dy = e.touches[0].clientY - drag.startY;
    const dist = Math.hypot(dx, dy);
    if (dist > drag.maxMove) {
      drag.maxMove = dist;
    }

    if (drag.lockedAxis === null && dist >= 8) {
      if (Math.abs(dy) > Math.abs(dx) * 1.4 && dy < 0) {
        drag.lockedAxis = "y";
      } else if (Math.abs(dx) > Math.abs(dy) * 1.4) {
        drag.lockedAxis = "x";
      } else {
        drag.lockedAxis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      }
      suppressExpandClickRef.current = true;
    }

    if (drag.lockedAxis === "x") {
      pendingMiniDragRef.current = {
        axis: "x",
        value: Math.max(-110, Math.min(110, dx)),
      };
    } else if (drag.lockedAxis === "y" && dy < 0) {
      pendingMiniDragRef.current = {
        axis: "y",
        value: Math.max(-90, dy),
      };
    } else {
      return;
    }

    if (miniDragRafRef.current === null) {
      miniDragRafRef.current = window.requestAnimationFrame(() => {
        miniDragRafRef.current = null;
        const next = pendingMiniDragRef.current;
        pendingMiniDragRef.current = null;
        if (!next) return;
        if (next.axis === "x") {
          const opacity = Math.max(0.15, 1 - Math.abs(next.value) / 140);
          applyMiniHorizontalVisuals(next.value, opacity, "none");
        } else {
          applyMiniVerticalVisuals(next.value, "none");
        }
      });
    }
  };

  const triggerMiniSwipeSkip = (direction: "next" | "prev") => {
    const exitX = direction === "next" ? -110 : 110;
    const enterX = direction === "next" ? 70 : -70;

    cancelMiniDragRaf();
    applyMiniHorizontalVisuals(
      exitX,
      0,
      "transform 140ms ease-out, opacity 140ms ease-out"
    );

    miniAnimTimerRef.current = window.setTimeout(() => {
      miniAnimTimerRef.current = null;
      if (direction === "next") {
        playNextTrack(false);
      } else {
        playPreviousTrack();
      }
      applyMiniHorizontalVisuals(enterX, 0, "none");

      miniRafRef.current = window.requestAnimationFrame(() => {
        miniRafRef.current = window.requestAnimationFrame(() => {
          miniRafRef.current = null;
          applyMiniHorizontalVisuals(
            0,
            1,
            "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out"
          );
        });
      });
    }, 140);
  };

  const handleMiniTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const drag = miniTouchRef.current;
    miniTouchRef.current = null;
    cancelMiniDragRaf();
    if (!drag) return;

    const dx =
      e.changedTouches.length > 0
        ? e.changedTouches[0].clientX - drag.startX
        : miniDragXRef.current;
    const dy =
      e.changedTouches.length > 0
        ? e.changedTouches[0].clientY - drag.startY
        : miniDragYRef.current;
    const totalMove = Math.max(drag.maxMove, Math.hypot(dx, dy));

    if (totalMove >= 8) {
      suppressExpandClickRef.current = true;
      window.setTimeout(() => {
        suppressExpandClickRef.current = false;
      }, 250);
    } else {
      suppressExpandClickRef.current = false;
      resetMiniDragPosition();
      return;
    }

    if (drag.lockedAxis === "y") {
      if (dy < -45 && Math.abs(dy) > Math.abs(dx) * 1.4) {
        applyMiniVerticalVisuals(0, "none");
        applyMiniHorizontalVisuals(0, 1, "none");
        setIsMobileExpanded(true);
      } else {
        resetMiniDragPosition();
      }
      return;
    }

    if (dx < -55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      triggerMiniSwipeSkip("next");
    } else if (dx > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      triggerMiniSwipeSkip("prev");
    } else {
      resetMiniDragPosition();
    }
  };

  const handleMiniTouchCancel = () => {
    miniTouchRef.current = null;
    suppressExpandClickRef.current = false;
    resetMiniDragPosition();
  };

  const cancelNpDragRaf = () => {
    if (npDragRafRef.current !== null) {
      window.cancelAnimationFrame(npDragRafRef.current);
      npDragRafRef.current = null;
    }
    pendingNpDragRef.current = null;
  };

  const applyNpTrackVisuals = (
    x: number,
    opacity: number,
    transition: string
  ) => {
    npTrackDragXRef.current = x;
    const scale = 1 - Math.min(0.04, Math.abs(x) / 2800);
    const transform = `translate3d(${x}px, 0, 0) scale3d(${scale}, ${scale}, 1)`;
    if (npArtworkRef.current) {
      npArtworkRef.current.style.transition = transition;
      npArtworkRef.current.style.transform = transform;
      npArtworkRef.current.style.opacity = String(opacity);
    }
    if (npMetaRef.current) {
      npMetaRef.current.style.transition = transition;
      npMetaRef.current.style.transform = transform;
      npMetaRef.current.style.opacity = String(opacity);
    }
  };

  const applyNpSheetVisuals = (y: number, transition: string) => {
    npDragYRef.current = y;
    const sheet = npSheetRef.current;
    if (!sheet) return;
    sheet.style.transition = transition;
    sheet.style.transform =
      y > 0 ? `translate3d(0, ${y}px, 0)` : "translate3d(0, 0, 0)";
  };

  const clearNpTrackAnimTimers = () => {
    if (npTrackAnimTimerRef.current !== null) {
      window.clearTimeout(npTrackAnimTimerRef.current);
      npTrackAnimTimerRef.current = null;
    }
    if (npTrackRafRef.current !== null) {
      window.cancelAnimationFrame(npTrackRafRef.current);
      npTrackRafRef.current = null;
    }
  };

  const resetNpTrackPosition = () => {
    applyNpTrackVisuals(
      0,
      1,
      "transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out"
    );
  };

  const triggerNpSwipeSkip = (direction: "next" | "prev") => {
    clearNpTrackAnimTimers();
    cancelNpDragRaf();
    const exitX = direction === "next" ? -160 : 160;
    const enterX = direction === "next" ? 110 : -110;

    applyNpTrackVisuals(
      exitX,
      0,
      "transform 140ms ease-in, opacity 140ms ease-in"
    );

    npTrackAnimTimerRef.current = window.setTimeout(() => {
      npTrackAnimTimerRef.current = null;
      if (direction === "next") {
        playNextTrack(false);
      } else {
        playPreviousTrack();
      }
      applyNpTrackVisuals(enterX, 0, "none");

      npTrackRafRef.current = window.requestAnimationFrame(() => {
        npTrackRafRef.current = window.requestAnimationFrame(() => {
          npTrackRafRef.current = null;
          applyNpTrackVisuals(
            0,
            1,
            "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out"
          );
        });
      });
    }, 140);
  };

  const closeNowPlayingSmooth = () => {
    if (npDismissTimerRef.current !== null) {
      window.clearTimeout(npDismissTimerRef.current);
      npDismissTimerRef.current = null;
    }
    cancelNpDragRaf();
    const exitY = typeof window !== "undefined" ? window.innerHeight : 850;
    applyNpSheetVisuals(exitY, "transform 200ms ease-in");
    npDismissTimerRef.current = window.setTimeout(() => {
      npDismissTimerRef.current = null;
      setIsMobileExpanded(false);
    }, 200);
  };

  const handleNpTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1 || nowPlayingMenu) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        '[role="slider"], [data-no-sheet-drag], button, input, textarea'
      )
    ) {
      npTouchRef.current = null;
      return;
    }
    if (npDismissTimerRef.current !== null) {
      window.clearTimeout(npDismissTimerRef.current);
      npDismissTimerRef.current = null;
    }
    cancelNpDragRaf();
    const sheet = npSheetRef.current;
    const onHeaderOrHandle = Boolean(target?.closest("[data-np-handle]"));
    const canDragDown = onHeaderOrHandle || !sheet || sheet.scrollTop <= 4;
    const allowTrackSwipe = Boolean(target?.closest("[data-np-track-swipe]"));
    npTouchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startTime: Date.now(),
      canDragDown,
      allowTrackSwipe,
      lockedAxis: null,
      dragging: false,
    };
  };

  const handleNpTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const drag = npTouchRef.current;
    if (!drag || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - drag.startX;
    const dy = e.touches[0].clientY - drag.startY;
    const dist = Math.hypot(dx, dy);

    if (drag.lockedAxis === null && dist >= 8) {
      if (
        drag.allowTrackSwipe &&
        Math.abs(dx) > 10 &&
        Math.abs(dx) > Math.abs(dy) * 1.4
      ) {
        drag.lockedAxis = "x";
        clearNpTrackAnimTimers();
      } else if (
        drag.canDragDown &&
        dy > 8 &&
        Math.abs(dy) > Math.abs(dx) * 1.2
      ) {
        drag.lockedAxis = "y";
      }
    }

    if (drag.lockedAxis === "x") {
      drag.dragging = true;
      pendingNpDragRef.current = {
        axis: "x",
        x: Math.max(-140, Math.min(140, dx)),
      };
    } else if (drag.lockedAxis === "y" && drag.canDragDown) {
      if (dy > 6) {
        drag.dragging = true;
        pendingNpDragRef.current = { axis: "y", y: dy };
      } else if (drag.dragging && dy <= 0) {
        pendingNpDragRef.current = { axis: "y", y: 0 };
      } else {
        return;
      }
    } else {
      return;
    }

    if (npDragRafRef.current === null) {
      npDragRafRef.current = window.requestAnimationFrame(() => {
        npDragRafRef.current = null;
        const next = pendingNpDragRef.current;
        pendingNpDragRef.current = null;
        if (!next) return;
        if (next.axis === "x") {
          const opacity = Math.max(0.45, 1 - Math.abs(next.x) / 220);
          applyNpTrackVisuals(next.x, opacity, "none");
        } else {
          applyNpSheetVisuals(next.y, "none");
        }
      });
    }
  };

  const handleNpTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const drag = npTouchRef.current;
    npTouchRef.current = null;
    cancelNpDragRaf();
    if (!drag || !drag.dragging) return;

    const dx =
      e.changedTouches.length > 0
        ? e.changedTouches[0].clientX - drag.startX
        : npTrackDragXRef.current;
    const dy =
      e.changedTouches.length > 0
        ? e.changedTouches[0].clientY - drag.startY
        : npDragYRef.current;

    if (drag.lockedAxis === "x") {
      if (dx <= -65) {
        triggerNpSwipeSkip("next");
      } else if (dx >= 65) {
        triggerNpSwipeSkip("prev");
      } else {
        resetNpTrackPosition();
      }
      return;
    }

    const elapsed = Math.max(1, Date.now() - drag.startTime);
    const velocity = dy / elapsed;

    if (dy > 110 || (dy > 50 && velocity > 0.65)) {
      closeNowPlayingSmooth();
    } else {
      applyNpSheetVisuals(0, "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)");
    }
  };

  const handleNpTouchCancel = () => {
    npTouchRef.current = null;
    cancelNpDragRaf();
    applyNpSheetVisuals(0, "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)");
    resetNpTrackPosition();
  };

  if (isWaveOpen) return null;

  return (
    <>
      {/* ===================== COMPACT MOBILE MINI-PLAYER (< 768px) ===================== */}
      {currentTrack && (
        <div
          ref={miniBarRef}
          data-no-tab-swipe="true"
          onTouchStart={handleMiniTouchStart}
          onTouchMove={handleMiniTouchMove}
          onTouchEnd={handleMiniTouchEnd}
          onTouchCancel={handleMiniTouchCancel}
          onClick={() => {
            if (suppressExpandClickRef.current) {
              suppressExpandClickRef.current = false;
              return;
            }
            setIsMobileExpanded(true);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") setIsMobileExpanded(true);
          }}
          style={{
            transform: isKeyboardOpen ? "translate3d(0, 140%, 0)" : undefined,
            transition: isKeyboardOpen
              ? "transform 150ms ease-out, opacity 150ms ease-out"
              : "opacity 150ms ease-out",
          }}
          aria-hidden={isKeyboardOpen}
          aria-label="Open full-screen now playing controls"
          className={`fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom))] left-2 right-2 z-40 md:hidden rounded-lg bg-black/95 border border-white/10 p-2 shadow-2xl overflow-hidden select-none cursor-pointer touch-none ${
            isKeyboardOpen ? "opacity-0 pointer-events-none" : "opacity-100"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex-1 min-w-0 overflow-hidden">
              <div
                ref={miniTrackRef}
                className="flex items-center gap-2.5 min-w-0"
              >
                <div className="relative w-10 h-10 rounded overflow-hidden shrink-0 bg-black">
                  <TrackArtwork
                    src={currentTrack.thumbnail}
                    alt={currentTrack.title}
                    iconSize={16}
                    className="w-full h-full object-cover"
                  />
                  {isBuffering && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 size={15} className="animate-spin text-[#FF5E4D]" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white truncate">
                    {currentTrack.title}
                  </p>
                  <p className="text-[11px] text-[#B3B3B3] truncate">
                    {currentTrack.artist}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleLike(currentTrack);
                }}
                aria-label={
                  isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"
                }
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full active:scale-95 transition-transform"
              >
                <Heart
                  size={19}
                  className={
                    isLiked
                      ? "text-[#FF5E4D] fill-[#FF5E4D]"
                      : "text-[#B3B3B3] hover:text-white"
                  }
                />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <span className="w-9 h-9 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] active:scale-95 text-black flex items-center justify-center shadow-md transition-all">
                  {isPlaying ? (
                    <Pause size={17} className="fill-black" />
                  ) : (
                    <Play size={17} className="fill-black ml-0.5" />
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* 2px Hyper Coral Progress Bar along bottom edge */}
          <MiniPlayerProgressBar
            fallbackDuration={currentTrack.duration_seconds}
          />
        </div>
      )}

      {/* ===================== FULL-SCREEN MOBILE NOW PLAYING SHEET (< 768px) ===================== */}
      {isMobileExpanded && currentTrack && (
        <div
          ref={npSheetRef}
          data-no-tab-swipe="true"
          onTouchStart={handleNpTouchStart}
          onTouchMove={handleNpTouchMove}
          onTouchEnd={handleNpTouchEnd}
          onTouchCancel={handleNpTouchCancel}
          style={{
            transform: npEntered
              ? "translate3d(0, 0, 0)"
              : "translate3d(0, 100%, 0)",
            transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          className="fixed inset-0 z-50 md:hidden bg-gradient-to-b from-[#1E1E1E] via-[#000000] to-[#000000] flex flex-col justify-between px-6 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))] overflow-y-auto overflow-x-hidden xone-modal-scroll overscroll-y-contain select-none"
        >
          {/* Top Drag Handle Pill + Header */}
          <div data-np-handle="true">
            <div className="w-10 h-1 rounded-full bg-white/25 mx-auto mb-2" />
            <div className="flex items-center justify-between gap-2 -mx-2">
              <button
                type="button"
                onClick={closeNowPlayingSmooth}
                aria-label="Minimize now playing"
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors"
              >
                <ChevronDown size={26} />
              </button>

              <div className="flex-1 min-w-0 text-center px-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#B3B3B3] whitespace-nowrap">
                  Now Playing
                </p>
                <p className="text-xs font-semibold text-white truncate mt-0.5">
                  {currentTrack.album || "Single"}
                </p>
              </div>

              <button
                type="button"
                onClick={(e) => {
                  setNowPlayingMenu({
                    track: currentTrack,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                aria-label={`More options for ${currentTrack.title}`}
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors"
              >
                <MoreVertical size={21} />
              </button>
            </div>

            <div className="flex justify-center mt-2.5">
              <button
                type="button"
                onClick={() => openXoneWave(currentTrack)}
                title="Play Xone Wave"
                aria-label="Play Xone Wave"
                className="inline-flex items-center gap-1.5 bg-white/[0.08] hover:bg-white/[0.14] active:scale-95 border border-white/10 text-zinc-100 rounded-full px-3.5 py-1.5 text-xs font-medium whitespace-nowrap transition-all"
              >
                <AudioWaveform size={14} className="shrink-0" />
                <span>Play Xone Wave</span>
              </button>
            </div>
          </div>

          {/* Large Centered Artwork or Synced Lyrics Stage */}
          {isLyricsOpen ? (
            <div className="my-3 flex-1 min-h-[220px] max-h-[45vh] w-full flex items-center justify-center overflow-hidden">
              <LyricsPanel
                track={currentTrack}
                durationSeconds={currentTrack.duration_seconds}
                className="max-w-[380px] h-full"
              />
            </div>
          ) : (
            <div
              data-np-track-swipe="true"
              data-no-tab-swipe="true"
              className="my-4 flex-1 flex items-center justify-center overflow-hidden"
            >
              <div
                ref={npArtworkRef}
                className="relative w-full max-w-[320px] aspect-square rounded-xl overflow-hidden shadow-2xl bg-[#141414]"
              >
                <TrackArtwork
                  src={currentTrack.thumbnail}
                  alt={currentTrack.title}
                  iconSize={52}
                  className="w-full h-full object-cover"
                />
                {isBuffering && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 size={32} className="animate-spin text-[#FF5E4D]" />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Track Meta, Seek Bar & Controls */}
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div
                data-np-track-swipe="true"
                data-no-tab-swipe="true"
                className="min-w-0 flex-1 overflow-hidden"
              >
                <div ref={npMetaRef}>
                  <h2 className="text-xl font-extrabold text-white truncate">
                    {currentTrack.title}
                  </h2>
                  <p className="text-sm text-[#B3B3B3] truncate mt-0.5">
                    {currentTrack.artist}
                  </p>
                  {playbackError && (
                    <p className="text-xs text-[#FF5E4D] truncate mt-1">
                      {playbackError}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center shrink-0 -mr-2">
                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => void toggleDownload(currentTrack)}
                  aria-label={
                    isDownloading
                      ? "Downloading track"
                      : isDownloaded
                        ? "Remove download"
                        : "Download track"
                  }
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full shrink-0"
                >
                  <DownloadStatusIcon
                    isDownloading={isDownloading}
                    isDownloaded={isDownloaded}
                    size={22}
                    inactiveClassName="text-[#B3B3B3] hover:text-white"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => void toggleLike(currentTrack)}
                  aria-label={
                    isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"
                  }
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full shrink-0"
                >
                  <Heart
                    size={24}
                    className={
                      isLiked
                        ? "text-[#FF5E4D] fill-[#FF5E4D]"
                        : "text-[#B3B3B3] hover:text-white"
                    }
                  />
                </button>
              </div>
            </div>

            {/* Interactive Mobile Seek Slider */}
            <MobileSeekSection
              hasTrack={Boolean(currentTrack)}
              fallbackDuration={currentTrack.duration_seconds}
            />

            {/* Transport Controls */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={toggleShuffle}
                aria-label="Toggle shuffle"
                className={`relative min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${
                  shuffle ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
                }`}
              >
                <Shuffle size={22} />
                {shuffle && (
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-1 w-1 h-1 rounded-full bg-[#FF5E4D]" />
                )}
              </button>

              <button
                type="button"
                onClick={playPreviousTrack}
                aria-label="Previous track"
                className="min-w-[48px] min-h-[48px] flex items-center justify-center text-white active:scale-95 transition-transform"
              >
                <SkipBack size={28} className="fill-current" />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="w-16 h-16 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] active:scale-95 text-black flex items-center justify-center shadow-2xl transition-all"
              >
                {isPlaying ? (
                  <Pause size={30} className="fill-black" />
                ) : (
                  <Play size={30} className="fill-black ml-1" />
                )}
              </button>

              <button
                type="button"
                onClick={() => playNextTrack(false)}
                aria-label="Next track"
                className="min-w-[48px] min-h-[48px] flex items-center justify-center text-white active:scale-95 transition-transform"
              >
                <SkipForward size={28} className="fill-current" />
              </button>

              <button
                type="button"
                onClick={cycleRepeat}
                aria-label={`Repeat mode: ${repeat}`}
                className={`relative min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${
                  repeat !== "off"
                    ? "text-[#FF5E4D]"
                    : "text-[#B3B3B3] hover:text-white"
                }`}
              >
                {repeat === "one" ? <Repeat1 size={22} /> : <Repeat size={22} />}
                {repeat !== "off" && (
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-1 w-1 h-1 rounded-full bg-[#FF5E4D]" />
                )}
              </button>
            </div>

            {/* Bottom Utility Row */}
            <div data-no-sheet-drag="true" className="flex items-center justify-between pt-1">
              {!jamState.isActive ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleEightD}
                    aria-pressed={eightDEnabled}
                    aria-label="Toggle 8D Spatial Audio"
                    className={`min-h-[34px] px-3 rounded-full text-xs tracking-wide transition-colors ${
                      eightDEnabled
                        ? "bg-[#FF5E4D]/20 border border-[#FF5E4D] text-[#FF5E4D] font-semibold"
                        : "bg-[#181818] border border-white/10 text-zinc-400"
                    }`}
                  >
                    8D
                  </button>
                  <button
                    type="button"
                    onClick={toggleSlowedReverb}
                    aria-pressed={srEnabled}
                    aria-label="Toggle Slowed and Reverb"
                    className={`min-h-[34px] px-3 rounded-full text-xs tracking-wide transition-colors ${
                      srEnabled
                        ? "bg-[#FF5E4D]/20 border border-[#FF5E4D] text-[#FF5E4D] font-semibold"
                        : "bg-[#181818] border border-white/10 text-zinc-400"
                    }`}
                  >
                    SR
                  </button>
                </div>
              ) : prefetchedVideoId ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#141414] border border-[#FF5E4D]/30 text-[10px] font-bold text-[#FF5E4D] tracking-wide">
                  NEXT READY
                </span>
              ) : (
                <span className="text-[11px] text-[#727272]">
                  Playing from Jam queue
                </span>
              )}

              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setIsLyricsOpen(!isLyricsOpen)}
                  aria-pressed={isLyricsOpen}
                  aria-label="Toggle Lyrics"
                  className={`min-h-[44px] px-2.5 flex items-center gap-1.5 text-xs font-semibold rounded-full transition-colors ${
                    isLyricsOpen
                      ? "text-[#FF5E4D] bg-[#FF5E4D]/15"
                      : "text-[#B3B3B3] hover:text-white"
                  }`}
                >
                  <Mic2 size={15} />
                  <span>Lyrics</span>
                </button>

                <button
                  type="button"
                  onClick={() => setJamModalOpen(true)}
                  aria-label="Open BLE Jam and Multi-Speaker"
                  className={`min-h-[44px] px-2.5 flex items-center gap-1.5 text-xs font-semibold rounded-full transition-colors ${
                    jamState.active
                      ? "text-[#FF5E4D] bg-[#FF5E4D]/15"
                      : "text-[#B3B3B3] hover:text-white"
                  }`}
                >
                  <Speaker size={15} />
                  <span>{jamState.active ? "Jam Live" : "Jam"}</span>
                  {jamState.active && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FF5E4D] animate-pulse" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMobileExpanded(false);
                    navigate({ type: "queue" });
                  }}
                  className="min-h-[44px] px-2.5 flex items-center gap-1.5 text-xs font-semibold text-[#B3B3B3] hover:text-white"
                >
                  <ListMusic size={15} />
                  <span>Queue</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== DESKTOP PLAYER BAR (>= 768px) ===================== */}
      <footer className="hidden md:flex h-[90px] shrink-0 bg-black border-t border-[#141414] px-4 items-center justify-between gap-4 select-none">
        {/* Left: Now Playing Track Info */}
        <div className="w-[30%] min-w-[200px] flex items-center gap-3.5">
          {currentTrack ? (
            <>
              <div className="relative w-14 h-14 rounded-md overflow-hidden shrink-0 bg-[#141414] shadow-lg">
                <TrackArtwork
                  src={currentTrack.thumbnail}
                  alt={currentTrack.title}
                  iconSize={20}
                  className="w-full h-full object-cover"
                />
                {isBuffering && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <Loader2 size={18} className="animate-spin text-[#FF5E4D]" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate hover:underline cursor-default">
                    {currentTrack.title}
                  </p>
                </div>
                <p className="text-xs text-[#B3B3B3] truncate">
                  {currentTrack.artist}
                </p>
                {playbackError && (
                  <p className="text-[11px] text-[#FF5E4D] truncate mt-0.5">
                    {playbackError}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={isDownloading}
                onClick={() => void toggleDownload(currentTrack)}
                title={
                  isDownloading
                    ? "Downloading..."
                    : isDownloaded
                      ? "Remove Download"
                      : "Download for offline playback"
                }
                aria-label={
                  isDownloading
                    ? "Downloading track"
                    : isDownloaded
                      ? "Remove download"
                      : "Download track"
                }
                className="p-1.5 rounded-full hover:scale-110 transition-transform shrink-0"
              >
                <DownloadStatusIcon
                  isDownloading={isDownloading}
                  isDownloaded={isDownloaded}
                  size={18}
                  inactiveClassName="text-[#B3B3B3] hover:text-white"
                />
              </button>
              <button
                type="button"
                onClick={() => void toggleLike(currentTrack)}
                aria-label={
                  isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"
                }
                className="p-1.5 rounded-full hover:scale-110 transition-transform shrink-0"
              >
                <Heart
                  size={18}
                  className={
                    isLiked
                      ? "text-[#FF5E4D] fill-[#FF5E4D]"
                      : "text-[#B3B3B3] hover:text-white"
                  }
                />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3 text-[#727272]">
              <div className="w-14 h-14 rounded-md bg-[#141414] flex items-center justify-center">
                <ListMusic size={20} />
              </div>
              <div>
                <p className="text-sm font-medium text-[#B3B3B3]">Ready to play</p>
                <p className="text-xs text-[#727272]">
                  Search a track to start streaming
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Center: Playback Controls + Seek Bar */}
        <div className="w-[40%] max-w-[680px] flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={toggleShuffle}
              title="Shuffle"
              aria-label="Toggle shuffle"
              className={`relative p-1.5 transition-colors ${
                shuffle ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
              }`}
            >
              <Shuffle size={18} />
              {shuffle && (
                <span className="absolute left-1/2 -translate-x-1/2 -bottom-0.5 w-1 h-1 rounded-full bg-[#FF5E4D]" />
              )}
            </button>

            <button
              type="button"
              onClick={playPreviousTrack}
              disabled={!currentTrack}
              title="Previous"
              aria-label="Previous track"
              className="p-1.5 text-[#B3B3B3] hover:text-white disabled:opacity-40 transition-colors"
            >
              <SkipBack size={20} className="fill-current" />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              disabled={!currentTrack}
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="w-9 h-9 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 text-black flex items-center justify-center transition-all shadow-md"
            >
              {isPlaying ? (
                <Pause size={18} className="fill-black" />
              ) : (
                <Play size={18} className="fill-black ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => playNextTrack(false)}
              disabled={!currentTrack}
              title="Next"
              aria-label="Next track"
              className="p-1.5 text-[#B3B3B3] hover:text-white disabled:opacity-40 transition-colors"
            >
              <SkipForward size={20} className="fill-current" />
            </button>

            <button
              type="button"
              onClick={cycleRepeat}
              title={`Repeat: ${repeat}`}
              aria-label={`Repeat mode: ${repeat}`}
              className={`relative p-1.5 transition-colors ${
                repeat !== "off"
                  ? "text-[#FF5E4D]"
                  : "text-[#B3B3B3] hover:text-white"
              }`}
            >
              {repeat === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
              {repeat !== "off" && (
                <span className="absolute left-1/2 -translate-x-1/2 -bottom-0.5 w-1 h-1 rounded-full bg-[#FF5E4D]" />
              )}
            </button>
          </div>

          {/* Interactive Seek Progress Bar */}
          <DesktopSeekSection
            hasTrack={Boolean(currentTrack)}
            fallbackDuration={currentTrack?.duration_seconds}
          />
        </div>

        {/* Right: Prefetch Badge + Queue Toggle + Volume Slider */}
        <div className="w-[30%] min-w-[180px] flex items-center justify-end gap-3">
          {prefetchedVideoId && (
            <span
              title="Next track preloaded into standby Audio buffer"
              className="hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#141414] border border-[#FF5E4D]/30 text-[10px] font-bold text-[#FF5E4D] tracking-wide"
            >
              NEXT READY
            </span>
          )}

          <button
            type="button"
            disabled={!currentTrack}
            onClick={() => currentTrack && openXoneWave(currentTrack)}
            title="Play Xone Wave"
            aria-label="Play Xone Wave"
            className="p-1.5 text-[#B3B3B3] hover:text-[#FF5E4D] transition-colors disabled:opacity-40"
          >
            <AudioWaveform size={18} />
          </button>

          <button
            type="button"
            disabled={!currentTrack}
            onClick={() => setIsLyricsOpen(!isLyricsOpen)}
            title="Lyrics"
            aria-pressed={isLyricsOpen}
            aria-label="Toggle Lyrics"
            className={`p-1.5 transition-colors disabled:opacity-40 ${
              isLyricsOpen
                ? "text-[#FF5E4D]"
                : "text-[#B3B3B3] hover:text-white"
            }`}
          >
            <Mic2 size={18} />
          </button>

          <button
            type="button"
            onClick={() => setJamModalOpen(true)}
            title="BLE Jam & Multi-Speaker"
            aria-label="Open BLE Jam and Multi-Speaker"
            className={`relative p-1.5 transition-colors ${
              jamState.active
                ? "text-[#FF5E4D]"
                : "text-[#B3B3B3] hover:text-white"
            }`}
          >
            <Speaker size={18} />
            {jamState.active && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#FF5E4D] animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => navigate({ type: "queue" })}
            title="Queue"
            aria-label="Open queue"
            className={`p-1.5 transition-colors ${
              activeView.type === "queue"
                ? "text-[#FF5E4D]"
                : "text-[#B3B3B3] hover:text-white"
            }`}
          >
            <ListMusic size={18} />
          </button>

          <div className="flex items-center gap-2 w-28 sm:w-32">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className="text-[#B3B3B3] hover:text-white transition-colors"
            >
              {effectiveVolume === 0 ? (
                <VolumeX size={18} />
              ) : effectiveVolume < 0.5 ? (
                <Volume1 size={18} />
              ) : (
                <Volume2 size={18} />
              )}
            </button>

            <div
              ref={volumeBarRef}
              data-no-tab-swipe="true"
              onPointerDown={handleVolumePointerDown}
              onPointerMove={handleVolumePointerMove}
              role="slider"
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={volumePct}
              className="group relative flex-1 h-4 flex items-center cursor-pointer touch-none"
            >
              <div className="w-full h-1 rounded-full bg-[#4D4D4D] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#FF5E4D]"
                  style={{ width: `${volumePct}%` }}
                />
              </div>
              <div
                className="absolute w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none -translate-x-1/2"
                style={{ left: `${volumePct}%` }}
              />
            </div>
          </div>
        </div>
      </footer>

      {/* Desktop Floating Lyrics Card (>= 768px) */}
      {isLyricsOpen && currentTrack && (
        <div
          data-no-tab-swipe="true"
          className="hidden md:flex fixed bottom-[102px] right-4 z-40 w-[380px] h-[460px] flex-col rounded-xl bg-[#111111] border border-white/10 shadow-2xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2 shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#FF5E4D]">
                Lyrics
              </p>
              <p className="text-xs font-bold text-white truncate">
                {currentTrack.title} • {currentTrack.artist}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsLyricsOpen(false)}
              aria-label="Close lyrics"
              className="p-1.5 rounded-full text-[#B3B3B3] hover:text-white hover:bg-white/10 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 min-h-0 p-2">
            <LyricsPanel
              track={currentTrack}
              durationSeconds={currentTrack.duration_seconds}
              className="border-0 bg-transparent"
            />
          </div>
        </div>
      )}

      <TrackContextMenu
        menu={nowPlayingMenu}
        onClose={() => setNowPlayingMenu(null)}
      />
    </>
  );
};
