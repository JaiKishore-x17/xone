import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { AddToPlaylistModal } from "./components/AddToPlaylistModal";
import { AudioEngine } from "./components/AudioEngine";
import { JamModal } from "./components/JamModal";
import { MainView } from "./components/MainView";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { NewPlaylistModal } from "./components/NewPlaylistModal";
import { PlayerBar } from "./components/PlayerBar";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { UpdateChecker } from "./components/UpdateChecker";
import { XoneDashModal } from "./components/XoneDashGame";
import { usePlayerStore } from "./store/usePlayerStore";
import type { ActiveView } from "./types";

const TAB_ORDER = ["home", "search", "library", "settings"] as const;

function getTabIndex(view: ActiveView): number {
  if (view.type === "home") return 0;
  if (view.type === "search") return 1;
  if (view.type === "settings") return 3;
  return 2;
}

interface KeyboardPluginLike {
  addListener(
    eventName:
      | "keyboardWillShow"
      | "keyboardDidShow"
      | "keyboardWillHide"
      | "keyboardDidHide",
    listenerFunc: () => void
  ): Promise<PluginListenerHandle>;
}

const CapacitorKeyboard = registerPlugin<KeyboardPluginLike>("Keyboard");

export const App: React.FC = () => {
  const fetchLibrary = usePlayerStore((s) => s.fetchLibrary);
  const toastMessage = usePlayerStore((s) => s.toastMessage);
  const activeView = usePlayerStore((s) => s.activeView);
  const isJamModalOpen = usePlayerStore((s) => s.isJamModalOpen);
  const isMobilePlayerExpanded = usePlayerStore((s) => s.isMobilePlayerExpanded);
  const isNewPlaylistModalOpen = usePlayerStore((s) => s.isNewPlaylistModalOpen);
  const addToPlaylistModalTrack = usePlayerStore((s) => s.addToPlaylistModalTrack);
  const dashTrack = usePlayerStore((s) => s.dashTrack);
  const navigate = usePlayerStore((s) => s.navigate);
  const setKeyboardOpen = usePlayerStore((s) => s.setKeyboardOpen);

  const currentTabIndex = getTabIndex(activeView);
  const prevTabIndexRef = useRef<number>(currentTabIndex);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [tabTransition, setTabTransition] = useState<
    "idle" | "from-right" | "from-left"
  >("idle");

  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  // Detect soft keyboard visibility via Capacitor Keyboard events + visualViewport height fallback
  useEffect(() => {
    let mounted = true;
    let baselineHeight =
      window.visualViewport?.height ?? window.innerHeight;
    let baselineWidth =
      window.visualViewport?.width ?? window.innerWidth;
    let nativeKeyboardActive = false;
    let focusRecheckTimers: number[] = [];

    const isTextInputFocused = (): boolean => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        el.isContentEditable
      );
    };

    const syncFromViewport = () => {
      if (!mounted) return;
      const curWidth = window.visualViewport?.width ?? window.innerWidth;
      const curHeight = window.visualViewport?.height ?? window.innerHeight;

      // Reset baseline when orientation changes or when viewport expands back while unfocused
      if (Math.abs(curWidth - baselineWidth) > 80) {
        baselineWidth = curWidth;
        baselineHeight = curHeight;
      } else if (!isTextInputFocused() && curHeight > baselineHeight) {
        baselineHeight = curHeight;
      }

      const shrunkRelativeToWindow =
        curHeight < window.innerHeight * 0.75;
      const shrunkWhileFocused =
        isTextInputFocused() && curHeight < baselineHeight * 0.78;

      const nextOpen =
        nativeKeyboardActive || shrunkRelativeToWindow || shrunkWhileFocused;
      setKeyboardOpen(nextOpen);
    };

    const handleKeyboardShow = () => {
      nativeKeyboardActive = true;
      if (mounted) setKeyboardOpen(true);
    };

    const handleKeyboardHide = () => {
      nativeKeyboardActive = false;
      if (mounted) setKeyboardOpen(false);
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
        syncFromViewport();
        focusRecheckTimers.forEach((id) => window.clearTimeout(id));
        focusRecheckTimers = [
          window.setTimeout(syncFromViewport, 150),
          window.setTimeout(syncFromViewport, 350),
        ];
      }
    };

    const handleFocusOut = () => {
      window.setTimeout(() => {
        if (!mounted) return;
        if (!isTextInputFocused() && !nativeKeyboardActive) {
          setKeyboardOpen(false);
        } else {
          syncFromViewport();
        }
      }, 90);
    };

    window.addEventListener("keyboardWillShow", handleKeyboardShow);
    window.addEventListener("keyboardDidShow", handleKeyboardShow);
    window.addEventListener("keyboardWillHide", handleKeyboardHide);
    window.addEventListener("keyboardDidHide", handleKeyboardHide);
    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("focusout", handleFocusOut);
    window.visualViewport?.addEventListener("resize", syncFromViewport);
    window.addEventListener("resize", syncFromViewport);

    const pluginHandles: Array<Promise<PluginListenerHandle>> = [];
    if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Keyboard")) {
      pluginHandles.push(
        CapacitorKeyboard.addListener("keyboardWillShow", handleKeyboardShow),
        CapacitorKeyboard.addListener("keyboardDidShow", handleKeyboardShow),
        CapacitorKeyboard.addListener("keyboardWillHide", handleKeyboardHide),
        CapacitorKeyboard.addListener("keyboardDidHide", handleKeyboardHide)
      );
    }

    return () => {
      mounted = false;
      focusRecheckTimers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener("keyboardWillShow", handleKeyboardShow);
      window.removeEventListener("keyboardDidShow", handleKeyboardShow);
      window.removeEventListener("keyboardWillHide", handleKeyboardHide);
      window.removeEventListener("keyboardDidHide", handleKeyboardHide);
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);
      window.visualViewport?.removeEventListener("resize", syncFromViewport);
      window.removeEventListener("resize", syncFromViewport);
      pluginHandles.forEach((p) => {
        void p.then((h) => h.remove()).catch(() => {});
      });
      setKeyboardOpen(false);
    };
  }, [setKeyboardOpen]);

  useLayoutEffect(() => {
    const prev = prevTabIndexRef.current;
    if (prev !== currentTabIndex) {
      prevTabIndexRef.current = currentTabIndex;
      setTabTransition(currentTabIndex > prev ? "from-right" : "from-left");
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
    const clampedIndex = Math.max(0, Math.min(TAB_ORDER.length - 1, targetIndex));
    const nextTab = TAB_ORDER[clampedIndex];
    if (nextTab === "home") {
      navigate({ type: "home" });
    } else if (nextTab === "search") {
      navigate({ type: "search" });
    } else if (nextTab === "settings") {
      navigate({ type: "settings" });
    } else {
      navigate({ type: "library" });
    }
  };

  const isAnyBlockingModalOpen = () =>
    isMobilePlayerExpanded ||
    isNewPlaylistModalOpen ||
    Boolean(addToPlaylistModalTrack) ||
    Boolean(dashTrack) ||
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
        switchToTab(Math.min(TAB_ORDER.length - 1, currentTabIndex + 1));
      } else {
        switchToTab(Math.max(0, currentTabIndex - 1));
      }
    }
  };

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col overflow-hidden overflow-x-hidden">
      {/* Headless audio controller, standby 15s prefetcher, MediaSession & shortcuts */}
      <AudioEngine />

      {/* Main 2-column workspace (hidden while Xone Dash is active to pause background UI compositing) */}
      <div
        className={`flex-1 min-h-0 flex gap-0 md:gap-2 p-0 md:p-2 md:pb-0 overflow-x-hidden ${
          dashTrack ? "hidden" : ""
        }`}
      >
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
      {!dashTrack && <MobileBottomNav />}

      {/* Modals & Toast */}
      <NewPlaylistModal />
      <AddToPlaylistModal />
      <JamModal />
      <UpdateChecker />
      <XoneDashModal />

      {toastMessage && (
        <div className="fixed bottom-[calc(8rem+env(safe-area-inset-bottom))] md:bottom-28 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-[#FF5E4D] text-black text-xs font-bold shadow-2xl pointer-events-none whitespace-nowrap max-w-[90vw] truncate">
          {toastMessage}
        </div>
      )}
    </div>
  );
};

export default App;
