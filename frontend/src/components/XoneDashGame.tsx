import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Gamepad2,
  Loader2,
  RotateCcw,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import {
  type DashLevel,
  type DashObstacle,
  lockDashLandscape,
  prepareDashLevel,
  restorePortraitOrientation,
  setDashImmersiveMode,
} from "../services/xoneDashService";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types";

type DashScreenPhase =
  | "preparing"
  | "playing"
  | "stage-clear"
  | "queue-complete"
  | "error";

const SPEED_UNITS_PER_SEC = 10.0;
const JUMP_VELOCITY = 18.8;
const GRAVITY = 86.0;
const CUBE_ROTATE_SPEED = Math.PI * 1.25;
const GRID_SIZE = 80;

export const XoneDashModal: React.FC = () => {
  const dashTrack = usePlayerStore((s) => s.dashTrack);
  const dashDifficulty = usePlayerStore((s) => s.dashDifficulty);
  const closeXoneDash = usePlayerStore((s) => s.closeXoneDash);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const playNextTrack = usePlayerStore((s) => s.playNextTrack);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);

  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [phase, setPhase] = useState<DashScreenPhase>("preparing");
  const [prepProgress, setPrepProgress] = useState(0);
  const [prepMessage, setPrepMessage] = useState(
    "Caching track & mapping beats..."
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(1);
  const [stageClearLabel, setStageClearLabel] = useState("Stage Clear!");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef<DashLevel | null>(null);
  const phaseRef = useRef<DashScreenPhase>("preparing");
  const rafRef = useRef<number | null>(null);
  const stageClearTimerRef = useRef<number | null>(null);
  const closedRef = useRef(false);
  const isHoldingJumpRef = useRef(false);

  // Direct DOM HUD refs (zero React re-renders during gameplay/restarts)
  const attemptRef = useRef(1);
  const attemptSpanRef = useRef<HTMLSpanElement | null>(null);
  const progressPctSpanRef = useRef<HTMLSpanElement | null>(null);
  const progressBarFillRef = useRef<HTMLDivElement | null>(null);

  // Smooth monotonic audio clock refs (never polls native bridge inside rAF)
  const audioClockRef = useRef({
    startPerfNow: 0,
    baseTimeSec: 0,
    elapsedSec: 0,
    pendingDriftSec: 0,
    pendingSeekZeroUntilMs: 0,
    isPlaying: false,
    rate: 1.0,
  });

  // Cube physics state (strictly mutable refs inside rAF)
  const gameRef = useRef({
    playerY: 0, // units above floor (0 = on ground)
    playerVy: 0,
    isGrounded: true,
    rotation: 0,
    worldScrollX: 0,
    jumpBufferUntilMs: 0,
    flashAlpha: 0,
    lastHudPct: -1,
    activeTrackVideoId: "",
  });

  phaseRef.current = phase;

  const syncHudDom = useCallback((pct: number, attempt?: number) => {
    if (progressPctSpanRef.current) {
      progressPctSpanRef.current.textContent = `${pct}%`;
    }
    if (progressBarFillRef.current) {
      progressBarFillRef.current.style.width = `${pct}%`;
    }
    if (attempt !== undefined && attemptSpanRef.current) {
      attemptSpanRef.current.textContent = `Attempt ${attempt}`;
    }
  }, []);

  const stopGameLoop = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (stageClearTimerRef.current !== null) {
      window.clearTimeout(stageClearTimerRef.current);
      stageClearTimerRef.current = null;
    }
  }, []);

  const resetCubeAndClock = useCallback((restartAudio: boolean) => {
    const g = gameRef.current;
    g.playerY = 0;
    g.playerVy = 0;
    g.isGrounded = true;
    g.rotation = 0;
    g.worldScrollX = 0;
    g.jumpBufferUntilMs = 0;
    g.lastHudPct = 0;
    syncHudDom(0, attemptRef.current);

    const now = performance.now();
    const clock = audioClockRef.current;
    clock.startPerfNow = now;
    clock.baseTimeSec = 0;
    clock.elapsedSec = 0;
    clock.pendingDriftSec = 0;
    clock.pendingSeekZeroUntilMs = restartAudio ? now + 700 : 0;

    if (restartAudio) {
      seekTo(0);
      if (!usePlayerStore.getState().isPlaying) {
        setIsPlaying(true);
      }
    }
  }, [seekTo, setIsPlaying, syncHudDom]);

  const startJumpHold = useCallback(() => {
    isHoldingJumpRef.current = true;
    if (phaseRef.current === "playing") {
      gameRef.current.jumpBufferUntilMs = performance.now() + 130;
    }
  }, []);

  const endJumpHold = useCallback(() => {
    isHoldingJumpRef.current = false;
  }, []);

  const startStageForTrack = useCallback(
    async (track: Track) => {
      if (closedRef.current) return;
      stopGameLoop();
      isHoldingJumpRef.current = false;
      levelRef.current = null;
      setActiveTrack(track);
      setPhase("preparing");
      setErrorMessage(null);
      attemptRef.current = 1;
      setAttemptCount(1);
      setPrepProgress(5);
      setPrepMessage("Caching track & mapping beats...");
      syncHudDom(0, 1);

      gameRef.current.activeTrackVideoId = track.video_id;
      gameRef.current.flashAlpha = 0;
      audioClockRef.current.pendingSeekZeroUntilMs = 0;

      // Ensure landscape orientation and immersive full-screen mode ASAP
      void lockDashLandscape();
      void setDashImmersiveMode(true);

      try {
        const difficulty = usePlayerStore.getState().dashDifficulty;
        const level = await prepareDashLevel(
          track,
          (p) => {
            if (!closedRef.current) {
              setPrepProgress(p.progress);
              setPrepMessage(p.message);
            }
          },
          difficulty
        );
        if (closedRef.current) return;

        levelRef.current = level;
        resetCubeAndClock(false);

        const store = usePlayerStore.getState();
        const isSameTrackPlaying =
          store.currentTrack?.video_id === track.video_id;
        if (isSameTrackPlaying) {
          store.seekTo(0);
          if (!store.isPlaying) {
            store.setIsPlaying(true);
          }
        } else {
          // Preserve current queue context if the track is already in queue
          const inQueue = store.queue.some((t) => t.video_id === track.video_id);
          playTrack(track, inQueue ? store.queue : [track]);
        }

        const now = performance.now();
        audioClockRef.current.startPerfNow = now;
        audioClockRef.current.baseTimeSec = 0;
        audioClockRef.current.elapsedSec = 0;
        audioClockRef.current.pendingDriftSec = 0;
        audioClockRef.current.pendingSeekZeroUntilMs = now + 700;
        audioClockRef.current.isPlaying = true;

        setPhase("playing");
      } catch (err) {
        if (closedRef.current) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Unable to prepare track for Xone Dash"
        );
        setPhase("error");
      }
    },
    [playTrack, resetCubeAndClock, stopGameLoop, syncHudDom]
  );

  // Open / close lifecycle driven by dashTrack
  useEffect(() => {
    if (!dashTrack) {
      closedRef.current = true;
      isHoldingJumpRef.current = false;
      stopGameLoop();
      levelRef.current = null;
      setActiveTrack(null);
      void setDashImmersiveMode(false);
      void restorePortraitOrientation();
      return;
    }
    closedRef.current = false;
    void startStageForTrack(dashTrack);

    return () => {
      closedRef.current = true;
      isHoldingJumpRef.current = false;
      stopGameLoop();
      void setDashImmersiveMode(false);
      void restorePortraitOrientation();
    };
  }, [dashTrack, startStageForTrack, stopGameLoop]);

  // Passive audio clock drift check (gentle <= 15ms nudge when drift > 40ms)
  useEffect(() => {
    if (!dashTrack) return;
    const syncSnapshot = () => {
      const s = usePlayerStore.getState();
      const clock = audioClockRef.current;
      const now = performance.now();
      clock.rate = s.srEnabled ? 0.87 : 1.0;

      if (now < clock.pendingSeekZeroUntilMs) {
        if (s.currentTime > 1.0) {
          // Ignore stale pre-seek timestamps while seekTo(0) commits
          return;
        }
        clock.pendingSeekZeroUntilMs = 0;
      }

      if (clock.isPlaying !== s.isPlaying) {
        if (s.isPlaying) {
          clock.baseTimeSec = clock.elapsedSec;
          clock.startPerfNow = now;
        } else {
          clock.baseTimeSec = clock.elapsedSec;
          clock.startPerfNow = now;
        }
        clock.isPlaying = s.isPlaying;
      }

      if (
        s.isPlaying &&
        gameRef.current.activeTrackVideoId &&
        s.currentTrack?.video_id === gameRef.current.activeTrackVideoId
      ) {
        const currentMono =
          clock.baseTimeSec +
          Math.max(0, (now - clock.startPerfNow) / 1000) * clock.rate;
        const drift = s.currentTime - currentMono;
        if (Math.abs(drift) > 0.04) {
          clock.pendingDriftSec = Math.max(
            -0.015,
            Math.min(0.015, drift * 0.25)
          );
        }
      }
    };

    syncSnapshot();
    const unsub = usePlayerStore.subscribe(syncSnapshot);
    return () => unsub();
  }, [dashTrack]);

  // Keyboard Spacebar / UpArrow hold & Escape exit
  const handleExit = useCallback(() => {
    closedRef.current = true;
    isHoldingJumpRef.current = false;
    stopGameLoop();
    levelRef.current = null;
    void setDashImmersiveMode(false);
    void restorePortraitOrientation();
    closeXoneDash();
  }, [closeXoneDash, stopGameLoop]);

  useEffect(() => {
    if (!dashTrack) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        startJumpHold();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleExit();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        endJumpHold();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", endJumpHold);
    window.addEventListener("pointerup", endJumpHold);
    window.addEventListener("pointercancel", endJumpHold);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", endJumpHold);
      window.removeEventListener("pointerup", endJumpHold);
      window.removeEventListener("pointercancel", endJumpHold);
    };
  }, [dashTrack, endJumpHold, handleExit, startJumpHold]);

  // Complete stage -> advance cleanly through queue
  const handleStageComplete = useCallback(() => {
    if (phaseRef.current !== "playing" || closedRef.current) return;
    isHoldingJumpRef.current = false;
    syncHudDom(100);
    setAttemptCount(attemptRef.current);
    setStageClearLabel("Stage Clear!");
    setPhase("stage-clear");

    stageClearTimerRef.current = window.setTimeout(() => {
      stageClearTimerRef.current = null;
      if (closedRef.current) return;

      const store = usePlayerStore.getState();
      const hasNextInQueue =
        store.queue.length > 0 &&
        (store.queueIndex + 1 < store.queue.length ||
          (store.repeat === "all" && store.queue.length > 0));

      if (hasNextInQueue) {
        const nextIdx =
          store.queueIndex + 1 < store.queue.length ? store.queueIndex + 1 : 0;
        const nextTrack = store.queue[nextIdx];
        if (nextTrack) {
          playNextTrack(false);
          void startStageForTrack(nextTrack);
          return;
        }
      }

      store.setIsPlaying(false);
      setPhase("queue-complete");
    }, 1500);
  }, [playNextTrack, startStageForTrack, syncHudDom]);

  // Main 60 FPS Canvas 2D Game Loop (kept alive across restarts with zero React remounts)
  useEffect(() => {
    if (phase !== "playing" || !levelRef.current) return;
    const canvas = canvasRef.current;
    const level = levelRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
    } as CanvasRenderingContext2DSettings);
    if (!ctx) return;

    let prevMs = performance.now();
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let canvasWidth = Math.max(320, canvas.clientWidth || window.innerWidth || 640);
    let canvasHeight = Math.max(200, canvas.clientHeight || window.innerHeight || 360);
    let firstVisibleIndex = 0;
    const visibleObstacles: DashObstacle[] = [];
    const totalObstacles = level.obstacles.length;

    const resizeCanvas = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      canvasWidth = Math.max(320, rect.width);
      canvasHeight = Math.max(200, rect.height);
      const targetW = Math.floor(canvasWidth * dpr);
      const targetH = Math.floor(canvasHeight * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("orientationchange", resizeCanvas);

    const handleCrashInPlace = (nowMs: number) => {
      const g = gameRef.current;
      g.playerY = 0;
      g.playerVy = 0;
      g.isGrounded = true;
      g.rotation = 0;
      g.worldScrollX = 0;
      g.jumpBufferUntilMs = 0;
      g.flashAlpha = 0.65;
      g.lastHudPct = 0;
      firstVisibleIndex = 0;

      attemptRef.current += 1;
      syncHudDom(0, attemptRef.current);

      const clock = audioClockRef.current;
      clock.startPerfNow = nowMs;
      clock.baseTimeSec = 0;
      clock.elapsedSec = 0;
      clock.pendingDriftSec = 0;
      clock.isPlaying = true;
      clock.pendingSeekZeroUntilMs = nowMs + 700;
      prevMs = nowMs;

      const store = usePlayerStore.getState();
      store.seekTo(0);
      if (!store.isPlaying) {
        store.setIsPlaying(true);
      }

      try {
        if (
          typeof navigator !== "undefined" &&
          typeof navigator.vibrate === "function"
        ) {
          navigator.vibrate(28);
        }
      } catch {
        // ignore vibration errors
      }
    };

    const collectVisibleObstacles = (
      simTimeSec: number,
      width: number,
      playerScreenX: number,
      pxPerSec: number,
      UNIT: number
    ) => {
      visibleObstacles.length = 0;
      while (firstVisibleIndex < totalObstacles) {
        const ob = level.obstacles[firstVisibleIndex];
        const blockW = ob.widthUnits * UNIT;
        const blockX = playerScreenX + (ob.timeSec - simTimeSec) * pxPerSec - blockW * 0.5;
        if (blockX + blockW < -50) {
          firstVisibleIndex += 1;
        } else {
          break;
        }
      }

      for (let i = firstVisibleIndex; i < totalObstacles; i += 1) {
        const ob = level.obstacles[i];
        const blockW = ob.widthUnits * UNIT;
        const blockX = playerScreenX + (ob.timeSec - simTimeSec) * pxPerSec - blockW * 0.5;
        if (blockX > width + 50) break;
        if (blockX + blockW >= -50) {
          visibleObstacles.push(ob);
        }
      }
    };

    const stepFrame = (nowMs: number) => {
      if (closedRef.current || phaseRef.current !== "playing") return;

      const dt = Math.min(0.033, Math.max(0.001, (nowMs - prevMs) / 1000));
      prevMs = nowMs;

      const width = canvasWidth;
      const height = canvasHeight;
      const UNIT = Math.max(26, Math.min(42, height * 0.115));
      const floorY = height * 0.8;
      const drawFloorY = Math.round(floorY);
      const playerScreenX = width * 0.22;
      const pxPerSec = UNIT * SPEED_UNITS_PER_SEC;

      // 1. Advance monotonic performance.now() master clock with gentle drift smoothing
      const clock = audioClockRef.current;
      if (clock.isPlaying) {
        if (Math.abs(clock.pendingDriftSec) > 0.0004) {
          const stepDrift =
            Math.sign(clock.pendingDriftSec) *
            Math.min(Math.abs(clock.pendingDriftSec), 0.004);
          clock.baseTimeSec += stepDrift;
          clock.pendingDriftSec -= stepDrift;
        } else {
          clock.pendingDriftSec = 0;
        }
        const nextTime =
          clock.baseTimeSec +
          Math.max(0, (nowMs - clock.startPerfNow) / 1000) * clock.rate;
        clock.elapsedSec = Math.max(clock.elapsedSec, nextTime);
      } else {
        clock.baseTimeSec = clock.elapsedSec;
        clock.startPerfNow = nowMs;
      }

      let simTime = Math.min(level.durationSec, Math.max(0, clock.elapsedSec));
      const g = gameRef.current;
      g.worldScrollX = simTime * pxPerSec;

      // Update HUD percentage directly via DOM text ref (0 React re-renders during gameplay)
      const pct = Math.min(
        100,
        Math.max(0, Math.floor((simTime / Math.max(1, level.durationSec)) * 100))
      );
      if (pct !== g.lastHudPct) {
        g.lastHudPct = pct;
        syncHudDom(pct);
      }

      // Check stage completion near end of track
      if (simTime >= level.durationSec - 0.15) {
        handleStageComplete();
        return;
      }

      // 2. Fade crash flash overlay
      if (g.flashAlpha > 0) {
        g.flashAlpha = Math.max(0, g.flashAlpha - dt * 4.5);
      }

      // 3. Player vertical physics + hold-to-jump & sliding-window block collision checks
      const playerWidthUnits = 1.0;
      const playerHeightUnits = 1.0;

      if (g.isGrounded && (isHoldingJumpRef.current || nowMs <= g.jumpBufferUntilMs)) {
        g.jumpBufferUntilMs = 0;
        g.isGrounded = false;
        g.playerVy = JUMP_VELOCITY;
      }

      const prevBottom = g.playerY;
      g.playerVy -= GRAVITY * dt;
      g.playerY += g.playerVy * dt;

      let supportTop = 0;
      collectVisibleObstacles(simTime, width, playerScreenX, pxPerSec, UNIT);
      let crashed = false;

      for (let i = 0; i < visibleObstacles.length; i += 1) {
        const ob = visibleObstacles[i];

        const obCenterRelUnits = (ob.timeSec - simTime) * SPEED_UNITS_PER_SEC;
        const obLeft = obCenterRelUnits - ob.widthUnits * 0.5;
        const obRight = obCenterRelUnits + ob.widthUnits * 0.5;
        const pLeft = -playerWidthUnits * 0.5;
        const pRight = playerWidthUnits * 0.5;

        if (ob.type === "overhead_block") {
          const insetX = 0.16;
          const insetY = 0.12;
          const obBottom = ob.elevationUnits;
          const hOverlap = pRight - insetX > obLeft && pLeft + insetX < obRight;
          if (hOverlap && g.playerY + playerHeightUnits > obBottom + insetY) {
            crashed = true;
            break;
          }
          continue;
        }

        // Solid Hyper Coral blocks & grounded pillars: safe on top, lethal on front vertical wall
        const obTop = ob.elevationUnits + ob.heightUnits;
        const obBottom = ob.elevationUnits;
        const overlapX = pRight - 0.14 > obLeft && pLeft + 0.14 < obRight;
        const topSnapZone = Math.min(0.35, Math.max(0.25, ob.heightUnits * 0.25));

        if (overlapX) {
          if (
            g.playerVy <= 0 &&
            prevBottom >= obTop - topSnapZone &&
            g.playerY <= obTop + 0.08
          ) {
            if (obTop > supportTop) {
              supportTop = obTop;
            }
          } else if (
            g.playerY < obTop - topSnapZone &&
            g.playerY + playerHeightUnits > obBottom + 0.14
          ) {
            crashed = true;
            break;
          }
        }
      }

      if (crashed) {
        handleCrashInPlace(nowMs);
        simTime = 0;
        collectVisibleObstacles(0, width, playerScreenX, pxPerSec, UNIT);
      } else if (g.playerY <= supportTop) {
        g.playerY = supportTop;
        g.playerVy = 0;
        g.isGrounded = true;
        // Snap rotation to nearest 90-degree angle when landed
        const snap = Math.round(g.rotation / (Math.PI / 2)) * (Math.PI / 2);
        g.rotation += (snap - g.rotation) * Math.min(1, dt * 22);

        // Auto-hop immediately on landing when holding jump
        if (isHoldingJumpRef.current || nowMs <= g.jumpBufferUntilMs) {
          g.jumpBufferUntilMs = 0;
          g.isGrounded = false;
          g.playerVy = JUMP_VELOCITY;
        }
      } else {
        g.isGrounded = false;
        g.rotation += CUBE_ROTATE_SPEED * dt;
      }

      // 4. Flat Two-Color Canvas 2D Render (Pure Black #000000 + Hyper Coral #FF5E4D, integer-snapped)
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      // Pure black background
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, Math.round(width), Math.round(height));

      // Large scrolling 80px x 80px square grid in faint translucent white
      const startGridX = -((g.worldScrollX * 0.5) % GRID_SIZE);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = startGridX; x <= width; x += GRID_SIZE) {
        const crispX = Math.round(x) + 0.5;
        ctx.moveTo(crispX, 0);
        ctx.lineTo(crispX, Math.round(height));
      }
      for (let y = drawFloorY - GRID_SIZE; y >= 0; y -= GRID_SIZE) {
        const crispY = Math.round(y) + 0.5;
        ctx.moveTo(0, crispY);
        ctx.lineTo(Math.round(width), crispY);
      }
      for (let y = drawFloorY + GRID_SIZE; y <= height; y += GRID_SIZE) {
        const crispY = Math.round(y) + 0.5;
        ctx.moveTo(0, crispY);
        ctx.lineTo(Math.round(width), crispY);
      }
      ctx.stroke();

      // Flat 2px Hyper Coral ground line
      ctx.strokeStyle = "#FF5E4D";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, drawFloorY);
      ctx.lineTo(Math.round(width), drawFloorY);
      ctx.stroke();

      // Batched solid Hyper Coral block obstacles & grounded pillars
      ctx.fillStyle = "#FF5E4D";
      for (let i = 0; i < visibleObstacles.length; i += 1) {
        const ob = visibleObstacles[i];
        const cx = playerScreenX + (ob.timeSec - simTime) * pxPerSec;
        const wPx = ob.widthUnits * UNIT;
        const hPx = ob.heightUnits * UNIT;
        const bottomY =
          ob.type === "platform" && ob.elevationUnits === 0
            ? drawFloorY
            : Math.round(floorY - ob.elevationUnits * UNIT);
        const bx = Math.round(cx - wPx * 0.5);
        const bw = Math.max(1, Math.round(wPx));

        if (ob.type === "overhead_block") {
          ctx.fillRect(bx, 0, bw, Math.max(8, bottomY));
        } else {
          const topY = Math.round(bottomY - hPx);
          const bh = Math.max(1, bottomY - topY);
          ctx.fillRect(bx, topY, bw, bh);
        }
      }

      // Hollow Hyper Coral Player Cube (transparent center, zero white, zero glow)
      const drawPlayerX = Math.round(playerScreenX);
      const drawCubeCenterY = Math.round(floorY - g.playerY * UNIT - UNIT * 0.5);
      ctx.save();
      ctx.translate(drawPlayerX, drawCubeCenterY);
      ctx.rotate(g.rotation);
      ctx.strokeStyle = "#FF5E4D";
      ctx.lineWidth = 3.5;
      const outerHalf = UNIT * 0.5 - 1.75;
      ctx.strokeRect(-outerHalf, -outerHalf, outerHalf * 2, outerHalf * 2);

      // Minimal hollow inner frame in Hyper Coral
      ctx.lineWidth = 2;
      const innerHalf = UNIT * 0.2;
      ctx.strokeRect(-innerHalf, -innerHalf, innerHalf * 2, innerHalf * 2);
      ctx.restore();

      // Brief crash flash overlay (0ms instant retry feedback)
      if (g.flashAlpha > 0) {
        ctx.fillStyle = `rgba(255, 94, 77, ${(g.flashAlpha * 0.35).toFixed(3)})`;
        ctx.fillRect(0, 0, Math.round(width), Math.round(height));
      }

      ctx.restore();
      rafRef.current = window.requestAnimationFrame(stepFrame);
    };

    rafRef.current = window.requestAnimationFrame(stepFrame);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
      window.removeEventListener("orientationchange", resizeCanvas);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [handleStageComplete, phase, syncHudDom]);

  if (!dashTrack) return null;

  const displayTrack = activeTrack || dashTrack;

  return (
    <div
      data-no-tab-swipe="true"
      role="dialog"
      aria-modal="true"
      aria-label="Xone Dash Rhythm Game"
      className="fixed inset-0 z-[130] bg-black text-white select-none overflow-hidden touch-none"
    >
      {/* Top-Left HUD (Track + Progress + Attempt) */}
      <div className="fixed top-0 left-0 z-20 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(1rem,env(safe-area-inset-left))] flex items-center gap-3 pointer-events-none">
        <div className="px-3 py-1.5 rounded-full bg-black/70 border border-white/15 flex items-center gap-2.5 max-w-[60vw]">
          <Gamepad2 size={15} className="text-[#FF5E4D] shrink-0" />
          <span className="text-xs font-bold text-white truncate">
            {displayTrack.title}
          </span>
          <span className="text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-zinc-200 shrink-0">
            {dashDifficulty}
          </span>
          <span
            ref={progressPctSpanRef}
            className="text-[11px] font-semibold text-[#FF5E4D] tabular-nums shrink-0"
          >
            0%
          </span>
          {phase === "playing" && (
            <span
              ref={attemptSpanRef}
              className="hidden sm:inline text-[11px] text-[#B3B3B3] tabular-nums shrink-0"
            >
              Attempt 1
            </span>
          )}
        </div>
      </div>

      {/* Top Progress Hairline */}
      {phase === "playing" && (
        <div className="fixed top-0 left-0 right-0 h-[3px] bg-white/10 z-20 pointer-events-none">
          <div
            ref={progressBarFillRef}
            className="h-full bg-[#FF5E4D]"
            style={{ width: "0%" }}
          />
        </div>
      )}

      {/* Pinned Top-Right Translucent Exit Button */}
      <button
        type="button"
        onClick={handleExit}
        aria-label="Exit Xone Dash"
        className="fixed top-0 right-0 z-30 mt-[max(0.75rem,env(safe-area-inset-top))] mr-[max(0.85rem,env(safe-area-inset-right))] min-h-[40px] px-3.5 py-1.5 rounded-full bg-black/65 hover:bg-black/85 active:scale-95 border border-white/15 text-xs font-bold text-white inline-flex items-center gap-1.5 transition-all"
      >
        <X size={15} className="text-[#FF5E4D]" />
        <span>Exit</span>
      </button>

      {/* Main 60 FPS Canvas Stage */}
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          e.preventDefault();
          startJumpHold();
        }}
        onPointerUp={endJumpHold}
        onPointerCancel={endJumpHold}
        onPointerLeave={endJumpHold}
        onTouchStart={(e) => {
          e.preventDefault();
          startJumpHold();
        }}
        onTouchEnd={endJumpHold}
        onTouchCancel={endJumpHold}
        className="w-full h-full block touch-none cursor-pointer"
      />

      {/* Caching & Beat Analysis Overlay */}
      {phase === "preparing" && (
        <div className="fixed inset-0 z-10 bg-black flex flex-col items-center justify-center p-6 text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#FF5E4D]/15 border border-[#FF5E4D]/40 flex items-center justify-center text-[#FF5E4D]">
            <Loader2 size={28} className="animate-spin" />
          </div>
          <div className="space-y-1 max-w-sm">
            <h2 className="text-lg font-extrabold text-white truncate">
              {displayTrack.title}
            </h2>
            <p className="text-xs font-semibold text-[#B3B3B3]">
              {prepMessage}
            </p>
          </div>
          <div className="w-60 h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#FF5E4D] transition-all duration-200 ease-out"
              style={{ width: `${prepProgress}%` }}
            />
          </div>
          <p className="text-[11px] font-bold text-[#FF5E4D] tabular-nums">
            {prepProgress}%
          </p>
        </div>
      )}

      {/* Stage Clear Flash (~1.5s before advancing to next queue song) */}
      {phase === "stage-clear" && (
        <div className="fixed inset-0 z-10 bg-black/60 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#FF5E4D] text-black text-base font-black shadow-2xl">
            <Sparkles size={18} />
            <span>{stageClearLabel}</span>
          </div>
          <p className="text-xs font-semibold text-white/80">
            Loading next track in queue...
          </p>
        </div>
      )}

      {/* Queue Complete Summary Overlay */}
      {phase === "queue-complete" && (
        <div className="fixed inset-0 z-10 bg-black/85 flex flex-col items-center justify-center p-6 text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#FF5E4D]/15 border border-[#FF5E4D]/40 flex items-center justify-center text-[#FF5E4D]">
            <Trophy size={28} />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-black text-white">Queue Complete</h2>
            <p className="text-xs text-[#B3B3B3]">
              Finished &ldquo;{displayTrack.title}&rdquo; in {attemptCount}{" "}
              {attemptCount === 1 ? "attempt" : "attempts"}.
            </p>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => void startStageForTrack(displayTrack)}
              className="min-h-[42px] px-5 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] text-black text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw size={14} />
              <span>Replay</span>
            </button>
            <button
              type="button"
              onClick={handleExit}
              className="min-h-[42px] px-5 rounded-full bg-[#1E1E1E] hover:bg-[#282828] border border-white/10 text-white text-xs font-bold transition-colors"
            >
              Exit
            </button>
          </div>
        </div>
      )}

      {/* Preparation Error Overlay */}
      {phase === "error" && (
        <div className="fixed inset-0 z-10 bg-black/90 flex flex-col items-center justify-center p-6 text-center gap-4">
          <p className="text-base font-extrabold text-white">
            Couldn&apos;t start Xone Dash
          </p>
          <p className="text-xs text-[#B3B3B3] max-w-sm">
            {errorMessage || "Unable to prepare this track right now."}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void startStageForTrack(displayTrack)}
              className="min-h-[42px] px-5 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] text-black text-xs font-extrabold inline-flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw size={14} />
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={handleExit}
              className="min-h-[42px] px-5 rounded-full bg-[#1E1E1E] hover:bg-[#282828] border border-white/10 text-white text-xs font-bold transition-colors"
            >
              Exit
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
