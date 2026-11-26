import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { AppUpdater } from "../plugins/appUpdater";
import { XoneAudio } from "../plugins/xoneAudio";
import type { Track } from "../types";

export interface WaveSlice {
  t: number;
  /** Upper mountain bottom edge as a normalized fraction of viewport height [0..1] */
  ceilingY: number;
  /** Lower mountain top edge as a normalized fraction of viewport height [0..1] */
  floorY: number;
  /** Normalized RMS loudness [0..1] for subtle audio-reactive visuals */
  energy?: number;
}

export interface WaveLevel {
  id: string;
  videoId: string;
  durationSec: number;
  sliceDurationSec: number;
  slices: WaveSlice[];
  generatedAt: number;
  version: number;
}

export interface WavePrepProgress {
  progress: number;
  message: string;
}

const WAVE_DB_NAME = "xone_wave_db";
const WAVE_DB_VERSION = 1;
const WAVE_SCHEMA_VERSION = 6;
const WAVE_STORE_NAME = "xone_wave_levels";
const WEB_AUDIO_CACHE_NAME = "xone-wave-audio-v1";
const TARGET_ANALYSIS_SAMPLE_RATE = 11025;
const VOCAL_LOW_HZ = 700;
const VOCAL_HIGH_HZ = 3500;
const SUB_BASS_HZ = 180;
const CALM_GATE_RATIO = 0.25;
const DRUM_SPIKE_MIN_GAP_SEC = 0.38;
const CONTOUR_STEP_SEC = 0.32;
const MAX_DELTA_Y_PER_SEC = 0.68;
const BASELINE_BORDER = 0.06;

function getWaveCacheKey(trackId: string): string {
  return `${trackId}_v${WAVE_SCHEMA_VERSION}`;
}

let waveDbPromise: Promise<IDBDatabase> | null = null;

function openWaveDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (waveDbPromise) return waveDbPromise;

  waveDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(WAVE_DB_NAME, WAVE_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(WAVE_STORE_NAME)) {
        db.createObjectStore(WAVE_STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      waveDbPromise = null;
      reject(req.error ?? new Error("Failed to open Xone Wave IndexedDB"));
    };
  });

  return waveDbPromise;
}

async function readCachedWaveLevel(trackId: string): Promise<WaveLevel | null> {
  try {
    const db = await openWaveDb();
    const cacheKey = getWaveCacheKey(trackId);
    const record = await new Promise<WaveLevel | undefined>((resolve, reject) => {
      const tx = db.transaction(WAVE_STORE_NAME, "readonly");
      const store = tx.objectStore(WAVE_STORE_NAME);
      const req = store.get(cacheKey);
      req.onsuccess = () => resolve(req.result as WaveLevel | undefined);
      req.onerror = () =>
        reject(req.error ?? new Error("Failed reading Xone Wave level"));
    });
    if (
      record &&
      record.version === WAVE_SCHEMA_VERSION &&
      Array.isArray(record.slices) &&
      record.slices.length > 0 &&
      record.durationSec > 0
    ) {
      return record;
    }
  } catch {
    // ignore IndexedDB read errors
  }
  return null;
}

async function writeCachedWaveLevel(level: WaveLevel): Promise<void> {
  try {
    const db = await openWaveDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(WAVE_STORE_NAME, "readwrite");
      const store = tx.objectStore(WAVE_STORE_NAME);
      const req = store.put(level);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error("Failed saving Xone Wave level"));
    });
  } catch {
    // ignore IndexedDB write errors
  }
}

export async function setWaveImmersiveMode(enabled: boolean): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await AppUpdater.setImmersiveMode({ enabled });
    } catch {
      // ignore fallback errors
    }
  }
}

export async function lockWaveLandscape(): Promise<void> {
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
    // ignore unlocked browser environments
  }
}

