import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Heart,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Speaker,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { formatTime } from "../utils/format";
import { DownloadStatusIcon } from "./DownloadStatusIcon";

export const PlayerBar: React.FC = () => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const volume = usePlayerStore((s) => s.volume);
  const isMuted = usePlayerStore((s) => s.isMuted);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const likedIds = usePlayerStore((s) => s.likedIds);
  const downloadedIds = usePlayerStore((s) => s.downloadedIds);
  const downloadingIds = usePlayerStore((s) => s.downloadingIds);
  const prefetchedVideoId = usePlayerStore((s) => s.prefetchedVideoId);
  const playbackError = usePlayerStore((s) => s.playbackError);
  const activeView = usePlayerStore((s) => s.activeView);
  const jamState = usePlayerStore((s) => s.jamState);
  const eightDEnabled = usePlayerStore((s) => s.eightDEnabled);
  const srEnabled = usePlayerStore((s) => s.srEnabled);

  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const playNextTrack = usePlayerStore((s) => s.playNextTrack);
  const playPreviousTrack = usePlayerStore((s) => s.playPreviousTrack);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const seekTo = usePlayerStore((s) => s.seekTo);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const toggleDownload = usePlayerStore((s) => s.toggleDownload);
  const toggleEightD = usePlayerStore((s) => s.toggleEightD);
  const toggleSlowedReverb = usePlayerStore((s) => s.toggleSlowedReverb);
  const setJamModalOpen = usePlayerStore((s) => s.setJamModalOpen);
  const navigate = usePlayerStore((s) => s.navigate);

  const [isMobileExpanded, setIsMobileExpanded] = useState(false);
  const [isDraggingSeek, setIsDraggingSeek] = useState(false);
  const [dragSeekValue, setDragSeekValue] = useState(0);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const mobileSeekBarRef = useRef<HTMLDivElement | null>(null);
  const volumeBarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!currentTrack) {
      setIsMobileExpanded(false);
    }
  }, [currentTrack]);

  const effectiveDuration =
    duration > 0 ? duration : currentTrack?.duration_seconds || 0;
  const displayedTime = isDraggingSeek ? dragSeekValue : currentTime;
  const progressPct =
    effectiveDuration > 0
      ? Math.min(100, Math.max(0, (displayedTime / effectiveDuration) * 100))
      : 0;
  const effectiveVolume = isMuted ? 0 : volume;
  const volumePct = Math.round(effectiveVolume * 100);
  const isLiked = currentTrack ? Boolean(likedIds[currentTrack.video_id]) : false;
  const isDownloaded = currentTrack
    ? Boolean(downloadedIds[currentTrack.video_id])
    : false;
  const isDownloading = currentTrack
    ? Boolean(downloadingIds[currentTrack.video_id])
    : false;

  const computeBarRatio = (
    clientX: number,
    el: HTMLDivElement | null
  ): number => {
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const handleSeekPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    barEl: HTMLDivElement | null
  ) => {
    if (!currentTrack || effectiveDuration <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ratio = computeBarRatio(e.clientX, barEl);
    setIsDraggingSeek(true);
    setDragSeekValue(ratio * effectiveDuration);
  };

  const handleSeekPointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
    barEl: HTMLDivElement | null
  ) => {
    if (!isDraggingSeek || effectiveDuration <= 0) return;
    const ratio = computeBarRatio(e.clientX, barEl);
    setDragSeekValue(ratio * effectiveDuration);
  };

  const handleSeekPointerUp = (
    e: React.PointerEvent<HTMLDivElement>,
    barEl: HTMLDivElement | null
  ) => {
    if (!isDraggingSeek) return;
    const ratio = computeBarRatio(e.clientX, barEl);
    const targetSeconds = ratio * effectiveDuration;
    setIsDraggingSeek(false);
    seekTo(targetSeconds);
  };

  const handleVolumePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const ratio = computeBarRatio(e.clientX, volumeBarRef.current);
    setVolume(ratio);
  };

  const handleVolumePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    const ratio = computeBarRatio(e.clientX, volumeBarRef.current);
    setVolume(ratio);
  };

  return (
    <>
      {/* ===================== COMPACT MOBILE MINI-PLAYER (< 768px) ===================== */}
      {currentTrack && (
        <div
          onClick={() => setIsMobileExpanded(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") setIsMobileExpanded(true);
          }}
          aria-label="Open full-screen now playing controls"
          className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom))] left-2 right-2 z-40 md:hidden rounded-lg bg-[#141414] border border-white/10 p-2 shadow-2xl overflow-hidden select-none cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <div className="relative w-10 h-10 rounded overflow-hidden shrink-0 bg-black">
              <img
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                className="w-full h-full object-cover"
              />
              {isBuffering && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <Loader2 size={15} className="animate-spin text-[#FF5E4D]" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-white truncate">
                {currentTrack.title}
              </p>
              <p className="text-[11px] text-[#B3B3B3] truncate">
                {currentTrack.artist}
              </p>
            </div>

            <div className="flex items-center shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleLike(currentTrack);
                }}
                aria-label={
                  isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"
                }
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full active:scale-95 transition-transform"
              >
                <Heart
                  size={19}
                  className={
                    isLiked
                      ? "text-[#FF5E4D] fill-[#FF5E4D]"
                      : "text-[#B3B3B3] hover:text-white"
                  }
                />
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center"
              >
                <span className="w-9 h-9 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] active:scale-95 text-black flex items-center justify-center shadow-md transition-all">
                  {isPlaying ? (
                    <Pause size={17} className="fill-black" />
                  ) : (
                    <Play size={17} className="fill-black ml-0.5" />
                  )}
                </span>
              </button>
            </div>
          </div>

          {/* 2px Hyper Coral Progress Bar along bottom edge */}
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/10 pointer-events-none">
            <div
              className="h-full bg-[#FF5E4D]"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* ===================== FULL-SCREEN MOBILE NOW PLAYING SHEET (< 768px) ===================== */}
      {isMobileExpanded && currentTrack && (
        <div className="fixed inset-0 z-50 md:hidden bg-gradient-to-b from-[#1E1E1E] via-[#000000] to-[#000000] flex flex-col justify-between px-6 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))] overflow-y-auto select-none">
          {/* Top Header */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsMobileExpanded(false)}
              aria-label="Minimize now playing"
              className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors"
            >
              <ChevronDown size={26} />
            </button>

            <div className="min-w-0 text-center flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#B3B3B3]">
                Now Playing
              </p>
              <p className="text-xs font-semibold text-white truncate mt-0.5">
                {currentTrack.album || "Single"}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsMobileExpanded(false);
                navigate({ type: "queue" });
              }}
              aria-label="Open queue"
              className={`min-w-[44px] min-h-[44px] -mr-2 flex items-center justify-center rounded-full transition-colors ${
                activeView.type === "queue"
                  ? "text-[#FF5E4D]"
                  : "text-white hover:bg-white/10"
              }`}
            >
              <ListMusic size={22} />
            </button>
          </div>

          {/* Large Centered Artwork */}
          <div className="my-4 flex-1 flex items-center justify-center">
            <div className="relative w-full max-w-[320px] aspect-square rounded-xl overflow-hidden shadow-2xl bg-[#141414]">
              <img
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                className="w-full h-full object-cover"
              />
              {isBuffering && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 size={32} className="animate-spin text-[#FF5E4D]" />
                </div>
              )}
            </div>
          </div>

          {/* Track Meta, Seek Bar & Controls */}
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-extrabold text-white truncate">
                  {currentTrack.title}
                </h2>
                <p className="text-sm text-[#B3B3B3] truncate mt-0.5">
                  {currentTrack.artist}
                </p>
                {playbackError && (
                  <p className="text-xs text-[#FF5E4D] truncate mt-1">
                    {playbackError}
                  </p>
                )}
              </div>
              <div className="flex items-center shrink-0 -mr-2">
                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => void toggleDownload(currentTrack)}
                  aria-label={
                    isDownloading
                      ? "Downloading track"
                      : isDownloaded
                        ? "Remove download"
                        : "Download track"
                  }
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full shrink-0"
                >
                  <DownloadStatusIcon
                    isDownloading={isDownloading}
                    isDownloaded={isDownloaded}
                    size={22}
                    inactiveClassName="text-[#B3B3B3] hover:text-white"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => void toggleLike(currentTrack)}
                  aria-label={
                    isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"
                  }
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full shrink-0"
                >
                  <Heart
                    size={24}
                    className={
                      isLiked
                        ? "text-[#FF5E4D] fill-[#FF5E4D]"
                        : "text-[#B3B3B3] hover:text-white"
                    }
                  />
                </button>
              </div>
            </div>

            {/* Interactive Mobile Seek Slider */}
            <div>
              <div
                ref={mobileSeekBarRef}
                onPointerDown={(e) =>
                  handleSeekPointerDown(e, mobileSeekBarRef.current)
                }
                onPointerMove={(e) =>
                  handleSeekPointerMove(e, mobileSeekBarRef.current)
                }
                onPointerUp={(e) =>
                  handleSeekPointerUp(e, mobileSeekBarRef.current)
                }
                role="slider"
                aria-label="Seek audio position"
                aria-valuemin={0}
                aria-valuemax={Math.round(effectiveDuration)}
                aria-valuenow={Math.round(displayedTime)}
                className="relative w-full h-8 flex items-center cursor-pointer touch-none"
              >
                <div className="w-full h-1.5 rounded-full bg-white/20 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#FF5E4D]"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div
                  className="absolute w-4 h-4 rounded-full bg-[#FF5E4D] shadow-lg pointer-events-none -translate-x-1/2"
                  style={{ left: `${progressPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs tabular-nums text-[#B3B3B3] -mt-1">
                <span>{formatTime(displayedTime)}</span>
                <span>{formatTime(effectiveDuration)}</span>
              </div>
            </div>

            {/* Transport Controls */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={toggleShuffle}
                aria-label="Toggle shuffle"
                className={`relative min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${
                  shuffle ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
                }`}
              >
                <Shuffle size={22} />
                {shuffle && (
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-1 w-1 h-1 rounded-full bg-[#FF5E4D]" />
                )}
              </button>

              <button
                type="button"
                onClick={playPreviousTrack}
                aria-label="Previous track"
                className="min-w-[48px] min-h-[48px] flex items-center justify-center text-white active:scale-95 transition-transform"
              >
                <SkipBack size={28} className="fill-current" />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
                className="w-16 h-16 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] active:scale-95 text-black flex items-center justify-center shadow-2xl transition-all"
              >
                {isPlaying ? (
                  <Pause size={30} className="fill-black" />
                ) : (
                  <Play size={30} className="fill-black ml-1" />
                )}
              </button>

              <button
                type="button"
                onClick={() => playNextTrack(false)}
                aria-label="Next track"
                className="min-w-[48px] min-h-[48px] flex items-center justify-center text-white active:scale-95 transition-transform"
              >
                <SkipForward size={28} className="fill-current" />
              </button>

              <button
                type="button"
                onClick={cycleRepeat}
                aria-label={`Repeat mode: ${repeat}`}
                className={`relative min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors ${
                  repeat !== "off"
                    ? "text-[#FF5E4D]"
                    : "text-[#B3B3B3] hover:text-white"
                }`}
              >
                {repeat === "one" ? <Repeat1 size={22} /> : <Repeat size={22} />}
                {repeat !== "off" && (
                  <span className="absolute left-1/2 -translate-x-1/2 bottom-1 w-1 h-1 rounded-full bg-[#FF5E4D]" />
                )}
              </button>
            </div>

            {/* Bottom Utility Row */}
            <div className="flex items-center justify-between pt-1">
              {!jamState.isActive ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleEightD}
                    aria-pressed={eightDEnabled}
                    aria-label="Toggle 8D Spatial Audio"
                    className={`min-h-[34px] px-3 rounded-full text-xs tracking-wide transition-colors ${
                      eightDEnabled
                        ? "bg-[#FF5E4D]/20 border border-[#FF5E4D] text-[#FF5E4D] font-semibold"
                        : "bg-[#181818] border border-white/10 text-zinc-400"
                    }`}
                  >
                    8D
                  </button>
                  <button
                    type="button"
                    onClick={toggleSlowedReverb}
                    aria-pressed={srEnabled}
                    aria-label="Toggle Slowed and Reverb"
                    className={`min-h-[34px] px-3 rounded-full text-xs tracking-wide transition-colors ${
                      srEnabled
                        ? "bg-[#FF5E4D]/20 border border-[#FF5E4D] text-[#FF5E4D] font-semibold"
                        : "bg-[#181818] border border-white/10 text-zinc-400"
                    }`}
                  >
                    SR
                  </button>
                </div>
              ) : prefetchedVideoId ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#141414] border border-[#FF5E4D]/30 text-[10px] font-bold text-[#FF5E4D] tracking-wide">
                  NEXT READY
                </span>
              ) : (
                <span className="text-[11px] text-[#727272]">
                  Playing from Jam queue
                </span>
              )}

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setJamModalOpen(true)}
                  aria-label="Open BLE Jam and Multi-Speaker"
                  className={`min-h-[44px] px-3 flex items-center gap-1.5 text-xs font-semibold rounded-full transition-colors ${
                    jamState.active
                      ? "text-[#FF5E4D] bg-[#FF5E4D]/15"
                      : "text-[#B3B3B3] hover:text-white"
                  }`}
                >
                  <Speaker size={16} />
                  <span>{jamState.active ? "Jam Live" : "Jam"}</span>
                  {jamState.active && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FF5E4D] animate-pulse" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMobileExpanded(false);
                    navigate({ type: "queue" });
                  }}
                  className="min-h-[44px] px-3 flex items-center gap-1.5 text-xs font-semibold text-[#B3B3B3] hover:text-white"
                >
                  <ListMusic size={16} />
                  <span>Queue</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== DESKTOP PLAYER BAR (>= 768px) ===================== */}
      <footer className="hidden md:flex h-[90px] shrink-0 bg-black border-t border-[#141414] px-4 items-center justify-between gap-4 select-none">
        {/* Left: Now Playing Track Info */}
        <div className="w-[30%] min-w-[200px] flex items-center gap-3.5">
          {currentTrack ? (
            <>
              <div className="relative w-14 h-14 rounded-md overflow-hidden shrink-0 bg-[#141414] shadow-lg">
                <img
                  src={currentTrack.thumbnail}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover"
                />
                {isBuffering && (
                  <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                    <Loader2 size={18} className="animate-spin text-[#FF5E4D]" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate hover:underline cursor-default">
                    {currentTrack.title}
                  </p>
                </div>
                <p className="text-xs text-[#B3B3B3] truncate">
                  {currentTrack.artist}
                </p>
                {playbackError && (
                  <p className="text-[11px] text-[#FF5E4D] truncate mt-0.5">
                    {playbackError}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={isDownloading}
                onClick={() => void toggleDownload(currentTrack)}
                title={
                  isDownloading
                    ? "Downloading..."
                    : isDownloaded
                      ? "Remove Download"
                      : "Download for offline playback"
                }
                aria-label={
                  isDownloading
                    ? "Downloading track"
                    : isDownloaded
                      ? "Remove download"
                      : "Download track"
                }
                className="p-1.5 rounded-full hover:scale-110 transition-transform shrink-0"
              >
                <DownloadStatusIcon
                  isDownloading={isDownloading}
                  isDownloaded={isDownloaded}
                  size={18}
                  inactiveClassName="text-[#B3B3B3] hover:text-white"
                />
              </button>
              <button
                type="button"
                onClick={() => void toggleLike(currentTrack)}
                aria-label={
                  isLiked ? "Remove from Liked Songs" : "Save to Liked Songs"
                }
                className="p-1.5 rounded-full hover:scale-110 transition-transform shrink-0"
              >
                <Heart
                  size={18}
                  className={
                    isLiked
                      ? "text-[#FF5E4D] fill-[#FF5E4D]"
                      : "text-[#B3B3B3] hover:text-white"
                  }
                />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-3 text-[#727272]">
              <div className="w-14 h-14 rounded-md bg-[#141414] flex items-center justify-center">
                <ListMusic size={20} />
              </div>
              <div>
                <p className="text-sm font-medium text-[#B3B3B3]">Ready to play</p>
                <p className="text-xs text-[#727272]">
                  Search a track to start streaming
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Center: Playback Controls + Seek Bar */}
        <div className="w-[40%] max-w-[680px] flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={toggleShuffle}
              title="Shuffle"
              aria-label="Toggle shuffle"
              className={`relative p-1.5 transition-colors ${
                shuffle ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
              }`}
            >
              <Shuffle size={18} />
              {shuffle && (
                <span className="absolute left-1/2 -translate-x-1/2 -bottom-0.5 w-1 h-1 rounded-full bg-[#FF5E4D]" />
              )}
            </button>

            <button
              type="button"
              onClick={playPreviousTrack}
              disabled={!currentTrack}
              title="Previous"
              aria-label="Previous track"
              className="p-1.5 text-[#B3B3B3] hover:text-white disabled:opacity-40 transition-colors"
            >
              <SkipBack size={20} className="fill-current" />
            </button>

            <button
              type="button"
              onClick={togglePlay}
              disabled={!currentTrack}
              title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="w-9 h-9 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 text-black flex items-center justify-center transition-all shadow-md"
            >
              {isPlaying ? (
                <Pause size={18} className="fill-black" />
              ) : (
                <Play size={18} className="fill-black ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => playNextTrack(false)}
              disabled={!currentTrack}
              title="Next"
              aria-label="Next track"
              className="p-1.5 text-[#B3B3B3] hover:text-white disabled:opacity-40 transition-colors"
            >
              <SkipForward size={20} className="fill-current" />
            </button>

            <button
              type="button"
              onClick={cycleRepeat}
              title={`Repeat: ${repeat}`}
              aria-label={`Repeat mode: ${repeat}`}
              className={`relative p-1.5 transition-colors ${
                repeat !== "off"
                  ? "text-[#FF5E4D]"
                  : "text-[#B3B3B3] hover:text-white"
              }`}
            >
              {repeat === "one" ? <Repeat1 size={18} /> : <Repeat size={18} />}
              {repeat !== "off" && (
                <span className="absolute left-1/2 -translate-x-1/2 -bottom-0.5 w-1 h-1 rounded-full bg-[#FF5E4D]" />
              )}
            </button>
          </div>

          {/* Interactive Seek Progress Bar */}
          <div className="w-full flex items-center gap-2.5">
            <span className="text-[11px] tabular-nums text-[#A7A7A7] w-10 text-right">
              {formatTime(displayedTime)}
            </span>
            <div
              ref={seekBarRef}
              onPointerDown={(e) =>
                handleSeekPointerDown(e, seekBarRef.current)
              }
              onPointerMove={(e) =>
                handleSeekPointerMove(e, seekBarRef.current)
              }
              onPointerUp={(e) => handleSeekPointerUp(e, seekBarRef.current)}
              role="slider"
              aria-label="Seek audio position"
              aria-valuemin={0}
              aria-valuemax={Math.round(effectiveDuration)}
              aria-valuenow={Math.round(displayedTime)}
              className="group relative flex-1 h-4 flex items-center cursor-pointer touch-none"
            >
              <div className="w-full h-1 rounded-full bg-[#4D4D4D] overflow-hidden">
                <div
                  className="h-full rounded-full bg-white group-hover:bg-[#FF5E4D] transition-colors"
                  style={{
                    width: `${progressPct}%`,
                    backgroundColor: isDraggingSeek ? "#FF5E4D" : undefined,
                  }}
                />
              </div>
              <div
                className="absolute left-0 h-1 rounded-full bg-[#FF5E4D] pointer-events-none"
                style={{ width: `${progressPct}%` }}
              />
              <div
                className="absolute w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none -translate-x-1/2"
                style={{
                  left: `${progressPct}%`,
                  opacity: isDraggingSeek ? 1 : undefined,
                }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-[#A7A7A7] w-10">
              {formatTime(effectiveDuration)}
            </span>
          </div>
        </div>

        {/* Right: Prefetch Badge + Queue Toggle + Volume Slider */}
        <div className="w-[30%] min-w-[180px] flex items-center justify-end gap-3">
          {prefetchedVideoId && (
            <span
              title="Next track preloaded into standby Audio buffer"
              className="hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#141414] border border-[#FF5E4D]/30 text-[10px] font-bold text-[#FF5E4D] tracking-wide"
            >
              NEXT READY
            </span>
          )}

          <button
            type="button"
            onClick={() => setJamModalOpen(true)}
            title="BLE Jam & Multi-Speaker"
            aria-label="Open BLE Jam and Multi-Speaker"
            className={`relative p-1.5 transition-colors ${
              jamState.active
                ? "text-[#FF5E4D]"
                : "text-[#B3B3B3] hover:text-white"
            }`}
          >
            <Speaker size={18} />
            {jamState.active && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#FF5E4D] animate-pulse" />
            )}
          </button>

          <button
            type="button"
            onClick={() => navigate({ type: "queue" })}
            title="Queue"
            aria-label="Open queue"
            className={`p-1.5 transition-colors ${
              activeView.type === "queue"
                ? "text-[#FF5E4D]"
                : "text-[#B3B3B3] hover:text-white"
            }`}
          >
            <ListMusic size={18} />
          </button>

          <div className="flex items-center gap-2 w-28 sm:w-32">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className="text-[#B3B3B3] hover:text-white transition-colors"
            >
              {effectiveVolume === 0 ? (
                <VolumeX size={18} />
              ) : effectiveVolume < 0.5 ? (
                <Volume1 size={18} />
              ) : (
                <Volume2 size={18} />
              )}
            </button>

            <div
              ref={volumeBarRef}
              onPointerDown={handleVolumePointerDown}
              onPointerMove={handleVolumePointerMove}
              role="slider"
              aria-label="Volume"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={volumePct}
              className="group relative flex-1 h-4 flex items-center cursor-pointer touch-none"
            >
              <div className="w-full h-1 rounded-full bg-[#4D4D4D] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#FF5E4D]"
                  style={{ width: `${volumePct}%` }}
                />
              </div>
              <div
                className="absolute w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none -translate-x-1/2"
                style={{ left: `${volumePct}%` }}
              />
            </div>
          </div>
        </div>
      </footer>
    </>
  );
};
