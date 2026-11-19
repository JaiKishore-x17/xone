import React, { useEffect, useRef, useState } from "react";
import { Heart, ListPlus } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types";

interface SwipeableTrackRowProps {
  track: Track;
  children: React.ReactNode;
}

const MAX_DRAG_PX = 115;
const TRIGGER_THRESHOLD_PX = 70;

export const SwipeableTrackRow: React.FC<SwipeableTrackRowProps> = ({
  track,
  children,
}) => {
  const likedIds = usePlayerStore((s) => s.likedIds);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const showToast = usePlayerStore((s) => s.showToast);

  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const touchStateRef = useRef<{
    startX: number;
    startY: number;
    maxAbsX: number;
    lockedAxis: "x" | "y" | null;
  } | null>(null);
  const suppressTapRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current);
      }
    };
  }, []);

  const isAlreadyLiked = Boolean(likedIds[track.video_id]);
  const isQueueReady = dragX >= TRIGGER_THRESHOLD_PX;
  const isLikeReady = dragX <= -TRIGGER_THRESHOLD_PX;

  const triggerHaptic = () => {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(15);
      }
    } catch {
      // ignore unsupported vibration errors
    }
  };

  const clearSuppressTimer = () => {
    if (suppressTimerRef.current !== null) {
      window.clearTimeout(suppressTimerRef.current);
      suppressTimerRef.current = null;
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) {
      touchStateRef.current = null;
      return;
    }
    clearSuppressTimer();
    suppressTapRef.current = false;
    touchStateRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      maxAbsX: 0,
      lockedAxis: null,
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const state = touchStateRef.current;
    if (!state || e.touches.length !== 1) return;

    const deltaX = e.touches[0].clientX - state.startX;
    const deltaY = e.touches[0].clientY - state.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX > state.maxAbsX) {
      state.maxAbsX = absX;
    }
    if (absX >= 8) {
      suppressTapRef.current = true;
    }

    if (state.lockedAxis === null) {
      if (absY > 10 && absY >= absX) {
        state.lockedAxis = "y";
        setIsDragging(false);
        setDragX(0);
        return;
      }
      if (absX > 12 && absX > absY * 1.3) {
        state.lockedAxis = "x";
        setIsDragging(true);
      } else {
        return;
      }
    }

    if (state.lockedAxis === "x") {
      const clampedX = Math.max(-MAX_DRAG_PX, Math.min(MAX_DRAG_PX, deltaX));
      setDragX(clampedX);
    }
  };

  const finishTouch = (finalClientX?: number) => {
    const state = touchStateRef.current;
    touchStateRef.current = null;
    if (!state) return;

    const finalDeltaX =
      finalClientX !== undefined ? finalClientX - state.startX : dragX;
    const maxMove = Math.max(state.maxAbsX, Math.abs(finalDeltaX));

    if (maxMove >= 8) {
      suppressTapRef.current = true;
      clearSuppressTimer();
      suppressTimerRef.current = window.setTimeout(() => {
        suppressTimerRef.current = null;
        suppressTapRef.current = false;
      }, 250);
    } else {
      suppressTapRef.current = false;
    }

    const effectiveDragX =
      state.lockedAxis === "x"
        ? Math.max(-MAX_DRAG_PX, Math.min(MAX_DRAG_PX, finalDeltaX))
        : dragX;

    setIsDragging(false);
    setDragX(0);

    if (state.lockedAxis !== "x") return;

    if (effectiveDragX >= TRIGGER_THRESHOLD_PX) {
      triggerHaptic();
      addToQueue(track);
      showToast("Added to queue");
    } else if (effectiveDragX <= -TRIGGER_THRESHOLD_PX) {
      triggerHaptic();
      if (!isAlreadyLiked) {
        void toggleLike(track);
      } else {
        showToast("Already in Liked Songs");
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const finalX =
      e.changedTouches.length > 0 ? e.changedTouches[0].clientX : undefined;
    finishTouch(finalX);
  };

  const handleTouchCancel = () => {
    touchStateRef.current = null;
    setIsDragging(false);
    setDragX(0);
    suppressTapRef.current = false;
  };

  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressTapRef.current) {
      e.stopPropagation();
      e.preventDefault();
      suppressTapRef.current = false;
    }
  };

  return (
    <div
      data-no-tab-swipe="true"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onClickCapture={handleClickCapture}
      className="relative overflow-hidden rounded-lg select-none touch-pan-y"
    >
      {/* Stationary Action Backdrop Revealed During Drag */}
      {dragX !== 0 && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-between px-5 pointer-events-none transition-colors duration-150 ${
            dragX > 0 ? "bg-emerald-600/90" : "bg-[#FF5E4D]"
          }`}
        >
          <div
            className={`flex items-center gap-2 text-white font-bold text-xs transition-transform duration-150 ${
              dragX > 0
                ? isQueueReady
                  ? "opacity-100 scale-125"
                  : "opacity-85 scale-100"
                : "opacity-0 scale-75"
            }`}
          >
            <ListPlus size={20} />
          </div>

          <div
            className={`flex items-center gap-2 text-black font-bold text-xs transition-transform duration-150 ${
              dragX < 0
                ? isLikeReady
                  ? "opacity-100 scale-125"
                  : "opacity-85 scale-100"
                : "opacity-0 scale-75"
            }`}
          >
            <Heart
              size={20}
              className={
                isAlreadyLiked || isLikeReady
                  ? "fill-black text-black"
                  : "text-black"
              }
            />
          </div>
        </div>
      )}

      {/* Foreground Row Content */}
      <div
        style={{ transform: `translateX(${dragX}px)` }}
        className={`relative bg-[#000000] ${
          isDragging
            ? "transition-none"
            : "transition-transform duration-200 ease-out"
        }`}
      >
        {children}
      </div>
    </div>
  );
};
