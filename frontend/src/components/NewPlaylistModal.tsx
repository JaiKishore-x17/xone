import React, { useState } from "react";
import { X } from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";

const ACCENT_SWATCHES = [
  "#FF5E4D",
  "#E11D48",
  "#F97316",
  "#8B5CF6",
  "#06B6D4",
  "#10B981",
  "#EC4899",
];

export const NewPlaylistModal: React.FC = () => {
  const isOpen = usePlayerStore((s) => s.isNewPlaylistModalOpen);
  const setOpen = usePlayerStore((s) => s.setNewPlaylistModalOpen);
  const createPlaylist = usePlayerStore((s) => s.createPlaylist);
  const showToast = usePlayerStore((s) => s.showToast);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [coverColor, setCoverColor] = useState("#FF5E4D");
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    if (submitting) return;
    setOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await createPlaylist(trimmed, description.trim(), coverColor);
      setName("");
      setDescription("");
      setCoverColor("#FF5E4D");
      setOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to create playlist");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-no-tab-swipe="true"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-[#141414] border border-white/10 shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-white">Create playlist</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close modal"
            className="p-1.5 rounded-full text-[#B3B3B3] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label
              htmlFor="xone-playlist-name"
              className="block text-xs font-semibold text-[#B3B3B3] uppercase tracking-wider mb-1.5"
            >
              Name
            </label>
            <input
              id="xone-playlist-name"
              type="text"
              required
              autoFocus
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Late Night Synth"
              className="w-full px-3.5 py-2.5 rounded-md bg-[#1E1E1E] text-sm text-white placeholder-[#727272] border border-white/10 focus:border-[#FF5E4D] focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="xone-playlist-desc"
              className="block text-xs font-semibold text-[#B3B3B3] uppercase tracking-wider mb-1.5"
            >
              Description (optional)
            </label>
            <textarea
              id="xone-playlist-desc"
              rows={2}
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add an optional description..."
              className="w-full px-3.5 py-2.5 rounded-md bg-[#1E1E1E] text-sm text-white placeholder-[#727272] border border-white/10 focus:border-[#FF5E4D] focus:outline-none resize-none"
            />
          </div>

          <div>
            <span className="block text-xs font-semibold text-[#B3B3B3] uppercase tracking-wider mb-2">
              Header Accent Gradient
            </span>
            <div className="flex items-center gap-2.5">
              {ACCENT_SWATCHES.map((swatch) => (
                <button
                  key={swatch}
                  type="button"
                  onClick={() => setCoverColor(swatch)}
                  aria-label={`Select color ${swatch}`}
                  className={`w-7 h-7 rounded-full transition-transform ${
                    coverColor === swatch
                      ? "ring-2 ring-white scale-110"
                      : "opacity-80 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: swatch }}
                />
              ))}
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={handleClose}
              className="px-5 py-2 rounded-full text-sm font-bold text-[#B3B3B3] hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || submitting}
              className="px-6 py-2 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] disabled:opacity-40 text-black text-sm font-bold transition-colors"
            >
              {submitting ? "Creating..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
