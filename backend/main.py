"""FastAPI application entry point for Xone."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from database import (
    add_track_to_playlist,
    create_playlist,
    delete_playlist,
    get_liked_songs,
    get_playlist,
    init_db,
    list_playlists,
    remove_track_from_playlist,
    reorder_playlist_tracks,
    toggle_liked_song,
)
from services.search import get_radio_queue, search_clean_tracks
from services.streamer import (
    get_cache_stats,
    proxy_audio_stream,
    resolve_stream_info,
)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    yield


app = FastAPI(
    title="Xone Audio API",
    version="1.0.0",
    lifespan=lifespan,
)

# Strictly bind CORS to localhost / local LAN origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TrackPayload(BaseModel):
    video_id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    artist: str = Field(..., min_length=1)
    album: str = ""
    thumbnail: str = ""
    duration: str = "0:00"
    duration_seconds: int = 0


class CreatePlaylistPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field(default="", max_length=300)
    cover_color: str = Field(default="#FF5E4D", max_length=30)


class ReorderTracksPayload(BaseModel):
    video_ids: list[str]


class ToggleLikePayload(BaseModel):
    title: str | None = None
    artist: str | None = None
    album: str = ""
    thumbnail: str = ""
    duration: str = "0:00"
    duration_seconds: int = 0


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "app": "Xone", **get_cache_stats()}


@app.get("/api/search")
async def search_tracks(q: str = Query(..., min_length=1)) -> dict[str, Any]:
    return await search_clean_tracks(q)


@app.get("/api/radio/{video_id}")
async def api_get_radio(
    video_id: str,
    limit: int = Query(default=20, ge=1, le=50),
) -> dict[str, Any]:
    return await get_radio_queue(video_id, limit=limit)


@app.get("/api/stream/{video_id}")
async def get_stream(
    video_id: str,
    refresh: bool = Query(default=False),
) -> dict[str, Any]:
    info = await resolve_stream_info(video_id, force_refresh=refresh)
    return {
        "video_id": info["video_id"],
        "stream_url": info["url"],
        "proxy_url": f"/api/proxy/{info['video_id']}",
        "mime_type": info["mime_type"],
        "acodec": info["acodec"],
        "cached": info["cached"],
        "expires_at": info["expires_at"],
        "resolution_ms": info["resolution_ms"],
    }


@app.get("/api/proxy/{video_id}")
async def stream_proxy(video_id: str, request: Request):
    range_header = request.headers.get("range") or request.headers.get("Range")
    return await proxy_audio_stream(video_id, range_header)


@app.get("/api/playlists")
async def api_list_playlists() -> dict[str, Any]:
    return {"playlists": await list_playlists()}


@app.get("/api/playlists/{playlist_id}")
async def api_get_playlist(playlist_id: int) -> dict[str, Any]:
    playlist = await get_playlist(playlist_id)
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@app.post("/api/playlists", status_code=201)
async def api_create_playlist(payload: CreatePlaylistPayload) -> dict[str, Any]:
    return await create_playlist(
        name=payload.name,
        description=payload.description,
        cover_color=payload.cover_color,
    )


@app.delete("/api/playlists/{playlist_id}")
async def api_delete_playlist(playlist_id: int) -> dict[str, Any]:
    deleted = await delete_playlist(playlist_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return {"deleted": True, "id": playlist_id}


@app.post("/api/playlists/{playlist_id}/tracks")
async def api_add_playlist_track(
    playlist_id: int,
    payload: TrackPayload,
) -> dict[str, Any]:
    result = await add_track_to_playlist(playlist_id, payload.model_dump())
    if result is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return result


@app.put("/api/playlists/{playlist_id}/tracks/reorder")
async def api_reorder_playlist_tracks(
    playlist_id: int,
    payload: ReorderTracksPayload,
) -> dict[str, Any]:
    updated = await reorder_playlist_tracks(playlist_id, payload.video_ids)
    if updated is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return updated


@app.delete("/api/playlists/{playlist_id}/tracks/{video_id}")
async def api_remove_playlist_track(
    playlist_id: int,
    video_id: str,
) -> dict[str, Any]:
    result = await remove_track_from_playlist(playlist_id, video_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return result


@app.get("/api/likes")
async def api_get_likes() -> dict[str, Any]:
    return {"tracks": await get_liked_songs()}


@app.post("/api/likes/{video_id}")
async def api_toggle_like(
    video_id: str,
    payload: ToggleLikePayload | None = None,
) -> dict[str, Any]:
    track_dict = None
    if payload and payload.title and payload.artist:
        track_dict = payload.model_dump()
    try:
        return await toggle_liked_song(video_id, track_dict)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
