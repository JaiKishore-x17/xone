import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ListMusic, Plus, X } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { TrackArtwork } from "./TrackArtwork";

const ACCENT_SWATCHES = [
  "#FF5E4D",
  "#E11D48",
  "#F97316",
  "#8B5CF6",
  "#06B6D4",
  "#10B981",
  "#EC4899",
];

export const AddToPlaylistModal: React.FC = () => {
  const track = usePlayerStore((s) => s.addToPlaylistModalTrack);
  const playlists = usePlayerStore((s) => s.playlists);
  const closeModal = usePlayerStore((s) => s.closeAddToPlaylistModal);
  const addTrackToPlaylist = usePlayerStore((s) => s.addTrackToPlaylist);
  const createPlaylistAndAddTrack = usePlayerStore(
    (s) => s.createPlaylistAndAddTrack
  );
  const showToast = usePlayerStore((s) => s.showToast);

  const backdropRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef<{
    startY: number;
    startTime: number;
    canDrag: boolean;
    dragging: boolean;
  } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingDragYRef = useRef<number | null>(null);
  const dragYRef = useRef(0);
  const dismissTimerRef = useRef<number | null>(null);

  const [sheetEntered, setSheetEntered] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#FF5E4D");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!track) {
      setCreatingNew(false);
      setNewName("");
      setNewColor("#FF5E4D");
      setBusy(false);
      dragYRef.current = 0;
      pendingDragYRef.current = null;
      return;
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        closeModal();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [track, busy, closeModal]);

  useLayoutEffect(() => {
    if (!track) {
      setSheetEntered(false);
      return;
    }
    setSheetEntered(false);
    dragYRef.current = 0;
    pendingDragYRef.current = null;
    if (sheetRef.current) {
      sheetRef.current.scrollTo({ top: 0, behavior: "instant" });
      sheetRef.current.style.transition =
        "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)";
      sheetRef.current.style.transform = "";
    }
    if (backdropRef.current) {
      backdropRef.current.style.transition = "background-color 200ms ease-out";
      backdropRef.current.style.backgroundColor = "";
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
  }, [track]);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(dismissTimerRef.current);
      }
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  if (!track) return null;

  const cancelDragRaf = () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingDragYRef.current = null;
  };

  const applyDragVisuals = (dy: number) => {
    dragYRef.current = dy;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "none";
      sheetRef.current.style.transform = `translate3d(0, ${dy}px, 0)`;
    }
    if (backdropRef.current) {
      const alpha = dy > 0 ? Math.max(0.15, 0.78 * (1 - dy / 420)) : 0.78;
      backdropRef.current.style.transition = "none";
      backdropRef.current.style.backgroundColor = `rgba(0, 0, 0, ${alpha})`;
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1 || busy) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea")) {
      touchRef.current = null;
      return;
    }
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    cancelDragRaf();
    const sheet = sheetRef.current;
    const onHandle = Boolean(target?.closest("[data-playlist-sheet-handle]"));
    const canDrag = onHandle || !sheet || sheet.scrollTop <= 2;
    touchRef.current = {
      startY: e.touches[0].clientY,
      startTime: Date.now(),
      canDrag,
      dragging: false,
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    const drag = touchRef.current;
    if (!drag || !drag.canDrag || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - drag.startY;
    if (dy > 4) {
      drag.dragging = true;
      pendingDragYRef.current = dy;
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(() => {
          rafRef.current = null;
          if (pendingDragYRef.current !== null) {
            const targetY = pendingDragYRef.current;
            pendingDragYRef.current = null;
            applyDragVisuals(targetY);
          }
        });
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const drag = touchRef.current;
    touchRef.current = null;
    cancelDragRaf();
    if (!drag || !drag.dragging) return;

    const dy =
      e.changedTouches.length > 0
        ? e.changedTouches[0].clientY - drag.startY
        : dragYRef.current;
    const elapsed = Math.max(1, Date.now() - drag.startTime);
    const velocity = dy / elapsed;

    if (dy > 80 || (dy > 40 && velocity > 0.65)) {
      const exitY = typeof window !== "undefined" ? window.innerHeight : 720;
      if (sheetRef.current) {
        sheetRef.current.style.transition = "transform 180ms ease-in";
        sheetRef.current.style.transform = `translate3d(0, ${exitY}px, 0)`;
      }
      if (backdropRef.current) {
        backdropRef.current.style.transition = "background-color 180ms ease-in";
        backdropRef.current.style.backgroundColor = "rgba(0, 0, 0, 0)";
      }
      dismissTimerRef.current = window.setTimeout(() => {
        dismissTimerRef.current = null;
        closeModal();
      }, 180);
    } else {
      dragYRef.current = 0;
      if (sheetRef.current) {
        sheetRef.current.style.transition =
          "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
        sheetRef.current.style.transform = "translate3d(0, 0, 0)";
      }
      if (backdropRef.current) {
        backdropRef.current.style.transition =
          "background-color 220ms ease-out";
        backdropRef.current.style.backgroundColor = "rgba(0, 0, 0, 0.78)";
      }
    }
  };

  const handleTouchCancel = () => {
    touchRef.current = null;
    cancelDragRaf();
    dragYRef.current = 0;
    if (sheetRef.current) {
      sheetRef.current.style.transition =
        "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
      sheetRef.current.style.transform = "translate3d(0, 0, 0)";
    }
    if (backdropRef.current) {
      backdropRef.current.style.transition = "background-color 220ms ease-out";
      backdropRef.current.style.backgroundColor = "rgba(0, 0, 0, 0.78)";
    }
  };

  const handlePickPlaylist = async (playlistId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      await addTrackToPlaylist(playlistId, track);
      closeModal();
    } catch {
      showToast("Failed to add song to playlist");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await createPlaylistAndAddTrack(trimmed, track, newColor);
      closeModal();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to create playlist"
      );
    } finally {
      setBusy(false);
    }
  };

  const content = (
    <div
      ref={backdropRef}
      data-no-tab-swipe="true"
      role="dialog"
      aria-modal="true"
      aria-label="Add to Playlist"
      onClick={() => {
        if (!busy) closeModal();
      }}
      style={{
        backgroundColor: `rgba(0, 0, 0, ${sheetEntered ? 0.78 : 0})`,
      }}
      className="fixed inset-0 z-[115] backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 select-none transition-colors duration-200 ease-out"
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        style={{
          transform: sheetEntered
            ? "translate3d(0, 0, 0)"
            : "translate3d(0, 100%, 0)",
          transition: "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
        className="w-full sm:max-w-md max-h-[82vh] overflow-y-auto xone-modal-scroll overscroll-y-contain rounded-t-2xl sm:rounded-2xl bg-[#141414] border-t sm:border border-white/10 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:p-5 shadow-2xl touch-pan-y"
      >
        {/* Mobile Drag Handle */}
        <div
          data-playlist-sheet-handle="true"
          className="sm:hidden py-1 -mt-1 mb-2 cursor-grab"
        >
          <div className="w-10 h-1 rounded-full bg-white/25 mx-auto" />
        </div>

        {/* Header with Target Track Preview */}
        <div
          data-playlist-sheet-handle="true"
          className="flex items-center gap-3 pb-3 border-b border-white/10"
        >
          <TrackArtwork
            src={track.thumbnail}
            alt={track.title}
            iconSize={18}
            className="w-11 h-11 rounded object-cover shrink-0 bg-black"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#FF5E4D]">
              Add to Playlist
            </p>
            <p className="text-sm font-bold text-white truncate">
              {track.title}
            </p>
            <p className="text-xs text-[#B3B3B3] truncate">{track.artist}</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={closeModal}
            aria-label="Close Add to Playlist"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-[#B3B3B3] hover:text-white hover:bg-white/10 transition-colors shrink-0"
          >
            <X size={20} />
          </button>
        </div>

        {/* Quick + New Playlist Toggle / Inline Form */}
        <div className="pt-3 pb-2">
          {!creatingNew ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => setCreatingNew(true)}
              className="w-full min-h-[52px] px-3 py-2 rounded-xl bg-[#1E1E1E] hover:bg-[#262626] border border-[#FF5E4D]/35 flex items-center gap-3 text-left transition-colors"
            >
              <div className="w-10 h-10 rounded-lg bg-[#FF5E4D]/15 text-[#FF5E4D] flex items-center justify-center shrink-0">
                <Plus size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#FF5E4D]">
                  + New Playlist
                </p>
                <p className="text-[11px] text-[#B3B3B3]">
                  Create a playlist and add this song now
                </p>
              </div>
            </button>
          ) : (
            <form
              onSubmit={(e) => void handleCreateAndAdd(e)}
              className="rounded-xl bg-[#1A1A1A] border border-white/10 p-3.5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-[#FF5E4D]">
                  New Playlist
                </span>
                <button
                  type="button"
                  onClick={() => setCreatingNew(false)}
                  className="text-xs font-semibold text-[#B3B3B3] hover:text-white"
                >
                  Cancel
                </button>
              </div>

              <input
                type="text"
                autoFocus
                required
                maxLength={100}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Playlist name..."
                className="w-full h-11 px-3 rounded-lg bg-[#0D0D0D] text-sm text-white placeholder-[#727272] border border-white/10 focus:border-[#FF5E4D] focus:outline-none"
              />

              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {ACCENT_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => setNewColor(swatch)}
                      aria-label={`Select color ${swatch}`}
                      className={`w-6 h-6 rounded-full transition-transform ${
                        newColor === swatch
                          ? "ring-2 ring-white scale-110"
                          : "opacity-75 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: swatch }}
                    />
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={!newName.trim() || busy}
                  className="min-h-[38px] px-4 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] disabled:opacity-40 text-black text-xs font-extrabold flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <Check size={14} />
                  <span>{busy ? "Adding..." : "Create & Add"}</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Existing User Playlists */}
        <div className="space-y-1.5 pt-1">
          {playlists.length === 0 ? (
            <div className="py-6 text-center rounded-xl bg-[#101010] border border-white/5">
              <ListMusic size={24} className="mx-auto text-[#727272] mb-2" />
              <p className="text-xs font-semibold text-[#B3B3B3]">
                No playlists yet — create one above!
              </p>
            </div>
          ) : (
            playlists.map((pl) => (
              <button
                key={pl.id}
                type="button"
                disabled={busy}
                onClick={() => void handlePickPlaylist(pl.id)}
                className="w-full min-h-[56px] p-2 rounded-xl hover:bg-[#1E1E1E] active:bg-[#242424] disabled:opacity-60 flex items-center gap-3 text-left transition-colors"
              >
                <div
                  className="w-11 h-11 rounded-lg shrink-0 overflow-hidden flex items-center justify-center shadow"
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
                        <TrackArtwork
                          key={idx}
                          src={thumb}
                          alt=""
                          iconSize={10}
                          className="w-full h-full object-cover"
                        />
                      ))}
                    </div>
                  ) : pl.thumbnails.length > 0 ? (
                    <TrackArtwork
                      src={pl.thumbnails[0]}
                      alt={pl.name}
                      iconSize={18}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ListMusic size={18} className="text-white/90" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">
                    {pl.name}
                  </p>
                  <p className="text-xs text-[#B3B3B3] truncate">
                    {pl.track_count} {pl.track_count === 1 ? "song" : "songs"}
                  </p>
                </div>

                <Plus size={18} className="text-[#FF5E4D] shrink-0 mr-1" />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(content, document.body)
    : content;
};
