"""SQLite persistence layer for Xone playlists and liked songs."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite

DB_PATH = Path(__file__).parent / "xone.db"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_connection() -> aiosqlite.Connection:
    conn = await aiosqlite.connect(DB_PATH)
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys = ON;")
    return conn


async def init_db() -> None:
    """Initialize SQLite tables for playlists, playlist tracks, and liked songs."""
    conn = await _get_connection()
    try:
        await conn.executescript(
            """
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                cover_color TEXT NOT NULL DEFAULT '#FF5E4D',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                video_id TEXT NOT NULL,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL DEFAULT '',
                thumbnail TEXT NOT NULL DEFAULT '',
                duration TEXT NOT NULL DEFAULT '0:00',
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                position INTEGER NOT NULL DEFAULT 0,
                added_at TEXT NOT NULL,
                UNIQUE(playlist_id, video_id)
            );

            CREATE TABLE IF NOT EXISTS liked_songs (
                video_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL DEFAULT '',
                thumbnail TEXT NOT NULL DEFAULT '',
                duration TEXT NOT NULL DEFAULT '0:00',
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                liked_at TEXT NOT NULL
            );
            """
        )
        await conn.commit()
    finally:
        await conn.close()


def _format_track_row(row: aiosqlite.Row) -> dict[str, Any]:
    keys = row.keys()
    artist_str = row["artist"]
    return {
        "video_id": row["video_id"],
        "title": row["title"],
        "artist": artist_str,
        "artists": [a.strip() for a in artist_str.split(",") if a.strip()],
        "album": row["album"],
        "album_id": None,
        "thumbnail": row["thumbnail"],
        "duration": row["duration"],
        "duration_seconds": row["duration_seconds"],
        "video_type": "MUSIC_VIDEO_TYPE_ATV",
        "position": row["position"] if "position" in keys else None,
        "added_at": row["added_at"] if "added_at" in keys else None,
        "liked_at": row["liked_at"] if "liked_at" in keys else None,
    }


async def list_playlists() -> list[dict[str, Any]]:
    """Return all playlists with track counts and up to 4 cover thumbnails."""
    conn = await _get_connection()
    try:
        cursor = await conn.execute(
            """
            SELECT p.id, p.name, p.description, p.cover_color, p.created_at,
                   COUNT(pt.id) AS track_count
            FROM playlists p
            LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
            GROUP BY p.id
            ORDER BY p.id DESC
            """
        )
        rows = await cursor.fetchall()

        playlists: list[dict[str, Any]] = []
        for row in rows:
            thumb_cursor = await conn.execute(
                """
                SELECT thumbnail FROM playlist_tracks
                WHERE playlist_id = ? AND thumbnail != ''
                ORDER BY position ASC, id ASC
                LIMIT 4
                """,
                (row["id"],),
            )
            thumb_rows = await thumb_cursor.fetchall()
            playlists.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "description": row["description"],
                    "cover_color": row["cover_color"],
                    "created_at": row["created_at"],
                    "track_count": row["track_count"],
                    "thumbnails": [t["thumbnail"] for t in thumb_rows],
                }
            )
        return playlists
    finally:
        await conn.close()


async def get_playlist(playlist_id: int) -> dict[str, Any] | None:
    """Return a single playlist with its ordered tracks, or None if missing."""
    conn = await _get_connection()
    try:
        cursor = await conn.execute(
            "SELECT id, name, description, cover_color, created_at FROM playlists WHERE id = ?",
            (playlist_id,),
        )
        playlist_row = await cursor.fetchone()
        if not playlist_row:
            return None

        track_cursor = await conn.execute(
            """
            SELECT video_id, title, artist, album, thumbnail, duration,
                   duration_seconds, position, added_at
            FROM playlist_tracks
            WHERE playlist_id = ?
            ORDER BY position ASC, id ASC
            """,
            (playlist_id,),
        )
        track_rows = await track_cursor.fetchall()
        tracks = [_format_track_row(r) for r in track_rows]
        thumbnails = [t["thumbnail"] for t in tracks if t["thumbnail"]][:4]

        return {
            "id": playlist_row["id"],
            "name": playlist_row["name"],
            "description": playlist_row["description"],
            "cover_color": playlist_row["cover_color"],
            "created_at": playlist_row["created_at"],
            "track_count": len(tracks),
            "thumbnails": thumbnails,
            "tracks": tracks,
        }
    finally:
        await conn.close()


async def create_playlist(
    name: str,
    description: str = "",
    cover_color: str = "#FF5E4D",
) -> dict[str, Any]:
    """Create a new playlist and return its full record."""
    conn = await _get_connection()
    try:
        created_at = _utc_now_iso()
        cursor = await conn.execute(
            """
            INSERT INTO playlists (name, description, cover_color, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (name.strip(), description.strip(), cover_color or "#FF5E4D", created_at),
        )
        await conn.commit()
        playlist_id = cursor.lastrowid
    finally:
        await conn.close()

    created = await get_playlist(int(playlist_id))
    assert created is not None
    return created


async def delete_playlist(playlist_id: int) -> bool:
    """Delete a playlist by ID. Returns True if a row was deleted."""
    conn = await _get_connection()
    try:
        cursor = await conn.execute(
            "DELETE FROM playlists WHERE id = ?",
            (playlist_id,),
        )
        await conn.commit()
        return cursor.rowcount > 0
    finally:
        await conn.close()


