import React from "react";
import { Gamepad2, Settings } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import type { DashDifficulty } from "../types";

interface SettingsPageProps {
  scrollRef?: React.RefObject<HTMLDivElement>;
}

const DIFFICULTY_OPTIONS: Array<{
  value: DashDifficulty;
  label: string;
  description: string;
}> = [
  {
    value: "easy",
    label: "Easy",
    description: "Balanced beat-synced jumps",
  },
  {
    value: "raw",
    label: "Raw",
    description: "Every high beat mapped for intense sync",
  },
];

export const SettingsPage: React.FC<SettingsPageProps> = ({ scrollRef }) => {
  const dashDifficulty = usePlayerStore((s) => s.dashDifficulty);
  const setDashDifficulty = usePlayerStore((s) => s.setDashDifficulty);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto overflow-x-hidden xone-modal-scroll overscroll-y-contain px-4 md:px-6 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pb-24 pt-6 bg-[#000000]"
    >
      <div className="max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-[#FF5E4D] shrink-0">
            <Settings size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white">
              Settings
            </h1>
            <p className="text-xs text-[#B3B3B3]">
              Customize your Xone experience
            </p>
          </div>
        </div>

        {/* Modular Card Section: Xone Dash */}
        <section
          aria-labelledby="settings-xone-dash-heading"
          className="rounded-2xl bg-[#111111] border border-white/[0.08] p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#FF5E4D]/15 border border-[#FF5E4D]/30 flex items-center justify-center text-[#FF5E4D] shrink-0">
              <Gamepad2 size={18} />
            </div>
            <div>
              <h2
                id="settings-xone-dash-heading"
                className="text-base font-bold text-white"
              >
                Xone Dash
              </h2>
              <p className="text-xs text-[#B3B3B3]">
                Beat-synced rhythm mini-game
              </p>
            </div>
          </div>

          <div className="space-y-2.5 pt-1 border-t border-white/[0.06]">
            <div className="flex items-center justify-between pt-2">
              <span className="text-sm font-semibold text-white">
                Difficulty
              </span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#FF5E4D]">
                {dashDifficulty === "raw" ? "Raw" : "Easy"}
              </span>
            </div>

            <div
              role="radiogroup"
              aria-label="Xone Dash Difficulty"
              className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-black/80 border border-white/[0.08]"
            >
              {DIFFICULTY_OPTIONS.map((option) => {
                const selected = dashDifficulty === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setDashDifficulty(option.value)}
                    className={`min-h-[60px] px-3 py-2.5 rounded-lg text-left transition-all ${
                      selected
                        ? "bg-[#FF5E4D] text-black shadow-md"
                        : "bg-transparent text-zinc-200 hover:bg-white/[0.06]"
                    }`}
                  >
                    <p
                      className={`text-sm font-extrabold leading-tight ${
                        selected ? "text-black" : "text-white"
                      }`}
                    >
                      {option.label}
                    </p>
                    <p
                      className={`text-[11px] leading-snug mt-1 ${
                        selected ? "text-black/80 font-medium" : "text-[#B3B3B3]"
                      }`}
                    >
                      {option.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