export async function restorePortraitOrientation(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await AppUpdater.setScreenOrientation({ orientation: "portrait" });
      return;
    } catch {
      // ignore fallback errors
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

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
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

function percentile(values: Float32Array, q: number, floor: number): number {
  if (values.length === 0) return floor;
  const copy = Float32Array.from(values).sort();
  const idx = Math.min(
    copy.length - 1,
    Math.max(0, Math.floor((copy.length - 1) * q))
  );
  return Math.max(floor, copy[idx]);
}

interface ContourAnchor {
  t: number;
  energy: number;
  vocalRatio: number; // 0 = heavy sub-bass verse, 1 = high vocals/synths/falsetto
  isDrumSpike: boolean;
}

function buildVocalContourSlices(
  anchors: ContourAnchor[],
  durationSec: number,
  sampleEnergyAtTime?: (t: number) => number
): WaveSlice[] {
  const safeDur = Math.max(30, durationSec);
  const endSafeTime = safeDur - 1.25;

  const resolveEnergy = (t: number, fallback: number): number => {
    const raw = sampleEnergyAtTime ? sampleEnergyAtTime(t) : fallback;
    return Number(clamp(raw, 0, 1).toFixed(3));
  };

  const slices: WaveSlice[] = [
    {
      t: 0,
      ceilingY: BASELINE_BORDER,
      floorY: 1 - BASELINE_BORDER,
      energy: resolveEnergy(0, 0.08),
    },
    {
      t: 1.25,
      ceilingY: BASELINE_BORDER,
      floorY: 1 - BASELINE_BORDER,
      energy: resolveEnergy(1.25, 0.1),
    },
  ];

  let prevTime = 1.25;
  let prevCeil = BASELINE_BORDER;
  let prevFloor = 1 - BASELINE_BORDER;
  let spikeSide: -1 | 1 = -1;

  const pushSlice = (
    t: number,
    rawCeil: number,
    rawFloor: number,
    minGap: number,
    fallbackEnergy: number
  ) => {
    if (t <= prevTime + 0.02) return;
    const dt = Math.max(0.05, t - prevTime);
    const maxStep = MAX_DELTA_Y_PER_SEC * dt;
    let ceil = clamp(rawCeil, prevCeil - maxStep, prevCeil + maxStep);
    let floor = clamp(rawFloor, prevFloor - maxStep, prevFloor + maxStep);
    ceil = clamp(ceil, 0.04, 0.88);
    floor = clamp(floor, 0.12, 0.96);

    if (floor - ceil < minGap) {
      const mid = (ceil + floor) * 0.5;
      ceil = clamp(mid - minGap * 0.5, 0.04, 0.96 - minGap);
      floor = clamp(ceil + minGap, minGap + 0.04, 0.96);
    }

    slices.push({
      t: Number(t.toFixed(3)),
      ceilingY: Number(ceil.toFixed(4)),
      floorY: Number(floor.toFixed(4)),
      energy: resolveEnergy(t, fallbackEnergy),
    });
    prevTime = t;
    prevCeil = ceil;
    prevFloor = floor;
  };

  for (let i = 0; i < anchors.length; i += 1) {
    const a = anchors[i];
    if (a.t < 1.55 || a.t > endSafeTime) continue;

    if (a.energy < CALM_GATE_RATIO) {
      pushSlice(a.t, BASELINE_BORDER, 1 - BASELINE_BORDER, 0.44, a.energy);
      continue;
    }

    // Gap narrows smoothly with RMS loudness: 44% calm -> 28% intense drops
    const energyNorm = clamp(
      (a.energy - CALM_GATE_RATIO) / (1 - CALM_GATE_RATIO),
      0,
      1
    );
    const gap = clamp(0.44 - energyNorm * 0.16, 0.28, 0.44);

    // Map vocal-to-bass balance to target corridor height:
    // High vocals/synths -> 22%–36% from top; heavy bass/low verses -> 64%–78% from top
    let targetCenterY: number;
    if (a.vocalRatio >= 0.58) {
      const highFrac = clamp((a.vocalRatio - 0.58) / 0.42, 0, 1);
      targetCenterY = 0.36 - highFrac * 0.14;
    } else if (a.vocalRatio <= 0.42) {
      const lowFrac = clamp((0.42 - a.vocalRatio) / 0.42, 0, 1);
      targetCenterY = 0.64 + lowFrac * 0.14;
    } else {
      const midFrac = (a.vocalRatio - 0.42) / 0.16;
      targetCenterY = 0.64 - midFrac * (0.64 - 0.36);
    }

    let rawCeil = targetCenterY - gap * 0.5;
    let rawFloor = targetCenterY + gap * 0.5;

    // Carve alternating triangular peaks ONLY when a strong drum onset spike occurs
    if (a.isDrumSpike) {
      const spikePush = 0.1 + energyNorm * 0.06;
      if (spikeSide === -1) {
        // Floor mountain spike rises sharply toward bottom edge of corridor
        const pushedCenter = clamp(targetCenterY - spikePush, 0.24, 0.66);
        rawFloor = clamp(pushedCenter + gap * 0.5, 0.38, 0.9);
        rawCeil = clamp(
          Math.min(rawFloor - gap, BASELINE_BORDER + 0.04),
          0.04,
          rawFloor - gap
        );
      } else {
        // Ceiling mountain spike drops sharply toward top edge of corridor
        const pushedCenter = clamp(targetCenterY + spikePush, 0.34, 0.76);
        rawCeil = clamp(pushedCenter - gap * 0.5, 0.1, 0.62);
        rawFloor = clamp(
          Math.max(rawCeil + gap, 1 - BASELINE_BORDER - 0.04),
          rawCeil + gap,
          0.96
        );
      }
      spikeSide = spikeSide === -1 ? 1 : -1;
    }

    pushSlice(a.t, rawCeil, rawFloor, gap, a.energy);
  }

  if (prevTime < safeDur) {
    pushSlice(safeDur, BASELINE_BORDER, 1 - BASELINE_BORDER, 0.44, 0.08);
  }

  return slices;
}

function buildFallbackWaveLevel(track: Track, durationSec: number): WaveLevel {
  const baseId = track.id || track.video_id;
  const safeDur = Math.max(30, durationSec || track.duration_seconds || 180);
  const rand = createSeededRandom(baseId || track.title);
  const anchors: ContourAnchor[] = [];
  let t = 1.65;

  while (t < safeDur - 1.35) {
    // Sustained 6-9s vocal-high vs bass-low phrases with occasional drum spikes
    const phraseWave = (Math.sin(t * 0.24) + 1) * 0.5;
    const energy = clamp(0.22 + ((Math.sin(t * 0.16) + 1) * 0.5) * 0.68, 0.15, 0.92);
    const isDrumSpike = energy >= 0.62 && rand() > 0.65;
    anchors.push({
      t: Number(t.toFixed(3)),
      energy,
      vocalRatio: clamp(phraseWave * 0.85 + 0.08, 0.05, 0.95),
      isDrumSpike,
    });
    t += CONTOUR_STEP_SEC;
  }

  const slices = buildVocalContourSlices(anchors, safeDur, (timeSec) =>
    clamp(0.22 + ((Math.sin(timeSec * 0.16) + 1) * 0.5) * 0.68, 0.15, 0.92)
  );

  return {
    id: getWaveCacheKey(baseId),
    videoId: track.video_id,
    durationSec: safeDur,
    sliceDurationSec: safeDur / Math.max(1, slices.length - 1),
    slices,
    generatedAt: Date.now(),
    version: WAVE_SCHEMA_VERSION,
  };
}

function buildWaveLevelFromSpectralChannels(
  highMidSamples: Float32Array,
  subBassSamples: Float32Array,
  sampleRate: number,
  durationSec: number,
  track: Track
): WaveLevel {
  const baseId = track.id || track.video_id;
  const totalSamples = Math.min(highMidSamples.length, subBassSamples.length);
  const windowSize = Math.max(128, Math.round(sampleRate * 0.02)); // 20ms
  const hopSize = Math.max(64, Math.round(sampleRate * 0.01)); // 10ms
  const numFrames = Math.max(1, Math.floor((totalSamples - windowSize) / hopSize));

  const highMidRms = new Float32Array(numFrames);
  const subBassRms = new Float32Array(numFrames);
  const totalRms = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f += 1) {
    const start = f * hopSize;
    let hSum = 0;
    let lSum = 0;
    for (let i = 0; i < windowSize; i += 1) {
      const hv = highMidSamples[start + i];
      const lv = subBassSamples[start + i];
      hSum += hv * hv;
      lSum += lv * lv;
    }
    const hvRms = Math.sqrt(hSum / windowSize);
    const lvRms = Math.sqrt(lSum / windowSize);
    highMidRms[f] = hvRms;
    subBassRms[f] = lvRms;
    totalRms[f] = Math.hypot(hvRms, lvRms);
  }

  const globalPeakRms = percentile(totalRms, 0.9, 0.004);
  const p90Vocal = percentile(highMidRms, 0.9, 0.002);
  const p90Bass = percentile(subBassRms, 0.9, 0.002);

  // 1) Smoothed ~350ms sectionEnergy relative to track's global 90th-percentile loudness
  const prefixRms = new Float64Array(numFrames + 1);
  for (let i = 0; i < numFrames; i += 1) {
    prefixRms[i + 1] = prefixRms[i] + totalRms[i];
  }
  const sectionRadius = Math.max(5, Math.round((0.175 * sampleRate) / hopSize));
  const sectionEnergy = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f += 1) {
    const left = Math.max(0, f - sectionRadius);
    const right = Math.min(numFrames - 1, f + sectionRadius);
    const meanRms = (prefixRms[right + 1] - prefixRms[left]) / (right - left + 1);
    sectionEnergy[f] = clamp(meanRms / globalPeakRms, 0, 1);
  }

  // 2) Sustained ~480ms Vocal-to-Bass Spectral Ratio so sustained vocals soar & stay high
  const rawVocalRatio = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f += 1) {
    const nVocal = clamp(highMidRms[f] / p90Vocal, 0, 1.8);
    const nBass = clamp(subBassRms[f] / p90Bass, 0, 1.8);
    rawVocalRatio[f] = nVocal / (nVocal + nBass + 0.08);
  }
  const prefixVocal = new Float64Array(numFrames + 1);
  for (let i = 0; i < numFrames; i += 1) {
    prefixVocal[i + 1] = prefixVocal[i] + rawVocalRatio[i];
  }
  const vocalRadius = Math.max(8, Math.round((0.24 * sampleRate) / hopSize));
  const vocalSmooth = new Float32Array(numFrames);
  const activeVocals: number[] = [];
  for (let f = 0; f < numFrames; f += 1) {
    const left = Math.max(0, f - vocalRadius);
    const right = Math.min(numFrames - 1, f + vocalRadius);
    const smoothed = (prefixVocal[right + 1] - prefixVocal[left]) / (right - left + 1);
    vocalSmooth[f] = smoothed;
    if (sectionEnergy[f] >= CALM_GATE_RATIO) {
      activeVocals.push(smoothed);
    }
  }

  let vocalLow = 0.25;
  let vocalHigh = 0.75;
  if (activeVocals.length > 16) {
    const sortedVocals = Float32Array.from(activeVocals).sort();
    vocalLow = sortedVocals[Math.floor((sortedVocals.length - 1) * 0.15)];
    vocalHigh = sortedVocals[Math.floor((sortedVocals.length - 1) * 0.85)];
    if (vocalHigh - vocalLow < 0.08) {
      const mid = (vocalLow + vocalHigh) * 0.5;
      vocalLow = mid - 0.04;
      vocalHigh = mid + 0.04;
    }
  }

  // 3) Percussive transient onsetFlux for alternating drum spikes only
  const onsetFlux = new Float32Array(numFrames);
  for (let f = 2; f < numFrames; f += 1) {
    const vocalDelta = Math.max(0, highMidRms[f] - highMidRms[f - 2]);
    const bassDelta = Math.max(0, subBassRms[f] - subBassRms[f - 2]);
    onsetFlux[f] = (vocalDelta * 1.05 + bassDelta * 1.15) / globalPeakRms;
  }

  // Walk chronologically: follow smooth vocal-to-bass contour, plus alternating spikes only on strong drum transients
  const anchors: ContourAnchor[] = [];
  let lastEmitTime = 1.25;
  let lastSpikeTime = -10;

  for (let f = 2; f < numFrames - 2; f += 1) {
    const t = (f * hopSize) / sampleRate;
    if (t < 1.55) continue;

    const secE = sectionEnergy[f];
    const flux = onsetFlux[f];
    const isStrongDrumSpike =
      secE >= 0.48 &&
      flux >= 0.135 &&
      flux >= onsetFlux[f - 1] &&
      flux >= onsetFlux[f + 1] &&
      t - lastSpikeTime >= DRUM_SPIKE_MIN_GAP_SEC;

    const shouldSampleContour = t - lastEmitTime >= CONTOUR_STEP_SEC;
    if (!isStrongDrumSpike && !shouldSampleContour) {
      continue;
    }
    if (isStrongDrumSpike && t - lastEmitTime < 0.12 && anchors.length > 0) {
      // Upgrade the just-emitted point rather than double-packing within 120ms
      anchors[anchors.length - 1].isDrumSpike = true;
      anchors[anchors.length - 1].energy = Math.max(
        anchors[anchors.length - 1].energy,
        secE
      );
      lastSpikeTime = t;
      continue;
    }

    const vocalNorm = clamp(
      (vocalSmooth[f] - vocalLow) / (vocalHigh - vocalLow),
      0,
      1
    );

    anchors.push({
      t,
      energy: secE,
      vocalRatio: vocalNorm,
      isDrumSpike: isStrongDrumSpike,
    });
    lastEmitTime = t;
    if (isStrongDrumSpike) {
      lastSpikeTime = t;
    }
  }

  const safeDur = Math.max(durationSec, track.duration_seconds || 0, 30);
  const sampleSectionEnergy = (tSec: number): number => {
    const idx = clamp(Math.round((tSec * sampleRate) / hopSize), 0, numFrames - 1);
    return clamp(sectionEnergy[idx], 0, 1);
  };
  const slices = buildVocalContourSlices(anchors, safeDur, sampleSectionEnergy);

  return {
    id: getWaveCacheKey(baseId),
    videoId: track.video_id,
    durationSec: safeDur,
    sliceDurationSec: safeDur / Math.max(1, slices.length - 1),
    slices,
    generatedAt: Date.now(),
    version: WAVE_SCHEMA_VERSION,
  };
}

