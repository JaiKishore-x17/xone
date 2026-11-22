import React, { useCallback, useEffect, useRef, useState } from "react";
import { Heart, ListPlus, Radio, Trash2 } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types";

interface SwipeableTrackRowProps {
  track: Track;
  children: React.ReactNode;
  mode?: "default" | "queue";
  canRemove?: boolean;
  onRemoveFromQueue?: () => void;
  removeIndex?: number;
  onRemoveAt?: (index: number) => void;
}

const MAX_DRAG_PX = 115;
const TRIGGER_THRESHOLD_PX = 70;

export const SwipeableTrackRow: React.FC<SwipeableTrackRowProps> = React.memo(
  ({
    track,
    children,
    mode = "default",
    canRemove = true,
    onRemoveFromQueue,
    removeIndex,
    onRemoveAt,
  }) => {
    const isAlreadyLiked = usePlayerStore((s) =>
      Boolean(s.likedIds[track.video_id])
    );
    const isJamActive = usePlayerStore((s) => s.jamState.active);
    const addToQueue = usePlayerStore((s) => s.addToQueue);
    const addTrackToJamSession = usePlayerStore((s) => s.addTrackToJamSession);
    const toggleLike = usePlayerStore((s) => s.toggleLike);
    const showToast = usePlayerStore((s) => s.showToast);

    const [isCollapsing, setIsCollapsing] = useState(false);

    const foregroundRef = useRef<HTMLDivElement | null>(null);
    const backdropRef = useRef<HTMLDivElement | null>(null);
    const leftActionRef = useRef<HTMLDivElement | null>(null);
    const rightActionRef = useRef<HTMLDivElement | null>(null);
    const heartIconRef = useRef<SVGSVGElement | null>(null);

    const dragXRef = useRef(0);
    const collapsingRef = useRef(false);
    const rafIdRef = useRef<number | null>(null);
    const pendingDragXRef = useRef<number | null>(null);

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
        if (rafIdRef.current !== null) {
          window.cancelAnimationFrame(rafIdRef.current);
        }
      };
    }, []);

    const cancelDragRaf = () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      pendingDragXRef.current = null;
    };

    const applySwipeVisuals = useCallback(
      (x: number, withTransition: boolean) => {
        dragXRef.current = x;
        const fg = foregroundRef.current;
        if (fg) {
          fg.style.transition = withTransition
            ? "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)"
            : "none";
          fg.style.transform = `translate3d(${x}px, 0, 0)`;
        }

        const isActive = x !== 0 || collapsingRef.current;
        const backdrop = backdropRef.current;
        if (backdrop) {
          backdrop.style.visibility = isActive ? "visible" : "hidden";
          if (isActive) {
            if (x > 0) {
              backdrop.style.backgroundColor = isJamActive
                ? "#FF5E4D"
                : "rgba(5, 150, 105, 0.9)";
            } else {
              backdrop.style.backgroundColor =
                mode === "queue" ? "rgba(220, 38, 38, 0.9)" : "#FF5E4D";
            }
          }
        }

        const leftAction = leftActionRef.current;
        if (leftAction) {
          if (x > 0) {
            const ready = x >= TRIGGER_THRESHOLD_PX;
            leftAction.style.opacity = ready ? "1" : "0.85";
            leftAction.style.transform = ready
              ? "scale3d(1.1, 1.1, 1)"
              : "scale3d(1, 1, 1)";
          } else {
            leftAction.style.opacity = "0";
            leftAction.style.transform = "scale3d(0.75, 0.75, 1)";
          }
        }

        const rightAction = rightActionRef.current;
        if (rightAction) {
          if (x < 0 || collapsingRef.current) {
            const ready = x <= -TRIGGER_THRESHOLD_PX || collapsingRef.current;
            rightAction.style.opacity = ready ? "1" : "0.85";
            rightAction.style.transform = ready
              ? "scale3d(1.1, 1.1, 1)"
              : "scale3d(1, 1, 1)";
          } else {
            rightAction.style.opacity = "0";
            rightAction.style.transform = "scale3d(0.75, 0.75, 1)";
          }
        }

        if (heartIconRef.current && mode !== "queue") {
          const shouldFill = isAlreadyLiked || x <= -TRIGGER_THRESHOLD_PX;
          heartIconRef.current.style.fill = shouldFill ? "#000000" : "none";
        }
      },
      [isAlreadyLiked, isJamActive, mode]
    );

    const scheduleDragFrame = (nextX: number) => {
      pendingDragXRef.current = nextX;
      if (rafIdRef.current !== null) return;
      rafIdRef.current = window.requestAnimationFrame(() => {
        rafIdRef.current = null;
        if (pendingDragXRef.current !== null) {
          const targetX = pendingDragXRef.current;
          pendingDragXRef.current = null;
          applySwipeVisuals(targetX, false);
        }
      });
    };

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
      if (e.touches.length !== 1 || collapsingRef.current) return;
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
      if (!state || e.touches.length !== 1 || collapsingRef.current) return;

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
          cancelDragRaf();
          if (dragXRef.current !== 0) {
            applySwipeVisuals(0, true);
          }
          return;
        }
        if (absX > 12 && absX > absY * 1.3) {
          if (mode === "queue" && (deltaX > 0 || !canRemove)) {
            state.lockedAxis = "y";
            cancelDragRaf();
            if (dragXRef.current !== 0) {
              applySwipeVisuals(0, true);
            }
            return;
          }
          state.lockedAxis = "x";
        } else {
          return;
        }
      }

      if (state.lockedAxis === "x") {
        scheduleDragFrame(clampDragDelta(deltaX));
      }
    };

    const finishTouch = (finalClientX?: number) => {
      const state = touchStateRef.current;
      touchStateRef.current = null;
      cancelDragRaf();
      if (!state || collapsingRef.current) return;

      const finalDeltaX =
        finalClientX !== undefined
          ? finalClientX - state.startX
          : dragXRef.current;
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
          ? clampDragDelta(finalDeltaX)
          : dragXRef.current;

      if (state.lockedAxis !== "x") {
        if (dragXRef.current !== 0) {
          applySwipeVisuals(0, true);
        }
        return;
      }

      if (mode === "queue") {
        if (canRemove && effectiveDragX <= -TRIGGER_THRESHOLD_PX) {
          triggerHaptic();
          collapsingRef.current = true;
          setIsCollapsing(true);
          applySwipeVisuals(-360, true);
          collapseTimerRef.current = window.setTimeout(() => {
            collapseTimerRef.current = null;
            if (onRemoveAt && removeIndex !== undefined) {
              onRemoveAt(removeIndex);
            } else {
              onRemoveFromQueue?.();
            }
            showToast("Removed from queue");
          }, 190);
          return;
        }
        applySwipeVisuals(0, true);
        return;
      }

      applySwipeVisuals(0, true);

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
      cancelDragRaf();
      if (!collapsingRef.current && dragXRef.current !== 0) {
        applySwipeVisuals(0, true);
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

    return (
      <div
        data-no-tab-swipe="true"
        style={{ touchAction: "pan-y" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onClickCapture={handleClickCapture}
        className={`relative overflow-hidden rounded-lg select-none xone-track-row transition-all duration-200 ease-out ${
          isCollapsing ? "max-h-0 opacity-0 my-0 py-0" : "max-h-40 opacity-100"
        }`}
      >
        {/* Stationary Action Backdrop Revealed During Drag */}
        <div
          ref={backdropRef}
          aria-hidden="true"
          style={{ visibility: isCollapsing ? "visible" : "hidden" }}
          className="absolute inset-0 flex items-center justify-between px-4 pointer-events-none transition-colors duration-150"
        >
          {/* Left Side Content (Revealed on Right Swipe: Add to Queue / Add to Jam) */}
          <div
            ref={leftActionRef}
            style={{ opacity: 0, transform: "scale3d(0.75, 0.75, 1)" }}
            className={`flex items-center gap-1.5 font-bold text-xs transition-transform duration-150 ${
              isJamActive ? "text-black" : "text-white"
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
            ref={rightActionRef}
            style={{
              opacity: isCollapsing ? 1 : 0,
              transform: isCollapsing
                ? "scale3d(1.1, 1.1, 1)"
                : "scale3d(0.75, 0.75, 1)",
            }}
            className={`flex items-center gap-1.5 font-bold text-xs transition-transform duration-150 ${
              mode === "queue" ? "text-white" : "text-black"
            }`}
          >
            {mode === "queue" ? (
              <>
                <span>Remove</span>
                <Trash2 size={18} />
              </>
            ) : (
              <Heart
                ref={heartIconRef}
                size={20}
                style={{ fill: isAlreadyLiked ? "#000000" : "none" }}
                className="text-black"
              />
            )}
          </div>
        </div>

        {/* Foreground Row Content */}
        <div
          ref={foregroundRef}
          style={{ transform: "translate3d(0px, 0, 0)" }}
          className="relative bg-[#000000]"
        >
          {children}
        </div>
      </div>
    );
  }
);

SwipeableTrackRow.displayName = "SwipeableTrackRow";
