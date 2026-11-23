export interface Track {
  id?: string;
  queueItemId?: string;
  video_id: string;
  title: string;
  artist: string;
  artists: string[];
  album: string;
  album_id?: string | null;
  thumbnail: string;
  duration: string;
  duration_seconds: number;
  video_type?: string | null;
  position?: number | null;
  added_at?: string | null;
  liked_at?: string | null;
  downloadedAt?: string | null;
}

export interface SearchResponse {
  query: string;
  top_result: Track | null;
  songs: Track[];
}

export interface Playlist {
  id: number;
  name: string;
  description: string;
  cover_color: string;
  created_at: string;
  track_count: number;
  thumbnails: string[];
  tracks?: Track[];
}

export interface StreamInfo {
  video_id: string;
  stream_url: string;
  proxy_url: string;
  mime_type: string;
  acodec: string;
  cached: boolean;
  expires_at: number;
  resolution_ms: number;
}

export type RepeatMode = "off" | "all" | "one";

export type ActiveView =
  | { type: "home" }
  | { type: "search" }
  | { type: "library" }
  | { type: "likes" }
  | { type: "downloads" }
  | { type: "playlist"; playlistId: number }
  | { type: "queue" };