async def add_track_to_playlist(
    playlist_id: int,
    track: dict[str, Any],
) -> dict[str, Any] | None:
    """Add a track to the end of a playlist. Returns None if playlist doesn't exist."""
    conn = await _get_connection()
    try:
        exists_cursor = await conn.execute(
            "SELECT id FROM playlists WHERE id = ?",
            (playlist_id,),
        )
        if not await exists_cursor.fetchone():
            return None

        dup_cursor = await conn.execute(
            "SELECT id FROM playlist_tracks WHERE playlist_id = ? AND video_id = ?",
            (playlist_id, track["video_id"]),
        )
        already_exists = await dup_cursor.fetchone() is not None
        if not already_exists:
            pos_cursor = await conn.execute(
                "SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM playlist_tracks WHERE playlist_id = ?",
                (playlist_id,),
            )
            pos_row = await pos_cursor.fetchone()
            next_pos = int(pos_row["next_pos"]) if pos_row else 0

            await conn.execute(
                """
                INSERT INTO playlist_tracks (
                    playlist_id, video_id, title, artist, album,
                    thumbnail, duration, duration_seconds, position, added_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    playlist_id,
                    track["video_id"],
                    track["title"],
                    track["artist"],
                    track.get("album", ""),
                    track.get("thumbnail", ""),
                    track.get("duration", "0:00"),
                    int(track.get("duration_seconds", 0) or 0),
                    next_pos,
                    _utc_now_iso(),
                ),
            )
            await conn.commit()
    finally:
        await conn.close()

    playlist = await get_playlist(playlist_id)
    return {
        "added": not already_exists,
        "already_exists": already_exists,
        "playlist": playlist,
    }


async def remove_track_from_playlist(
    playlist_id: int,
    video_id: str,
) -> dict[str, Any] | None:
    """Remove a track from a playlist and compact positions."""
    conn = await _get_connection()
    try:
        exists_cursor = await conn.execute(
            "SELECT id FROM playlists WHERE id = ?",
            (playlist_id,),
        )
        if not await exists_cursor.fetchone():
            return None

        cursor = await conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ? AND video_id = ?",
            (playlist_id, video_id),
        )
        removed = cursor.rowcount > 0

        if removed:
            rem_cursor = await conn.execute(
                "SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC, id ASC",
                (playlist_id,),
            )
            rem_rows = await rem_cursor.fetchall()
            for idx, r in enumerate(rem_rows):
                await conn.execute(
                    "UPDATE playlist_tracks SET position = ? WHERE id = ?",
                    (idx, r["id"]),
                )
        await conn.commit()
    finally:
        await conn.close()

    playlist = await get_playlist(playlist_id)
    return {"removed": removed, "playlist": playlist}


async def reorder_playlist_tracks(
    playlist_id: int,
    video_ids: list[str],
) -> dict[str, Any] | None:
    """Persist new track ordering for a playlist."""
    conn = await _get_connection()
    try:
        exists_cursor = await conn.execute(
            "SELECT id FROM playlists WHERE id = ?",
            (playlist_id,),
        )
        if not await exists_cursor.fetchone():
            return None

        cur_cursor = await conn.execute(
            "SELECT video_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC, id ASC",
            (playlist_id,),
        )
        existing_ids = [r["video_id"] for r in await cur_cursor.fetchall()]
        seen: set[str] = set()
        ordered: list[str] = []

        for vid in video_ids:
            if vid in existing_ids and vid not in seen:
                ordered.append(vid)
                seen.add(vid)
        for vid in existing_ids:
            if vid not in seen:
                ordered.append(vid)
                seen.add(vid)

        for idx, vid in enumerate(ordered):
            await conn.execute(
                "UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND video_id = ?",
                (idx, playlist_id, vid),
            )
        await conn.commit()
    finally:
        await conn.close()

    return await get_playlist(playlist_id)


async def get_liked_songs() -> list[dict[str, Any]]:
    """Return all liked songs ordered most recently liked first."""
    conn = await _get_connection()
    try:
        cursor = await conn.execute(
            """
            SELECT video_id, title, artist, album, thumbnail,
                   duration, duration_seconds, liked_at
            FROM liked_songs
            ORDER BY liked_at DESC
            """
        )
        rows = await cursor.fetchall()
        return [_format_track_row(r) for r in rows]
    finally:
        await conn.close()


async def toggle_liked_song(
    video_id: str,
    track: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Toggle liked state for a track. Removes if liked; inserts if unliked."""
    conn = await _get_connection()
    try:
        cursor = await conn.execute(
            "SELECT video_id FROM liked_songs WHERE video_id = ?",
            (video_id,),
        )
        existing = await cursor.fetchone()
        if existing:
            await conn.execute(
                "DELETE FROM liked_songs WHERE video_id = ?",
                (video_id,),
            )
            await conn.commit()
            return {"liked": False, "video_id": video_id}

        if not track:
            raise ValueError("Track metadata is required when liking a new song.")

        liked_at = _utc_now_iso()
        await conn.execute(
            """
            INSERT INTO liked_songs (
                video_id, title, artist, album, thumbnail,
                duration, duration_seconds, liked_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                video_id,
                track["title"],
                track["artist"],
                track.get("album", ""),
                track.get("thumbnail", ""),
                track.get("duration", "0:00"),
                int(track.get("duration_seconds", 0) or 0),
                liked_at,
            ),
        )
        await conn.commit()
        return {
            "liked": True,
            "video_id": video_id,
            "track": {
                "video_id": video_id,
                "title": track["title"],
                "artist": track["artist"],
                "artists": [a.strip() for a in track["artist"].split(",") if a.strip()],
                "album": track.get("album", ""),
                "album_id": None,
                "thumbnail": track.get("thumbnail", ""),
                "duration": track.get("duration", "0:00"),
                "duration_seconds": int(track.get("duration_seconds", 0) or 0),
                "video_type": "MUSIC_VIDEO_TYPE_ATV",
                "liked_at": liked_at,
            },
        }
    finally:
        await conn.close()
