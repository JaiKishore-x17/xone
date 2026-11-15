import React, { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Heart,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
} from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types";
import type { ContextMenuState } from "./TrackContextMenu";

interface TrackRowProps {
  track: Track;
  index: number;
  contextQueue?: Track[];
  playlistId?: number;
  reorderable?: boolean;
  totalCount?: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDragStart?: (index: number) => void;
  onDragOverRow?: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onDropRow?: (index: number) => void;
  isDragOver?: boolean;
  onOpenContextMenu: (menu: ContextMenuState) => void;
}

export const TrackRow: React.FC<TrackRowProps> = ({
  track,
  index,
  contextQueue,
  playlistId,
  reorderable = false,
  totalCount = 0,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOverRow,
  onDropRow,
  isDragOver = false,
  onOpenContextMenu,
}) => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const likedIds = usePlayerStore((s) => s.likedIds);
  const playlists = usePlayerStore((s) => s.playlists);

  const playTrack = usePlayerStore((s) => s.playTrack);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const setNewPlaylistModalOpen = usePlayerStore(
    (s) => s.setNewPlaylistModalOpen
  );

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [dropdownOpen]);

  const isActive = currentTrack?.video_id === track.video_id;
  const isActivelyPlaying = isActive && isPlaying;
  const isLiked = Boolean(likedIds[track.video_id]);

  return (
    <div
      draggable={reorderable}
      onDragStart={() => onDragStart?.(index)}
      onDragOver={(e) => onDragOverRow?.(e, index)}
      onDrop={() => onDropRow?.(index)}
      onDoubleClick={() => playTrack(track, contextQueue)}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenContextMenu({
          track,
          x: e.clientX,
          y: e.clientY,
          playlistId,
        });
      }}
      className={`group flex md:grid md:grid-cols-[36px_minmax(0,2.2fr)_minmax(0,1.2fr)_140px] items-center gap-3 px-2 md:px-3 py-1.5 md:py-2 rounded-md transition-colors ${
        isDragOver
          ? "border-t-2 border-[#FF5E4D] bg-[#282828]"
          : isActive
            ? "bg-[#282828]/80 hover:bg-[#282828]"
            : "hover:bg-[#282828]"
      }`}
    >
      {/* Index / Equalizer / Play toggle (Desktop only) */}
      <div className="hidden md:flex items-center justify-center w-8 h-8">
        {reorderable && (
          <GripVertical
            size={14}
            className="hidden group-hover:block text-[#727272] cursor-grab mr-0.5 shrink-0"
          />
        )}
        <button
          type="button"
          onClick={() => playTrack(track, contextQueue)}
          aria-label={isActivelyPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
          className="flex items-center justify-center w-7 h-7"
        >
          {isActivelyPlaying ? (
            <>
              <div className="flex items-end gap-[2px] h-4 group-hover:hidden">
                <span className="w-[3px] bg-[#FF5E4D] rounded-sm eq-bar-1" />
                <span className="w-[3px] bg-[#FF5E4D] rounded-sm eq-bar-2" />
                <span className="w-[3px] bg-[#FF5E4D] rounded-sm eq-bar-3" />
              </div>
              <Pause
                size={15}
                className="hidden group-hover:block text-[#FF5E4D] fill-[#FF5E4D]"
              />
            </>
          ) : (
            <>
              <span
                className={`text-sm tabular-nums group-hover:hidden ${
                  isActive ? "text-[#FF5E4D] font-bold" : "text-[#B3B3B3]"
                }`}
              >
                {index + 1}
              </span>
              <Play
                size={15}
                className="hidden group-hover:block text-white fill-white"
              />
            </>
          )}
        </button>
      </div>

      {/* Cover Art + Stacked Title + Artist */}
      <div
        onClick={() => playTrack(track, contextQueue)}
        className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer min-h-[44px]"
      >
        <div className="relative w-11 h-11 md:w-10 md:h-10 rounded overflow-hidden shrink-0 bg-[#181818]">
          <img
            src={track.thumbnail}
            alt={track.title}
            loading="lazy"
            className="w-full h-full object-cover"
          />
          {isActivelyPlaying && (
            <div className="md:hidden absolute inset-0 bg-black/55 flex items-center justify-center">
              <div className="flex items-end gap-[2px] h-4">
                <span className="w-[3px] bg-[#FF5E4D] rounded-sm eq-bar-1" />
                <span className="w-[3px] bg-[#FF5E4D] rounded-sm eq-bar-2" />
                <span className="w-[3px] bg-[#FF5E4D] rounded-sm eq-bar-3" />
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm font-medium truncate ${
              isActive ? "text-[#FF5E4D]" : "text-white"
            }`}
          >
            {track.title}
          </p>
          <p className="text-xs text-[#B3B3B3] truncate">{track.artist}</p>
        </div>
      </div>

      {/* Album (Desktop only) */}
      <div className="min-w-0 hidden md:block">
        <p className="text-xs text-[#B3B3B3] truncate">
          {track.album || "Single"}
        </p>
      </div>

      {/* Actions: Reorder (desktop playlist), Like, Add-to-Playlist (desktop), Duration (desktop), More */}
      <div className="flex items-center justify-end gap-0.5 md:gap-1.5 shrink-0">
        {reorderable && (
          <div className="hidden md:group-hover:flex items-center gap-0.5 mr-1">
            <button
              type="button"
              disabled={index === 0}
              onClick={onMoveUp}
              title="Move up"
              aria-label="Move track up"
              className="p-1 rounded text-[#B3B3B3] hover:text-white disabled:opacity-25"
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              disabled={index >= totalCount - 1}
              onClick={onMoveDown}
              title="Move down"
              aria-label="Move track down"
              className="p-1 rounded text-[#B3B3B3] hover:text-white disabled:opacity-25"
            >
              <ArrowDown size={13} />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => void toggleLike(track)}
          aria-label={isLiked ? "Unlike track" : "Like track"}
          className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-2 md:p-1 rounded-full transition-all ${
            isLiked
              ? "opacity-100 text-[#FF5E4D]"
              : "opacity-100 md:opacity-0 md:group-hover:opacity-100 text-[#B3B3B3] hover:text-white"
          }`}
        >
          <Heart size={17} className={isLiked ? "fill-[#FF5E4D]" : ""} />
        </button>

        {/* Add to playlist quick dropdown (Desktop only; mobile uses bottom sheet via ...) */}
        <div className="relative hidden md:block" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            title="Add to playlist"
            aria-label="Add to playlist"
            className="opacity-0 group-hover:opacity-100 p-1 rounded-full text-[#B3B3B3] hover:text-[#FF5E4D] transition-all"
          >
            <Plus size={16} />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 bottom-full mb-1 z-40 w-48 rounded-md bg-[#282828] border border-white/10 shadow-xl py-1 text-xs">
              <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#A7A7A7]">
                Add to playlist
              </p>
              {playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => {
                    void addTrackToPlaylist(pl.id, track);
                    setDropdownOpen(false);
                  }}
                  className="w-full px-3 py-1.5 text-left text-white hover:bg-white/10 truncate"
                >
                  {pl.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setDropdownOpen(false);
                  setNewPlaylistModalOpen(true);
                }}
                className="w-full px-3 py-1.5 text-left text-[#FF5E4D] font-semibold hover:bg-white/10 border-t border-white/10 mt-1 pt-2"
              >
                + New Playlist
              </button>
            </div>
          )}
        </div>

        <span className="hidden md:inline-block text-xs tabular-nums text-[#B3B3B3] w-10 text-right">
          {track.duration || "0:00"}
        </span>

        <button
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            onOpenContextMenu({
              track,
              x: rect.left - 180,
              y: rect.bottom + 4,
              playlistId,
            });
          }}
          aria-label="More options"
          className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center p-2 md:p-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 rounded-full text-[#B3B3B3] hover:text-white transition-all"
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  );
};
