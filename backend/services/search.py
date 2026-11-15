"""Clean studio-track search & filtering service powered by unauthenticated ytmusicapi."""

from __future__ import annotations

import asyncio
import re
from typing import Any

from ytmusicapi import YTMusic

# Strictly unauthenticated YTMusic client (never accepts or sends cookies)
_ytmusic = YTMusic()

NOISE_KEYWORDS: list[str] = [
    "remix",
    "live",
    "sped up",
    "slowed",
    "reverb",
    "cover",
    "karaoke",
    "instrumental",
    "8d audio",
]

_TRAILING_SUFFIX_RE = re.compile(
    r"\s*-\s*(remaster(?:ed)?(?:\s*\d{4})?|radio edit|album version|single version|explicit|clean|bonus track).*$",
    re.IGNORECASE,
)
_BRACKET_RE = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9\s]")
_WHITESPACE_RE = re.compile(r"\s+")
_GOOGLE_THUMB_SIZE_RE = re.compile(r"=w\d+-h\d+[^&\s]*")


def has_unrequested_noise(text: str, query: str) -> bool:
    """Return True if text contains a noise keyword not explicitly present in query."""
    if not text:
        return False
    lowered_text = text.lower()
    lowered_query = query.lower()

    for kw in NOISE_KEYWORDS:
        if re.search(rf"\b{re.escape(kw)}\b", lowered_query):
            continue
        if re.search(rf"\b{re.escape(kw)}\b", lowered_text):
            return True
    return False


def normalize_base_title(title: str) -> str:
    """Strip parenthetical/bracketed suffixes and normalize title for deduplication."""
    stripped = _BRACKET_RE.sub("", title)
    stripped = _TRAILING_SUFFIX_RE.sub("", stripped)
    stripped = stripped.lower()
    stripped = _NON_ALNUM_RE.sub(" ", stripped)
    return _WHITESPACE_RE.sub(" ", stripped).strip()


def upgrade_thumbnail(thumbnails: list[dict[str, Any]] | None, video_id: str) -> str:
    """Select the highest-res thumbnail URL and upgrade googleusercontent sizing."""
    if thumbnails:
        best = max(
            thumbnails,
            key=lambda t: (int(t.get("width") or 0) * int(t.get("height") or 0)),
        )
        url = str(best.get("url") or "")
        if url:
            if "googleusercontent.com" in url or "ggpht.com" in url:
                upgraded = _GOOGLE_THUMB_SIZE_RE.sub("=w544-h544-l90-rj", url)
                return upgraded
            return url
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def parse_duration(
    duration_str: str | None,
    duration_seconds: int | None,
) -> tuple[str, int]:
    """Return normalized (M:SS, seconds) tuple."""
    if duration_seconds is not None and duration_seconds > 0:
        secs = int(duration_seconds)
        if not duration_str:
            mins, rem = divmod(secs, 60)
            hrs, mins = divmod(mins, 60)
            formatted = f"{hrs}:{mins:02d}:{rem:02d}" if hrs else f"{mins}:{rem:02d}"
            return formatted, secs
        return duration_str, secs

    if duration_str:
        parts = [p for p in duration_str.strip().split(":") if p.isdigit()]
        if len(parts) == 2:
            secs = int(parts[0]) * 60 + int(parts[1])
            return duration_str.strip(), secs
        if len(parts) == 3:
            secs = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
            return duration_str.strip(), secs

    return "0:00", 0


def _extract_artists(item: dict[str, Any]) -> tuple[str, list[str]]:
    raw_artists = item.get("artists") or []
    names: list[str] = []
    for a in raw_artists:
        if isinstance(a, dict) and a.get("name"):
            names.append(str(a["name"]).strip())
        elif isinstance(a, str) and a.strip():
            names.append(a.strip())
    if not names and item.get("artist"):
        names = [str(item["artist"]).strip()]
    if not names:
        names = ["Unknown Artist"]
    return ", ".join(names), names


def _format_song_item(item: dict[str, Any]) -> dict[str, Any]:
    video_id = str(item.get("videoId") or "")
    title = str(item.get("title") or "Untitled Track").strip()
    artist_str, artist_list = _extract_artists(item)
    album_obj = item.get("album")
    album_name = ""
    album_id = None
    if isinstance(album_obj, dict):
        album_name = str(album_obj.get("name") or "").strip()
        album_id = album_obj.get("id")
    elif isinstance(album_obj, str):
        album_name = album_obj.strip()

    duration_raw = item.get("duration") or item.get("length")
    duration_str, duration_seconds = parse_duration(
        duration_raw,
        item.get("duration_seconds"),
    )
    thumbs_raw = item.get("thumbnails") or item.get("thumbnail")
    thumbnail = upgrade_thumbnail(thumbs_raw, video_id)
    video_type = item.get("videoType")

    return {
        "id": video_id,
        "video_id": video_id,
        "title": title,
        "artist": artist_str,
        "artists": artist_list,
        "album": album_name,
        "album_id": album_id,
        "thumbnail": thumbnail,
        "duration": duration_str,
        "duration_seconds": duration_seconds,
        "video_type": video_type,
    }


