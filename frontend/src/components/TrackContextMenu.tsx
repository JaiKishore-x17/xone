import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  Gamepad2,
  Heart,
  ListEnd,
  ListPlus,
  Play,
  Plus,
  Speaker,
  Trash2,
  X,
} from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types";
import { DownloadStatusIcon } from "./DownloadStatusIcon";
import { TrackArtwork } from "./TrackArtwork";

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
  const sheetBackdropRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetTouchRef = useRef<{
    startY: number;
    startTime: number;
    canDrag: boolean;
    dragging: boolean;
  } | null>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const sheetRafRef = useRef<number | null>(null);
  const pendingSheetDragYRef = useRef<number | null>(null);
  const sheetDragYRef = useRef(0);
  const [showPlaylistsSub, setShowPlaylistsSub] = useState(false);
  const [mobilePlaylistsOpen, setMobilePlaylistsOpen] = useState(false);
  const [sheetEntered, setSheetEntered] = useState(false);

  const playlists = usePlayerStore((s) => s.playlists);
  const likedIds = usePlayerStore((s) => s.likedIds);
  const downloadedIds = usePlayerStore((s) => s.downloadedIds);
  const downloadingIds = usePlayerStore((s) => s.downloadingIds);
  const jamState = usePlayerStore((s) => s.jamState);
  const playNextInQueue = usePlayerStore((s) => s.playNextInQueue);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const addTrackToJamSession = usePlayerStore((s) => s.addTrackToJamSession);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const toggleDownload = usePlayerStore((s) => s.toggleDownload);
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const removeTrackFromPlaylist = usePlayerStore(
    (s) => s.removeTrackFromPlaylist
  );
  const openXoneDash = usePlayerStore((s) => s.openXoneDash);
  const setNewPlaylistModalOpen = usePlayerStore(
    (s) => s.setNewPlaylistModalOpen
  );

  useEffect(() => {
    setShowPlaylistsSub(false);
    setMobilePlaylistsOpen(false);
    sheetDragYRef.current = 0;
    pendingSheetDragYRef.current = null;
  }, [menu]);

  useLayoutEffect(() => {
    if (!menu) {
      setSheetEntered(false);
      return;
    }
    setSheetEntered(false);
    sheetDragYRef.current = 0;
    pendingSheetDragYRef.current = null;
    if (sheetRef.current) {
      sheetRef.current.scrollTo({ top: 0, behavior: "instant" });
      sheetRef.current.style.transition =
        "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)";
      sheetRef.current.style.transform = "";
    }
    if (sheetBackdropRef.current) {
      sheetBackdropRef.current.style.transition =
        "background-color 200ms ease-out";
      sheetBackdropRef.current.style.backgroundColor = "";
    }
    let cancelled = false;
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (!cancelled) {
          setSheetEntered(true);
        }
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [menu]);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
      }
      if (sheetRafRef.current !== null) {
        window.cancelAnimationFrame(sheetRafRef.current);
      }
    };
  }, []);

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

  const cancelSheetRaf = () => {
    if (sheetRafRef.current !== null) {
      window.cancelAnimationFrame(sheetRafRef.current);
      sheetRafRef.current = null;
    }
    pendingSheetDragYRef.current = null;
  };

  const applySheetDragVisuals = (dy: number) => {
    sheetDragYRef.current = dy;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
      sheetRef.current.style.transform = `translate3d(0, ${dy}px, 0)`;
    }
    if (sheetBackdropRef.current) {
      const alpha = dy > 0 ? Math.max(0.15, 0.75 * (1 - dy / 420)) : 0.75;
      sheetBackdropRef.current.style.transition = "none";
      sheetBackdropRef.current.style.backgroundColor = `rgba(0, 0, 0, ${alpha})`;
    }
  };

  const handleSheetTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    cancelSheetRaf();
    const sheet = sheetRef.current;
    const target = e.target as HTMLElement | null;
    const onHandleOrHeader = Boolean(target?.closest("[data-sheet-handle]"));
    const canDrag = onHandleOrHeader || !sheet || sheet.scrollTop <= 2;
    sheetTouchRef.current = {
      startY: e.touches[0].clientY,
      startTime: Date.now(),
      canDrag,
      dragging: false,
    };
  };

  const handleSheetTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const drag = sheetTouchRef.current;
    if (!drag || !drag.canDrag || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - drag.startY;
    if (dy > 4) {
      drag.dragging = true;
      pendingSheetDragYRef.current = dy;
      if (sheetRafRef.current === null) {
        sheetRafRef.current = window.requestAnimationFrame(() => {
          sheetRafRef.current = null;
          if (pendingSheetDragYRef.current !== null) {
            const targetY = pendingSheetDragYRef.current;
            pendingSheetDragYRef.current = null;
            applySheetDragVisuals(targetY);
          }
        });
      }
    }
  };

  const handleSheetTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const drag = sheetTouchRef.current;
    sheetTouchRef.current = null;
    cancelSheetRaf();
    if (!drag || !drag.dragging) return;

    const dy =
      e.changedTouches.length > 0
        ? e.changedTouches[0].clientY - drag.startY
        : sheetDragYRef.current;
    const elapsed = Math.max(1, Date.now() - drag.startTime);
    const velocity = dy / elapsed;

    if (dy > 80 || (dy > 40 && velocity > 0.65)) {
      const exitY = typeof window !== "undefined" ? window.innerHeight : 700;
      if (sheetRef.current) {
        sheetRef.current.style.transition = "transform 180ms ease-in";
        sheetRef.current.style.transform = `translate3d(0, ${exitY}px, 0)`;
      }
      if (sheetBackdropRef.current) {
        sheetBackdropRef.current.style.transition =
          "background-color 180ms ease-in";
        sheetBackdropRef.current.style.backgroundColor = "rgba(0, 0, 0, 0)";
      }
      dismissTimerRef.current = window.setTimeout(() => {
        dismissTimerRef.current = null;
        onClose();
      }, 180);
    } else {
      sheetDragYRef.current = 0;
      if (sheetRef.current) {
        sheetRef.current.style.transition =
          "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
        sheetRef.current.style.transform = "translate3d(0, 0, 0)";
      }
      if (sheetBackdropRef.current) {
        sheetBackdropRef.current.style.transition =
          "background-color 220ms ease-out";
        sheetBackdropRef.current.style.backgroundColor = "rgba(0, 0, 0, 0.75)";
      }
    }
  };

  const handleSheetTouchCancel = () => {
    sheetTouchRef.current = null;
    cancelSheetRaf();
    sheetDragYRef.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition =
        "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
      sheetRef.current.style.transform = "translate3d(0, 0, 0)";
    }
    if (sheetBackdropRef.current) {
      sheetBackdropRef.current.style.transition =
        "background-color 220ms ease-out";
      sheetBackdropRef.current.style.backgroundColor = "rgba(0, 0, 0, 0.75)";
    }
  };

  const content = (
    <>
      {/* ===================== DESKTOP POPOVER (>= 768px) ===================== */}
      <div
        ref={menuRef}
        data-no-tab-swipe="true"
        style={{ left, top }}
        className="hidden md:block fixed z-[110] w-56 rounded-md bg-[#1E1E1E] border border-white/10 shadow-2xl py-1.5 text-sm text-[#EAEAEA] select-none"
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

        {jamState.active && (
          <button
            type="button"
            onClick={() => {
              void addTrackToJamSession(menu.track);
              onClose();
            }}
            className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/10 text-left text-[#FF5E4D] transition-colors"
          >
            <Speaker size={15} />
            <span>Add to Jam Queue</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            openXoneDash(menu.track);
            onClose();
          }}
          className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/10 text-left transition-colors"
        >
          <Gamepad2 size={15} className="text-[#FF5E4D]" />
          <span>Play Xone Dash</span>
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
              <button
          type="button"
          onClick={() => {
            openXoneDash(menu.track);
            onClose();
          }}
          className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/10 text-left transition-colors"
        >
          <Gamepad2 size={15} className="text-[#FF5E4D]" />
          <span>Play Xone Dash</span>
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
            <button
          type="button"
          onClick={() => {
            openXoneDash(menu.track);
            onClose();
          }}
          className="w-full px-3 py-2 flex items-center gap-2.5 hover:bg-white/10 text-left transition-colors"
        >
          <Gamepad2 size={15} className="text-[#FF5E4D]" />
          <span>Play Xone Dash</span>
        </button>

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
        ref={sheetBackdropRef}
        data-no-tab-swipe="true"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
        style={{
          backgroundColor: `rgba(0, 0, 0, ${sheetEntered ? 0.75 : 0})`,
        }}
        className="md:hidden fixed inset-0 z-[110] flex items-end justify-center select-none transition-colors duration-200 ease-out"
      >
        <div
          ref={sheetRef}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={handleSheetTouchStart}
          onTouchMove={handleSheetTouchMove}
          onTouchEnd={handleSheetTouchEnd}
          onTouchCancel={handleSheetTouchCancel}
          style={{
            transform: sheetEntered
              ? "translate3d(0, 0, 0)"
              : "translate3d(0, 100%, 0)",
            transition: "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
          className="w-full max-h-[80vh] overflow-y-auto xone-modal-scroll overscroll-y-contain rounded-t-2xl bg-[#141414] border-t border-white/10 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+3rem)] shadow-2xl touch-pan-y"
        >
          {/* Sheet Drag Handle */}
          <div data-sheet-handle="true" className="py-1 -mt-1 mb-2 cursor-grab">
            <div className="w-10 h-1 rounded-full bg-white/25 mx-auto" />
          </div>

          {/* Track Summary Header */}
          <div
            data-sheet-handle="true"
            className="flex items-center gap-3 pb-3 border-b border-white/10"
          >
            <TrackArtwork
              src={menu.track.thumbnail}
              alt={menu.track.title}
              iconSize={18}
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

            {jamState.active && (
              <button
                type="button"
                onClick={() => {
                  void addTrackToJamSession(menu.track);
                  onClose();
                }}
                className="w-full min-h-[48px] px-3 rounded-lg flex items-center gap-3.5 hover:bg-[#1E1E1E] active:bg-[#1E1E1E] text-left text-[#FF5E4D] transition-colors"
              >
                <Speaker size={18} />
                <span>Add to Jam Queue</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                openXoneDash(menu.track);
                onClose();
              }}
              className="w-full min-h-[48px] px-3 rounded-lg flex items-center gap-3.5 hover:bg-[#1E1E1E] active:bg-[#1E1E1E] text-left transition-colors"
            >
              <Gamepad2 size={18} className="text-[#FF5E4D]" />
              <span>Play Xone Dash</span>
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

  return typeof document !== "undefined"
    ? createPortal(content, document.body)
    : content;
};
