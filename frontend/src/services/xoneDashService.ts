import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { AppUpdater } from "../plugins/appUpdater";
import { XoneAudio } from "../plugins/xoneAudio";
import type { DashDifficulty, Track } from "../types";

export type { DashDifficulty };

export type DashObstacleType =
  | "single_block"
  | "tall_block"
  | "wide_block"
  | "platform"
  | "overhead_block";

export interface DashObstacle {
  id: number;
  type: DashObstacleType;
  /** Audio time in seconds when the obstacle center reaches the player X anchor */
  timeSec: number;
  /** Obstacle width in cube-size units */
  widthUnits: number;
  /** Obstacle height in cube-size units */
  heightUnits: number;
  /** Vertical elevation above floor in cube-size units */
  elevationUnits: number;
  /** Normalized beat energy [0..1] */
  energy: number;
}

export interface DashLevel {
  id: string;
  videoId: string;
  difficulty: DashDifficulty;
  durationSec: number;
  bpmEstimate: number;
  beatTimes: number[];
  obstacles: DashObstacle[];
  generatedAt: number;
  version: number;
}

export interface DashPrepProgress {
  progress: number;
  message: string;
}

const DASH_DB_NAME = "xone_dash_db";
const DASH_DB_VERSION = 1;
const LEVEL_SCHEMA_VERSION = 4;
const DASH_STORE_NAME = "xone_dash_levels";
const WEB_AUDIO_CACHE_NAME = "xone-dash-audio-v1";
const TARGET_ANALYSIS_SAMPLE_RATE = 11025;
const HIGHPASS_CUTOFF_HZ = 45;

function getLevelCacheKey(trackId: string, difficulty: DashDifficulty): string {
  return `${trackId}_${difficulty}_v${LEVEL_SCHEMA_VERSION}`;
}

let dashDbPromise: Promise<IDBDatabase> | null = null;

function openDashDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dashDbPromise) return dashDbPromise;

  dashDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DASH_DB_NAME, DASH_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DASH_STORE_NAME)) {
        db.createObjectStore(DASH_STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dashDbPromise = null;
      reject(req.error ?? new Error("Failed to open Xone Dash IndexedDB"));
    };
  });

  return dashDbPromise;
}

async function readCachedDashLevel(
  trackId: string,
  difficulty: DashDifficulty
): Promise<DashLevel | null> {
  try {
    const db = await openDashDb();
    const cacheKey = getLevelCacheKey(trackId, difficulty);
    const record = await new Promise<DashLevel | undefined>((resolve, reject) => {
      const tx = db.transaction(DASH_STORE_NAME, "readonly");
      const store = tx.objectStore(DASH_STORE_NAME);
      const req = store.get(cacheKey);
      req.onsuccess = () => resolve(req.result as DashLevel | undefined);
      req.onerror = () =>
        reject(req.error ?? new Error("Failed reading Xone Dash level"));
    });
    if (
      record &&
      record.version === LEVEL_SCHEMA_VERSION &&
      record.difficulty === difficulty &&
      Array.isArray(record.obstacles) &&
      record.durationSec > 0
    ) {
      return record;
    }
  } catch {
    // ignore IndexedDB errors
  }
  return null;
}

async function writeCachedDashLevel(level: DashLevel): Promise<void> {
  try {
    const db = await openDashDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DASH_STORE_NAME, "readwrite");
      const store = tx.objectStore(DASH_STORE_NAME);
      const req = store.put(level);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error("Failed saving Xone Dash level"));
    });
  } catch {
    // ignore IndexedDB write errors
  }
}

export async function setDashImmersiveMode(enabled: boolean): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await AppUpdater.setImmersiveMode({ enabled });
    } catch {
      // ignore fallback errors
    }
  }
}

export async function lockDashLandscape(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await AppUpdater.setScreenOrientation({ orientation: "landscape" });
      return;
    } catch {
      // fall through to browser Screen Orientation API
    }
  }
  try {
    const orientationObj = screen.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>;
    };
    if (orientationObj && typeof orientationObj.lock === "function") {
      await orientationObj.lock("landscape");
    }
  } catch {
    // desktop browsers and unlocked webviews may reject lock() outside fullscreen
  }
}