async function generateWaveLevelFromBytes(
  rawBytes: ArrayBuffer,
  track: Track
): Promise<WaveLevel> {
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx || typeof OfflineAudioContext === "undefined") {
    return buildFallbackWaveLevel(track, track.duration_seconds || 180);
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

    // 2-channel 11025 Hz OfflineAudioContext:
    // Ch 0 = 700 Hz–3.5 kHz high-mid vocal/synth band; Ch 1 = <180 Hz sub-bass band
    const offlineCtx = new OfflineAudioContext(
      2,
      monoLength,
      TARGET_ANALYSIS_SAMPLE_RATE
    );
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;

    const vocalHighpass = offlineCtx.createBiquadFilter();
    vocalHighpass.type = "highpass";
    vocalHighpass.frequency.value = VOCAL_LOW_HZ;
    vocalHighpass.Q.value = 0.7;

    const vocalLowpass = offlineCtx.createBiquadFilter();
    vocalLowpass.type = "lowpass";
    vocalLowpass.frequency.value = VOCAL_HIGH_HZ;
    vocalLowpass.Q.value = 0.7;

    const subLowpass = offlineCtx.createBiquadFilter();
    subLowpass.type = "lowpass";
    subLowpass.frequency.value = SUB_BASS_HZ;
    subLowpass.Q.value = 0.7;

    const merger = offlineCtx.createChannelMerger(2);
    source.connect(vocalHighpass);
    vocalHighpass.connect(vocalLowpass);
    vocalLowpass.connect(merger, 0, 0);

    source.connect(subLowpass);
    subLowpass.connect(merger, 0, 1);
    merger.connect(offlineCtx.destination);

    source.start(0);
    renderedBuffer = await offlineCtx.startRendering();

    // Release full decoded stereo buffer immediately to free RAM
    source.buffer = null;
    decodedBuffer = null;

    const highBand = renderedBuffer.getChannelData(0);
    const lowBand = renderedBuffer.getChannelData(1);

    return buildWaveLevelFromSpectralChannels(
      highBand,
      lowBand,
      TARGET_ANALYSIS_SAMPLE_RATE,
      totalDur,
      track
    );
  } catch {
    return buildFallbackWaveLevel(track, track.duration_seconds || 180);
  } finally {
    decodedBuffer = null;
    renderedBuffer = null;
    void decodeCtx.close().catch(() => {});
  }
}

