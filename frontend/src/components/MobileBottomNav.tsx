import React from "react";
import { Home, Library, Search } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";

export const MobileBottomNav: React.FC = () => {
  const activeView = usePlayerStore((s) => s.activeView);
  const navigate = usePlayerStore((s) => s.navigate);

  const isHome = activeView.type === "home";
  const isSearch = activeView.type === "search";
  const isLibrary =
    activeView.type === "library" ||
    activeView.type === "likes" ||
    activeView.type === "playlist";

  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 left-0 right-0 z-40 h-14 bg-black/95 backdrop-blur-md border-t border-white/10 flex md:hidden items-center justify-around px-2 select-none"
    >
      <button
        type="button"
        onClick={() => navigate({ type: "home" })}
        className={`min-h-[44px] min-w-[64px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
          isHome ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
        }`}
      >
        <Home size={20} />
        <span>Home</span>
      </button>

      <button
        type="button"
        onClick={() => {
          navigate({ type: "search" });
          window.requestAnimationFrame(() => {
            document.getElementById("xone-search-input")?.focus();
          });
        }}
        className={`min-h-[44px] min-w-[64px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
          isSearch ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
        }`}
      >
        <Search size={20} />
        <span>Search</span>
      </button>

      <button
        type="button"
        onClick={() => navigate({ type: "library" })}
        className={`min-h-[44px] min-w-[64px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
          isLibrary ? "text-[#FF5E4D]" : "text-[#B3B3B3] hover:text-white"
        }`}
      >
        <Library size={20} />
        <span>Library</span>
      </button>
    </nav>
  );
};
