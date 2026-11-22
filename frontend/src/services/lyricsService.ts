import type { Track } from "../types";

export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricsResult {
  id: string;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  lines: LyricLine[];
  instrumental: boolean;
  notFound: boolean;
  fetchedAt: number;
  sourceTitle?: string;
  sourceArtist?: string;
}

interface LrclibApiRecord {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const LYRICS_DB_NAME = "xone_lyrics_db";
const LYRICS_DB_VERSION = 1;
const LYRICS_STORE_NAME = "lyrics_cache";
const LRCLIB_HEADERS: HeadersInit = {
  "User-Agent": "Xone/1.0",
};

const memoryCache = new Map<string, LyricsResult>();
const inFlightRequests = new Map<string, Promise<LyricsResult>>();
let lyricsDbPromise: Promise<IDBDatabase> | null = null;

function openLyricsDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (lyricsDbPromise) return lyricsDbPromise;

  lyricsDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(LYRICS_DB_NAME, LYRICS_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LYRICS_STORE_NAME)) {
        db.createObjectStore(LYRICS_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      lyricsDbPromise = null;
      reject(request.error ?? new Error("Failed to open lyrics IndexedDB"));
    };
  });

  return lyricsDbPromise;
}

async function readLyricsFromCache(id: string): Promise<LyricsResult | null> {
  const memHit = memoryCache.get(id);
  if (memHit) return memHit;

  try {
    const db = await openLyricsDb();
    const record = await new Promise<LyricsResult | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(LYRICS_STORE_NAME, "readonly");
        const store = tx.objectStore(LYRICS_STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result as LyricsResult | undefined);
        req.onerror = () =>
          reject(req.error ?? new Error("Failed reading lyrics cache"));
      }
    );
    if (record) {
      memoryCache.set(id, record);
      return record;
    }
  } catch {
    // ignore IndexedDB read errors cleanly
  }

  return null;
}

async function writeLyricsToCache(result: LyricsResult): Promise<void> {
  memoryCache.set(result.id, result);
  try {
    const db = await openLyricsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LYRICS_STORE_NAME, "readwrite");
      const store = tx.objectStore(LYRICS_STORE_NAME);
      const req = store.put(result);
      req.onsuccess = () => resolve();
      req.onerror = () =>
        reject(req.error ?? new Error("Failed writing lyrics cache"));
    });
  } catch {
    // ignore IndexedDB write errors cleanly
  }
}

export function cleanArtistName(rawArtist: string): string {
  if (!rawArtist) return "";
  return rawArtist
    .replace(/\s*-\s*Topic\b/gi, "")
    .replace(/\s*VEVO$/i, "")
    .replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "")
    .split(",")[0]
    .replace(/\s{2,}/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanTrackTitle(rawTitle: string, rawArtist?: string): string {
  if (!rawTitle) return "";

  let cleaned = rawTitle
    .replace(/\s*\|.*$/g, "")
    .replace(/\s*\/\/.*$/g, "");

  // Strip noise tags inside (...) or [...]
  const bracketNoisePattern =
    /\s*[\(\[]\s*(?:official(?:\s+(?:music\s*)?(?:video|audio|lyric\s*video|visualizer|visualiser|hd|4k))?|(?:lyric\s*)?video|lyrics?|audio\s*(?:only|stream)?|visuali[sz]er|mv|m\/v|hd|hq|4k|8d|slowed(?:\s*\+?\s*reverb)?|remastered(?:\s*\d{4})?|explicit|clean|live(?:\s+at\s+[^\)\]]*)?|prod\.?\s*[^\)\]]*|(?:ft\.?|feat\.?|featuring)\s+[^\)\]]*|with\s+[^\)\]]*)\s*[\)\]]/gi;

  // Iterate in case multiple parenthetical noise segments follow one another
  let prev = "";
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(bracketNoisePattern, "");
  }

  // Strip trailing inline feat./ft. outside brackets
  cleaned = cleaned.replace(
    /\s+(?:ft\.?|feat\.?|featuring)\s+[^(\[\-|]+/gi,
    ""
  );

  // Strip trailing hyphenated YouTube noise tags (e.g. "- Official Video")
  cleaned = cleaned.replace(
    /\s*-\s*(?:official(?:\s+(?:music\s*)?(?:video|audio|lyric\s*video|visualizer|visualiser))?|lyrics?|lyric\s*video|audio|hd|4k)\s*$/gi,
    ""
  );

  // Strip redundant "<Artist> - Title" prefix if present
  const cleanArtist = cleanArtistName(rawArtist || "");
  if (cleanArtist) {
    const prefixRegex = new RegExp(
      `^${escapeRegExp(cleanArtist)}\\s*[-–—:]\\s+`,
      "i"
    );
    cleaned = cleaned.replace(prefixRegex, "");
  }

  return cleaned.replace(/\s{2,}/g, " ").trim();
}

export function parseLrc(syncedLyrics: string | null | undefined): LyricLine[] {
  if (!syncedLyrics) return [];

  const lines: LyricLine[] = [];
  const rawLines = syncedLyrics.split(/\r?\n/);
  const timestampRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,4}))?\]/g;

  for (const rawLine of rawLines) {
    timestampRegex.lastIndex = 0;
    const timestamps: number[] = [];
    let lastEndIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = timestampRegex.exec(rawLine)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fracStr = match[3];
      const fracSeconds = fracStr
        ? Number(fracStr) / Math.pow(10, fracStr.length)
        : 0;

      if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
        timestamps.push(minutes * 60 + seconds + fracSeconds);
      }
      lastEndIndex = timestampRegex.lastIndex;
    }

    if (timestamps.length === 0) continue;

    const lyricText = rawLine.slice(lastEndIndex).trim();
    if (!lyricText) continue;

    for (const time of timestamps) {
      lines.push({ time, text: lyricText });
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return lines;
}