export async function restorePortraitOrientation(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await AppUpdater.setScreenOrientation({ orientation: "portrait" });
      return;
    } catch {
      // ignore fallback failure
    }
  }
  try {
    if (screen.orientation && typeof screen.orientation.unlock === "function") {
      screen.orientation.unlock();
    }
  } catch {
    // ignore
  }
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createSeededRandom(seedStr: string): () => number {
  let state = hashSeed(seedStr) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNITS_PER_SEC = 10.0;

function collectStaircaseBeats(
  rawPeaks: Array<{ time: number; energy: number; sustained: number }>,
  startIndex: number,
  minStepSec = 0.38,
  maxStepSec = 0.56
): number[] {
  const beats: number[] = [rawPeaks[startIndex].time];
  for (let j = startIndex + 1; j < rawPeaks.length && beats.length < 8; j += 1) {
    const dt = rawPeaks[j].time - beats[beats.length - 1];
    if (dt < minStepSec) continue;
    if (dt <= maxStepSec) {
      beats.push(rawPeaks[j].time);
    } else {
      break;
    }
  }
  return beats;
}

function buildFallbackLevel(
  track: Track,
  durationSec: number,
  difficulty: DashDifficulty = "easy"
): DashLevel {
  const isRaw = difficulty === "raw";
  const baseId = track.id || track.video_id;
  const safeDur = Math.max(30, durationSec || track.duration_seconds || 180);
  const rand = createSeededRandom(baseId || track.title);
  const beatStep = isRaw
    ? 0.24 + Math.floor(rand() * 3) * 0.02
    : 0.42 + Math.floor(rand() * 3) * 0.03;
  const minCooldown = isRaw ? 0.23 : 0.41;
  const beatTimes: number[] = [];
  const obstacles: DashObstacle[] = [];

  let nextAllowedTime = 2.0;
  let lastGroundObstacleTime = -10;
  let obstacleId = 1;
  let stepIdx = 0;
  const endSafeTime = safeDur - 2.2;

  for (let t = 2.0; t < endSafeTime; t += beatStep) {
    beatTimes.push(Number(t.toFixed(3)));
    stepIdx += 1;
    if (t < nextAllowedTime) continue;

    const energy = 0.4 + ((Math.sin(t * 0.16) + 1) * 0.5) * 0.52;

    if (
      stepIdx % (isRaw ? 9 : 14) === 0 &&
      energy >= (isRaw ? 0.48 : 0.55) &&
      t + beatStep * 5 + 0.6 < endSafeTime
    ) {
      const b0 = t;
      const b1 = t + beatStep * (isRaw ? 1.25 : 1.0);
      const b2 = b1 + beatStep * (isRaw ? 1.35 : 1.0);
      const spanBeats = 3 + (stepIdx % 3);
      const spanSec = Math.min(2.75, Math.max(isRaw ? 1.1 : 1.35, beatStep * spanBeats));
      const leftEdgeSec = b2 - 0.06;
      const platformEndSec = b2 + spanSec;
      const platCenterSec = (leftEdgeSec + platformEndSec) * 0.5;
      const platWidthUnits = Number(
        ((platformEndSec - leftEdgeSec) * UNITS_PER_SEC).toFixed(2)
      );

      obstacles.push({
        id: obstacleId++,
        type: "single_block",
        timeSec: Number(b0.toFixed(3)),
        widthUnits: isRaw ? 1.05 : 1.15,
        heightUnits: 1.0,
        elevationUnits: 0,
        energy,
      });
      obstacles.push({
        id: obstacleId++,
        type: "platform",
        timeSec: Number(b1.toFixed(3)),
        widthUnits: isRaw ? 1.05 : 1.15,
        heightUnits: 2.0,
        elevationUnits: 0,
        energy,
      });
      obstacles.push({
        id: obstacleId++,
        type: "platform",
        timeSec: Number(platCenterSec.toFixed(3)),
        widthUnits: platWidthUnits,
        heightUnits: 2.6,
        elevationUnits: 0,
        energy,
      });
      if (spanSec >= (isRaw ? 1.35 : 1.75)) {
        const bMid = b2 + spanSec * 0.5;
        obstacles.push({
          id: obstacleId++,
          type: "single_block",
          timeSec: Number(bMid.toFixed(3)),
          widthUnits: 1.0,
          heightUnits: 1.0,
          elevationUnits: 2.6,
          energy,
        });
      }
      nextAllowedTime = platformEndSec + (isRaw ? 0.4 : 0.56);
      lastGroundObstacleTime = platformEndSec;
    } else if (
      stepIdx % 10 === 0 &&
      energy >= 0.55 &&
      t - lastGroundObstacleTime >= (isRaw ? 0.44 : 0.5) &&
      t + 0.6 < endSafeTime
    ) {
      obstacles.push({
        id: obstacleId++,
        type: "overhead_block",
        timeSec: Number(t.toFixed(3)),
        widthUnits: 1.2,
        heightUnits: 2.0,
        elevationUnits: 1.48,
        energy,
      });
      nextAllowedTime = t + (isRaw ? 0.34 : 0.45);
    } else if (energy >= (isRaw ? 0.72 : 0.76)) {
      const useTall = stepIdx % 2 === 0;
      obstacles.push({
        id: obstacleId++,
        type: useTall ? "tall_block" : "wide_block",
        timeSec: Number(t.toFixed(3)),
        widthUnits: useTall ? 1.0 : 2.0,
        heightUnits: useTall ? 1.55 : 1.0,
        elevationUnits: 0,
        energy,
      });
      nextAllowedTime = t + (isRaw ? 0.34 : 0.5);
      lastGroundObstacleTime = t;
    } else if (
      stepIdx % (isRaw ? 5 : 6) === 0 &&
      energy >= 0.5 &&
      t + 0.6 < endSafeTime
    ) {
      obstacles.push({
        id: obstacleId++,
        type: "platform",
        timeSec: Number(t.toFixed(3)),
        widthUnits: isRaw ? 1.9 : 2.1,
        heightUnits: 1.25,
        elevationUnits: 0,
        energy,
      });
      nextAllowedTime = t + (isRaw ? 0.26 : 0.44);
      lastGroundObstacleTime = t;
    } else {
      obstacles.push({
        id: obstacleId++,
        type: "single_block",
        timeSec: Number(t.toFixed(3)),
        widthUnits: 1.0,
        heightUnits: 1.0,
        elevationUnits: 0,
        energy,
      });
      nextAllowedTime = t + minCooldown;
      lastGroundObstacleTime = t;
    }
  }

  obstacles.sort(
    (a, b) =>
      a.timeSec -
      (a.widthUnits * 0.5) / UNITS_PER_SEC -
      (b.timeSec - (b.widthUnits * 0.5) / UNITS_PER_SEC)
  );

  return {
    id: getLevelCacheKey(baseId, difficulty),
    videoId: track.video_id,
    difficulty,
    durationSec: safeDur,
    bpmEstimate: Math.round(60 / beatStep),
    beatTimes,
    obstacles,
    generatedAt: Date.now(),
    version: LEVEL_SCHEMA_VERSION,
  };
}

function buildBeatMapFromBassSamples(
  samples: Float32Array,
  sampleRate: number,
  durationSec: number,
  track: Track,
  difficulty: DashDifficulty = "easy"
): DashLevel {
  const isRaw = difficulty === "raw";
  const baseId = track.id || track.video_id;
  const totalSamples = samples.length;
  const windowSize = Math.max(128, Math.round(sampleRate * 0.02)); // ~20ms
  const hopSize = Math.max(64, Math.round(sampleRate * 0.01)); // ~10ms (~100fps)
  const numFrames = Math.max(1, Math.floor((totalSamples - windowSize) / hopSize));

  const rms = new Float32Array(numFrames);
  let rmsSum = 0;
  let rmsMax = 0.0001;

  for (let f = 0; f < numFrames; f += 1) {
    const start = f * hopSize;
    let sumSq = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const v = samples[start + i];
      sumSq += v * v;
    }
    const val = Math.sqrt(sumSq / windowSize);
    rms[f] = val;
    rmsSum += val;
    if (val > rmsMax) rmsMax = val;
  }

  const globalMean = rmsSum / numFrames;
  // ~1.5s adaptive local moving average window (0.75s each side)
  const localRadius = Math.max(10, Math.round((0.75 * sampleRate) / hopSize));

  // Prefix sum for O(n) local moving average
  const prefix = new Float64Array(numFrames + 1);
  for (let i = 0; i < numFrames; i += 1) {
    prefix[i + 1] = prefix[i] + rms[i];
  }

  const rawPeaks: Array<{ time: number; energy: number; sustained: number }> = [];
  const minPeakIntervalSec = isRaw ? 0.12 : 0.2;
  const globalFloor = isRaw ? 0.18 : 0.35;
  const localMultiplier = isRaw ? 1.12 : 1.35;
  const onsetFactor = isRaw ? 0.035 : 0.08;
  const minJumpCooldownSec = isRaw ? 0.23 : 0.41;

  const minPeakIntervalFrames = Math.max(
    1,
    Math.round((minPeakIntervalSec * sampleRate) / hopSize)
  );
  let lastPeakFrame = -minPeakIntervalFrames;

  for (let f = 3; f < numFrames - 3; f += 1) {
    const cur = rms[f];
    if (
      cur < rms[f - 1] ||
      cur < rms[f + 1] ||
      (cur < rms[f - 2] && cur < rms[f + 2])
    ) {
      continue;
    }
    if (f - lastPeakFrame < minPeakIntervalFrames) continue;

    const left = Math.max(0, f - localRadius);
    const right = Math.min(numFrames - 1, f + localRadius);
    const localMean = (prefix[right + 1] - prefix[left]) / (right - left + 1);

    const onset = cur - Math.min(rms[f - 1], rms[f - 2]);
    const threshold = Math.max(globalMean * globalFloor, localMean * localMultiplier);
    if (cur > threshold && onset > localMean * onsetFactor) {
      lastPeakFrame = f;
      const time = (f * hopSize) / sampleRate;
      const normEnergy = Math.min(1, Math.max(0, cur / Math.max(0.001, rmsMax * 0.84)));
      const susLeft = Math.max(0, f - localRadius * 2);
      const susRight = Math.min(numFrames - 1, f + localRadius * 2);
      const sustainedMean =
        (prefix[susRight + 1] - prefix[susLeft]) / (susRight - susLeft + 1);
      const normSustained = Math.min(
        1,
        Math.max(0, sustainedMean / Math.max(0.001, globalMean * 1.35))
      );

      rawPeaks.push({ time, energy: normEnergy, sustained: normSustained });
    }
  }

  if (rawPeaks.length < 6) {
    return buildFallbackLevel(track, durationSec, difficulty);
  }

  // Estimate dominant BPM from inter-beat intervals
  const intervals: number[] = [];
  for (let i = 1; i < rawPeaks.length; i += 1) {
    const dt = rawPeaks[i].time - rawPeaks[i - 1].time;
    if (dt >= (isRaw ? 0.18 : 0.25) && dt <= 1.2) {
      intervals.push(dt);
    }
  }
  intervals.sort((a, b) => a - b);
  const medianDt =
    intervals.length > 0 ? intervals[Math.floor(intervals.length / 2)] : 0.46;
  let bpm = Math.round(60 / Math.max(0.2, medianDt));
  while (bpm > 175) bpm = Math.round(bpm / 2);
  while (bpm < 72) bpm = bpm * 2;

  const beatTimes = rawPeaks.map((p) => Number(p.time.toFixed(3)));
  const obstacles: DashObstacle[] = [];
  let obstacleId = 1;
  let nextAllowedTime = 1.85;
  let lastGroundObstacleTime = -10;
  const endSafeTime = Math.max(3.0, durationSec - 2.0);
  let patternCounter = 0;

  for (let i = 0; i < rawPeaks.length; i += 1) {
    const peak = rawPeaks[i];
    if (peak.time < nextAllowedTime || peak.time > endSafeTime) continue;

    patternCounter += 1;

    // 1. Multi-Jump Staircase & High Elevated Chorus Platform
    if (
      peak.sustained >= (isRaw ? 0.48 : 0.55) &&
      (patternCounter % (isRaw ? 3 : 4) === 0 || peak.sustained >= (isRaw ? 0.6 : 0.68))
    ) {
      const stairBeats = collectStaircaseBeats(
        rawPeaks,
        i,
        isRaw ? 0.24 : 0.38,
        isRaw ? 0.48 : 0.56
      );
      if (stairBeats.length >= (isRaw ? 3 : 4)) {
        const b0 = stairBeats[0];
        const b1 = stairBeats[1];
        const b2 = stairBeats[2];
        const maxEndIdx = Math.min(stairBeats.length - 1, 7);
        const rawSpanSec = stairBeats[maxEndIdx] - b2;
        const spanSec = Math.min(2.75, Math.max(isRaw ? 1.1 : 1.35, rawSpanSec));
        const leftEdgeSec = b2 - 0.06;
        const platformEndSec = b2 + spanSec;

        if (platformEndSec + 0.55 < endSafeTime) {
          const platCenterSec = (leftEdgeSec + platformEndSec) * 0.5;
          const platWidthUnits = Number(
            ((platformEndSec - leftEdgeSec) * UNITS_PER_SEC).toFixed(2)
          );

          // Step 1 (Beat 1): Ground-level 1x1 block
          obstacles.push({
            id: obstacleId++,
            type: "single_block",
            timeSec: Number(b0.toFixed(3)),
            widthUnits: isRaw ? 1.05 : 1.15,
            heightUnits: 1.0,
            elevationUnits: 0,
            energy: peak.energy,
          });

          // Step 2 (Beat 2): Solid Hyper Coral pillar up to y = 2.0
          obstacles.push({
            id: obstacleId++,
            type: "platform",
            timeSec: Number(b1.toFixed(3)),
            widthUnits: isRaw ? 1.05 : 1.15,
            heightUnits: 2.0,
            elevationUnits: 0,
            energy: peak.energy,
          });

          // Step 3 (Beat 3+): Solid Hyper Coral wall up to y = 2.6 spanning 3-6 beats
          obstacles.push({
            id: obstacleId++,
            type: "platform",
            timeSec: Number(platCenterSec.toFixed(3)),
            widthUnits: platWidthUnits,
            heightUnits: 2.6,
            elevationUnits: 0,
            energy: peak.energy,
          });

          // Optional 1x1 block sitting flush on top of the solid elevated wall
          if (spanSec >= (isRaw ? 1.35 : 1.75)) {
            const innerBeat = stairBeats.find(
              (bt) => bt >= b2 + 0.52 && bt <= platformEndSec - 0.52
            );
            const blockTime = innerBeat ?? b2 + spanSec * 0.5;
            obstacles.push({
              id: obstacleId++,
              type: "single_block",
              timeSec: Number(blockTime.toFixed(3)),
              widthUnits: 1.0,
              heightUnits: 1.0,
              elevationUnits: 2.6,
              energy: peak.energy,
            });
          }

          nextAllowedTime = platformEndSec + (isRaw ? 0.4 : 0.56);
          lastGroundObstacleTime = platformEndSec;
          continue;
        }
      }
    }

    // 2. Overhead / Hanging Drop Block (clear runway after ground obstacles)
    if (
      peak.energy >= (isRaw ? 0.54 : 0.58) &&
      patternCounter % (isRaw ? 9 : 7) === 0 &&
      peak.time - lastGroundObstacleTime >= (isRaw ? 0.44 : 0.5) &&
      peak.time + 0.6 < endSafeTime
    ) {
      obstacles.push({
        id: obstacleId++,
        type: "overhead_block",
        timeSec: Number(peak.time.toFixed(3)),
        widthUnits: 1.2,
        heightUnits: 2.0,
        elevationUnits: 1.48,
        energy: peak.energy,
      });
      nextAllowedTime = peak.time + (isRaw ? 0.34 : 0.45);
      continue;
    }

    // 3. Tall (1x1.55) / Double-Wide (2x1) Block on heavy hits
    if (peak.energy >= (isRaw ? 0.72 : 0.76)) {
      const useTall = patternCounter % 2 === 0;
      obstacles.push({
        id: obstacleId++,
        type: useTall ? "tall_block" : "wide_block",
        timeSec: Number(peak.time.toFixed(3)),
        widthUnits: useTall ? 1.0 : 2.0,
        heightUnits: useTall ? 1.55 : 1.0,
        elevationUnits: 0,
        energy: peak.energy,
      });
      nextAllowedTime = peak.time + (isRaw ? 0.34 : 0.5);
      lastGroundObstacleTime = peak.time;
      continue;
    }

    // 4. Solid Grounded Stepping-Stone Pillar
    if (
      peak.sustained >= (isRaw ? 0.44 : 0.5) &&
      patternCounter % (isRaw ? 4 : 5) === 0 &&
      peak.time + 0.6 < endSafeTime
    ) {
      obstacles.push({
        id: obstacleId++,
        type: "platform",
        timeSec: Number(peak.time.toFixed(3)),
        widthUnits: isRaw ? 1.9 : 2.1,
        heightUnits: 1.25,
        elevationUnits: 0,
        energy: peak.energy,
      });
      nextAllowedTime = peak.time + (isRaw ? 0.26 : 0.44);
      lastGroundObstacleTime = peak.time;
      continue;
    }

    // 5. Standard Single 1x1 Beat Block
    obstacles.push({
      id: obstacleId++,
      type: "single_block",
      timeSec: Number(peak.time.toFixed(3)),
      widthUnits: 1.0,
      heightUnits: 1.0,
      elevationUnits: 0,
      energy: peak.energy,
    });
    nextAllowedTime = peak.time + minJumpCooldownSec;
    lastGroundObstacleTime = peak.time;
  }

  obstacles.sort(
    (a, b) =>
      a.timeSec -
      (a.widthUnits * 0.5) / UNITS_PER_SEC -
      (b.timeSec - (b.widthUnits * 0.5) / UNITS_PER_SEC)
  );

  return {
    id: getLevelCacheKey(baseId, difficulty),
    videoId: track.video_id,
    difficulty,
    durationSec: Math.max(durationSec, track.duration_seconds || 0),
    bpmEstimate: bpm,
    beatTimes,
    obstacles,
    generatedAt: Date.now(),
    version: LEVEL_SCHEMA_VERSION,
  };
}

