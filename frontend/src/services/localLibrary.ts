import type { Playlist, Track } from "../types";

const DB_NAME = "xone_local_library";
const DB_VERSION = 1;
const STORE_PLAYLISTS = "playlists";
const STORE_LIKES = "liked_songs";

interface StoredPlaylist {
  id?: number;
  name: string;
  description: string;
  cover_color: string;
  created_at: string;
  tracks: Track[];
}

type LikedTrackRecord = Track & { liked_at: string };

let dbPromise: Promise<IDBDatabase> | null = null;

function openLibraryDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
        db.createObjectStore(STORE_PLAYLISTS, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
      if (!db.objectStoreNames.contains(STORE_LIKES)) {
        db.createObjectStore(STORE_LIKES, {
          keyPath: "video_id",
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("Failed to open local IndexedDB"));
    };
  });

  return dbPromise;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
  const db = await openLibraryDb();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);

  const txDone = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });

  const result = await fn(store);
  await txDone;
  return result;
}

function normalizeTrack(track: Track): Track {
  return {
    id: track.id ?? track.video_id,
    video_id: track.video_id,
    title: track.title,
    artist: track.artist,
    artists:
      track.artists && track.artists.length > 0
        ? track.artists
        : track.artist
            .split(",")
            .map((a) => a.trim())
            .filter(Boolean),
    album: track.album || "",
    album_id: track.album_id ?? null,
    thumbnail: track.thumbnail || "",
    duration: track.duration || "0:00",
    duration_seconds: Number(track.duration_seconds || 0),
    video_type: track.video_type ?? "MUSIC_VIDEO_TYPE_ATV",
  };
}

function formatPlaylist(record: StoredPlaylist, includeTracks: boolean): Playlist {
  const indexedTracks = record.tracks.map((t, index) => ({
    ...t,
    position: index,
  }));
  const thumbnails = indexedTracks
    .map((t) => t.thumbnail)
    .filter(Boolean)
    .slice(0, 4);

  const summary: Playlist = {
    id: Number(record.id ?? 0),
    name: record.name,
    description: record.description,
    cover_color: record.cover_color,
    created_at: record.created_at,
    track_count: indexedTracks.length,
    thumbnails,
  };

  if (includeTracks) {
    summary.tracks = indexedTracks;
  }
  return summary;
}

export async function fetchPlaylists(): Promise<Playlist[]> {
  return withStore(STORE_PLAYLISTS, "readonly", async (store) => {
    const records = (await promisifyRequest(store.getAll())) as StoredPlaylist[];
    records.sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0));
    return records.map((rec) => formatPlaylist(rec, false));
  });
}

export async function fetchPlaylistDetail(playlistId: number): Promise<Playlist> {
  return withStore(STORE_PLAYLISTS, "readonly", async (store) => {
    const record = (await promisifyRequest(
      store.get(playlistId)
    )) as StoredPlaylist | undefined;
    if (!record) {
      throw new Error("Playlist not found");
    }
    return formatPlaylist(record, true);
  });
}

export async function createPlaylist(
  name: string,
  description: string,
  coverColor: string
): Promise<Playlist> {
  const newRecord: StoredPlaylist = {
    name: name.trim(),
    description: description.trim(),
    cover_color: coverColor || "#FF5E4D",
    created_at: new Date().toISOString(),
    tracks: [],
  };

  return withStore(STORE_PLAYLISTS, "readwrite", async (store) => {
    const id = (await promisifyRequest(store.add(newRecord))) as number;
    return formatPlaylist({ ...newRecord, id }, true);
  });
}

export async function deletePlaylist(playlistId: number): Promise<void> {
  await withStore(STORE_PLAYLISTS, "readwrite", async (store) => {
    await promisifyRequest(store.delete(playlistId));
  });
}

export async function addTrackToPlaylist(
  playlistId: number,
  track: Track
): Promise<{ added: boolean; already_exists: boolean; playlist: Playlist }> {
  return withStore(STORE_PLAYLISTS, "readwrite", async (store) => {
    const record = (await promisifyRequest(
      store.get(playlistId)
    )) as StoredPlaylist | undefined;
    if (!record) {
      throw new Error("Playlist not found");
    }

    const alreadyExists = record.tracks.some(
      (item) => item.video_id === track.video_id
    );
    if (!alreadyExists) {
      const nextTrack: Track = {
        ...normalizeTrack(track),
        position: record.tracks.length,
        added_at: new Date().toISOString(),
      };
      record.tracks = [...record.tracks, nextTrack];
      await promisifyRequest(store.put(record));
    }

    return {
      added: !alreadyExists,
      already_exists: alreadyExists,
      playlist: formatPlaylist(record, true),
    };
  });
}

export async function removeTrackFromPlaylist(
  playlistId: number,
  videoId: string
): Promise<{ removed: boolean; playlist: Playlist }> {
  return withStore(STORE_PLAYLISTS, "readwrite", async (store) => {
    const record = (await promisifyRequest(
      store.get(playlistId)
    )) as StoredPlaylist | undefined;
    if (!record) {
      throw new Error("Playlist not found");
    }

    const beforeLen = record.tracks.length;
    record.tracks = record.tracks
      .filter((item) => item.video_id !== videoId)
      .map((item, idx) => ({ ...item, position: idx }));
    const removed = record.tracks.length < beforeLen;

    if (removed) {
      await promisifyRequest(store.put(record));
    }

    return {
      removed,
      playlist: formatPlaylist(record, true),
    };
  });
}

export async function reorderPlaylistTracks(
  playlistId: number,
  videoIds: string[]
): Promise<Playlist> {
  return withStore(STORE_PLAYLISTS, "readwrite", async (store) => {
    const record = (await promisifyRequest(
      store.get(playlistId)
    )) as StoredPlaylist | undefined;
    if (!record) {
      throw new Error("Playlist not found");
    }

    const byId = new Map<string, Track>();
    for (const item of record.tracks) {
      byId.set(item.video_id, item);
    }

    const seen = new Set<string>();
    const reordered: Track[] = [];
    for (const vid of videoIds) {
      const found = byId.get(vid);
      if (found && !seen.has(vid)) {
        seen.add(vid);
        reordered.push(found);
      }
    }
    for (const item of record.tracks) {
      if (!seen.has(item.video_id)) {
        seen.add(item.video_id);
        reordered.push(item);
      }
    }

    record.tracks = reordered.map((item, idx) => ({ ...item, position: idx }));
    await promisifyRequest(store.put(record));
    return formatPlaylist(record, true);
  });
}

export async function fetchLikedSongs(): Promise<Track[]> {
  return withStore(STORE_LIKES, "readonly", async (store) => {
    const records = (await promisifyRequest(
      store.getAll()
    )) as LikedTrackRecord[];
    records.sort((a, b) =>
      String(b.liked_at || "").localeCompare(String(a.liked_at || ""))
    );
    return records;
  });
}

export async function toggleLikeTrack(
  track: Track
): Promise<{ liked: boolean; video_id: string; track?: Track }> {
  return withStore(STORE_LIKES, "readwrite", async (store) => {
    const existing = (await promisifyRequest(
      store.get(track.video_id)
    )) as LikedTrackRecord | undefined;

    if (existing) {
      await promisifyRequest(store.delete(track.video_id));
      return {
        liked: false,
        video_id: track.video_id,
      };
    }

    const saved: LikedTrackRecord = {
      ...normalizeTrack(track),
      liked_at: new Date().toISOString(),
    };
    await promisifyRequest(store.put(saved));
    return {
      liked: true,
      video_id: track.video_id,
      track: saved,
    };
  });
}
