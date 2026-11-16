import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Heart,
  ListEnd,
  ListPlus,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types";
import { DownloadStatusIcon } from "./DownloadStatusIcon";

export interface ContextMenuState {
  track: Track;
  x: number;
  y: number;
  playlistId?: number;
}

interface TrackContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
}

export const TrackContextMenu: React.FC<TrackContextMenuProps> = ({
  menu,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [showPlaylistsSub, setShowPlaylistsSub] = useState(false);
  const [mobilePlaylistsOpen, setMobilePlaylistsOpen] = useState(false);

  const playlists = usePlayerStore((s) => s.playlists);
  const likedIds = usePlayerStore((s) => s.likedIds);
  const downloadedIds = usePlayerStore((s) => s.downloadedIds);
  const downloadingIds = usePlayerStore((s) => s.downloadingIds);
  const playNextInQueue = usePlayerStore((s) => s.playNextInQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const toggleDownload = usePlayerStore((s) => s.toggleDownload);
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const removeTrackFromPlaylist = usePlayerStore(
    (s) => s.removeTrackFromPlaylist
  );
  const setNewPlaylistModalOpen = usePlayerStore(
    (s) => s.setNewPlaylistModalOpen
  );

  useEffect(() => {
    setShowPlaylistsSub(false);
    setMobilePlaylistsOpen(false);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inDesktopMenu = menuRef.current?.contains(target);
      const inMobileSheet = sheetRef.current?.contains(target);
      if (!inDesktopMenu && !inMobileSheet) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  const isLiked = Boolean(likedIds[menu.track.video_id]);
  const isDownloaded = Boolean(downloadedIds[menu.track.video_id]);
  const isDownloading = Boolean(downloadingIds[menu.track.video_id]);
  const downloadLabel = isDownloading
    ? "Downloading..."
    : isDownloaded
      ? "Remove Download"
      : "Download";
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
  const viewportHeight =
    typeof window !== "undefined" ? window.innerHeight : 800;

  const left = Math.min(Math.max(8, menu.x), viewportWidth - 235);
  const top = Math.min(Math.max(8, menu.y), viewportHeight - 250);

  return (
    <>
      {/* ===================== DESKTOP POPOVER (>= 768px) ===================== */}
      <div
        ref={menuRef}
        style={{ left, top }}
        className="hidden md:block fixed z-50 w-56 rounded-md bg-[#1E1E1E] border border-white/10 shadow-2xl py-1.5 text-sm text-[#EAEAEA] select-none"
      >
        <button
          type="button"
          onClick={() => {
            playNextInQueue(menu.track);
            onClose();
          }}
          className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/10 text-left transition-colors"
        >
          <Play size={15} className="text-[#FF5E4D]" />
          <span>Play Next</span>
        </button>

        <button
          type="button"
          onClick={() => {
            addToQueue(menu.track);
            onClose();
          }}
          className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/10 text-left transition-colors"
        >
          <ListEnd size={15} className="text-[#B3B3B3]" />
          <span>Add to Queue</span>
        </button>

        <div className="my-1 border-t border-white/10" />

        <button
          type="button"
          onClick={() => {
            void toggleLike(menu.track);
            onClose();
          }}
          className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/10 text-left transition-colors"
        >
          <Heart
            size={15}
            className={isLiked ? "text-[#FF5E4D] fill-[#FF5E4D]" : "text-[#B3B3B3]"}
          />
          <span>{isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}</span>
        </button>

        <button
          type="button"
          disabled={isDownloading}
          onClick={() => {
            void toggleDownload(menu.track);
            onClose();
          }}
          className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/10 disabled:opacity-60 text-left transition-colors"
        >
          <DownloadStatusIcon
            isDownloading={isDownloading}
            isDownloaded={isDownloaded}
            size={15}
            inactiveClassName="text-[#B3B3B3]"
          />
          <span>{downloadLabel}</span>
        </button>

        {/* Add to Playlist nested menu */}
        <div
          className="relative"
          onMouseEnter={() => setShowPlaylistsSub(true)}
          onMouseLeave={() => setShowPlaylistsSub(false)}
        >
          <button
            type="button"
            onClick={() => setShowPlaylistsSub((v) => !v)}
            className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/10 text-left transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <ListPlus size={15} className="text-[#B3B3B3]" />
              <span>Add to playlist</span>
            </span>
            <ChevronRight size={14} className="text-[#B3B3B3]" />
          </button>

          {showPlaylistsSub && (
            <div
              className={`absolute top-0 w-52 max-h-60 overflow-y-auto rounded-md bg-[#1E1E1E] border border-white/10 shadow-2xl py-1.5 ${
                left + 440 > viewportWidth ? "right-full mr-1" : "left-full ml-1"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setNewPlaylistModalOpen(true);
                  onClose();
                }}
                className="w-full px-3 py-2 flex items-center gap-2 hover:bg-white/10 text-left text-[#FF5E4D] font-semibold"
              >
                <Plus size={14} />
                <span>New playlist</span>
              </button>
              <div className="my-1 border-t border-white/10" />
              {playlists.length === 0 ? (
                <p className="px-3 py-2 text-xs text-[#A7A7A7]">No playlists yet</p>
              ) : (
                playlists.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => {
                      void addTrackToPlaylist(pl.id, menu.track);
                      onClose();
                    }}
                    className="w-full px-3 py-2 text-left text-sm truncate hover:bg-white/10 transition-colors"
                  >
                    {pl.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {menu.playlistId !== undefined && (
          <>
            <div className="my-1 border-t border-white/10" />
            <button
              type="button"
              onClick={() => {
                if (menu.playlistId !== undefined) {
                  void removeTrackFromPlaylist(menu.playlistId, menu.track.video_id);
                }
                onClose();
              }}
              className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/10 text-left text-[#FF5E4D] transition-colors"
            >
              <Trash2 size={15} />
              <span>Remove from playlist</span>
            </button>
          </>
        )}
      </div>

      {/* ===================== MOBILE BOTTOM ACTION SHEET (< 768px) ===================== */}
      <div
        onClick={onClose}
        className="md:hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end justify-center select-none"
      >
        <div
          ref={sheetRef}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-h-[82vh] overflow-y-auto rounded-t-2xl bg-[#141414] border-t border-white/10 px-4 pt-3 pb-[calc(1.75rem+env(safe-area-inset-bottom))] shadow-2xl"
        >
          {/* Sheet Drag Handle */}
          <div className="w-10 h-1 rounded-full bg-white/25 mx-auto mb-3" />

          {/* Track Summary Header */}
          <div className="flex items-center gap-3 pb-3 border-b border-white/10">
            <img
              src={menu.track.thumbnail}
              alt={menu.track.title}
              className="w-11 h-11 rounded object-cover shrink-0 bg-black"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white truncate">
                {menu.track.title}
              </p>
              <p className="text-xs text-[#B3B3B3] truncate">
                {menu.track.artist}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close actions"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full text-[#B3B3B3] hover:text-white"
            >
              <X size={20} />
            </button>
          </div>

          {/* Touch-Friendly Action Buttons (>= 48px) */}
          <div className="pt-2 space-y-1 text-sm font-medium text-white">
            <button
              type="button"
              onClick={() => {
                playNextInQueue(menu.track);
                onClose();
              }}
              className="w-full min-h-[48px] px-3 rounded-lg flex items-center gap-3.5 hover:bg-[#1E1E1E] active:bg-[#1E1E1E] text-left transition-colors"
            >
              <Play size={18} className="text-[#FF5E4D]" />
              <span>Play Next</span>
            </button>

            <button
              type="button"
              onClick={() => {
                addToQueue(menu.track);
                onClose();
              }}
              className="w-full min-h-[48px] px-3 rounded-lg flex items-center gap-3.5 hover:bg-[#1E1E1E] active:bg-[#1E1E1E] text-left transition-colors"
            >
              <ListEnd size={18} className="text-[#B3B3B3]" />
              <span>Add to Queue</span>
            </button>

            <button
              type="button"
              onClick={() => {
                void toggleLike(menu.track);
                onClose();
              }}
              className="w-full min-h-[48px] px-3 rounded-lg flex items-center gap-3.5 hover:bg-[#1E1E1E] active:bg-[#1E1E1E] text-left transition-colors"
            >
              <Heart
                size={18}
                className={
                  isLiked ? "text-[#FF5E4D] fill-[#FF5E4D]" : "text-[#B3B3B3]"
                }
              />
              <span>
                {isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"}
              </span>
            </button>

            <button
              type="button"
              disabled={isDownloading}
              onClick={() => {
                void toggleDownload(menu.track);
                onClose();
              }}
              className="w-full min-h-[48px] px-3 rounded-lg flex items-center gap-3.5 hover:bg-[#1E1E1E] active:bg-[#1E1E1E] disabled:opacity-60 text-left transition-colors"
            >
              <DownloadStatusIcon
                isDownloading={isDownloading}
                isDownloaded={isDownloaded}
                size={18}
                inactiveClassName="text-[#B3B3B3]"
              />
              <span>{downloadLabel}</span>
            </button>

            {/* Expandable Add to Playlist list */}
            <div>
              <button
                type="button"
                onClick={() => setMobilePlaylistsOpen((v) => !v)}
                className="w-full min-h-[48px] px-3 rounded-lg flex items-center justify-between hover:bg-[#1E1E1E] active:bg-[#1E1E1E] text-left transition-colors"
              >
                <span className="flex items-center gap-3.5">
                  <ListPlus size={18} className="text-[#B3B3B3]" />
                  <span>Add to Playlist</span>
                </span>
                {mobilePlaylistsOpen ? (
                  <ChevronDown size={18} className="text-[#B3B3B3]" />
                ) : (
                  <ChevronRight size={18} className="text-[#B3B3B3]" />
                )}
              </button>

              {mobilePlaylistsOpen && (
                <div className="mt-1 ml-3 pl-3 border-l border-white/10 space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      setNewPlaylistModalOpen(true);
                      onClose();
                    }}
                    className="w-full min-h-[44px] px-3 rounded-lg flex items-center gap-2.5 text-[#FF5E4D] font-semibold hover:bg-[#1E1E1E] text-left"
                  >
                    <Plus size={16} />
                    <span>New Playlist</span>
                  </button>
                  {playlists.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-[#A7A7A7]">
                      No playlists yet
                    </p>
                  ) : (
                    playlists.map((pl) => (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => {
                          void addTrackToPlaylist(pl.id, menu.track);
                          onClose();
                        }}
                        className="w-full min-h-[44px] px-3 rounded-lg text-left text-sm text-[#EAEAEA] hover:bg-[#1E1E1E] truncate"
                      >
                        {pl.name}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {menu.playlistId !== undefined && (
              <button
                type="button"
                onClick={() => {
                  if (menu.playlistId !== undefined) {
                    void removeTrackFromPlaylist(
                      menu.playlistId,
                      menu.track.video_id
                    );
                  }
                  onClose();
                }}
                className="w-full min-h-[48px] px-3 rounded-lg flex items-center gap-3.5 text-[#FF5E4D] hover:bg-[#1E1E1E] active:bg-[#1E1E1E] text-left transition-colors"
              >
                <Trash2 size={18} />
                <span>Remove from Playlist</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
