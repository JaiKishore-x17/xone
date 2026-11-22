import React, { useEffect, useState } from "react";
import { ExternalLink, Github, Loader2, RefreshCw, X } from "lucide-react";
import {
  getInstalledAppVersion,
  triggerManualUpdateCheck,
  type UpdateCheckSummary,
} from "./UpdateChecker";
import { XoneLogo } from "./XoneLogo";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose }) => {
  const [installedVersion, setInstalledVersion] = useState("1.2.0");
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateCheckSummary | null>(
    null
  );

  useEffect(() => {
    if (!isOpen) {
      setUpdateStatus(null);
      return;
    }
    void getInstalledAppVersion().then((v) => setInstalledVersion(v));
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCheckUpdates = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    setUpdateStatus(null);
    const result = await triggerManualUpdateCheck();
    setIsCheckingUpdate(false);
    if (result.status === "available") {
      onClose();
      return;
    }
    setUpdateStatus(result);
  };

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-xone-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[#141414] border border-white/10 rounded-2xl p-6 shadow-2xl text-white space-y-5"
      >
        {/* App Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <XoneLogo size={44} className="shrink-0 shadow-lg" />
            <div>
              <h2
                id="about-xone-title"
                className="text-xl font-extrabold tracking-tight text-white leading-tight"
              >
                Xone
              </h2>
              <span className="inline-flex items-center mt-1 px-2.5 py-0.5 rounded-full bg-[#1E1E1E] border border-[#FF5E4D]/30 text-[11px] font-semibold text-[#FF5E4D]">
                v{installedVersion} • Android
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close About Xone"
            className="min-w-[36px] min-h-[36px] -mr-1 -mt-1 flex items-center justify-center rounded-full text-[#B3B3B3] hover:text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tagline / Highlights */}
        <p className="text-sm leading-relaxed text-[#B3B3B3]">
          Ad-free, local-first personal music player with offline downloads,
          real-time 8D &amp; Slowed+Reverb DSP, and zero-server BLE Jam.
        </p>

        {/* Creator Credit Card */}
        <div className="pt-1 border-t border-white/10 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#B3B3B3]">
            Created by <span className="text-white">Jai Kishore</span>
          </p>

          <a
            href="https://github.com/JaiKishore-x17"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#1E1E1E] border border-white/10 hover:border-[#FF5E4D]/60 active:border-[#FF5E4D] active:scale-[0.98] flex items-center justify-between gap-3 text-sm font-medium text-white transition-all"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Github size={17} className="text-[#FF5E4D] shrink-0" />
              <span className="truncate">github.com/JaiKishore-x17</span>
            </span>
            <ExternalLink size={15} className="text-[#B3B3B3] shrink-0" />
          </a>

          <button
            type="button"
            disabled={isCheckingUpdate}
            onClick={() => void handleCheckUpdates()}
            className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl bg-[#1E1E1E] border border-white/10 hover:border-[#FF5E4D]/60 active:border-[#FF5E4D] active:scale-[0.98] disabled:opacity-60 flex items-center justify-between gap-3 text-sm font-semibold text-white transition-all"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              {isCheckingUpdate ? (
                <Loader2 size={16} className="animate-spin text-[#FF5E4D] shrink-0" />
              ) : (
                <RefreshCw size={16} className="text-[#FF5E4D] shrink-0" />
              )}
              <span>
                {isCheckingUpdate ? "Checking for updates..." : "Check for Updates"}
              </span>
            </span>
            <span className="text-[11px] font-semibold text-[#B3B3B3] shrink-0">
              v{installedVersion}
            </span>
          </button>

          {updateStatus && (
            <p
              className={`text-xs font-medium px-1 ${
                updateStatus.status === "error"
                  ? "text-[#FF5E4D]"
                  : "text-[#B3B3B3]"
              }`}
            >
              {updateStatus.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
