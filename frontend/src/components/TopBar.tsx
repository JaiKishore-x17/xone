import React, { useEffect, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ListMusic,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { XoneLogo } from "./XoneLogo";

export const TopBar: React.FC = () => {
  const historyIndex = usePlayerStore((s) => s.historyIndex);
  const historyLength = usePlayerStore((s) => s.history.length);
  const searchQuery = usePlayerStore((s) => s.searchQuery);
  const isSearching = usePlayerStore((s) => s.isSearching);
  const activeView = usePlayerStore((s) => s.activeView);

  const goBack = usePlayerStore((s) => s.goBack);
  const goForward = usePlayerStore((s) => s.goForward);
  const navigate = usePlayerStore((s) => s.navigate);
  const setSearchQuery = usePlayerStore((s) => s.setSearchQuery);
  const runSearch = usePlayerStore((s) => s.runSearch);

  const debounceRef = useRef<number | null>(null);
  const lastSearchedRef = useRef<string>("");

  // 350ms debounced instant search
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }

    if (!trimmed) {
      lastSearchedRef.current = "";
      void runSearch("");
      return;
    }

    if (trimmed === lastSearchedRef.current) {
      return;
    }

    debounceRef.current = window.setTimeout(() => {
      lastSearchedRef.current = trimmed;
      void runSearch(trimmed);
    }, 350);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery, runSearch]);

  const handleInputChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim() && activeView.type !== "search") {
      navigate({ type: "search" });
    }
  };

  return (
    <header className="sticky top-0 z-30 h-16 px-3 md:px-6 flex items-center justify-between gap-2 md:gap-4 bg-[#121212]/90 backdrop-blur-md border-b border-white/[0.04]">
      {/* Left: Mobile Logo + History Navigation + Instant Debounced Search */}
      <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0 max-w-2xl">
        <button
          type="button"
          onClick={() => navigate({ type: "home" })}
          aria-label="Xone Home"
          className="flex md:hidden min-w-[44px] min-h-[44px] items-center justify-center shrink-0"
        >
          <XoneLogo size={28} />
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={goBack}
            disabled={historyIndex <= 0}
            aria-label="Go back"
            className="min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 md:w-8 md:h-8 rounded-full bg-black/70 flex items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#282828] transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            onClick={goForward}
            disabled={historyIndex >= historyLength - 1}
            aria-label="Go forward"
            className="hidden sm:flex min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 md:w-8 md:h-8 rounded-full bg-black/70 items-center justify-center text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#282828] transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="relative flex-1 min-w-0 max-w-md group">
          <Search
            size={18}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#B3B3B3] group-focus-within:text-[#FF5E4D] transition-colors pointer-events-none"
          />
          <input
            id="xone-search-input"
            type="text"
            value={searchQuery}
            onFocus={() => {
              if (activeView.type !== "search" && searchQuery.trim()) {
                navigate({ type: "search" });
              }
            }}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="What do you want to play?"
            className="w-full h-11 md:h-10 pl-10 pr-14 md:pr-20 rounded-full bg-[#242424] hover:bg-[#2A2A2A] focus:bg-[#2A2A2A] text-sm text-white placeholder-[#A7A7A7] border border-transparent focus:border-[#FF5E4D] focus:outline-none transition-all"
          />
          <div className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
            {isSearching && (
              <Loader2 size={15} className="animate-spin text-[#FF5E4D]" />
            )}
            {searchQuery ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  lastSearchedRef.current = "";
                }}
                aria-label="Clear search"
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-full text-[#B3B3B3] hover:text-white"
              >
                <X size={16} />
              </button>
            ) : (
              <kbd className="hidden md:inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold text-[#B3B3B3] bg-black/60 rounded border border-white/10">
                Ctrl K
              </kbd>
            )}
          </div>
        </div>
      </div>

      {/* Right: Queue Button */}
      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        <button
          type="button"
          onClick={() => navigate({ type: "queue" })}
          title="View Queue"
          aria-label="View Queue"
          className={`min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center gap-2 px-3 md:px-3.5 py-2 md:py-1.5 rounded-full text-xs font-bold transition-colors ${
            activeView.type === "queue"
              ? "bg-[#FF5E4D] text-black"
              : "bg-black/70 hover:bg-[#282828] text-white"
          }`}
        >
          <ListMusic size={17} />
          <span className="hidden sm:inline">Queue</span>
        </button>
      </div>
    </header>
  );
};
