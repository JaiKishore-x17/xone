import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioWaveform,
  Loader2,
  RotateCcw,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import {
  type WaveLevel,
  lockWaveLandscape,
  prepareWaveLevel,
  restorePortraitOrientation,
  setWaveImmersiveMode,
} from "../services/xoneWaveService";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types";

type WaveScreenPhase =
  | "preparing"
  | "playing"
  | "stage-clear"
  | "queue-complete"
  | "error";

interface TrailPoint {
  timeSec: number;
  yNorm: number;
}

interface StarDot {
  xNorm: number;
  yNorm: number;
  radius: number;
  speedMult: number;
  color: string;
  glowColor: string | null;
  glowRadius: number;
}

interface StardustParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  maxAge: number;
  size: number;
}

const SCROLL_PX_PER_SEC_AT_360H = 380;
const STAR_COUNT = 72;
const STARDUST_POOL_SIZE = 32;
const RIDGE_OFFSET_PX = 12;
const CHECKPOINT_FRACTIONS = [0.25, 0.5, 0.75] as const;
const MAX_TRAIL_POINTS = 48;
const TRAIL_LIFETIME_SEC = 1.4;
const MAX_PITCH_RAD = (38 * Math.PI) / 180;
const THRUST_ACCEL_NORM_PER_SEC2 = 4.6;
const GRAVITY_ACCEL_NORM_PER_SEC2 = 4.2;
const MAX_ASCEND_SPEED_NORM = 0.88;
const MAX_DESCEND_SPEED_NORM = 0.88;
const DIRECTION_FLIP_DAMPING = 0.94;
const HITBOX_SCALE = 0.65;

const STAR_LAYER_SPECS = [
  {
    speedMult: 0.04,
    minR: 0.45,
    maxR: 0.65,
    glowMult: 0,
    colors: ["rgba(255, 255, 255, 0.14)", "rgba(255, 255, 255, 0.14)"],
    glowColors: [null, null],
  },
  {
    speedMult: 0.1,
    minR: 0.55,
    maxR: 0.8,
    glowMult: 0,
    colors: ["rgba(255, 255, 255, 0.20)", "rgba(255, 94, 77, 0.18)"],
    glowColors: [null, null],
  },
  {
    speedMult: 0.22,
    minR: 0.7,
    maxR: 0.95,
    glowMult: 2.8,
    colors: ["rgba(255, 255, 255, 0.30)", "rgba(255, 94, 77, 0.30)"],
    glowColors: ["rgba(255, 255, 255, 0.06)", "rgba(255, 94, 77, 0.07)"],
  },
  {
    speedMult: 0.4,
    minR: 0.85,
    maxR: 1.15,
    glowMult: 3.1,
    colors: ["rgba(255, 255, 255, 0.42)", "rgba(255, 94, 77, 0.42)"],
    glowColors: ["rgba(255, 255, 255, 0.08)", "rgba(255, 94, 77, 0.10)"],
  },
  {
    speedMult: 0.65,
    minR: 1.0,
    maxR: 1.35,
    glowMult: 3.4,
    colors: ["rgba(255, 255, 255, 0.55)", "rgba(255, 94, 77, 0.54)"],
    glowColors: ["rgba(255, 255, 255, 0.10)", "rgba(255, 94, 77, 0.13)"],
  },
] as const;

function createStarfield(): StarDot[] {
  let seed = 0x517cc1b7;
  const nextRand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stars: StarDot[] = [];
  for (let i = 0; i < STAR_COUNT; i += 1) {
    // 20 ultra-far (0.04x), 18 far (0.10x), 14 mid (0.22x), 12 near (0.40x), 8 close (0.65x)
    let layerIdx = 0;
    if (i >= 64) layerIdx = 4;
    else if (i >= 52) layerIdx = 3;
    else if (i >= 38) layerIdx = 2;
    else if (i >= 20) layerIdx = 1;

    const spec = STAR_LAYER_SPECS[layerIdx];
    const useCoral = layerIdx > 0 && nextRand() < (layerIdx >= 3 ? 0.4 : 0.28);
    const radius = spec.minR + nextRand() * (spec.maxR - spec.minR);
    stars.push({
      xNorm: nextRand(),
      yNorm: 0.04 + nextRand() * 0.92,
      radius,
      speedMult: spec.speedMult,
      color: useCoral ? spec.colors[1] : spec.colors[0],
      glowColor: useCoral ? spec.glowColors[1] : spec.glowColors[0],
      glowRadius: radius * spec.glowMult,
    });
  }
  stars.sort((a, b) => a.color.localeCompare(b.color));
  return stars;
}

function getSliceEnergyFallback(ceilingY: number, floorY: number): number {
  return Math.min(
    1,
    Math.max(0, (ceilingY - 0.06 + (0.94 - floorY)) / 0.56)
  );
}

function sampleCanyonAtTime(
  level: WaveLevel,
  timeSec: number
): { ceilingY: number; floorY: number; energy: number } {
  const slices = level.slices;
  const n = slices.length;
  if (n === 0) return { ceilingY: 0.25, floorY: 0.75, energy: 0.2 };
  if (timeSec <= slices[0].t) {
    const s = slices[0];
    return {
      ceilingY: s.ceilingY,
      floorY: s.floorY,
      energy: s.energy ?? getSliceEnergyFallback(s.ceilingY, s.floorY),
    };
  }
  if (timeSec >= slices[n - 1].t) {
    const s = slices[n - 1];
    return {
      ceilingY: s.ceilingY,
      floorY: s.floorY,
      energy: s.energy ?? getSliceEnergyFallback(s.ceilingY, s.floorY),
    };
  }

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (slices[mid].t <= timeSec) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const s0 = slices[lo];
  const s1 = slices[lo + 1];
  const span = Math.max(0.0001, s1.t - s0.t);
  const frac = Math.min(1, Math.max(0, (timeSec - s0.t) / span));
  const e0 = s0.energy ?? getSliceEnergyFallback(s0.ceilingY, s0.floorY);
  const e1 = s1.energy ?? getSliceEnergyFallback(s1.ceilingY, s1.floorY);
  return {
    ceilingY: s0.ceilingY + (s1.ceilingY - s0.ceilingY) * frac,
    floorY: s0.floorY + (s1.floorY - s0.floorY) * frac,
    energy: e0 + (e1 - e0) * frac,
  };
}