async function generateBeatLevelFromBytes(
  rawBytes: ArrayBuffer,
  track: Track,
  difficulty: DashDifficulty
): Promise<DashLevel> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx || typeof OfflineAudioContext === "undefined") {
    return buildFallbackLevel(track, track.duration_seconds || 180, difficulty);
  }

  const decodeCtx = new AudioCtx();
  let decodedBuffer: AudioBuffer | null = null;
  let renderedBuffer: AudioBuffer | null = null;

  try {
    decodedBuffer = await decodeCtx.decodeAudioData(rawBytes);
    const totalDur = decodedBuffer.duration || track.duration_seconds || 180;
    const monoLength = Math.max(
      1,
      Math.ceil(totalDur * TARGET_ANALYSIS_SAMPLE_RATE)
    );

    const offlineCtx = new OfflineAudioContext(
      1,
      monoLength,
      TARGET_ANALYSIS_SAMPLE_RATE
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;

    // 45 Hz high-pass into 1200 Hz (Easy) / 2200 Hz (Raw) low-pass for kick + snare/percussion transients
    const highpass = offlineCtx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = HIGHPASS_CUTOFF_HZ;
    highpass.Q.value = 0.7;

    const lowpass = offlineCtx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = difficulty === "raw" ? 2200 : 1200;
    lowpass.Q.value = 0.75;

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(offlineCtx.destination);
    source.start(0);

    renderedBuffer = await offlineCtx.startRendering();

    // Release decoded stereo buffer immediately to free RAM
    source.buffer = null;
    decodedBuffer = null;

    const bassPcm = renderedBuffer.getChannelData(0);
    return buildBeatMapFromBassSamples(
      bassPcm,
      TARGET_ANALYSIS_SAMPLE_RATE,
      totalDur,
      track,
      difficulty
    );
  } catch {
    return buildFallbackLevel(track, track.duration_seconds || 180, difficulty);
  } finally {
    decodedBuffer = null;
    renderedBuffer = null;
    void decodeCtx.close().catch(() => {});
  }
}