def _filter_and_dedupe_songs(
    raw_songs: list[dict[str, Any]],
    query: str,
    strict_atv: bool,
) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str]] = set()

    for item in raw_songs:
        video_id = item.get("videoId")
        if not video_id:
            continue

        video_type = item.get("videoType")
        if strict_atv and video_type is not None and video_type != "MUSIC_VIDEO_TYPE_ATV":
            continue

        formatted = _format_song_item(item)
        if has_unrequested_noise(formatted["title"], query):
            continue
        if has_unrequested_noise(formatted["album"], query):
            continue

        primary_artist = (
            formatted["artists"][0].lower().strip()
            if formatted["artists"]
            else formatted["artist"].lower().strip()
        )
        dedupe_key = (normalize_base_title(formatted["title"]), primary_artist)
        if dedupe_key in seen_keys:
            continue

        seen_keys.add(dedupe_key)
        filtered.append(formatted)

    return filtered


def _resolve_top_result(
    raw_top_items: list[dict[str, Any]],
    filtered_songs: list[dict[str, Any]],
    query: str,
) -> dict[str, Any] | None:
    top_entries = [
        item for item in raw_top_items if item.get("category") == "Top result"
    ]
    if not top_entries and raw_top_items:
        top_entries = raw_top_items[:1]

    for entry in top_entries:
        video_id = entry.get("videoId")
        if video_id:
            video_type = entry.get("videoType")
            if video_type is not None and video_type != "MUSIC_VIDEO_TYPE_ATV":
                # If Top result is a music video (OMV), prefer matching studio ATV track
                norm_title = normalize_base_title(str(entry.get("title") or ""))
                for song in filtered_songs:
                    if normalize_base_title(song["title"]) == norm_title:
                        return song
                continue

            formatted = _format_song_item(entry)
            if not has_unrequested_noise(formatted["title"], query) and not has_unrequested_noise(
                formatted["album"], query
            ):
                # Prefer enriched album metadata from filtered_songs if same video_id exists
                for song in filtered_songs:
                    if song["video_id"] == formatted["video_id"]:
                        return song
                return formatted

        # Top result might be an Artist or Album card -> match best filtered song
        entry_title = str(entry.get("title") or "").strip().lower()
        _, entry_artists = _extract_artists(entry)
        entry_artist_lower = entry_artists[0].lower() if entry_artists else ""

        if entry.get("resultType") == "artist" and entry_title:
            for song in filtered_songs:
                if entry_title in song["artist"].lower():
                    return song

        if entry_artist_lower and entry_artist_lower != "unknown artist":
            for song in filtered_songs:
                if entry_artist_lower in song["artist"].lower():
                    return song

    return filtered_songs[0] if filtered_songs else None


async def search_clean_tracks(query: str) -> dict[str, Any]:
    """Search YouTube Music unauthenticated and return clean studio songs + top result."""
    clean_query = query.strip()
    if not clean_query:
        return {"query": "", "top_result": None, "songs": []}

    raw_songs, raw_general = await asyncio.gather(
        asyncio.to_thread(_ytmusic.search, clean_query, "songs", None, 20),
        asyncio.to_thread(_ytmusic.search, clean_query, None, None, 5),
    )

    songs = _filter_and_dedupe_songs(raw_songs or [], clean_query, strict_atv=True)
    if not songs and raw_songs:
        songs = _filter_and_dedupe_songs(raw_songs, clean_query, strict_atv=False)

    top_result = _resolve_top_result(raw_general or [], songs, clean_query)

    return {
        "query": clean_query,
        "top_result": top_result,
        "songs": songs,
    }


async def get_radio_queue(video_id: str, limit: int = 20) -> dict[str, Any]:
    """Generate clean autoplay / vibe radio tracks seeded from a video_id."""
    clean_id = video_id.strip()
    if not clean_id:
        return {"seed_video_id": "", "tracks": []}

    watch_playlist = await asyncio.to_thread(
        _ytmusic.get_watch_playlist,
        videoId=clean_id,
        radio=True,
        limit=limit,
    )
    raw_tracks: list[dict[str, Any]] = (watch_playlist or {}).get("tracks") or []

    # Skip the seed item if it appears first (or anywhere in the watch list)
    candidates: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_tracks):
        item_vid = item.get("videoId")
        if not item_vid:
            continue
        if idx == 0 and item_vid == clean_id:
            continue
        if item_vid == clean_id:
            continue
        candidates.append(item)

    radio_tracks = _filter_and_dedupe_songs(candidates, "", strict_atv=True)
    if len(radio_tracks) < 5 and candidates:
        seen_ids = {t["video_id"] for t in radio_tracks}
        seen_keys = {
            (
                normalize_base_title(t["title"]),
                (t["artists"][0].lower().strip() if t["artists"] else t["artist"].lower().strip()),
            )
            for t in radio_tracks
        }
        for item in _filter_and_dedupe_songs(candidates, "", strict_atv=False):
            key = (
                normalize_base_title(item["title"]),
                (
                    item["artists"][0].lower().strip()
                    if item["artists"]
                    else item["artist"].lower().strip()
                ),
            )
            if item["video_id"] not in seen_ids and key not in seen_keys:
                radio_tracks.append(item)
                seen_ids.add(item["video_id"])
                seen_keys.add(key)

    return {
        "seed_video_id": clean_id,
        "tracks": radio_tracks,
    }
