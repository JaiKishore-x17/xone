import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AudioEngine } from "./components/AudioEngine";
import { JamModal } from "./components/JamModal";
import { MainView } from "./components/MainView";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { NewPlaylistModal } from "./components/NewPlaylistModal";
import { PlayerBar } from "./components/PlayerBar";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { usePlayerStore } from "./store/usePlayerStore";
import type { ActiveView } from "./types";

function getTabIndex(view: ActiveView, isJamModalOpen: boolean): number {
  if (isJamModalOpen) return 3;
  if (view.type === "home") return 0;
  if (view.type === "search") return 1;
  return 2;
}

export const App: React.FC = () => {
  const fetchLibrary = usePlayerStore((s) => s.fetchLibrary);
  const toastMessage = usePlayerStore((s) => s.toastMessage);
  const activeView = usePlayerStore((s) => s.activeView);
  const isJamModalOpen = usePlayerStore((s) => s.isJamModalOpen);
  const isMobilePlayerExpanded = usePlayerStore((s) => s.isMobilePlayerExpanded);
  const isNewPlaylistModalOpen = usePlayerStore((s) => s.isNewPlaylistModalOpen);
  const navigate = usePlayerStore((s) => s.navigate);
  const setJamModalOpen = usePlayerStore((s) => s.setJamModalOpen);

  const currentTabIndex = getTabIndex(activeView, isJamModalOpen);
  const prevTabIndexRef = useRef<number>(currentTabIndex);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [tabTransition, setTabTransition] = useState<
    "idle" | "from-right" | "from-left"
  >("idle");

  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  useLayoutEffect(() => {
    const prev = prevTabIndexRef.current;
    if (prev !== currentTabIndex) {
      prevTabIndexRef.current = currentTabIndex;
      if (currentTabIndex !== 3) {
        setTabTransition(currentTabIndex > prev ? "from-right" : "from-left");
      }
    }
  }, [currentTabIndex]);

  useEffect(() => {
    if (tabTransition === "idle") return;
    let cancelled = false;
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        if (!cancelled) {
          setTabTransition("idle");
        }
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [tabTransition]);

  const switchToTab = (targetIndex: number) => {
    if (targetIndex === currentTabIndex) return;
    if (targetIndex === 0) {
      setJamModalOpen(false);
      navigate({ type: "home" });
    } else if (targetIndex === 1) {
      setJamModalOpen(false);
      navigate({ type: "search" });
    } else if (targetIndex === 2) {
      setJamModalOpen(false);
      navigate({ type: "library" });
    } else if (targetIndex === 3) {
      setJamModalOpen(true);
    }
  };

  const isAnyBlockingModalOpen = () =>
    isMobilePlayerExpanded ||
    isNewPlaylistModalOpen ||
    isJamModalOpen ||
    Boolean(document.querySelector('[role="dialog"]'));

  const handleMainTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1 || isAnyBlockingModalOpen()) {
      swipeStartRef.current = null;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        '[data-no-tab-swipe], [role="slider"], input, textarea, [draggable="true"]'
      )
    ) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleMainTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || e.changedTouches.length === 0 || isAnyBlockingModalOpen()) {
      return;
    }
    const deltaX = e.changedTouches[0].clientX - start.x;
    const deltaY = e.changedTouches[0].clientY - start.y;
    if (Math.abs(deltaX) > 65 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
      if (deltaX < 0) {
        switchToTab(Math.min(3, currentTabIndex + 1));
      } else {
        switchToTab(Math.max(0, currentTabIndex - 1));
      }
    }
  };

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col overflow-hidden overflow-x-hidden">
      {/* Headless audio controller, standby 15s prefetcher, MediaSession & shortcuts */}
      <AudioEngine />

      {/* Main 2-column workspace */}
      <div className="flex-1 min-h-0 flex gap-0 md:gap-2 p-0 md:p-2 md:pb-0 overflow-x-hidden">
        <Sidebar />

        <main
          onTouchStart={handleMainTouchStart}
          onTouchEnd={handleMainTouchEnd}
          onTouchCancel={() => {
            swipeStartRef.current = null;
          }}
          className="flex-1 min-w-0 rounded-none md:rounded-lg bg-[#000000] flex flex-col overflow-hidden relative"
        >
          <TopBar />
          <div
            className={
              tabTransition === "from-right"
                ? "flex-1 min-h-0 flex flex-col transition-none translate-x-5 opacity-0"
                : tabTransition === "from-left"
                  ? "flex-1 min-h-0 flex flex-col transition-none -translate-x-5 opacity-0"
                  : "flex-1 min-h-0 flex flex-col transition-all duration-200 ease-out translate-x-0 opacity-100"
            }
          >
            <MainView />
          </div>
        </main>
      </div>

      {/* Persistent bottom player bar (desktop bar + mobile floating mini-player & full-screen sheet) */}
      <PlayerBar />

      {/* Fixed mobile bottom navigation */}
      <MobileBottomNav />

      {/* Modals & Toast */}
      <NewPlaylistModal />
      <JamModal />

      {toastMessage && (
        <div className="fixed bottom-[calc(8rem+env(safe-area-inset-bottom))] md:bottom-28 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-[#FF5E4D] text-black text-xs font-bold shadow-2xl pointer-events-none whitespace-nowrap max-w-[90vw] truncate">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default App;
