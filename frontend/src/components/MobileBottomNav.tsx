import React from "react";
import { Home, Library, Search, Speaker } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";

export const MobileBottomNav: React.FC = () => {
  const activeView = usePlayerStore((s) => s.activeView);
  const isJamModalOpen = usePlayerStore((s) => s.isJamModalOpen);
  const isKeyboardOpen = usePlayerStore((s) => s.isKeyboardOpen);
  const jamActive = usePlayerStore((s) => s.jamState.active);
  const navigate = usePlayerStore((s) => s.navigate);
  const setJamModalOpen = usePlayerStore((s) => s.setJamModalOpen);

  const isHome = !isJamModalOpen && activeView.type === "home";
  const isSearch = !isJamModalOpen && activeView.type === "search";
  const isLibrary =
    !isJamModalOpen &&
    (activeView.type === "library" ||
      activeView.type === "likes" ||
      activeView.type === "downloads" ||
      activeView.type === "playlist" ||
      activeView.type === "queue");

  return (
    <nav
      aria-label="Mobile Navigation"
      aria-hidden={isKeyboardOpen}
      className={`fixed bottom-0 left-0 right-0 z-40 h-[calc(3.5rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] bg-black/95 backdrop-blur-md border-t border-white/10 flex md:hidden items-center justify-around px-2 select-none transition-all duration-150 ease-out ${
        isKeyboardOpen
          ? "translate-y-[140%] opacity-0 pointer-events-none"
          : "translate-y-0 opacity-100"
      }`}
    >
      <button
        type="button"
        onClick={() => {
          setJamModalOpen(false);
          navigate({ type: "home" });
        }}
        className={`min-h-[44px] min-w-[56px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
          isHome ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
        }`}
      >
        <Home size={20} />
        <span>Home</span>
      </button>

      <button
        type="button"
        onClick={() => {
          setJamModalOpen(false);
          navigate({ type: "search" });
          window.requestAnimationFrame(() => {
            document.getElementById("xone-search-input")?.focus();
          });
        }}
        className={`min-h-[44px] min-w-[56px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
          isSearch ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
        }`}
      >
        <Search size={20} />
        <span>Search</span>
      </button>

      <button
        type="button"
        onClick={() => {
          setJamModalOpen(false);
          navigate({ type: "library" });
        }}
        className={`min-h-[44px] min-w-[56px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
          isLibrary ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
        }`}
      >
        <Library size={20} />
        <span>Library</span>
      </button>

      <button
        type="button"
        onClick={() => setJamModalOpen(true)}
        className={`relative min-h-[44px] min-w-[56px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
          isJamModalOpen || jamActive
            ? "text-[#FF5E4D]"
            : "text-[#B3B3B3] hover:text-white"
        }`}
      >
        <Speaker size={20} />
        <span>Jam</span>
        {jamActive && (
          <span className="absolute top-1.5 right-2.5 w-1.5 h-1.5 rounded-full bg-[#FF5E4D] animate-pulse" />
        )}
      </button>
    </nav>
  );
};