async function ensureWebCachedAudioBytes(
  videoId: string,
  onProgress: (p: WavePrepProgress) => void
): Promise<ArrayBuffer> {
  const proxyUrl = `/api/proxy/${encodeURIComponent(videoId)}`;

  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(WEB_AUDIO_CACHE_NAME);
      const cachedResp = await cache.match(proxyUrl);
      if (cachedResp && cachedResp.ok) {
        onProgress({ progress: 65, message: "Scanning song contour..." });
        return await cachedResp.arrayBuffer();
      }
      onProgress({ progress: 15, message: "Caching audio & shaping canyon..." });
      const fetched = await fetch(proxyUrl);
      if (!fetched.ok) {
        throw new Error(`Unable to fetch audio (${fetched.status})`);
      }
      await cache.put(proxyUrl, fetched.clone());
      onProgress({ progress: 65, message: "Scanning song contour..." });
      return await fetched.arrayBuffer();
    } catch {
      // fall through to direct fetch
    }
  }

  onProgress({ progress: 20, message: "Caching audio & shaping canyon..." });
  const res = await fetch(proxyUrl);
  if (!res.ok) {
    throw new Error(`Unable to fetch audio (${res.status})`);
  }
  onProgress({ progress: 65, message: "Scanning song contour..." });
  return await res.arrayBuffer();
}

