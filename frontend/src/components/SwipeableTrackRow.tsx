import React, { useEffect, useRef, useState } from "react";
import { Heart, ListPlus, Radio, Trash2 } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types";

interface SwipeableTrackRowProps {
  track: Track;
  children: React.ReactNode;
  mode?: "default" | "queue";
  canRemove?: boolean;
  onRemoveFromQueue?: () => void;
}

const MAX_DRAG_PX = 115;
const TRIGGER_THRESHOLD_PX = 70;

export const SwipeableTrackRow: React.FC<SwipeableTrackRowProps> = ({
  track,
  children,
  mode = "default",
  canRemove = true,
  onRemoveFromQueue,
}) => {
  const likedIds = usePlayerStore((s) => s.likedIds);
  const isJamActive = usePlayerStore((s) => s.jamState.active);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const addTrackToJamSession = usePlayerStore((s) => s.addTrackToJamSession);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const showToast = usePlayerStore((s) => s.showToast);

  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isCollapsing, setIsCollapsing] = useState(false);

  const touchStateRef = useRef<{
    startX: number;
    startY: number;
    maxAbsX: number;
    lockedAxis: "x" | "y" | null;
  } | null>(null);
  const suppressTapRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const collapseTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current);
      }
      if (collapseTimerRef.current !== null) {
        window.clearTimeout(collapseTimerRef.current);
      }
    };
  }, []);

  const isAlreadyLiked = Boolean(likedIds[track.video_id]);
  const isRightReady = dragX >= TRIGGER_THRESHOLD_PX;
  const isLeftReady = dragX <= -TRIGGER_THRESHOLD_PX;

  const triggerHaptic = () => {
    try {
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.vibrate === "function"
      ) {
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
    if (e.touches.length !== 1 || isCollapsing) return;
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

  const clampDragDelta = (deltaX: number): number => {
    if (mode === "queue") {
      if (!canRemove) return 0;
      return Math.max(-MAX_DRAG_PX, Math.min(0, deltaX));
    }
    return Math.max(-MAX_DRAG_PX, Math.min(MAX_DRAG_PX, deltaX));
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const state = touchStateRef.current;
    if (!state || e.touches.length !== 1 || isCollapsing) return;

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
        if (mode === "queue" && (deltaX > 0 || !canRemove)) {
          state.lockedAxis = "y";
          setIsDragging(false);
          setDragX(0);
          return;
        }
        state.lockedAxis = "x";
        setIsDragging(true);
      } else {
        return;
      }
    }

    if (state.lockedAxis === "x") {
      setDragX(clampDragDelta(deltaX));
    }
  };

  const finishTouch = (finalClientX?: number) => {
    const state = touchStateRef.current;
    touchStateRef.current = null;
    if (!state || isCollapsing) return;

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
      state.lockedAxis === "x" ? clampDragDelta(finalDeltaX) : dragX;

    if (state.lockedAxis !== "x") {
      setIsDragging(false);
      setDragX(0);
      return;
    }

    if (mode === "queue") {
      if (canRemove && effectiveDragX <= -TRIGGER_THRESHOLD_PX) {
        triggerHaptic();
        setIsDragging(false);
        setIsCollapsing(true);
        setDragX(-360);
        collapseTimerRef.current = window.setTimeout(() => {
          collapseTimerRef.current = null;
          onRemoveFromQueue?.();
          showToast("Removed from queue");
        }, 190);
        return;
      }
      setIsDragging(false);
      setDragX(0);
      return;
    }

    setIsDragging(false);
    setDragX(0);

    if (effectiveDragX >= TRIGGER_THRESHOLD_PX) {
      triggerHaptic();
      if (isJamActive) {
        void addTrackToJamSession(track);
        showToast("Added to Jam");
      } else {
        addToQueue(track);
        showToast("Added to queue");
      }
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
    if (!isCollapsing) {
      setIsDragging(false);
      setDragX(0);
    }
    suppressTapRef.current = false;
  };

  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressTapRef.current) {
      e.stopPropagation();
      e.preventDefault();
      suppressTapRef.current = false;
    }
  };

  const rightBackdropClass = isJamActive
    ? "bg-[#FF5E4D]"
    : "bg-emerald-600/90";
  const leftBackdropClass =
    mode === "queue" ? "bg-red-600/90" : "bg-[#FF5E4D]";

  return (
    <div
      data-no-tab-swipe="true"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onClickCapture={handleClickCapture}
      className={`relative overflow-hidden rounded-lg select-none touch-pan-y transition-all duration-200 ease-out ${
        isCollapsing ? "max-h-0 opacity-0 my-0 py-0" : "max-h-40 opacity-100"
      }`}
    >
      {/* Stationary Action Backdrop Revealed During Drag */}
      {(dragX !== 0 || isCollapsing) && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center justify-between px-4 pointer-events-none transition-colors duration-150 ${
            dragX > 0 ? rightBackdropClass : leftBackdropClass
          }`}
        >
          {/* Left Side Content (Revealed on Right Swipe: Add to Queue / Add to Jam) */}
          <div
            className={`flex items-center gap-1.5 font-bold text-xs transition-transform duration-150 ${
              isJamActive ? "text-black" : "text-white"
            } ${
              dragX > 0
                ? isRightReady
                  ? "opacity-100 scale-110"
                  : "opacity-85 scale-100"
                : "opacity-0 scale-75"
            }`}
          >
            {isJamActive ? (
              <>
                <Radio size={17} />
                <ListPlus size={18} />
                <span>Add to Jam</span>
              </>
            ) : (
              <>
                <ListPlus size={20} />
                <span>Add to Queue</span>
              </>
            )}
          </div>

          {/* Right Side Content (Revealed on Left Swipe: Like or Remove from Queue) */}
          <div
            className={`flex items-center gap-1.5 font-bold text-xs transition-transform duration-150 ${
              mode === "queue" ? "text-white" : "text-black"
            } ${
              dragX < 0 || isCollapsing
                ? isLeftReady || isCollapsing
                  ? "opacity-100 scale-110"
                  : "opacity-85 scale-100"
                : "opacity-0 scale-75"
            }`}
          >
            {mode === "queue" ? (
              <>
                <span>Remove</span>
                <Trash2 size={18} />
              </>
            ) : (
              <Heart
                size={20}
                className={
                  isAlreadyLiked || isLeftReady
                    ? "fill-black text-black"
                    : "text-black"
                }
              />
            )}
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
