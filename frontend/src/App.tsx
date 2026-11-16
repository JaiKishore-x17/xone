import React, { useEffect } from "react";
import { AudioEngine } from "./components/AudioEngine";
import { JamModal } from "./components/JamModal";
import { MainView } from "./components/MainView";
import { MobileBottomNav } from "./components/MobileBottomNav";
import { NewPlaylistModal } from "./components/NewPlaylistModal";
import { PlayerBar } from "./components/PlayerBar";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { usePlayerStore } from "./store/usePlayerStore";

export const App: React.FC = () => {
  const fetchLibrary = usePlayerStore((s) => s.fetchLibrary);
  const toastMessage = usePlayerStore((s) => s.toastMessage);

  useEffect(() => {
    void fetchLibrary();
  }, [fetchLibrary]);

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col overflow-hidden overflow-x-hidden">
      {/* Headless audio controller, standby 15s prefetcher, MediaSession & shortcuts */}
      <AudioEngine />

      {/* Main 2-column workspace */}
      <div className="flex-1 min-h-0 flex gap-0 md:gap-2 p-0 md:p-2 md:pb-0 overflow-x-hidden">
        <Sidebar />

        <main className="flex-1 min-w-0 rounded-none md:rounded-lg bg-[#000000] flex flex-col overflow-hidden relative">
          <TopBar />
          <MainView />
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