export async function prepareWaveLevel(
  track: Track,
  onProgress: (p: WavePrepProgress) => void
): Promise<WaveLevel> {
  const levelId = track.id || track.video_id;
  if (!levelId) {
    throw new Error("Track ID is missing");
  }

  onProgress({ progress: 5, message: "Caching audio & shaping canyon..." });

  let localFileUrl: string | null = null;

  if (Capacitor.isNativePlatform()) {
    let listenerHandle: PluginListenerHandle | null = null;
    try {
      listenerHandle = await XoneAudio.addListener("wavePrepProgress", (ev) => {
        if (ev.videoId === track.video_id) {
          onProgress({
            progress: Math.round(ev.progress * 0.6),
            message:
              ev.stage === "cached"
                ? "Shaping musical canyon..."
                : "Caching audio & shaping canyon...",
          });
        }
      });

      const prepRes = await XoneAudio.prepareWaveAudio({
        videoId: track.video_id,
      });
      localFileUrl = Capacitor.convertFileSrc(prepRes.localFilePath);
    } finally {
      if (listenerHandle) {
        await listenerHandle.remove();
      }
    }
  }

  // Return deterministic IndexedDB canyon map if already generated
  const cachedLevel = await readCachedWaveLevel(levelId);
  if (cachedLevel) {
    onProgress({ progress: 100, message: "Ready!" });
    return cachedLevel;
  }

  onProgress({ progress: 62, message: "Scanning spectral contour..." });

  let audioBytes: ArrayBuffer | null = null;
  if (Capacitor.isNativePlatform()) {
    if (!localFileUrl) {
      throw new Error("Cached audio file unavailable");
    }
    const res = await fetch(localFileUrl);
    if (!res.ok) {
      throw new Error(`Failed reading cached audio (${res.status})`);
    }
    audioBytes = await res.arrayBuffer();
  } else {
    audioBytes = await ensureWebCachedAudioBytes(track.video_id, onProgress);
  }

  onProgress({ progress: 82, message: "Sculpting canyon ridges..." });
  const generatedLevel = await generateWaveLevelFromBytes(audioBytes, track);
  audioBytes = null;

  await writeCachedWaveLevel(generatedLevel);
  onProgress({ progress: 100, message: "Ready!" });
  return generatedLevel;
}