async function ensureWebCachedAudioBytes(
  videoId: string,
  onProgress: (p: DashPrepProgress) => void
): Promise<ArrayBuffer> {
  const proxyUrl = `/api/proxy/${encodeURIComponent(videoId)}`;

  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(WEB_AUDIO_CACHE_NAME);
      const cachedResp = await cache.match(proxyUrl);
      if (cachedResp && cachedResp.ok) {
        onProgress({ progress: 65, message: "Analyzing bass transients..." });
        return await cachedResp.arrayBuffer();
      }
      onProgress({ progress: 15, message: "Caching track & mapping beats..." });
      const fetched = await fetch(proxyUrl);
      if (!fetched.ok) {
        throw new Error(`Unable to fetch audio (${fetched.status})`);
      }
      await cache.put(proxyUrl, fetched.clone());
      onProgress({ progress: 65, message: "Analyzing bass transients..." });
      return await fetched.arrayBuffer();
    } catch {
      // fall through to direct fetch
    }
  }

  onProgress({ progress: 20, message: "Caching track & mapping beats..." });
  const res = await fetch(proxyUrl);
  if (!res.ok) {
    throw new Error(`Unable to fetch audio (${res.status})`);
  }
  onProgress({ progress: 65, message: "Analyzing bass transients..." });
  return await res.arrayBuffer();
}