export const XoneWaveModal: React.FC = () => {
  const waveTrack = usePlayerStore((s) => s.waveTrack);
  const closeXoneWave = usePlayerStore((s) => s.closeXoneWave);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const playNextTrack = usePlayerStore((s) => s.playNextTrack);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const setIsPlaying = usePlayerStore((s) => s.setIsPlaying);

  const [activeTrack, setActiveTrack] = useState<Track | null>(null);
  const [phase, setPhase] = useState<WaveScreenPhase>("preparing");
  const [prepProgress, setPrepProgress] = useState(0);
  const [prepMessage, setPrepMessage] = useState(
    "Caching audio & shaping canyon..."
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(1);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const levelRef = useRef<WaveLevel | null>(null);
  const phaseRef = useRef<WaveScreenPhase>("preparing");
  const rafRef = useRef<number | null>(null);
  const stageClearTimerRef = useRef<number | null>(null);
  const closedRef = useRef(false);

  // Hold-to-ascend / release-gravity thruster refs (zero React re-renders)
  const isThrustingRef = useRef(false);
  const pointerThrustRef = useRef(false);
  const keyThrustRef = useRef(false);

  // Direct DOM HUD, checkpoint & song pill swipe refs
  const attemptRef = useRef(1);
  const attemptSpanRef = useRef<HTMLSpanElement | null>(null);
  const progressPctSpanRef = useRef<HTMLSpanElement | null>(null);
  const progressBarFillRef = useRef<HTMLDivElement | null>(null);
  const checkpointProgressRef = useRef<0 | 0.25 | 0.5 | 0.75>(0);
  const checkpointBannerRef = useRef<HTMLDivElement | null>(null);
  const checkpointTimerRef = useRef<number | null>(null);
  const stageNonceRef = useRef(0);
  const pillSwipeRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
  });

  // Smooth monotonic clock refs (never polls native bridge inside rAF)
  const audioClockRef = useRef({
    startPerfNow: 0,
    baseTimeSec: 0,
    elapsedSec: 0,
    pendingDriftSec: 0,
    pendingSeekUntilMs: 0,
    pendingSeekTargetSec: 0,
    isPlaying: false,
    rate: 1.0,
  });

  // Ship state + pre-allocated 48-slot trail ring buffer + 60-star & 32-particle pools
  const starsRef = useRef<StarDot[]>(createStarfield());
  const stardustRef = useRef({
    pool: Array.from(
      { length: STARDUST_POOL_SIZE },
      (): StardustParticle => ({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        age: 0,
        maxAge: 0.4,
        size: 1.5,
      })
    ),
    cursor: 0,
    emitAccumSec: 0,
  });

  const shipRef = useRef({
    yNorm: 0.5,
    vyNorm: 0,
    vyPxPerSec: 0,
    angleRad: 0,
    lastYNorm: 0.5,
    haloEnergy: 0.15,
    flashAlpha: 0,
    lastHudPct: -1,
    activeTrackVideoId: "",
    trailRing: Array.from({ length: MAX_TRAIL_POINTS }, (): TrailPoint => ({
      timeSec: 0,
      yNorm: 0.5,
    })),
    trailHead: 0,
    trailCount: 0,
    lastTrailTimeSec: -1,
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

  const hideCheckpointHud = useCallback(() => {
    if (checkpointTimerRef.current !== null) {
      window.clearTimeout(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }
    if (checkpointBannerRef.current) {
      checkpointBannerRef.current.style.opacity = "0";
    }
  }, []);

  const flashCheckpointHud = useCallback((label: string) => {
    if (checkpointTimerRef.current !== null) {
      window.clearTimeout(checkpointTimerRef.current);
      checkpointTimerRef.current = null;
    }
    const el = checkpointBannerRef.current;
    if (el) {
      el.textContent = label;
      el.style.opacity = "1";
    }
    checkpointTimerRef.current = window.setTimeout(() => {
      checkpointTimerRef.current = null;
      if (checkpointBannerRef.current) {
        checkpointBannerRef.current.style.opacity = "0";
      }
    }, 1800);
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
    hideCheckpointHud();
  }, [hideCheckpointHud]);

  const resetShipAndClock = useCallback(
    (restartAudio: boolean) => {
      const ship = shipRef.current;
      ship.yNorm = 0.5;
      ship.lastYNorm = 0.5;
      ship.vyNorm = 0;
      ship.vyPxPerSec = 0;
      ship.angleRad = 0;
      ship.haloEnergy = 0.15;
      ship.trailHead = 0;
      ship.trailCount = 0;
      ship.lastTrailTimeSec = -1;
      ship.lastHudPct = 0;

      const dust = stardustRef.current;
      dust.cursor = 0;
      dust.emitAccumSec = 0;
      for (let i = 0; i < dust.pool.length; i += 1) {
        dust.pool[i].active = false;
      }

      syncHudDom(0, attemptRef.current);

      const now = performance.now();
      const clock = audioClockRef.current;
      clock.startPerfNow = now;
      clock.baseTimeSec = 0;
      clock.elapsedSec = 0;
      clock.pendingDriftSec = 0;
      clock.pendingSeekUntilMs = restartAudio ? now + 700 : 0;
      clock.pendingSeekTargetSec = 0;

      if (restartAudio) {
        seekTo(0);
        if (!usePlayerStore.getState().isPlaying) {
          setIsPlaying(true);
        }
      }
    },
    [seekTo, setIsPlaying, syncHudDom]
  );

  const startStageForTrack = useCallback(
    async (track: Track) => {
      if (closedRef.current) return;
      const myNonce = ++stageNonceRef.current;
      stopGameLoop();
      pointerThrustRef.current = false;
      keyThrustRef.current = false;
      isThrustingRef.current = false;
      checkpointProgressRef.current = 0;
      levelRef.current = null;
      setActiveTrack(track);
      setPhase("preparing");
      setErrorMessage(null);
      attemptRef.current = 1;
      setAttemptCount(1);
      setPrepProgress(5);
      setPrepMessage("Caching audio & shaping canyon...");
      syncHudDom(0, 1);

      shipRef.current.activeTrackVideoId = track.video_id;
      shipRef.current.flashAlpha = 0;
      audioClockRef.current.pendingSeekUntilMs = 0;
      audioClockRef.current.pendingSeekTargetSec = 0;

      // Pause old track cleanly while preparing a different track
      const initialStore = usePlayerStore.getState();
      if (initialStore.currentTrack?.video_id !== track.video_id && initialStore.isPlaying) {
        initialStore.setIsPlaying(false);
      }

      // Lock SENSOR_LANDSCAPE and hide status/nav bars ASAP
      void lockWaveLandscape();
      void setWaveImmersiveMode(true);

      try {
        const level = await prepareWaveLevel(track, (p) => {
          if (!closedRef.current && stageNonceRef.current === myNonce) {
            setPrepProgress(p.progress);
            setPrepMessage(p.message);
          }
        });
        if (closedRef.current || stageNonceRef.current !== myNonce) return;

        levelRef.current = level;
        resetShipAndClock(false);

        const store = usePlayerStore.getState();
        const isSameTrackPlaying =
          store.currentTrack?.video_id === track.video_id;
        if (isSameTrackPlaying) {
          store.seekTo(0);
          if (!store.isPlaying) {
            store.setIsPlaying(true);
          }
        } else {
          const inQueue = store.queue.some((t) => t.video_id === track.video_id);
          playTrack(track, inQueue ? store.queue : [track]);
        }

        const now = performance.now();
        audioClockRef.current.startPerfNow = now;
        audioClockRef.current.baseTimeSec = 0;
        audioClockRef.current.elapsedSec = 0;
        audioClockRef.current.pendingDriftSec = 0;
        audioClockRef.current.pendingSeekUntilMs = now + 700;
        audioClockRef.current.pendingSeekTargetSec = 0;
        audioClockRef.current.isPlaying = true;

        setPhase("playing");
      } catch (err) {
        if (closedRef.current || stageNonceRef.current !== myNonce) return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : "Unable to prepare track for Xone Wave"
        );
        setPhase("error");
      }
    },
    [playTrack, resetShipAndClock, stopGameLoop, syncHudDom]
  );

  const switchQueueTrack = useCallback(
    (direction: 1 | -1) => {
      if (closedRef.current) return;
      const store = usePlayerStore.getState();
      const queue = store.queue;
      if (queue.length <= 1) return;

      const cur = activeTrack || waveTrack || store.currentTrack;
      let curIdx = cur
        ? queue.findIndex((t) =>
            cur.queueItemId && t.queueItemId
              ? t.queueItemId === cur.queueItemId
              : t.video_id === cur.video_id
          )
        : store.queueIndex;
      if (curIdx < 0) {
        curIdx = Math.max(0, Math.min(queue.length - 1, store.queueIndex));
      }

      const nextIdx = (curIdx + direction + queue.length) % queue.length;
      if (nextIdx === curIdx) return;
      const targetTrack = queue[nextIdx];
      if (targetTrack) {
        void startStageForTrack(targetTrack);
      }
    },
    [activeTrack, startStageForTrack, waveTrack]
  );

  // Open / close lifecycle driven by waveTrack
  useEffect(() => {
    if (!waveTrack) {
      closedRef.current = true;
      stopGameLoop();
      levelRef.current = null;
      setActiveTrack(null);
      void setWaveImmersiveMode(false);
      void restorePortraitOrientation();
      return;
    }
    closedRef.current = false;
    void startStageForTrack(waveTrack);

    return () => {
      closedRef.current = true;
      stopGameLoop();
      void setWaveImmersiveMode(false);
      void restorePortraitOrientation();
    };
  }, [waveTrack, startStageForTrack, stopGameLoop]);

  // Passive audio clock drift listener (<= 15ms nudge when drift > 40ms)
  useEffect(() => {
    if (!waveTrack) return;
    const syncSnapshot = () => {
      const s = usePlayerStore.getState();
      const clock = audioClockRef.current;
      const now = performance.now();
      clock.rate = s.srEnabled ? 0.87 : 1.0;

      if (now < clock.pendingSeekUntilMs) {
        if (Math.abs(s.currentTime - clock.pendingSeekTargetSec) > 1.2) {
          return;
        }
        clock.pendingSeekUntilMs = 0;
      }

      if (clock.isPlaying !== s.isPlaying) {
        clock.baseTimeSec = clock.elapsedSec;
        clock.startPerfNow = now;
        clock.isPlaying = s.isPlaying;
      }

      if (
        s.isPlaying &&
        shipRef.current.activeTrackVideoId &&
        s.currentTrack?.video_id === shipRef.current.activeTrackVideoId
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
  }, [waveTrack]);

  const handleExit = useCallback(() => {
    closedRef.current = true;
    stageNonceRef.current += 1;
    pointerThrustRef.current = false;
    keyThrustRef.current = false;
    isThrustingRef.current = false;
    checkpointProgressRef.current = 0;
    stopGameLoop();
    levelRef.current = null;
    void setWaveImmersiveMode(false);
    void restorePortraitOrientation();
    closeXoneWave();
  }, [closeXoneWave, stopGameLoop]);

  // Keyboard Space / ArrowUp / W hold-to-ascend + Escape exit
  useEffect(() => {
    if (!waveTrack) return;
    const isThrustKey = (e: KeyboardEvent) =>
      e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW";
    const onKeyDown = (e: KeyboardEvent) => {
      if (isThrustKey(e)) {
        e.preventDefault();
        keyThrustRef.current = true;
        isThrustingRef.current = true;
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleExit();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isThrustKey(e)) {
        keyThrustRef.current = false;
        isThrustingRef.current = pointerThrustRef.current;
      }
    };
    const clearPointerThrust = () => {
      pointerThrustRef.current = false;
      isThrustingRef.current = keyThrustRef.current;
    };
    const clearAllThrust = () => {
      keyThrustRef.current = false;
      pointerThrustRef.current = false;
      isThrustingRef.current = false;
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerup", clearPointerThrust, true);
    window.addEventListener("pointercancel", clearPointerThrust, true);
    window.addEventListener("blur", clearAllThrust);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerup", clearPointerThrust, true);
      window.removeEventListener("pointercancel", clearPointerThrust, true);
      window.removeEventListener("blur", clearAllThrust);
    };
  }, [waveTrack, handleExit]);

  // Complete stage -> show brief "Stage Clear" then launch next song in queue
  const handleStageComplete = useCallback(() => {
    if (phaseRef.current !== "playing" || closedRef.current) return;
    pointerThrustRef.current = false;
    keyThrustRef.current = false;
    isThrustingRef.current = false;
    checkpointProgressRef.current = 0;
    hideCheckpointHud();
    syncHudDom(100);
    setAttemptCount(attemptRef.current);
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

  // Locked 60 FPS Canvas 2D Game Loop
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
    let firstVisibleSliceIdx = 0;

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
      const respawnTimeSec = checkpointProgressRef.current * level.durationSec;
      const safeSlice = sampleCanyonAtTime(level, respawnTimeSec);
      const respawnYNorm = Math.min(
        0.9,
        Math.max(0.1, (safeSlice.ceilingY + safeSlice.floorY) * 0.5)
      );

      const ship = shipRef.current;
      ship.yNorm = respawnYNorm;
      ship.lastYNorm = respawnYNorm;
      ship.vyNorm = 0;
      ship.vyPxPerSec = 0;
      ship.angleRad = 0;
      ship.haloEnergy = 0.15;
      ship.trailHead = 0;
      ship.trailCount = 0;
      ship.lastTrailTimeSec = -1;
      ship.flashAlpha = 0.65;
      ship.lastHudPct = Math.floor(checkpointProgressRef.current * 100);
      firstVisibleSliceIdx = 0;

      const dust = stardustRef.current;
      dust.cursor = 0;
      dust.emitAccumSec = 0;
      for (let i = 0; i < dust.pool.length; i += 1) {
        dust.pool[i].active = false;
      }

      attemptRef.current += 1;
      syncHudDom(ship.lastHudPct, attemptRef.current);

      const clock = audioClockRef.current;
      clock.startPerfNow = nowMs;
      clock.baseTimeSec = respawnTimeSec;
      clock.elapsedSec = respawnTimeSec;
      clock.pendingDriftSec = 0;
      clock.isPlaying = true;
      clock.pendingSeekUntilMs = nowMs + 700;
      clock.pendingSeekTargetSec = respawnTimeSec;
      prevMs = nowMs;

      const store = usePlayerStore.getState();
      store.seekTo(respawnTimeSec);
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

    const stepFrame = (nowMs: number) => {
      if (closedRef.current || phaseRef.current !== "playing") return;

      const dt = Math.min(0.033, Math.max(0.001, (nowMs - prevMs) / 1000));
      prevMs = nowMs;

      const width = canvasWidth;
      const height = canvasHeight;
      const drawW = Math.round(width);
      const drawH = Math.round(height);
      const scrollPxPerSec =
        SCROLL_PX_PER_SEC_AT_360H * (Math.max(240, height) / 360);
      const shipScreenX = width * 0.22;
      const shipSize = Math.max(18, Math.min(30, height * 0.068));

      // 1. Advance monotonic master clock with gentle bounded drift smoothing
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

      // Update DOM HUD percentage & 25%/50%/75% checkpoint tracking (0 React re-renders during active play)
      const progressFrac = simTime / Math.max(1, level.durationSec);
      const pct = Math.min(100, Math.max(0, Math.floor(progressFrac * 100)));
      const ship = shipRef.current;
      if (pct !== ship.lastHudPct) {
        ship.lastHudPct = pct;
        syncHudDom(pct);
      }

      if (progressFrac >= 0.75 && checkpointProgressRef.current < 0.75) {
        checkpointProgressRef.current = 0.75;
        flashCheckpointHud("Checkpoint 75%");
      } else if (progressFrac >= 0.5 && checkpointProgressRef.current < 0.5) {
        checkpointProgressRef.current = 0.5;
        flashCheckpointHud("Checkpoint 50%");
      } else if (progressFrac >= 0.25 && checkpointProgressRef.current < 0.25) {
        checkpointProgressRef.current = 0.25;
        flashCheckpointHud("Checkpoint 25%");
      }

      if (simTime >= level.durationSec - 0.15) {
        handleStageComplete();
        return;
      }

      if (ship.flashAlpha > 0) {
        ship.flashAlpha = Math.max(0, ship.flashAlpha - dt * 4.5);
      }

      // 2. Smooth hold-to-ascend thruster / release gravity physics & dynamic pitch
      const minNormY = 12 / Math.max(1, height);
      const maxNormY = 1 - minNormY;
      const thrusting =
        isThrustingRef.current ||
        pointerThrustRef.current ||
        keyThrustRef.current;

      if (thrusting) {
        if (ship.vyNorm > 0) {
          ship.vyNorm *= DIRECTION_FLIP_DAMPING;
        }
        ship.vyNorm = Math.max(
          -MAX_ASCEND_SPEED_NORM,
          ship.vyNorm - THRUST_ACCEL_NORM_PER_SEC2 * dt
        );
      } else {
        if (ship.vyNorm < 0) {
          ship.vyNorm *= DIRECTION_FLIP_DAMPING;
        }
        ship.vyNorm = Math.min(
          MAX_DESCEND_SPEED_NORM,
          ship.vyNorm + GRAVITY_ACCEL_NORM_PER_SEC2 * dt
        );
      }

      ship.yNorm += ship.vyNorm * dt;
      if (ship.yNorm < minNormY) {
        ship.yNorm = minNormY;
        if (ship.vyNorm < 0) ship.vyNorm = 0;
      } else if (ship.yNorm > maxNormY) {
        ship.yNorm = maxNormY;
        if (ship.vyNorm > 0) ship.vyNorm = 0;
      }

      const shipY = ship.yNorm * height;
      ship.lastYNorm = ship.yNorm;
      ship.vyPxPerSec = ship.vyNorm * height;

      const targetAngle = Math.max(
        -MAX_PITCH_RAD,
        Math.min(MAX_PITCH_RAD, Math.atan2(ship.vyPxPerSec, scrollPxPerSec))
      );
      ship.angleRad += (targetAngle - ship.angleRad) * Math.min(1, dt * 18);

      // Record world-anchored point in ring buffer every ~28ms
      if (
        ship.lastTrailTimeSec < 0 ||
        simTime - ship.lastTrailTimeSec >= 0.028
      ) {
        ship.lastTrailTimeSec = simTime;
        const slot = ship.trailRing[ship.trailHead];
        slot.timeSec = simTime;
        slot.yNorm = ship.yNorm;
        ship.trailHead = (ship.trailHead + 1) % MAX_TRAIL_POINTS;
        if (ship.trailCount < MAX_TRAIL_POINTS) {
          ship.trailCount += 1;
        }
      }

      // 3. Triangle inner-core (65%) collision against interpolated ceiling & floor ridges
      const cosA = Math.cos(ship.angleRad);
      const sinA = Math.sin(ship.angleRad);
      const noseLocalX = shipSize * 0.65 * HITBOX_SCALE;
      const tailLocalX = -shipSize * 0.48 * HITBOX_SCALE;
      const wingLocalY = shipSize * 0.44 * HITBOX_SCALE;

      const noseX = shipScreenX + noseLocalX * cosA;
      const noseY = shipY + noseLocalX * sinA;
      const upperWingX = shipScreenX + tailLocalX * cosA - -wingLocalY * sinA;
      const upperWingY = shipY + tailLocalX * sinA + -wingLocalY * cosA;
      const lowerWingX = shipScreenX + tailLocalX * cosA - wingLocalY * sinA;
      const lowerWingY = shipY + tailLocalX * sinA + wingLocalY * cosA;

      const noseT = simTime + (noseX - shipScreenX) / scrollPxPerSec;
      const upperWingT = simTime + (upperWingX - shipScreenX) / scrollPxPerSec;
      const lowerWingT = simTime + (lowerWingX - shipScreenX) / scrollPxPerSec;

      const noseCanyon = sampleCanyonAtTime(level, noseT);
      const upperCanyon = sampleCanyonAtTime(level, upperWingT);
      const lowerCanyon = sampleCanyonAtTime(level, lowerWingT);

      const hitCanyon =
        noseY <= noseCanyon.ceilingY * height ||
        noseY >= noseCanyon.floorY * height ||
        upperWingY <= upperCanyon.ceilingY * height ||
        upperWingY >= upperCanyon.floorY * height ||
        lowerWingY <= lowerCanyon.ceilingY * height ||
        lowerWingY >= lowerCanyon.floorY * height;

      if (hitCanyon) {
        handleCrashInPlace(nowMs);
        simTime = checkpointProgressRef.current * level.durationSec;
      }

      const drawShipY = ship.yNorm * height;
      const drawCosA = Math.cos(ship.angleRad);
      const drawSinA = Math.sin(ship.angleRad);
      const tailCenterX = shipScreenX - shipSize * 0.28 * drawCosA;
      const tailCenterY = drawShipY - shipSize * 0.28 * drawSinA;

      // Update fixed 32-particle thruster stardust pool (emit softly while ascending)
      const dustState = stardustRef.current;
      const thrustActive =
        isThrustingRef.current ||
        pointerThrustRef.current ||
        keyThrustRef.current;
      if (!hitCanyon && thrustActive) {
        dustState.emitAccumSec += dt;
        if (dustState.emitAccumSec >= 0.028) {
          dustState.emitAccumSec = 0;
          const p = dustState.pool[dustState.cursor];
          dustState.cursor = (dustState.cursor + 1) % STARDUST_POOL_SIZE;
          p.active = true;
          p.x = tailCenterX;
          p.y = tailCenterY;
          p.vx = -scrollPxPerSec * (0.45 + Math.random() * 0.35);
          p.vy = ship.vyPxPerSec * 0.15 + (Math.random() - 0.5) * 44 + 16;
          p.age = 0;
          p.maxAge = 0.35 + Math.random() * 0.3;
          p.size = 1.2 + Math.random() * 1.3;
        }
      } else {
        dustState.emitAccumSec = 0;
      }

      for (let i = 0; i < dustState.pool.length; i += 1) {
        const p = dustState.pool[i];
        if (!p.active) continue;
        p.age += dt;
        if (p.age >= p.maxAge) {
          p.active = false;
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }

      // 4. Nocturnal Obsidian & Hyper Coral Canvas 2D Render (Pure #000000 Sky, Zero ShadowBlur)
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, drawW, drawH);

      // Deep-space 72-particle 5-layer parallax starfield (0.04x..0.65x) with subtle glow
      const worldScrollX = simTime * scrollPxPerSec;
      const stars = starsRef.current;
      if (stars.length > 0) {
        // Pass 1: Soft low-opacity glow halos around mid/close particles (no shadowBlur cost)
        let activeGlow = "";
        ctx.beginPath();
        for (let i = 0; i < stars.length; i += 1) {
          const star = stars[i];
          if (!star.glowColor) continue;
          if (star.glowColor !== activeGlow) {
            if (activeGlow) {
              ctx.fill();
            }
            activeGlow = star.glowColor;
            ctx.fillStyle = activeGlow;
            ctx.beginPath();
          }
          const sx =
            (((star.xNorm * width - worldScrollX * star.speedMult) % width) +
              width) %
            width;
          const sy = star.yNorm * height;
          ctx.moveTo(sx + star.glowRadius, sy);
          ctx.arc(sx, sy, star.glowRadius, 0, Math.PI * 2);
        }
        if (activeGlow) {
          ctx.fill();
        }

        // Pass 2: Crisp micro-cores batched by color
        let activeColor = "";
        ctx.beginPath();
        for (let i = 0; i < stars.length; i += 1) {
          const star = stars[i];
          if (star.color !== activeColor) {
            if (activeColor) {
              ctx.fill();
            }
            activeColor = star.color;
            ctx.fillStyle = activeColor;
            ctx.beginPath();
          }
          const sx =
            (((star.xNorm * width - worldScrollX * star.speedMult) % width) +
              width) %
            width;
          const sy = star.yNorm * height;
          ctx.moveTo(sx + star.radius, sy);
          ctx.arc(sx, sy, star.radius, 0, Math.PI * 2);
        }
        if (activeColor) {
          ctx.fill();
        }
      }

      // Sliding spatial culling over alternating mountain vertices within [-60px, viewportWidth + 60px]
      const slices = level.slices;
      const totalSlices = slices.length;
      while (firstVisibleSliceIdx + 1 < totalSlices) {
        const nextX =
          shipScreenX + (slices[firstVisibleSliceIdx + 1].t - simTime) * scrollPxPerSec;
        if (nextX < -60) {
          firstVisibleSliceIdx += 1;
        } else {
          break;
        }
      }

      const startIdx = firstVisibleSliceIdx;
      let endIdx = startIdx;
      while (endIdx + 1 < totalSlices) {
        const curX = shipScreenX + (slices[endIdx].t - simTime) * scrollPxPerSec;
        endIdx += 1;
        if (curX > width + 60) {
          break;
        }
      }

      if (endIdx > startIdx) {
        let maxVisibleCeilY = 0;
        let minVisibleFloorY = drawH;
        for (let idx = startIdx; idx <= endIdx; idx += 1) {
          const sl = slices[idx];
          const cy = Math.round(sl.ceilingY * height);
          const fy = Math.round(sl.floorY * height);
          if (cy > maxVisibleCeilY) maxVisibleCeilY = cy;
          if (fy < minVisibleFloorY) minVisibleFloorY = fy;
        }

        const firstSliceX = Math.round(
          shipScreenX + (slices[startIdx].t - simTime) * scrollPxPerSec
        );
        const lastSliceX = Math.round(
          shipScreenX + (slices[endIdx].t - simTime) * scrollPxPerSec
        );
        const rimFadeSpan = Math.max(48, height * 0.26);

        // --- Upper Ceiling Mountain: Opaque #08080B + Soft Coral Rim Gradient + Layered Ridges ---
        ctx.beginPath();
        ctx.moveTo(firstSliceX, 0);
        for (let idx = startIdx; idx <= endIdx; idx += 1) {
          const sl = slices[idx];
          const sx = Math.round(shipScreenX + (sl.t - simTime) * scrollPxPerSec);
          const cy = Math.round(sl.ceilingY * height);
          ctx.lineTo(sx, cy);
        }
        ctx.lineTo(lastSliceX, 0);
        ctx.closePath();
        ctx.fillStyle = "#08080B";
        ctx.fill();

        const ceilGrad = ctx.createLinearGradient(
          0,
          maxVisibleCeilY,
          0,
          Math.max(0, maxVisibleCeilY - rimFadeSpan)
        );
        ceilGrad.addColorStop(0, "rgba(255, 94, 77, 0.16)");
        ceilGrad.addColorStop(0.38, "rgba(255, 94, 77, 0.04)");
        ceilGrad.addColorStop(1, "rgba(8, 8, 11, 0)");
        ctx.fillStyle = ceilGrad;
        ctx.fill();

        // Secondary offset ridge line (12px deeper inside ceiling mountain)
        ctx.lineJoin = "miter";
        ctx.miterLimit = 6;
        ctx.beginPath();
        for (let idx = startIdx; idx <= endIdx; idx += 1) {
          const sl = slices[idx];
          const sx = Math.round(shipScreenX + (sl.t - simTime) * scrollPxPerSec);
          const cyInner = Math.round(sl.ceilingY * height) - RIDGE_OFFSET_PX;
          if (idx === startIdx) {
            ctx.moveTo(sx, cyInner);
          } else {
            ctx.lineTo(sx, cyInner);
          }
        }
        ctx.strokeStyle = "rgba(255, 94, 77, 0.18)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Primary luminous 2px Hyper Coral outer ceiling silhouette
        ctx.beginPath();
        for (let idx = startIdx; idx <= endIdx; idx += 1) {
          const sl = slices[idx];
          const sx = Math.round(shipScreenX + (sl.t - simTime) * scrollPxPerSec);
          const cy = Math.round(sl.ceilingY * height);
          if (idx === startIdx) {
            ctx.moveTo(sx, cy);
          } else {
            ctx.lineTo(sx, cy);
          }
        }
        ctx.strokeStyle = "#FF5E4D";
        ctx.lineWidth = 2;
        ctx.stroke();

        // --- Lower Floor Mountain: Opaque #08080B + Soft Coral Rim Gradient + Layered Ridges ---
        ctx.beginPath();
        ctx.moveTo(firstSliceX, drawH);
        for (let idx = startIdx; idx <= endIdx; idx += 1) {
          const sl = slices[idx];
          const sx = Math.round(shipScreenX + (sl.t - simTime) * scrollPxPerSec);
          const fy = Math.round(sl.floorY * height);
          ctx.lineTo(sx, fy);
        }
        ctx.lineTo(lastSliceX, drawH);
        ctx.closePath();
        ctx.fillStyle = "#08080B";
        ctx.fill();

        const floorGrad = ctx.createLinearGradient(
          0,
          minVisibleFloorY,
          0,
          Math.min(drawH, minVisibleFloorY + rimFadeSpan)
        );
        floorGrad.addColorStop(0, "rgba(255, 94, 77, 0.16)");
        floorGrad.addColorStop(0.38, "rgba(255, 94, 77, 0.04)");
        floorGrad.addColorStop(1, "rgba(8, 8, 11, 0)");
        ctx.fillStyle = floorGrad;
        ctx.fill();

        // Secondary offset ridge line (12px deeper inside floor mountain)
        ctx.beginPath();
        for (let idx = startIdx; idx <= endIdx; idx += 1) {
          const sl = slices[idx];
          const sx = Math.round(shipScreenX + (sl.t - simTime) * scrollPxPerSec);
          const fyInner = Math.round(sl.floorY * height) + RIDGE_OFFSET_PX;
          if (idx === startIdx) {
            ctx.moveTo(sx, fyInner);
          } else {
            ctx.lineTo(sx, fyInner);
          }
        }
        ctx.strokeStyle = "rgba(255, 94, 77, 0.18)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Primary luminous 2px Hyper Coral outer floor silhouette
        ctx.beginPath();
        for (let idx = startIdx; idx <= endIdx; idx += 1) {
          const sl = slices[idx];
          const sx = Math.round(shipScreenX + (sl.t - simTime) * scrollPxPerSec);
          const fy = Math.round(sl.floorY * height);
          if (idx === startIdx) {
            ctx.moveTo(sx, fy);
          } else {
            ctx.lineTo(sx, fy);
          }
        }
        ctx.strokeStyle = "#FF5E4D";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Vertical dashed Hyper Coral checkpoint markers at 30% and 60%
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "rgba(255, 94, 77, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.fillStyle = "rgba(255, 94, 77, 0.68)";
      ctx.font = "600 11px system-ui, -apple-system, sans-serif";
      ctx.textBaseline = "top";
      for (let cpIdx = 0; cpIdx < CHECKPOINT_FRACTIONS.length; cpIdx += 1) {
        const frac = CHECKPOINT_FRACTIONS[cpIdx];
        const cpTime = frac * level.durationSec;
        const cpX = shipScreenX + (cpTime - simTime) * scrollPxPerSec;
        if (cpX < -60 || cpX > width + 60) continue;
        const cpSlice = sampleCanyonAtTime(level, cpTime);
        const topY = Math.round(cpSlice.ceilingY * height);
        const botY = Math.round(cpSlice.floorY * height);
        if (botY - topY > 12) {
          const crispX = Math.round(cpX) + 0.5;
          ctx.beginPath();
          ctx.moveTo(crispX, topY);
          ctx.lineTo(crispX, botY);
          ctx.stroke();
          ctx.fillText(`${Math.round(frac * 100)}%`, crispX + 6, topY + 8);
        }
      }
      ctx.restore();

      // Subtle audio-reactive radial halo centered behind the ship
      const curSlice = sampleCanyonAtTime(level, simTime);
      ship.haloEnergy += (curSlice.energy - ship.haloEnergy) * Math.min(1, dt * 8);
      const haloRadius = shipSize * (2.2 + ship.haloEnergy * 2.1);
      const haloGrad = ctx.createRadialGradient(
        shipScreenX,
        drawShipY,
        0,
        shipScreenX,
        drawShipY,
        haloRadius
      );
      haloGrad.addColorStop(0, "rgba(255, 94, 77, 0.08)");
      haloGrad.addColorStop(0.55, "rgba(255, 94, 77, 0.025)");
      haloGrad.addColorStop(1, "rgba(255, 94, 77, 0)");
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(shipScreenX, drawShipY, haloRadius, 0, Math.PI * 2);
      ctx.fill();

      // Render active Hyper Coral thruster stardust sparks
      for (let i = 0; i < dustState.pool.length; i += 1) {
        const p = dustState.pool[i];
        if (!p.active) continue;
        const life = 1 - p.age / p.maxAge;
        const alpha = 0.55 * life * life;
        ctx.fillStyle = `rgba(255, 94, 77, ${alpha.toFixed(3)})`;
        ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
      }

      // Smooth Hyper Coral quadratic ribbon trail anchored directly to tail center
      if (ship.trailCount >= 2) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const oldestIdx =
          (ship.trailHead - ship.trailCount + MAX_TRAIL_POINTS) %
          MAX_TRAIL_POINTS;

        for (let k = 0; k < ship.trailCount; k += 1) {
          const idxCur = (oldestIdx + k) % MAX_TRAIL_POINTS;
          const ptCur = ship.trailRing[idxCur];
          const age = simTime - ptCur.timeSec;
          if (age < 0 || age > TRAIL_LIFETIME_SEC) continue;

          const xCur = shipScreenX + (ptCur.timeSec - simTime) * scrollPxPerSec;
          const yCur = ptCur.yNorm * height;
          if (xCur < -40) continue;

          let xNext: number;
          let yNext: number;
          if (k + 1 < ship.trailCount) {
            const idxNext = (oldestIdx + k + 1) % MAX_TRAIL_POINTS;
            const ptNext = ship.trailRing[idxNext];
            xNext = shipScreenX + (ptNext.timeSec - simTime) * scrollPxPerSec;
            yNext = ptNext.yNorm * height;
          } else {
            xNext = tailCenterX;
            yNext = tailCenterY;
          }

          let xPrev = xCur;
          let yPrev = yCur;
          if (k > 0) {
            const idxPrev = (oldestIdx + k - 1) % MAX_TRAIL_POINTS;
            const ptPrev = ship.trailRing[idxPrev];
            xPrev = shipScreenX + (ptPrev.timeSec - simTime) * scrollPxPerSec;
            yPrev = ptPrev.yNorm * height;
          }

          const midStartX = (xPrev + xCur) * 0.5;
          const midStartY = (yPrev + yCur) * 0.5;
          const midEndX = (xCur + xNext) * 0.5;
          const midEndY = (yCur + yNext) * 0.5;

          const lifeNorm = 1 - age / TRAIL_LIFETIME_SEC;
          const alpha = 0.9 * lifeNorm * lifeNorm;
          const strokeWidth = 0.5 + 3.0 * lifeNorm;

          ctx.strokeStyle = `rgba(255, 94, 77, ${alpha.toFixed(3)})`;
          ctx.lineWidth = strokeWidth;
          ctx.beginPath();
          ctx.moveTo(midStartX, midStartY);
          ctx.quadraticCurveTo(xCur, yCur, midEndX, midEndY);
          ctx.stroke();
        }
      }

      // Solid Hyper Coral Triangular Delta Spaceship
      ctx.save();
      ctx.translate(Math.round(shipScreenX), Math.round(drawShipY));
      ctx.rotate(ship.angleRad);
      ctx.beginPath();
      ctx.moveTo(shipSize * 0.65, 0);
      ctx.lineTo(-shipSize * 0.48, -shipSize * 0.44);
      ctx.lineTo(-shipSize * 0.28, 0);
      ctx.lineTo(-shipSize * 0.48, shipSize * 0.44);
      ctx.closePath();
      ctx.fillStyle = "#FF5E4D";
      ctx.fill();
      ctx.restore();

      // Instant crash flash feedback
      if (ship.flashAlpha > 0) {
        ctx.fillStyle = `rgba(255, 94, 77, ${(ship.flashAlpha * 0.32).toFixed(3)})`;
        ctx.fillRect(0, 0, drawW, drawH);
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
  }, [flashCheckpointHud, handleStageComplete, phase, syncHudDom]);

  if (!waveTrack) return null;

  const displayTrack = activeTrack || waveTrack;

  return (
    <div
      data-no-tab-swipe="true"
      role="dialog"
      aria-modal="true"
      aria-label="Xone Wave Rhythm Flight"
      className="fixed inset-0 z-[130] bg-black text-white select-none overflow-hidden touch-none"
    >
      {/* Top-Left Swipeable HUD Pill (Track + Progress + Attempt) */}
      <div className="fixed top-0 left-0 z-20 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(1rem,env(safe-area-inset-left))] flex items-center gap-3 pointer-events-none">
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            pillSwipeRef.current = {
              pointerId: e.pointerId,
              startX: e.clientX,
              startY: e.clientY,
            };
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            const swipe = pillSwipeRef.current;
            if (swipe.pointerId !== e.pointerId) return;
            pillSwipeRef.current.pointerId = null;
            const deltaX = e.clientX - swipe.startX;
            const deltaY = e.clientY - swipe.startY;
            if (Math.abs(deltaX) > 42 && Math.abs(deltaX) > Math.abs(deltaY)) {
              switchQueueTrack(deltaX < -42 ? 1 : -1);
            }
          }}
          onPointerCancel={(e) => {
            e.stopPropagation();
            if (pillSwipeRef.current.pointerId === e.pointerId) {
              pillSwipeRef.current.pointerId = null;
            }
          }}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          onTouchCancel={(e) => e.stopPropagation()}
          title="Swipe left or right to switch tracks"
          className="pointer-events-auto cursor-grab active:cursor-grabbing touch-none px-3 py-1.5 rounded-full bg-black/70 border border-white/15 flex items-center gap-2.5 max-w-[60vw]"
        >
          <AudioWaveform size={15} className="text-[#FF5E4D] shrink-0" />
          <span className="text-xs font-bold text-white truncate">
            {displayTrack.title}
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

      {/* Transient Checkpoint HUD Flash */}
      <div
        ref={checkpointBannerRef}
        className="fixed top-[max(0.85rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-20 pointer-events-none opacity-0 transition-opacity duration-300 px-3 py-1 rounded-full bg-black/75 border border-[#FF5E4D]/35 text-[11px] font-bold tracking-wide text-[#FF5E4D]"
      >
        Checkpoint 25%
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

      {/* Pinned Top-Right Borderless Exit Button */}
      <button
        type="button"
        onClick={handleExit}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        aria-label="Exit Xone Wave"
        className="fixed top-0 right-0 z-30 mt-[max(0.6rem,env(safe-area-inset-top))] mr-[max(0.85rem,env(safe-area-inset-right))] min-h-[40px] px-2.5 py-1.5 bg-transparent text-xs font-bold text-zinc-300 hover:text-white active:scale-95 inline-flex items-center gap-1.5 transition-colors"
      >
        <X size={15} className="text-[#FF5E4D]" />
        <span>Exit</span>
      </button>

      {/* Main Hold-to-Ascend / Gravity 60 FPS Canvas Stage */}
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          e.preventDefault();
          pointerThrustRef.current = true;
          isThrustingRef.current = true;
        }}
        onPointerUp={() => {
          pointerThrustRef.current = false;
          isThrustingRef.current = keyThrustRef.current;
        }}
        onPointerCancel={() => {
          pointerThrustRef.current = false;
          isThrustingRef.current = keyThrustRef.current;
        }}
        onPointerLeave={() => {
          pointerThrustRef.current = false;
          isThrustingRef.current = keyThrustRef.current;
        }}
        onTouchStart={(e) => {
          e.preventDefault();
          pointerThrustRef.current = true;
          isThrustingRef.current = true;
        }}
        onTouchEnd={() => {
          pointerThrustRef.current = false;
          isThrustingRef.current = keyThrustRef.current;
        }}
        onTouchCancel={() => {
          pointerThrustRef.current = false;
          isThrustingRef.current = keyThrustRef.current;
        }}
        className="w-full h-full block touch-none cursor-pointer"
      />

      {/* Caching & Spectral Contour Analysis Overlay */}
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
            <span>Stage Clear</span>
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
              Conducted &ldquo;{displayTrack.title}&rdquo; in {attemptCount}{" "}
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
            Couldn&apos;t start Xone Wave
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
