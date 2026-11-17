import { Capacitor } from "@capacitor/core";
import { XoneAudio } from "../plugins/xoneAudio";
import type { Playlist, SearchResponse, StreamInfo, Track } from "../types";
import * as localLibrary from "./localLibrary";

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.detail) detail = String(errBody.detail);
    } catch {
      // ignore non-json error bodies
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function searchTracks(query: string): Promise<SearchResponse> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return { query: "", top_result: null, songs: [] };
  }

  if (isNativePlatform()) {
    const res = await XoneAudio.searchSongs({ query: cleanQuery });
    return {
      query: cleanQuery,
      top_result: res.topResult ?? null,
      songs: res.songs ?? [],
    };
  }

  const encoded = encodeURIComponent(cleanQuery);
  return requestJson<SearchResponse>(`/api/search?q=${encoded}`);
}

export async function fetchRadioQueue(
  videoId: string,
  limit = 20
): Promise<Track[]> {
  if (isNativePlatform()) {
    const res = await XoneAudio.getRadioQueue({ videoId, limit });
    return res.tracks ?? [];
  }

  const data = await requestJson<{ seed_video_id: string; tracks: Track[] }>(
    `/api/radio/${encodeURIComponent(videoId)}?limit=${limit}`
  );
  return data.tracks;
}

export async function fetchStreamInfo(
  videoId: string,
  refresh = false
): Promise<StreamInfo> {
  const suffix = refresh ? "?refresh=true" : "";
  return requestJson<StreamInfo>(
    `/api/stream/${encodeURIComponent(videoId)}${suffix}`
  );
}

export async function fetchPlaylists(): Promise<Playlist[]> {
  if (isNativePlatform()) {
    return localLibrary.fetchPlaylists();
  }
  const data = await requestJson<{ playlists: Playlist[] }>("/api/playlists");
  return data.playlists;
}

export async function fetchPlaylistDetail(playlistId: number): Promise<Playlist> {
  if (isNativePlatform()) {
    return localLibrary.fetchPlaylistDetail(playlistId);
  }
  return requestJson<Playlist>(`/api/playlists/${playlistId}`);
}

export async function createPlaylist(
  name: string,
  description: string,
  coverColor: string
): Promise<Playlist> {
  if (isNativePlatform()) {
    return localLibrary.createPlaylist(name, description, coverColor);
  }
  return requestJson<Playlist>("/api/playlists", {
    method: "POST",
    body: JSON.stringify({
      name,
      description,
      cover_color: coverColor,
    }),
  });
}

export async function deletePlaylist(playlistId: number): Promise<void> {
  if (isNativePlatform()) {
    await localLibrary.deletePlaylist(playlistId);
    return;
  }
  await requestJson<{ deleted: boolean }>(`/api/playlists/${playlistId}`, {
    method: "DELETE",
  });
}

export async function addTrackToPlaylist(
  playlistId: number,
  track: Track
): Promise<{ added: boolean; already_exists: boolean; playlist: Playlist }> {
  if (isNativePlatform()) {
    return localLibrary.addTrackToPlaylist(playlistId, track);
  }
  return requestJson<{
    added: boolean;
    already_exists: boolean;
    playlist: Playlist;
  }>(`/api/playlists/${playlistId}/tracks`, {
    method: "POST",
    body: JSON.stringify({
      video_id: track.video_id,
      title: track.title,
      artist: track.artist,
      album: track.album || "",
      thumbnail: track.thumbnail || "",
      duration: track.duration || "0:00",
      duration_seconds: track.duration_seconds || 0,
    }),
  });
}

export async function removeTrackFromPlaylist(
  playlistId: number,
  videoId: string
): Promise<{ removed: boolean; playlist: Playlist }> {
  if (isNativePlatform()) {
    return localLibrary.removeTrackFromPlaylist(playlistId, videoId);
  }
  return requestJson<{ removed: boolean; playlist: Playlist }>(
    `/api/playlists/${playlistId}/tracks/${encodeURIComponent(videoId)}`,
    {
      method: "DELETE",
    }
  );
}

export async function reorderPlaylistTracks(
  playlistId: number,
  videoIds: string[]
): Promise<Playlist> {
  if (isNativePlatform()) {
    return localLibrary.reorderPlaylistTracks(playlistId, videoIds);
  }
  return requestJson<Playlist>(`/api/playlists/${playlistId}/tracks/reorder`, {
    method: "PUT",
    body: JSON.stringify({ video_ids: videoIds }),
  });
}

export async function fetchLikedSongs(): Promise<Track[]> {
  if (isNativePlatform()) {
    return localLibrary.fetchLikedSongs();
  }
  const data = await requestJson<{ tracks: Track[] }>("/api/likes");
  return data.tracks;
}

export async function toggleLikeTrack(
  track: Track
): Promise<{ liked: boolean; video_id: string; track?: Track }> {
  if (isNativePlatform()) {
    return localLibrary.toggleLikeTrack(track);
  }
  return requestJson<{ liked: boolean; video_id: string; track?: Track }>(
    `/api/likes/${encodeURIComponent(track.video_id)}`,
    {
      method: "POST",
      body: JSON.stringify({
        title: track.title,
        artist: track.artist,
        album: track.album || "",
        thumbnail: track.thumbnail || "",
        duration: track.duration || "0:00",
        duration_seconds: track.duration_seconds || 0,
      }),
    }
  );
}

export async function downloadTrack(track: Track): Promise<Track> {
  if (isNativePlatform()) {
    await XoneAudio.downloadTrack({
      videoId: track.id || track.video_id,
      title: track.title,
      artist: track.artist,
    });
  }
  return localLibrary.saveDownloadedTrack(track);
}

export async function removeDownload(videoId: string): Promise<void> {
  if (isNativePlatform()) {
    try {
      await XoneAudio.deleteDownload({ videoId });
    } catch {
      // ignore if already missing natively
    }
  }
  await localLibrary.removeDownloadedTrack(videoId);
}

export async function getDownloadedTracks(): Promise<Track[]> {
  return localLibrary.getDownloadedTracks();
}

export async function openDownloadsFolder(): Promise<void> {
  if (!isNativePlatform()) {
    throw new Error("Offline Music/Xone folder is available on Android.");
  }
  await XoneAudio.openDownloadsFolder();
}