export async function prepareDashLevel(
  track: Track,
  onProgress: (p: DashPrepProgress) => void,
  difficulty: DashDifficulty = "easy"
): Promise<DashLevel> {
  const levelId = track.id || track.video_id;
  if (!levelId) {
    throw new Error("Track ID is missing");
  }

  onProgress({ progress: 5, message: "Caching track & mapping beats..." });

  let nativeBytesPromise: Promise<ArrayBuffer> | null = null;
  let localFileUrl: string | null = null;

  if (Capacitor.isNativePlatform()) {
    let listenerHandle: PluginListenerHandle | null = null;
    try {
      listenerHandle = await XoneAudio.addListener("dashPrepProgress", (ev) => {
        if (ev.videoId === track.video_id) {
          onProgress({
            progress: Math.round(ev.progress * 0.6),
            message:
              ev.stage === "cached"
                ? "Mapping beats..."
                : "Caching track & mapping beats...",
          });
        }
      });

      const prepRes = await XoneAudio.prepareDashAudio({
        videoId: track.video_id,
      });
      localFileUrl = Capacitor.convertFileSrc(prepRes.localFilePath);
    } finally {
      if (listenerHandle) {
        await listenerHandle.remove();
      }
    }
  }

  // Check IndexedDB level cache first — skips decoding if already generated
  const cachedLevel = await readCachedDashLevel(levelId, difficulty);
  if (cachedLevel) {
    onProgress({ progress: 100, message: "Ready!" });
    return cachedLevel;
  }

  onProgress({ progress: 62, message: "Analyzing bass & beats..." });

  let audioBytes: ArrayBuffer | null = null;
  if (Capacitor.isNativePlatform()) {
    if (!localFileUrl) {
      throw new Error("Cached audio file unavailable");
    }
    nativeBytesPromise = fetch(localFileUrl).then((r) => {
      if (!r.ok) throw new Error(`Failed reading cached audio (${r.status})`);
      return r.arrayBuffer();
    });
    audioBytes = await nativeBytesPromise;
  } else {
    audioBytes = await ensureWebCachedAudioBytes(track.video_id, onProgress);
  }

  onProgress({ progress: 82, message: "Generating beat obstacles..." });
  const generatedLevel = await generateBeatLevelFromBytes(
    audioBytes,
    track,
    difficulty
  );
  audioBytes = null;

  await writeCachedDashLevel(generatedLevel);
  onProgress({ progress: 100, message: "Ready!" });
  return generatedLevel;
}
