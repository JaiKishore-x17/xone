import React, { useState } from "react";
import {
  Clock3,
  Download,
  FolderOpen,
  Heart,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Plus,
  Radio,
  Search,
  Shuffle,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { formatTotalDuration, getTimeGreeting } from "../utils/format";
import { TrackContextMenu, type ContextMenuState } from "./TrackContextMenu";
import { TrackRow } from "./TrackRow";

export const MainView: React.FC = () => {
  const activeView = usePlayerStore((s) => s.activeView);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const prefetchedVideoId = usePlayerStore((s) => s.prefetchedVideoId);
  const autoplayRadio = usePlayerStore((s) => s.autoplayRadio);
  const isFetchingRadio = usePlayerStore((s) => s.isFetchingRadio);
  const toggleAutoplayRadio = usePlayerStore((s) => s.toggleAutoplayRadio);

  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const searchResults = usePlayerStore((s) => s.searchResults);
  const isSearching = usePlayerStore((s) => s.isSearching);
  const searchError = usePlayerStore((s) => s.searchError);

  const playlists = usePlayerStore((s) => s.playlists);
  const activePlaylist = usePlayerStore((s) => s.activePlaylist);
  const likedSongs = usePlayerStore((s) => s.likedSongs);
  const downloadedTracks = usePlayerStore((s) => s.downloadedTracks);
  const jamState = usePlayerStore((s) => s.jamState);

  const navigate = usePlayerStore((s) => s.navigate);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist);
  const reorderPlaylistTracks = usePlayerStore((s) => s.reorderPlaylistTracks);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const clearUpcomingQueue = usePlayerStore((s) => s.clearUpcomingQueue);
  const openDownloadsFolder = usePlayerStore((s) => s.openDownloadsFolder);
  const setNewPlaylistModalOpen = usePlayerStore(
    (s) => s.setNewPlaylistModalOpen
  );
  const setSearchQuery = usePlayerStore((s) => s.setSearchQuery);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Drag & drop state for playlist reordering
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const renderOpenFolderButton = (compact = false) => (
    <button
      type="button"
      onClick={() => void openDownloadsFolder()}
      aria-label="Open Music/Xone folder"
      className={`${
        compact ? "min-h-[40px] px-3.5" : "min-h-[44px] px-4 py-2"
      } rounded-full bg-[#181818] border border-white/10 text-white hover:border-[#FF5E4D] text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0`}
    >
      <FolderOpen size={compact ? 14 : 16} className="text-[#FF5E4D]" />
      <span className={compact ? "hidden sm:inline" : undefined}>Open Folder</span>
    </button>
  );

  const renderPlayableListHeader = () => (
    <div className="hidden md:grid grid-cols-[36px_minmax(0,2.2fr)_minmax(0,1.2fr)_168px] items-center gap-3 px-3 py-2 border-b border-white/10 text-xs font-semibold uppercase tracking-wider text-[#B3B3B3] mb-1">
      <span className="text-center">#</span>
      <span>Title</span>
      <span>Album</span>
      <div className="flex justify-end pr-6">
        <Clock3 size={15} />
      </div>
    </div>
  );

  // ===================== HOME VIEW =====================
  if (activeView.type === "home") {
    return (
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-24 pt-4 md:pt-5 bg-gradient-to-b from-[#FF5E4D]/15 via-[#000000] to-[#000000]">
        {/* Dynamic Greeting + 6 Quick-Access Horizontal Cards */}
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-4">
          {getTimeGreeting()}
        </h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 md:gap-3 mb-8">
          {/* Liked Songs Quick Card */}
          <button
            type="button"
            onClick={() => navigate({ type: "likes" })}
            className="group flex items-center gap-3.5 h-16 rounded-md bg-[#141414] hover:bg-[#1E1E1E] overflow-hidden text-left transition-colors pr-3"
          >
            <div
              className="w-16 h-16 shrink-0 flex items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, #FF5E4D 0%, #9E1B12 70%, #3B0704 100%)",
              }}
            >
              <Heart size={24} className="text-white fill-white" />
            </div>
            <span className="font-bold text-sm text-white truncate flex-1">
              Liked Songs
            </span>
            {likedSongs.length > 0 && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  playTrack(likedSongs[0], likedSongs);
                }}
                className="opacity-0 group-hover:opacity-100 w-10 h-10 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] text-black flex items-center justify-center shadow-xl transition-all"
              >
                <Play size={18} className="fill-black ml-0.5" />
              </span>
            )}
          </button>

          {/* Up to 4 User Playlists */}
          {playlists.slice(0, 4).map((pl) => (
            <button
              key={pl.id}
              type="button"
              onClick={() => navigate({ type: "playlist", playlistId: pl.id })}
              className="group flex items-center gap-3.5 h-16 rounded-md bg-[#141414] hover:bg-[#1E1E1E] overflow-hidden text-left transition-colors pr-3"
            >
              <div
                className="w-16 h-16 shrink-0 flex items-center justify-center overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, ${pl.cover_color} 0%, #141414 100%)`,
                }}
              >
                {pl.thumbnails.length > 0 ? (
                  <img
                    src={pl.thumbnails[0]}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ListMusic size={22} className="text-white" />
                )}
              </div>
              <span className="font-bold text-sm text-white truncate flex-1">
                {pl.name}
              </span>
            </button>
          ))}

          {/* Quick Search / New Playlist Card if fewer than 5 playlists */}
          {playlists.length < 5 && (
            <button
              type="button"
              onClick={() => setNewPlaylistModalOpen(true)}
              className="flex items-center gap-3.5 h-16 rounded-md bg-[#141414] hover:bg-[#1E1E1E] overflow-hidden text-left transition-colors pr-3"
            >
              <div className="w-16 h-16 shrink-0 bg-[#1E1E1E] flex items-center justify-center text-[#FF5E4D]">
                <Plus size={24} />
              </div>
              <span className="font-bold text-sm text-white truncate">
                Create New Playlist
              </span>
            </button>
          )}
        </div>
      </div>
    );
  }

  // ===================== LIBRARY VIEW (MOBILE / UNIVERSAL) =====================
  if (activeView.type === "library") {
    return (
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-24 pt-5 bg-[#000000]">
        <div className="flex items-center justify-between gap-3 mb-5">
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            Your Library
          </h1>
          <button
            type="button"
            onClick={() => setNewPlaylistModalOpen(true)}
            className="min-h-[44px] px-4 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] text-black text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0"
          >
            <Plus size={16} />
            <span>New Playlist</span>
          </button>
        </div>

        <div className="space-y-2">
          {/* Liked Songs */}
          <button
            type="button"
            onClick={() => navigate({ type: "likes" })}
            className="w-full min-h-[64px] flex items-center gap-3.5 p-2.5 rounded-lg bg-[#141414] hover:bg-[#1E1E1E] text-left transition-colors"
          >
            <div
              className="w-12 h-12 rounded-md shrink-0 flex items-center justify-center shadow-md"
              style={{
                background:
                  "linear-gradient(135deg, #FF5E4D 0%, #9E1B12 65%, #3B0704 100%)",
              }}
            >
              <Heart size={22} className="text-white fill-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white truncate">
                Liked Songs
              </p>
              <p className="text-xs text-[#B3B3B3] truncate">
                Playlist • {likedSongs.length}{" "}
                {likedSongs.length === 1 ? "song" : "songs"}
              </p>
            </div>
          </button>

          {/* Downloaded (Offline Tracks) */}
          <div className="rounded-xl bg-[#141414] border border-white/10 overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-2.5">
              <button
                type="button"
                onClick={() => navigate({ type: "downloads" })}
                className="flex items-center gap-3.5 min-w-0 flex-1 min-h-[48px] text-left"
              >
                <div className="w-12 h-12 rounded-md shrink-0 bg-[#FF5E4D] flex items-center justify-center shadow-md">
                  <Download size={22} className="text-black" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">
                    Downloaded
                  </p>
                  <p className="text-xs text-[#B3B3B3] truncate">
                    {downloadedTracks.length}{" "}
                    {downloadedTracks.length === 1 ? "track" : "tracks"} saved offline
                  </p>
                </div>
              </button>

              <div className="flex items-center gap-2 shrink-0">
                {renderOpenFolderButton(true)}

                {downloadedTracks.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      playTrack(downloadedTracks[0], downloadedTracks)
                    }
                    className="min-h-[40px] px-4 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] text-black text-xs font-bold flex items-center gap-1.5 transition-colors shrink-0"
                  >
                    <Play size={14} className="fill-black" />
                    <span>Play All</span>
                  </button>
                )}
              </div>
            </div>

            {downloadedTracks.length > 0 && (
              <div className="border-t border-white/10 px-1 md:px-3 py-2 space-y-0.5">
                {downloadedTracks.map((track, idx) => (
                  <TrackRow
                    key={track.video_id}
                    track={track}
                    index={idx}
                    contextQueue={downloadedTracks}
                    onOpenContextMenu={setContextMenu}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Active Queue Shortcut */}
          <button
            type="button"
            onClick={() => navigate({ type: "queue" })}
            className="w-full min-h-[64px] flex items-center gap-3.5 p-2.5 rounded-lg bg-[#141414] hover:bg-[#1E1E1E] text-left transition-colors"
          >
            <div className="w-12 h-12 rounded-md shrink-0 bg-[#1E1E1E] flex items-center justify-center text-[#FF5E4D]">
              <ListMusic size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white truncate">
                Active Queue
              </p>
              <p className="text-xs text-[#B3B3B3] truncate">
                {queue.length} {queue.length === 1 ? "track" : "tracks"} queued
              </p>
            </div>
          </button>

          {/* User Playlists */}
          {playlists.length === 0 ? (
            <div className="mt-4 p-6 rounded-xl bg-[#141414] border border-white/5 text-center">
              <p className="text-sm font-bold text-white">
                No custom playlists yet
              </p>
              <p className="text-xs text-[#B3B3B3] mt-1">
                Create a playlist to start building your collection.
              </p>
            </div>
          ) : (
            playlists.map((pl) => (
              <div
                key={pl.id}
                className="flex items-center gap-2 p-2.5 rounded-lg bg-[#141414] hover:bg-[#1E1E1E] transition-colors"
              >
                <button
                  type="button"
                  onClick={() =>
                    navigate({ type: "playlist", playlistId: pl.id })
                  }
                  className="flex items-center gap-3.5 flex-1 min-w-0 min-h-[48px] text-left"
                >
                  <div
                    className="w-12 h-12 rounded-md shrink-0 overflow-hidden flex items-center justify-center shadow"
                    style={{
                      background:
                        pl.thumbnails.length === 0
                          ? `linear-gradient(135deg, ${pl.cover_color} 0%, #141414 100%)`
                          : "#141414",
                    }}
                  >
                    {pl.thumbnails.length >= 4 ? (
                      <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
                        {pl.thumbnails.slice(0, 4).map((thumb, idx) => (
                          <img
                            key={idx}
                            src={thumb}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ))}
                      </div>
                    ) : pl.thumbnails.length > 0 ? (
                      <img
                        src={pl.thumbnails[0]}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <ListMusic size={20} className="text-white/90" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white truncate">
                      {pl.name}
                    </p>
                    <p className="text-xs text-[#B3B3B3] truncate">
                      Playlist • {pl.track_count}{" "}
                      {pl.track_count === 1 ? "song" : "songs"}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void deletePlaylist(pl.id)}
                  aria-label={`Delete ${pl.name}`}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-[#B3B3B3] hover:text-[#FF5E4D] transition-colors shrink-0"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            ))
          )}
        </div>

        <TrackContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      </div>
    );
  }

  // ===================== SEARCH VIEW =====================
  if (activeView.type === "search") {
    const topResult = searchResults?.top_result ?? null;
    const songs = searchResults?.songs ?? [];
    const isTopActive =
      topResult !== null && currentTrack?.video_id === topResult.video_id;
    const isTopPlaying = isTopActive && isPlaying;

    return (
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-24 pt-5 bg-[#000000]">
        {!searchQuery.trim() ? (
          <div className="max-w-2xl mx-auto mt-10 md:mt-14 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#141414] border border-white/10 flex items-center justify-center mx-auto mb-4">
              <Search size={28} className="text-[#FF5E4D]" />
            </div>
            <h2 className="text-xl md:text-2xl font-extrabold text-white">
              Play what you love
            </h2>
            <p className="text-sm text-[#B3B3B3] mt-2">
              Search for songs, artists, or moods to start listening.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {[
                "Blinding Lights",
                "Daft Punk Instant Crush",
                "Midnight City",
                "Starboy",
                "Tame Impala Let It Happen",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setSearchQuery(suggestion)}
                  className="min-h-[44px] md:min-h-0 px-4 md:px-3.5 py-2 md:py-1.5 rounded-full bg-[#141414] hover:bg-[#1E1E1E] text-xs font-semibold text-white border border-white/10 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : isSearching && !searchResults ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 size={32} className="animate-spin text-[#FF5E4D]" />
            <p className="text-sm text-[#B3B3B3]">Searching...</p>
          </div>
        ) : searchError ? (
          <div className="rounded-lg bg-[#141414] border border-[#FF5E4D]/30 p-6 text-center max-w-lg mx-auto mt-10">
            <p className="text-sm font-bold text-[#FF5E4D]">{searchError}</p>
          </div>
        ) : songs.length === 0 && !topResult ? (
          <div className="text-center py-20">
            <p className="text-lg font-bold text-white">
              No results found for &ldquo;{searchQuery}&rdquo;
            </p>
            <p className="text-sm text-[#B3B3B3] mt-1">
              Check your spelling or try a different artist or track name.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Top Result + Top Songs Split Row (stacked on mobile, 12-col split on lg) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {topResult && (
                <div className="lg:col-span-5">
                  <h2 className="text-lg md:text-xl font-bold text-white mb-3">
                    Top result
                  </h2>
                  <div
                    onClick={() => playTrack(topResult)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({
                        track: topResult,
                        x: e.clientX,
                        y: e.clientY,
                      });
                    }}
                    className="group relative p-5 rounded-lg bg-[#141414] hover:bg-[#1E1E1E] transition-colors cursor-pointer min-h-[200px] md:h-[232px] flex flex-col justify-between gap-4"
                  >
                    <img
                      src={topResult.thumbnail}
                      alt={topResult.title}
                      className="w-24 h-24 md:w-[104px] md:h-[104px] rounded-md object-cover shadow-2xl bg-black"
                    />
                    <div className="min-w-0 pr-14">
                      <h3
                        className={`text-xl md:text-2xl font-extrabold tracking-tight truncate ${
                          isTopActive ? "text-[#FF5E4D]" : "text-white"
                        }`}
                      >
                        {topResult.title}
                      </h3>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="px-2 py-0.5 rounded-full bg-black/50 text-[11px] font-bold uppercase tracking-wider text-white shrink-0">
                          Song
                        </span>
                        <span className="text-sm font-medium text-[#B3B3B3] truncate">
                          {topResult.artist}
                        </span>
                      </div>
                    </div>

                    {/* Floating Hyper Coral Play Button (always visible on touch/mobile, hover slide-up on desktop) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        playTrack(topResult);
                      }}
                      aria-label={isTopPlaying ? "Pause top result" : "Play top result"}
                      className={`absolute right-5 bottom-5 w-12 h-12 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] hover:scale-105 text-black flex items-center justify-center shadow-2xl transition-all duration-200 ${
                        isTopPlaying
                          ? "opacity-100 translate-y-0"
                          : "opacity-100 md:opacity-0 translate-y-0 md:translate-y-2 md:group-hover:opacity-100 md:group-hover:translate-y-0"
                      }`}
                    >
                      {isTopPlaying ? (
                        <Pause size={22} className="fill-black" />
                      ) : (
                        <Play size={22} className="fill-black ml-0.5" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Quick Top 4 Songs preview next to Top Result */}
              <div className={topResult ? "lg:col-span-7" : "lg:col-span-12"}>
                <h2 className="text-lg md:text-xl font-bold text-white mb-3">
                  Top Songs
                </h2>
                <div className="space-y-1">
                  {songs.slice(0, 4).map((track, idx) => (
                    <TrackRow
                      key={track.video_id}
                      track={track}
                      index={idx}
                      onOpenContextMenu={setContextMenu}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Full Songs Table */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="text-lg md:text-xl font-bold text-white">
                  Songs ({songs.length})
                </h2>
              </div>
              {renderPlayableListHeader()}
              <div className="space-y-0.5">
                {songs.map((track, idx) => (
                  <TrackRow
                    key={track.video_id}
                    track={track}
                    index={idx}
                    onOpenContextMenu={setContextMenu}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <TrackContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      </div>
    );
  }

  // ===================== LIKED SONGS & DOWNLOADED VIEWS =====================
  if (activeView.type === "likes" || activeView.type === "downloads") {
    const isDownloadsView = activeView.type === "downloads";
    const tracks = isDownloadsView ? downloadedTracks : likedSongs;
    const totalSecs = tracks.reduce(
      (acc, t) => acc + (t.duration_seconds || 0),
      0
    );
    const isPlayingCollection =
      tracks.length > 0 &&
      isPlaying &&
      tracks.some((t) => t.video_id === currentTrack?.video_id);

    const heroIcon = isDownloadsView ? (
      <Download
        size={64}
        className="text-black drop-shadow-lg md:w-[76px] md:h-[76px]"
      />
    ) : (
      <Heart
        size={64}
        className="text-white fill-white drop-shadow-lg md:w-[76px] md:h-[76px]"
      />
    );

    const viewTitle = isDownloadsView ? "Downloaded" : "Liked Songs";
    const viewBadge = isDownloadsView ? "Offline Library" : "Playlist";
    const viewLead = isDownloadsView
      ? "Available offline"
      : "Your favorite tracks";

    return (
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-24"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,94,77,0.45) 0%, rgba(110,20,16,0.35) 210px, #000000 360px, #000000 100%)",
        }}
      >
        {/* Header (compact & centered on mobile, left-aligned row on desktop) */}
        <div className="px-4 md:px-6 pt-6 md:pt-8 pb-4 md:pb-6 flex flex-col items-center text-center md:flex-row md:items-end md:text-left gap-4 md:gap-6">
          <div
            className="w-36 h-36 sm:w-44 sm:h-44 md:w-52 md:h-52 rounded-lg shadow-2xl shrink-0 flex items-center justify-center"
            style={{
              background: isDownloadsView
                ? "linear-gradient(135deg, #FF5E4D 0%, #FF7466 45%, #8A1E15 100%)"
                : "linear-gradient(135deg, #FF5E4D 0%, #9E1B12 65%, #3B0704 100%)",
            }}
          >
            {heroIcon}
          </div>
          <div className="min-w-0 w-full">
            <p className="text-[11px] md:text-xs font-bold uppercase tracking-widest text-white/90">
              {viewBadge}
            </p>
            <h1 className="text-2xl sm:text-4xl md:text-6xl font-black tracking-tight text-white mt-1 md:mt-2">
              {viewTitle}
            </h1>
            <p className="text-xs md:text-sm text-white/80 mt-2 md:mt-3 font-medium">
              {viewLead} • {tracks.length}{" "}
              {tracks.length === 1 ? "song" : "songs"}
              {totalSecs > 0 ? `, ${formatTotalDuration(totalSecs)}` : ""}
            </p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="px-4 md:px-6 py-3 md:py-4 flex flex-wrap items-center justify-center md:justify-start gap-3 md:gap-4">
          <button
            type="button"
            disabled={tracks.length === 0}
            onClick={() => {
              if (tracks.length > 0) {
                playTrack(tracks[0], tracks);
              }
            }}
            aria-label={`Play ${viewTitle}`}
            className={
              isDownloadsView
                ? "min-h-[44px] px-6 py-2.5 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 text-black text-sm font-bold flex items-center gap-2 shadow-xl transition-all"
                : "w-14 h-14 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 text-black flex items-center justify-center shadow-xl transition-all"
            }
          >
            {isPlayingCollection ? (
              <Pause size={isDownloadsView ? 20 : 26} className="fill-black" />
            ) : (
              <Play
                size={isDownloadsView ? 20 : 26}
                className={isDownloadsView ? "fill-black" : "fill-black ml-1"}
              />
            )}
            {isDownloadsView && <span>Play All</span>}
          </button>

          {isDownloadsView && renderOpenFolderButton(false)}

          <button
            type="button"
            onClick={toggleShuffle}
            title="Toggle Shuffle"
            aria-label="Toggle Shuffle"
            className={`min-w-[44px] min-h-[44px] flex items-center justify-center p-2 transition-colors ${
              shuffle ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
            }`}
          >
            <Shuffle size={24} />
          </button>
        </div>

        {/* Tracks Table */}
        <div className="px-2 md:px-6">
          {tracks.length === 0 ? (
            <div className="mx-2 md:mx-0 rounded-xl bg-[#141414]/90 p-8 md:p-10 text-center mt-4">
              {isDownloadsView ? (
                <Download size={36} className="mx-auto text-[#FF5E4D] mb-3" />
              ) : (
                <Heart size={36} className="mx-auto text-[#FF5E4D] mb-3" />
              )}
              <p className="text-lg font-bold text-white">
                {isDownloadsView
                  ? "No downloaded tracks yet"
                  : "Songs you like will appear here"}
              </p>
              <p className="text-sm text-[#B3B3B3] mt-1">
                {isDownloadsView
                  ? "Tap the download icon on any track to listen completely offline."
                  : "Tap the heart icon on any track to save it to your library."}
              </p>
            </div>
          ) : (
            <>
              {renderPlayableListHeader()}
              <div className="space-y-0.5">
                {tracks.map((track, idx) => (
                  <TrackRow
                    key={track.video_id}
                    track={track}
                    index={idx}
                    contextQueue={tracks}
                    onOpenContextMenu={setContextMenu}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <TrackContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      </div>
    );
  }

  // ===================== PLAYLIST DETAIL VIEW =====================
  if (activeView.type === "playlist") {
    const playlist =
      activePlaylist?.id === activeView.playlistId ? activePlaylist : null;

    if (!playlist) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#000000]">
          <Loader2 size={30} className="animate-spin text-[#FF5E4D]" />
        </div>
      );
    }

    const tracks = playlist.tracks ?? [];
    const totalSecs = tracks.reduce(
      (acc, t) => acc + (t.duration_seconds || 0),
      0
    );
    const isPlayingThisPlaylist =
      tracks.length > 0 &&
      isPlaying &&
      tracks.some((t) => t.video_id === currentTrack?.video_id);
    const accent = playlist.cover_color || "#FF5E4D";

    return (
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-24"
        style={{
          background: `linear-gradient(180deg, ${accent}66 0%, ${accent}22 210px, #000000 360px, #000000 100%)`,
        }}
      >
        {/* Dynamic Gradient Playlist Header (compact & centered on mobile) */}
        <div className="px-4 md:px-6 pt-6 md:pt-8 pb-4 md:pb-6 flex flex-col items-center text-center md:flex-row md:items-end md:text-left gap-4 md:gap-6">
          <div
            className="w-36 h-36 sm:w-44 sm:h-44 md:w-52 md:h-52 rounded-lg shadow-2xl shrink-0 overflow-hidden flex items-center justify-center"
            style={{
              background:
                playlist.thumbnails.length === 0
                  ? `linear-gradient(135deg, ${accent} 0%, #141414 100%)`
                  : "#141414",
            }}
          >
            {playlist.thumbnails.length >= 4 ? (
              <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
                {playlist.thumbnails.slice(0, 4).map((thumb, idx) => (
                  <img
                    key={idx}
                    src={thumb}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ))}
              </div>
            ) : playlist.thumbnails.length > 0 ? (
              <img
                src={playlist.thumbnails[0]}
                alt={playlist.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <ListMusic size={60} className="text-white/90" />
            )}
          </div>

          <div className="min-w-0 w-full">
            <p className="text-[11px] md:text-xs font-bold uppercase tracking-widest text-white/90">
              Playlist
            </p>
            <h1 className="text-2xl sm:text-4xl md:text-6xl font-black tracking-tight text-white mt-1 md:mt-2 truncate">
              {playlist.name}
            </h1>
            {playlist.description && (
              <p className="text-xs md:text-sm text-white/75 mt-1.5 md:mt-2 line-clamp-2">
                {playlist.description}
              </p>
            )}
            <p className="text-xs md:text-sm text-white/80 mt-2 md:mt-3 font-medium">
              {tracks.length} {tracks.length === 1 ? "song" : "songs"}
              {totalSecs > 0 ? ` • ${formatTotalDuration(totalSecs)}` : ""}
            </p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 md:gap-5">
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => {
                if (tracks.length > 0) {
                  playTrack(tracks[0], tracks);
                }
              }}
              aria-label={`Play ${playlist.name}`}
              className="w-14 h-14 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] hover:scale-105 disabled:opacity-40 disabled:hover:scale-100 text-black flex items-center justify-center shadow-xl transition-all"
            >
              {isPlayingThisPlaylist ? (
                <Pause size={26} className="fill-black" />
              ) : (
                <Play size={26} className="fill-black ml-1" />
              )}
            </button>

            <button
              type="button"
              onClick={toggleShuffle}
              title="Toggle Shuffle"
              aria-label="Toggle Shuffle"
              className={`min-w-[44px] min-h-[44px] flex items-center justify-center p-2 transition-colors ${
                shuffle ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
              }`}
            >
              <Shuffle size={24} />
            </button>

            <span className="hidden md:inline text-xs text-[#B3B3B3]">
              Drag rows or use arrows to reorder tracks
            </span>
          </div>

          <button
            type="button"
            onClick={() => void deletePlaylist(playlist.id)}
            className="min-h-[44px] md:min-h-0 flex items-center gap-1.5 px-4 md:px-3.5 py-2 md:py-1.5 rounded-full bg-black/40 hover:bg-[#1E1E1E] text-xs font-semibold text-[#B3B3B3] hover:text-[#FF5E4D] transition-colors shrink-0"
          >
            <Trash2 size={15} />
            <span>Delete</span>
            <span className="hidden sm:inline">Playlist</span>
          </button>
        </div>

        {/* Reorderable Track List */}
        <div className="px-2 md:px-6">
          {tracks.length === 0 ? (
            <div className="mx-2 md:mx-0 rounded-xl bg-[#141414]/90 p-8 md:p-10 text-center mt-4">
              <ListMusic size={36} className="mx-auto text-[#FF5E4D] mb-3" />
              <p className="text-lg font-bold text-white">
                This playlist is currently empty
              </p>
              <p className="text-sm text-[#B3B3B3] mt-1">
                Search for songs and tap &hellip; or + to add tracks.
              </p>
              <button
                type="button"
                onClick={() => navigate({ type: "search" })}
                className="mt-4 min-h-[44px] px-6 py-2 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] text-black text-xs font-bold transition-colors"
              >
                Find Songs
              </button>
            </div>
          ) : (
            <>
              {renderPlayableListHeader()}
              <div className="space-y-0.5">
                {tracks.map((track, idx) => (
                  <TrackRow
                    key={track.video_id}
                    track={track}
                    index={idx}
                    contextQueue={tracks}
                    playlistId={playlist.id}
                    reorderable
                    totalCount={tracks.length}
                    isDragOver={dragOverIndex === idx && dragIndex !== idx}
                    onMoveUp={() =>
                      void reorderPlaylistTracks(playlist.id, idx, idx - 1)
                    }
                    onMoveDown={() =>
                      void reorderPlaylistTracks(playlist.id, idx, idx + 1)
                    }
                    onDragStart={(fromIdx) => setDragIndex(fromIdx)}
                    onDragOverRow={(e, overIdx) => {
                      e.preventDefault();
                      setDragOverIndex(overIdx);
                    }}
                    onDropRow={(toIdx) => {
                      if (dragIndex !== null && dragIndex !== toIdx) {
                        void reorderPlaylistTracks(
                          playlist.id,
                          dragIndex,
                          toIdx
                        );
                      }
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onOpenContextMenu={setContextMenu}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <TrackContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      </div>
    );
  }

  // ===================== QUEUE VIEW =====================
  const jamUpcoming =
    queueIndex >= 0
      ? [...queue.slice(queueIndex + 1), ...queue.slice(0, queueIndex)]
      : queue;
  const upcoming = jamState.active
    ? jamUpcoming
    : queueIndex >= 0
      ? queue.slice(queueIndex + 1)
      : queue;

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-6 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-24 pt-6 bg-[#000000]">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-extrabold text-white">
            {jamState.active ? "Jam Queue" : "Queue"}
          </h1>
          {jamState.active ? (
            <span className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border bg-[#FF5E4D]/15 border-[#FF5E4D] text-[#FF5E4D]">
              <Radio size={13} />
              <span>BLE Jam Loop • Repeat All</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={toggleAutoplayRadio}
              aria-pressed={autoplayRadio}
              className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                autoplayRadio
                  ? "bg-[#FF5E4D]/15 border-[#FF5E4D] text-[#FF5E4D] hover:bg-[#FF5E4D]/25"
                  : "bg-[#141414] border-white/10 text-[#B3B3B3] hover:text-white"
              }`}
            >
              {isFetchingRadio ? (
                <Loader2 size={13} className="animate-spin text-[#FF5E4D]" />
              ) : (
                <Radio size={13} />
              )}
              <span>Autoplay Radio</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] leading-none ${
                  autoplayRadio
                    ? "bg-[#FF5E4D] text-black"
                    : "bg-white/10 text-[#B3B3B3]"
                }`}
              >
                {autoplayRadio ? "ON" : "OFF"}
              </span>
            </button>
          )}
        </div>

        {!jamState.active && upcoming.length > 0 && (
          <button
            type="button"
            onClick={clearUpcomingQueue}
            className="min-h-[44px] md:min-h-0 px-4 py-2 md:py-1.5 rounded-full bg-[#141414] hover:bg-[#1E1E1E] border border-white/10 text-xs font-bold text-[#B3B3B3] hover:text-white transition-colors"
          >
            Clear queue
          </button>
        )}
      </div>

      {/* Now Playing */}
      <div className="mb-8">
        <h2 className="text-xs md:text-sm font-bold uppercase tracking-wider text-[#B3B3B3] mb-3">
          Now playing
        </h2>
        {currentTrack ? (
          <div className="flex items-center gap-3 md:gap-4 p-3 rounded-lg bg-[#141414] border border-[#FF5E4D]/25">
            <img
              src={currentTrack.thumbnail}
              alt={currentTrack.title}
              className="w-12 h-12 rounded object-cover shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-[#FF5E4D] truncate">
                {currentTrack.title}
              </p>
              <p className="text-xs text-[#B3B3B3] truncate">
                {currentTrack.artist}
              </p>
            </div>
            <span className="hidden sm:inline text-xs text-[#B3B3B3] tabular-nums pr-2">
              {currentTrack.duration}
            </span>
          </div>
        ) : (
          <p className="text-sm text-[#727272]">Nothing is playing right now.</p>
        )}
      </div>

      {/* Next Up */}
      <div>
        <h2 className="text-xs md:text-sm font-bold uppercase tracking-wider text-[#B3B3B3] mb-3">
          Next up ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          isFetchingRadio ? (
            <div className="rounded-xl bg-[#141414] p-8 text-center">
              <Loader2 size={28} className="mx-auto text-[#FF5E4D] animate-spin mb-2" />
              <p className="text-sm text-[#B3B3B3]">
                Finding similar tracks for your queue...
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-[#141414] p-8 text-center">
              <ListMusic size={30} className="mx-auto text-[#727272] mb-2" />
              <p className="text-sm text-[#B3B3B3]">
                Use &hellip; or right-click &rarr; Play Next / Add to Queue on any song.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-1">
            {upcoming.map((track, offset) => {
              const absoluteIdx =
                queueIndex >= 0 ? queueIndex + 1 + offset : offset;
              const isPrefetched =
                offset === 0 && prefetchedVideoId === track.video_id;

              return (
                <div
                  key={`${track.video_id}-${absoluteIdx}`}
                  className="group flex items-center gap-3 px-2 md:px-3 py-2 rounded-md hover:bg-[#1E1E1E] transition-colors"
                >
                  <span className="hidden md:inline-block w-6 text-center text-xs tabular-nums text-[#B3B3B3]">
                    {offset + 1}
                  </span>
                  <img
                    src={track.thumbnail}
                    alt={track.title}
                    className="w-11 h-11 md:w-10 md:h-10 rounded object-cover cursor-pointer shrink-0"
                    onClick={() => playTrack(track, queue)}
                  />
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => playTrack(track, queue)}
                  >
                    <p className="text-sm font-medium text-white truncate">
                      {track.title}
                    </p>
                    <p className="text-xs text-[#B3B3B3] truncate">
                      {track.artist}
                      {(track as { addedBy?: string }).addedBy
                        ? ` • Added by ${(track as { addedBy?: string }).addedBy}`
                        : ""}
                    </p>
                  </div>
                  {isPrefetched && (
                    <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#FF5E4D]/15 border border-[#FF5E4D]/40 text-[10px] font-bold text-[#FF5E4D] shrink-0">
                      <Sparkles size={10} />
                      PREFETCHED • READY
                    </span>
                  )}
                  <span className="hidden md:inline text-xs text-[#B3B3B3] tabular-nums">
                    {track.duration}
                  </span>
                  {!jamState.active && (
                    <button
                      type="button"
                      onClick={() => removeFromQueue(absoluteIdx)}
                      aria-label="Remove from queue"
                      className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-2 md:p-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 rounded-full text-[#B3B3B3] hover:text-[#FF5E4D] transition-all shrink-0"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
