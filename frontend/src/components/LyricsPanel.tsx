import React, { useEffect, useMemo, useRef, useState } from "react";
import { Mic2, Music2, RefreshCw } from "lucide-react";
import {
  getLyricsForTrack,
  type LyricLine,
  type LyricsResult,
} from "../services/lyricsService";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types";

interface LyricsPanelProps {
  track: Track;
  durationSeconds?: number;
  className?: string;
}

interface SyncedLyricsViewProps {
  trackKey: string;
  lines: LyricLine[];
}

const SyncedLyricsView: React.FC<SyncedLyricsViewProps> = React.memo(
  ({ trackKey, lines }) => {
    const currentTime = usePlayerStore((s) => (s.waveTrack ? 0 : s.currentTime));
    const seekTo = usePlayerStore((s) => s.seekTo);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const activeLineRef = useRef<HTMLButtonElement | null>(null);
    const manualPauseUntilRef = useRef<number>(0);

    const activeIndex = useMemo(() => {
      if (lines.length === 0) return -1;
      const targetTime = currentTime + 0.15;
      let found = -1;
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].time <= targetTime) {
          found = i;
        } else {
          break;
        }
      }
      return found;
    }, [lines, currentTime]);

    useEffect(() => {
      manualPauseUntilRef.current = 0;
      containerRef.current?.scrollTo({ top: 0, behavior: "instant" });
    }, [trackKey]);

    useEffect(() => {
      if (activeIndex < 0) return;
      if (usePlayerStore.getState().waveTrack) return;
      if (Date.now() < manualPauseUntilRef.current) return;
      activeLineRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, [activeIndex]);

    const handleUserScrollIntent = () => {
      manualPauseUntilRef.current = Date.now() + 3000;
    };

    return (
      <div
        ref={containerRef}
        data-no-sheet-drag="true"
        data-no-tab-swipe="true"
        onWheel={handleUserScrollIntent}
        onTouchStart={handleUserScrollIntent}
        onTouchMove={handleUserScrollIntent}
        className="w-full h-full overflow-y-auto xone-modal-scroll overscroll-y-contain touch-pan-y px-3 py-12 space-y-3.5 text-left"
      >
        {lines.map((line, idx) => {
          const isActive = idx === activeIndex;
          return (
            <button
              key={`${line.time}-${idx}`}
              ref={isActive ? activeLineRef : undefined}
              type="button"
              onClick={() => {
                manualPauseUntilRef.current = 0;
                seekTo(line.time);
              }}
              style={
                isActive
                  ? { textShadow: "0 0 18px rgba(255, 94, 77, 0.55)" }
                  : undefined
              }
              className={`block w-full text-left text-lg sm:text-xl leading-snug tracking-tight transition-all duration-200 origin-left cursor-pointer py-1 ${
                isActive
                  ? "text-white font-bold scale-[1.02] pl-2 border-l-2 border-[#FF5E4D]"
                  : "text-white/35 hover:text-white/65 font-semibold"
              }`}
            >
              {line.text}
            </button>
          );
        })}
      </div>
    );
  }
);

SyncedLyricsView.displayName = "SyncedLyricsView";

export const LyricsPanel: React.FC<LyricsPanelProps> = React.memo(
  ({ track, durationSeconds = 0, className = "" }) => {
    const trackKey = track.id || track.video_id;
    const [loading, setLoading] = useState(true);
    const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
    const [retryRequest, setRetryRequest] = useState<{
      trackKey: string;
      nonce: number;
    }>({ trackKey, nonce: 0 });

    const forceRefresh =
      retryRequest.trackKey === trackKey && retryRequest.nonce > 0;

    useEffect(() => {
      let cancelled = false;
      setLoading(true);
      setLyrics(null);

      void getLyricsForTrack(track, durationSeconds, forceRefresh)
        .then((res) => {
          if (!cancelled) {
            setLyrics(res);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setLyrics({
              id: trackKey,
              syncedLyrics: null,
              plainLyrics: null,
              lines: [],
              instrumental: false,
              notFound: true,
              fetchedAt: Date.now(),
            });
            setLoading(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [
      trackKey,
      track.title,
      track.artist,
      durationSeconds,
      forceRefresh,
      retryRequest.nonce,
    ]);

    const handleRetry = () => {
      setRetryRequest((prev) => ({
        trackKey,
        nonce: prev.trackKey === trackKey ? prev.nonce + 1 : 1,
      }));
    };

    return (
      <div
        data-no-sheet-drag="true"
        data-no-tab-swipe="true"
        className={`relative w-full h-full rounded-xl bg-[#0B0B0B]/95 border border-white/10 overflow-hidden flex flex-col ${className}`}
      >
        {loading ? (
          <div className="flex-1 p-5 flex flex-col justify-center gap-3.5 animate-pulse">
            <div className="h-5 w-3/4 rounded bg-white/10" />
            <div className="h-5 w-11/12 rounded bg-white/15" />
            <div className="h-5 w-2/3 rounded bg-white/10" />
            <div className="h-5 w-5/6 rounded bg-white/10" />
            <div className="h-5 w-1/2 rounded bg-white/10" />
            <div className="h-5 w-4/5 rounded bg-white/10" />
          </div>
        ) : lyrics?.instrumental ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-[#FF5E4D]/15 border border-[#FF5E4D]/35 flex items-center justify-center text-[#FF5E4D]">
              <Music2 size={22} />
            </div>
            <p className="text-base font-bold text-white">Instrumental</p>
            <p className="text-xs text-[#B3B3B3]">
              Enjoy the music — this track has no vocals.
            </p>
          </div>
        ) : lyrics && lyrics.lines.length > 0 ? (
          <SyncedLyricsView trackKey={trackKey} lines={lyrics.lines} />
        ) : lyrics?.plainLyrics ? (
          <div
            data-no-sheet-drag="true"
            data-no-tab-swipe="true"
            className="w-full h-full overflow-y-auto xone-modal-scroll overscroll-y-contain touch-pan-y px-4 py-6 space-y-4 text-left"
          >
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/10 text-[10px] font-bold uppercase tracking-wider text-[#B3B3B3]">
              Plain Lyrics
            </div>
            {lyrics.plainLyrics.split(/\n{2,}/).map((paragraph, idx) => (
              <p
                key={idx}
                className="text-base sm:text-lg leading-relaxed text-white/85 whitespace-pre-line font-medium"
              >
                {paragraph.trim()}
              </p>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-[#727272]">
              <Mic2 size={22} />
            </div>
            <p className="text-sm font-bold text-white">
              No lyrics found for this track
            </p>
            <p className="text-xs text-[#727272] max-w-[240px]">
              Checked LRCLIB for &ldquo;{track.title}&rdquo;.
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="mt-1 min-h-[36px] px-4 py-1.5 rounded-full bg-[#1E1E1E] hover:bg-[#282828] active:scale-95 border border-white/10 hover:border-[#FF5E4D]/60 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-all"
            >
              <RefreshCw size={13} className="text-[#FF5E4D]" />
              <span>Retry</span>
            </button>
          </div>
        )}
      </div>
    );
  }
);

LyricsPanel.displayName = "LyricsPanel";