function buildResultFromRecord(
  id: string,
  record: LrclibApiRecord
): LyricsResult {
  const syncedLyrics = record.syncedLyrics?.trim() || null;
  const plainLyrics = record.plainLyrics?.trim() || null;
  const lines = parseLrc(syncedLyrics);
  const instrumental = Boolean(record.instrumental);

  return {
    id,
    syncedLyrics,
    plainLyrics,
    lines,
    instrumental,
    notFound: !instrumental && lines.length === 0 && !plainLyrics,
    fetchedAt: Date.now(),
    sourceTitle: record.trackName,
    sourceArtist: record.artistName,
  };
}

function pickBestSearchCandidate(
  candidates: LrclibApiRecord[],
  cleanTitle: string,
  cleanArtist: string,
  durationSec: number
): LrclibApiRecord | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const targetTitle = cleanTitle.toLowerCase();
  const targetArtist = cleanArtist.toLowerCase();

  let best: LrclibApiRecord | null = null;
  let bestScore = -Infinity;

  for (const item of candidates) {
    const hasSynced = Boolean(item.syncedLyrics?.trim());
    const hasPlain = Boolean(item.plainLyrics?.trim());
    const isInst = Boolean(item.instrumental);

    if (!hasSynced && !hasPlain && !isInst) continue;

    let score = 0;
    if (hasSynced) score += 1000;
    else if (hasPlain) score += 250;
    else if (isInst) score += 80;

    const itemTitle = (item.trackName || "").toLowerCase();
    const itemArtist = (item.artistName || "").toLowerCase();

    if (targetTitle && itemTitle === targetTitle) score += 120;
    else if (targetTitle && itemTitle.includes(targetTitle)) score += 60;

    if (targetArtist && itemArtist.includes(targetArtist)) score += 80;

    if (durationSec > 0 && typeof item.duration === "number" && item.duration > 0) {
      const diff = Math.abs(item.duration - durationSec);
      score -= Math.min(200, diff * 2.5);
    }

    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best;
}

async function fetchLyricsFromNetwork(
  track: Track,
  durationSec: number
): Promise<LyricsResult> {
  const id = track.id || track.video_id;
  const cleanArtist = cleanArtistName(track.artist);
  const cleanTitle = cleanTrackTitle(track.title, track.artist);
  const effectiveDuration =
    durationSec > 0 ? durationSec : track.duration_seconds || 0;

  let networkFailed = false;

  // Step 1: Exact /api/get lookup
  if (cleanTitle && cleanArtist) {
    try {
      const params = new URLSearchParams({
        track_name: cleanTitle,
        artist_name: cleanArtist,
      });
      if (effectiveDuration > 0) {
        params.set("duration", String(Math.round(effectiveDuration)));
      }

      const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
        headers: LRCLIB_HEADERS,
      });

      if (res.ok) {
        const data = (await res.json()) as LrclibApiRecord;
        const parsed = buildResultFromRecord(id, data);
        if (!parsed.notFound) {
          await writeLyricsToCache(parsed);
          return parsed;
        }
      } else if (res.status !== 404) {
        networkFailed = true;
      }
    } catch {
      networkFailed = true;
    }
  }

  // Step 2: Fuzzy /api/search fallback
  const searchQuery = [cleanTitle || track.title, cleanArtist]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (searchQuery) {
    try {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`;
      const res = await fetch(searchUrl, { headers: LRCLIB_HEADERS });
      if (res.ok) {
        const list = (await res.json()) as LrclibApiRecord[];
        const best = pickBestSearchCandidate(
          list,
          cleanTitle,
          cleanArtist,
          effectiveDuration
        );
        if (best) {
          const parsed = buildResultFromRecord(id, best);
          if (!parsed.notFound) {
            await writeLyricsToCache(parsed);
            return parsed;
          }
        }
        networkFailed = false;
      } else {
        networkFailed = true;
      }
    } catch {
      networkFailed = true;
    }
  }

  const missResult: LyricsResult = {
    id,
    syncedLyrics: null,
    plainLyrics: null,
    lines: [],
    instrumental: false,
    notFound: true,
    fetchedAt: Date.now(),
  };

  // Persist confirmed misses so repeat offline plays don't wait on failed requests;
  // do not cache offline network errors so connectivity recovery retries cleanly.
  if (!networkFailed) {
    await writeLyricsToCache(missResult);
  }

  return missResult;
}

export async function getLyricsForTrack(
  track: Track,
  durationSec = 0
): Promise<LyricsResult> {
  const id = track.id || track.video_id;
  if (!id) {
    return {
      id: "",
      syncedLyrics: null,
      plainLyrics: null,
      lines: [],
      instrumental: false,
      notFound: true,
      fetchedAt: Date.now(),
    };
  }

  const cached = await readLyricsFromCache(id);
  if (cached) {
    return cached;
  }

  const existing = inFlightRequests.get(id);
  if (existing) {
    return existing;
  }

  const promise = fetchLyricsFromNetwork(track, durationSec).finally(() => {
    inFlightRequests.delete(id);
  });
  inFlightRequests.set(id, promise);
  return promise;
}
