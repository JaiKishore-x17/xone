"""Audio-only stream extraction, 4-hour in-memory TTL cache, and byte-range proxy."""

from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncIterator

import httpx
import yt_dlp
from fastapi import HTTPException
from fastapi.responses import StreamingResponse

CACHE_TTL_SECONDS = 4 * 3600  # 4-hour TTL cache

# Strictly unauthenticated, audio-only, zero-disk-write yt-dlp configuration
YDL_OPTS: dict[str, Any] = {
    "format": "bestaudio[acodec=opus]/bestaudio/best",
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    "extract_flat": False,
    "skip_download": True,
}

# In-memory cache: {video_id: {"url": ..., "expires_at": ..., "mime_type": ..., ...}}
STREAM_CACHE: dict[str, dict[str, Any]] = {}


def get_cached_stream(video_id: str) -> dict[str, Any] | None:
    """Return cached stream entry if present and unexpired."""
    entry = STREAM_CACHE.get(video_id)
    if not entry:
        return None
    if entry["expires_at"] <= time.time():
        STREAM_CACHE.pop(video_id, None)
        return None
    return entry


def invalidate_stream_cache(video_id: str) -> None:
    """Remove a cached stream entry."""
    STREAM_CACHE.pop(video_id, None)


def get_cache_stats() -> dict[str, Any]:
    """Return current valid cache entry count."""
    now = time.time()
    expired = [vid for vid, entry in STREAM_CACHE.items() if entry["expires_at"] <= now]
    for vid in expired:
        STREAM_CACHE.pop(vid, None)
    return {"cached_streams": len(STREAM_CACHE), "ttl_seconds": CACHE_TTL_SECONDS}


def _infer_mime_type(ext: str | None, acodec: str | None) -> str:
    ext_l = (ext or "").lower()
    acodec_l = (acodec or "").lower()
    if ext_l == "webm" or "opus" in acodec_l:
        return "audio/webm"
    if ext_l in ("m4a", "mp4") or "mp4a" in acodec_l or "aac" in acodec_l:
        return "audio/mp4"
    if ext_l == "ogg" or "vorbis" in acodec_l:
        return "audio/ogg"
    if ext_l == "mp3":
        return "audio/mpeg"
    return "audio/webm"


def _extract_with_ytdlp(video_id: str) -> dict[str, Any]:
    watch_url = f"https://music.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(YDL_OPTS) as ydl:
        info = ydl.extract_info(watch_url, download=False)

    if not info:
        raise ValueError(f"yt-dlp returned empty info for {video_id}")

    stream_url = info.get("url")
    selected_fmt: dict[str, Any] = info

    # Fallback: pick best audio-only format if top-level url is missing
    if not stream_url and isinstance(info.get("formats"), list):
        audio_formats = [
            f
            for f in info["formats"]
            if f.get("url") and f.get("acodec") not in (None, "none")
        ]
        opus_audio = [
            f
            for f in audio_formats
            if f.get("vcodec") in (None, "none")
            and "opus" in str(f.get("acodec", "")).lower()
        ]
        pure_audio = [
            f for f in audio_formats if f.get("vcodec") in (None, "none")
        ]
        candidates = opus_audio or pure_audio or audio_formats
        if candidates:
            selected_fmt = max(candidates, key=lambda f: float(f.get("abr") or 0))
            stream_url = selected_fmt.get("url")

    if not stream_url:
        raise ValueError(f"No playable audio stream URL found for {video_id}")

    ext = selected_fmt.get("ext") or info.get("ext")
    acodec = selected_fmt.get("acodec") or info.get("acodec")
    http_headers = dict(
        selected_fmt.get("http_headers") or info.get("http_headers") or {}
    )
    mime_type = _infer_mime_type(ext, acodec)

    return {
        "video_id": video_id,
        "url": stream_url,
        "ext": ext,
        "acodec": acodec or "opus",
        "abr": selected_fmt.get("abr") or info.get("abr"),
        "mime_type": mime_type,
        "http_headers": http_headers,
        "expires_at": time.time() + CACHE_TTL_SECONDS,
    }


async def resolve_stream_info(
    video_id: str,
    force_refresh: bool = False,
) -> dict[str, Any]:
    """Resolve direct audio stream URL with 4-hour in-memory TTL caching."""
    started = time.perf_counter()
    if not force_refresh:
        cached_entry = get_cached_stream(video_id)
        if cached_entry is not None:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
            return {
                **cached_entry,
                "cached": True,
                "resolution_ms": elapsed_ms,
            }

    try:
        extracted = await asyncio.to_thread(_extract_with_ytdlp, video_id)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to extract audio stream for {video_id}: {exc}",
        ) from exc

    STREAM_CACHE[video_id] = extracted
    elapsed_ms = round((time.perf_counter() - started) * 1000, 3)
    return {
        **extracted,
        "cached": False,
        "resolution_ms": elapsed_ms,
    }


async def _open_upstream_stream(
    client: httpx.AsyncClient,
    stream_entry: dict[str, Any],
    range_header: str | None,
) -> httpx.Response:
    headers: dict[str, str] = {}
    raw_headers = stream_entry.get("http_headers") or {}
    if "User-Agent" in raw_headers:
        headers["User-Agent"] = raw_headers["User-Agent"]
    if range_header:
        headers["Range"] = range_header

    req = client.build_request("GET", stream_entry["url"], headers=headers)
    return await client.send(req, stream=True)


async def proxy_audio_stream(
    video_id: str,
    range_header: str | None,
) -> StreamingResponse:
    """Stream upstream audio bytes with Range support and automatic 403 refresh."""
    stream_entry = await resolve_stream_info(video_id)
    client = httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(30.0, connect=10.0),
    )

    try:
        upstream_resp = await _open_upstream_stream(client, stream_entry, range_header)

        # Resilient recovery: if cached URL returned 401/403/410, invalidate & re-extract once
        if upstream_resp.status_code in (401, 403, 410):
            await upstream_resp.aclose()
            invalidate_stream_cache(video_id)
            stream_entry = await resolve_stream_info(video_id, force_refresh=True)
            upstream_resp = await _open_upstream_stream(client, stream_entry, range_header)

        if upstream_resp.status_code >= 400:
            status = upstream_resp.status_code
            await upstream_resp.aclose()
            await client.aclose()
            raise HTTPException(
                status_code=502,
                detail=f"Upstream audio server returned HTTP {status} for {video_id}",
            )
    except HTTPException:
        raise
    except Exception as exc:
        await client.aclose()
        raise HTTPException(
            status_code=502,
            detail=f"Error proxying stream for {video_id}: {exc}",
        ) from exc

    response_headers: dict[str, str] = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
    }
    for header_name in ("Content-Length", "Content-Range"):
        val = upstream_resp.headers.get(header_name)
        if val:
            response_headers[header_name] = val

    media_type = (
        upstream_resp.headers.get("Content-Type")
        or stream_entry.get("mime_type")
        or "audio/webm"
    )

    async def stream_body() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream_resp.aiter_bytes(chunk_size=65536):
                yield chunk
        finally:
            await upstream_resp.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_body(),
        status_code=upstream_resp.status_code,
        headers=response_headers,
        media_type=media_type,
    )
