import React, { useEffect, useRef, useState } from "react";
import {
  Bluetooth,
  Check,
  Copy,
  Loader2,
  Lock,
  Music2,
  Play,
  Plus,
  Radio,
  Search,
  Share2,
  Speaker,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import * as api from "../services/musicApi";
import {
  EMPTY_JAM_STATE,
  getJamState,
  onJamEnded,
  onJamStateUpdated,
} from "../services/xoneJam";
import { usePlayerStore } from "../store/usePlayerStore";
import type { Track } from "../types";

export const JamModal: React.FC = () => {
  const isOpen = usePlayerStore((s) => s.isJamModalOpen);
  const isBusy = usePlayerStore((s) => s.isJamBusy);
  const jamState = usePlayerStore((s) => s.jamState);
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  const setJamModalOpen = usePlayerStore((s) => s.setJamModalOpen);
  const setJamState = usePlayerStore((s) => s.setJamState);
  const startJamSession = usePlayerStore((s) => s.startJamSession);
  const joinJamSession = usePlayerStore((s) => s.joinJamSession);
  const leaveJamSession = usePlayerStore((s) => s.leaveJamSession);
  const addTrackToJamSession = usePlayerStore((s) => s.addTrackToJamSession);
  const setJamSpeakerDevices = usePlayerStore((s) => s.setJamSpeakerDevices);
  const setJamMultiSpeakerMode = usePlayerStore((s) => s.setJamMultiSpeakerMode);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const navigate = usePlayerStore((s) => s.navigate);
  const showToast = usePlayerStore((s) => s.showToast);

  const jamSwipeRef = useRef<{ x: number; y: number } | null>(null);

  const [activeTab, setActiveTab] = useState<"host" | "join">("host");
  const [deviceNameInput, setDeviceNameInput] = useState("");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const [jamSearchQuery, setJamSearchQuery] = useState("");
  const [jamSearchResults, setJamSearchResults] = useState<Track[]>([]);
  const [isSearchingJam, setIsSearchingJam] = useState(false);

  // Maintain native BLE Jam event subscriptions for the lifetime of the app
  useEffect(() => {
    let mounted = true;
    void getJamState()
      .then((initial) => {
        if (mounted) setJamState(initial);
      })
      .catch(() => {});

    const updatedHandle = onJamStateUpdated((next) => {
      if (mounted) setJamState(next);
    });
    const endedHandle = onJamEnded((ev) => {
      if (!mounted) return;
      setJamState(EMPTY_JAM_STATE);
      if (ev.reason) {
        usePlayerStore.getState().showToast(ev.reason);
      }
    });

    return () => {
      mounted = false;
      void updatedHandle.then((h) => h.remove());
      void endedHandle.then((h) => h.remove());
    };
  }, [setJamState]);

  useEffect(() => {
    if (jamState.role === "host") setActiveTab("host");
    if (jamState.role === "guest") setActiveTab("join");
  }, [jamState.role]);

  useEffect(() => {
    if (!isOpen) {
      setErrorMsg(null);
      return;
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setJamModalOpen(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [isOpen, setJamModalOpen]);

  // Debounced quick track search inside Jam Modal
  useEffect(() => {
    const trimmed = jamSearchQuery.trim();
    if (!trimmed) {
      setJamSearchResults([]);
      setIsSearchingJam(false);
      return;
    }

    let cancelled = false;
    setIsSearchingJam(true);
    const timer = window.setTimeout(() => {
      void api
        .searchTracks(trimmed)
        .then((res) => {
          if (!cancelled) {
            setJamSearchResults(res.songs.slice(0, 6));
            setIsSearchingJam(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setIsSearchingJam(false);
          }
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jamSearchQuery]);

  if (!isOpen) return null;

  const isLocalSpeakerEnabled = jamState.activeSpeakers.includes(
    jamState.localDeviceId
  );

  const handleStartJam = async () => {
    setErrorMsg(null);
    try {
      await startJamSession(deviceNameInput.trim() || undefined);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unable to start Jam");
    }
  };

  const handleJoinJam = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCodeInput.replace(/\D/g, "").slice(0, 6);
    if (cleaned.length !== 6) {
      setErrorMsg("Enter the 6-digit Jam code shown on the Host device.");
      return;
    }
    setErrorMsg(null);
    try {
      await joinJamSession(cleaned, deviceNameInput.trim() || undefined);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unable to join Jam");
    }
  };

  const handleCopyCode = async () => {
    if (!jamState.jamCode) return;
    try {
      await navigator.clipboard.writeText(jamState.jamCode);
      setCopiedCode(true);
      showToast(`Copied Jam code ${jamState.jamCode}`);
      window.setTimeout(() => setCopiedCode(false), 1600);
    } catch {
      showToast(`Jam Code: ${jamState.jamCode}`);
    }
  };

  const handleShareCode = async () => {
    if (!jamState.jamCode) return;
    const shareText = `Join my Xone BLE Jam! Code: ${jamState.jamCode}`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Xone BLE Jam", text: shareText });
        return;
      } catch {
        // user cancelled or unsupported -> fallback to copy
      }
    }
    await handleCopyCode();
  };

  const handleToggleSpeaker = (deviceAddress: string) => {
    if (!jamState.isMultiSpeakerMode && deviceAddress !== "HOST") {
      return;
    }
    const currentSet = new Set(jamState.activeSpeakers);
    if (currentSet.has(deviceAddress)) {
      currentSet.delete(deviceAddress);
    } else {
      currentSet.add(deviceAddress);
    }
    void setJamSpeakerDevices(Array.from(currentSet));
  };

  const renderSharedQueueAndSearch = () => (
    <div className="mt-5 space-y-4 border-t border-white/10 pt-4">
      {/* Add Tracks via Search */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-[#B3B3B3] mb-2">
          Add Songs to Jam Queue
        </p>
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#B3B3B3] pointer-events-none"
          />
          <input
            type="text"
            value={jamSearchQuery}
            onChange={(e) => setJamSearchQuery(e.target.value)}
            placeholder="Search a song to queue..."
            className="w-full h-10 pl-9 pr-9 rounded-lg bg-[#1E1E1E] text-sm text-white placeholder-[#727272] border border-white/10 focus:border-[#FF5E4D] focus:outline-none"
          />
          {isSearchingJam ? (
            <Loader2
              size={15}
              className="animate-spin text-[#FF5E4D] absolute right-3 top-1/2 -translate-y-1/2"
            />
          ) : (
            jamSearchQuery && (
              <button
                type="button"
                onClick={() => setJamSearchQuery("")}
                aria-label="Clear jam search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#B3B3B3] hover:text-white"
              >
                <X size={15} />
              </button>
            )
          )}
        </div>

        {jamSearchResults.length > 0 && (
          <div className="mt-2 rounded-lg bg-[#000000] border border-white/10 divide-y divide-white/5 max-h-48 overflow-y-auto">
            {jamSearchResults.map((track) => (
              <div
                key={track.video_id}
                className="flex items-center gap-2.5 p-2 hover:bg-[#1E1E1E] transition-colors"
              >
                <img
                  src={track.thumbnail}
                  alt={track.title}
                  className="w-9 h-9 rounded object-cover shrink-0 bg-[#141414]"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-white truncate">
                    {track.title}
                  </p>
                  <p className="text-[11px] text-[#B3B3B3] truncate">
                    {track.artist}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void addTrackToJamSession(track)}
                  className="min-h-[34px] px-3 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] text-black text-xs font-bold flex items-center gap-1 shrink-0 transition-colors"
                >
                  <Plus size={13} />
                  <span>Add</span>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Live Shared Queue */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold uppercase tracking-wider text-[#B3B3B3]">
            Live Jam Queue ({jamState.jamQueue.length})
          </p>
          {jamState.role === "host" && currentTrack && (
            <button
              type="button"
              onClick={() => void addTrackToJamSession(currentTrack)}
              className="text-[11px] font-semibold text-[#FF5E4D] hover:underline"
            >
              + Current Track
            </button>
          )}
        </div>

        {jamState.jamQueue.length === 0 ? (
          <div className="rounded-lg bg-[#000000] border border-white/10 p-4 text-center">
            <Music2 size={22} className="mx-auto text-[#727272] mb-1.5" />
            <p className="text-xs text-[#B3B3B3]">
              Queue is empty. Search above or play a track to start syncing.
            </p>
          </div>
        ) : (
          <div className="rounded-lg bg-[#000000] border border-white/10 divide-y divide-white/5 max-h-52 overflow-y-auto">
            {jamState.jamQueue.map((item, idx) => {
              const isActiveTrack =
                jamState.currentTrack?.video_id === item.video_id;
              return (
                <div
                  key={`${item.video_id}-${idx}`}
                  onClick={() => {
                    if (jamState.role === "host") {
                      playTrack(item, jamState.jamQueue);
                    }
                  }}
                  className={`flex items-center gap-2.5 p-2.5 ${
                    jamState.role === "host"
                      ? "cursor-pointer hover:bg-[#1E1E1E]"
                      : ""
                  } ${isActiveTrack ? "bg-[#1E1E1E]/70" : ""}`}
                >
                  <img
                    src={item.thumbnail}
                    alt={item.title}
                    className="w-10 h-10 rounded object-cover shrink-0 bg-[#141414]"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-xs font-bold truncate ${
                        isActiveTrack ? "text-[#FF5E4D]" : "text-white"
                      }`}
                    >
                      {item.title}
                    </p>
                    <p className="text-[11px] text-[#B3B3B3] truncate">
                      {item.artist} • Added by{" "}
                      <span className="text-white/90">{item.addedBy}</span>
                    </p>
                  </div>
                  {isActiveTrack ? (
                    <span className="px-2 py-0.5 rounded-full bg-[#FF5E4D]/20 text-[#FF5E4D] text-[10px] font-bold shrink-0">
                      {jamState.isPlaying ? "PLAYING" : "PAUSED"}
                    </span>
                  ) : (
                    jamState.role === "host" && (
                      <Play size={14} className="text-[#B3B3B3] shrink-0" />
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      data-no-tab-swipe="true"
      onClick={() => setJamModalOpen(false)}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 select-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          if (e.touches.length !== 1) {
            jamSwipeRef.current = null;
            return;
          }
          const target = e.target as HTMLElement | null;
          if (
            target?.closest(
              'input, textarea, button[role="switch"], [role="slider"]'
            )
          ) {
            jamSwipeRef.current = null;
            return;
          }
          jamSwipeRef.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
          };
        }}
        onTouchEnd={(e) => {
          const start = jamSwipeRef.current;
          jamSwipeRef.current = null;
          if (!start || e.changedTouches.length === 0) return;
          const deltaX = e.changedTouches[0].clientX - start.x;
          const deltaY = e.changedTouches[0].clientY - start.y;
          if (deltaX > 65 && Math.abs(deltaX) > Math.abs(deltaY) * 1.5) {
            setJamModalOpen(false);
            navigate({ type: "library" });
          }
        }}
        onTouchCancel={() => {
          jamSwipeRef.current = null;
        }}
        className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#141414] border-t sm:border border-white/10 shadow-2xl p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-6"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[#FF5E4D]/15 border border-[#FF5E4D]/40 flex items-center justify-center shrink-0">
              <Bluetooth size={18} className="text-[#FF5E4D]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-extrabold text-white truncate">
                  BLE Jam &amp; Multi-Speaker
                </h2>
                {jamState.active && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FF5E4D] text-black text-[10px] font-black shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
                    LIVE
                  </span>
                )}
              </div>
              <p className="text-xs text-[#B3B3B3] truncate">
                BLE control &amp; clock sync • Each speaker streams on its own internet
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setJamModalOpen(false)}
            aria-label="Close Jam modal"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-full text-[#B3B3B3] hover:text-white hover:bg-[#1E1E1E]"
          >
            <X size={20} />
          </button>
        </div>

        {/* Host / Join Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#000000] border border-white/10 mb-5">
          <button
            type="button"
            onClick={() => {
              setActiveTab("host");
              setErrorMsg(null);
            }}
            className={`min-h-[40px] rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "host"
                ? "bg-[#FF5E4D] text-black"
                : "text-[#B3B3B3] hover:text-white"
            }`}
          >
            <Speaker size={15} />
            <span>Host Jam</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("join");
              setErrorMsg(null);
            }}
            className={`min-h-[40px] rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "join"
                ? "bg-[#FF5E4D] text-black"
                : "text-[#B3B3B3] hover:text-white"
            }`}
          >
            <Radio size={15} />
            <span>Join Jam</span>
          </button>
        </div>

        {errorMsg && (
          <div className="mb-4 px-3.5 py-2.5 rounded-lg bg-[#FF5E4D]/15 border border-[#FF5E4D]/50 text-xs font-semibold text-[#FF5E4D]">
            {errorMsg}
          </div>
        )}

        {/* ===================== HOST TAB ===================== */}
        {activeTab === "host" && (
          <div>
            {jamState.role === "host" && jamState.active ? (
              <div className="space-y-4">
                {/* 6-Digit Code Display Card */}
                <div className="rounded-xl bg-[#000000] border border-[#FF5E4D]/40 p-4 text-center">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-[#B3B3B3]">
                    Share 6-Digit Jam Code
                  </p>
                  <p className="text-4xl font-black tracking-[0.25em] text-[#FF5E4D] tabular-nums mt-1.5 pl-2">
                    {jamState.jamCode}
                  </p>
                  <div className="mt-3.5 flex items-center justify-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => void handleCopyCode()}
                      className="min-h-[38px] px-3.5 rounded-full bg-[#1E1E1E] hover:bg-white/15 text-xs font-bold text-white flex items-center gap-1.5 transition-colors"
                    >
                      {copiedCode ? (
                        <Check size={14} className="text-[#FF5E4D]" />
                      ) : (
                        <Copy size={14} />
                      )}
                      <span>{copiedCode ? "Copied" : "Copy"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleShareCode()}
                      className="min-h-[38px] px-3.5 rounded-full bg-[#1E1E1E] hover:bg-white/15 text-xs font-bold text-white flex items-center gap-1.5 transition-colors"
                    >
                      <Share2 size={14} />
                      <span>Share</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void leaveJamSession()}
                      className="min-h-[38px] px-3.5 rounded-full bg-[#FF5E4D]/15 hover:bg-[#FF5E4D]/25 border border-[#FF5E4D]/40 text-xs font-bold text-[#FF5E4D] transition-colors"
                    >
                      End Jam
                    </button>
                  </div>
                </div>

                {/* Audio Output Speakers Section */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-[#B3B3B3]">
                      Audio Output Speakers ({jamState.activeSpeakers.length}/
                      {jamState.participants.length})
                    </p>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={jamState.isMultiSpeakerMode}
                      onClick={() =>
                        void setJamMultiSpeakerMode(!jamState.isMultiSpeakerMode)
                      }
                      className="flex items-center gap-2 text-left"
                    >
                      <span className="text-[11px] font-semibold text-[#B3B3B3]">
                        Multi-Speaker Mode
                      </span>
                      <span
                        className={`w-10 h-5 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
                          jamState.isMultiSpeakerMode
                            ? "bg-[#FF5E4D]"
                            : "bg-[#1E1E1E] border border-white/10"
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded-full bg-black shadow transition-transform ${
                            jamState.isMultiSpeakerMode
                              ? "translate-x-5"
                              : "translate-x-0"
                          }`}
                        />
                      </span>
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {jamState.participants.map((p) => {
                      const isGuestLocked = !jamState.isMultiSpeakerMode && !p.isHost;
                      const enabled = isGuestLocked ? false : p.isSpeakerEnabled;
                      return (
                        <button
                          key={p.deviceAddress}
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          disabled={isGuestLocked}
                          onClick={() => handleToggleSpeaker(p.deviceAddress)}
                          className={`w-full min-h-[52px] px-3.5 py-2.5 rounded-xl bg-[#000000] border border-white/10 flex items-center justify-between gap-3 text-left transition-colors ${
                            isGuestLocked
                              ? "opacity-50 cursor-not-allowed"
                              : "hover:border-[#FF5E4D]/40"
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                                enabled
                                  ? "bg-[#FF5E4D] text-black"
                                  : "bg-[#1E1E1E] text-[#727272]"
                              }`}
                            >
                              {isGuestLocked ? (
                                <Lock size={16} />
                              ) : enabled ? (
                                <Volume2 size={17} />
                              ) : (
                                <VolumeX size={17} />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-white truncate">
                                {p.deviceName}{" "}
                                {p.isHost && (
                                  <span className="text-xs text-[#FF5E4D] font-semibold">
                                    (Host)
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] text-[#B3B3B3] truncate">
                                {isGuestLocked
                                  ? "Enable Multi-Speaker Mode to unlock"
                                  : enabled
                                  ? "Streaming audio in sync"
                                  : "Muted (control & queue only)"}
                              </p>
                            </div>
                          </div>

                          <span
                            className={`w-11 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
                              enabled ? "bg-[#FF5E4D]" : "bg-[#1E1E1E]"
                            }`}
                          >
                            <span
                              className={`w-5 h-5 rounded-full bg-black shadow transition-transform ${
                                enabled ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {renderSharedQueueAndSearch()}
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="jam-host-name"
                    className="block text-xs font-bold uppercase tracking-wider text-[#B3B3B3] mb-1.5"
                  >
                    Host Device Name
                  </label>
                  <input
                    id="jam-host-name"
                    type="text"
                    maxLength={24}
                    value={deviceNameInput}
                    onChange={(e) => setDeviceNameInput(e.target.value)}
                    placeholder="My Phone"
                    className="w-full h-11 px-3.5 rounded-lg bg-[#1E1E1E] text-sm text-white placeholder-[#727272] border border-white/10 focus:border-[#FF5E4D] focus:outline-none"
                  />
                </div>

                {jamState.role === "guest" && jamState.active ? (
                  <p className="text-xs text-[#B3B3B3]">
                    Leave your current Guest Jam in the Join tab to start hosting.
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleStartJam()}
                    className="w-full min-h-[48px] rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] disabled:opacity-50 text-black text-sm font-extrabold flex items-center justify-center gap-2 transition-colors"
                  >
                    {isBusy ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        <span>Starting BLE Host...</span>
                      </>
                    ) : (
                      <>
                        <Speaker size={18} />
                        <span>Start BLE Jam</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===================== JOIN TAB ===================== */}
        {activeTab === "join" && (
          <div>
            {jamState.role === "guest" && jamState.active ? (
              <div className="space-y-4">
                <div className="rounded-xl bg-[#000000] border border-white/10 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[#B3B3B3]">
                        Connected to Jam
                      </p>
                      <p className="text-2xl font-black tracking-[0.2em] text-[#FF5E4D] tabular-nums">
                        {jamState.jamCode}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void leaveJamSession()}
                      className="min-h-[38px] px-4 rounded-full bg-[#FF5E4D]/15 hover:bg-[#FF5E4D]/25 border border-[#FF5E4D]/40 text-xs font-bold text-[#FF5E4D]"
                    >
                      Leave Jam
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
                        jamState.isMultiSpeakerMode && isLocalSpeakerEnabled
                          ? "bg-[#FF5E4D] text-black"
                          : "bg-[#1E1E1E] text-[#B3B3B3]"
                      }`}
                    >
                      {jamState.isMultiSpeakerMode && isLocalSpeakerEnabled ? (
                        <Volume2 size={13} />
                      ) : (
                        <VolumeX size={13} />
                      )}
                      <span>
                        {!jamState.isMultiSpeakerMode
                          ? "Host Speaker Only"
                          : isLocalSpeakerEnabled
                          ? "Speaker Active"
                          : "Muted by Host"}
                      </span>
                    </span>

                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1E1E1E] text-xs font-semibold text-[#B3B3B3]">
                      <Bluetooth size={12} className="text-[#FF5E4D]" />
                      <span>
                        Clock Sync: {jamState.clockOffsetMs >= 0 ? "+" : ""}
                        {jamState.clockOffsetMs} ms
                      </span>
                    </span>
                  </div>
                </div>

                {renderSharedQueueAndSearch()}
              </div>
            ) : (
              <form onSubmit={handleJoinJam} className="space-y-4">
                <div>
                  <label
                    htmlFor="jam-guest-name"
                    className="block text-xs font-bold uppercase tracking-wider text-[#B3B3B3] mb-1.5"
                  >
                    Your Device Name
                  </label>
                  <input
                    id="jam-guest-name"
                    type="text"
                    maxLength={24}
                    value={deviceNameInput}
                    onChange={(e) => setDeviceNameInput(e.target.value)}
                    placeholder="Living Room Phone"
                    className="w-full h-11 px-3.5 rounded-lg bg-[#1E1E1E] text-sm text-white placeholder-[#727272] border border-white/10 focus:border-[#FF5E4D] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="jam-pin-input"
                    className="block text-xs font-bold uppercase tracking-wider text-[#B3B3B3] mb-1.5"
                  >
                    6-Digit Host PIN
                  </label>
                  <input
                    id="jam-pin-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={joinCodeInput}
                    onChange={(e) =>
                      setJoinCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    placeholder="000000"
                    className="w-full h-14 px-4 rounded-xl bg-[#000000] text-center text-2xl font-black tracking-[0.35em] text-[#FF5E4D] placeholder-[#404040] border border-white/15 focus:border-[#FF5E4D] focus:outline-none tabular-nums"
                  />
                </div>

                {jamState.role === "host" && jamState.active ? (
                  <p className="text-xs text-[#B3B3B3]">
                    End your current Host session before joining another phone.
                  </p>
                ) : (
                  <button
                    type="submit"
                    disabled={isBusy || joinCodeInput.length !== 6}
                    className="w-full min-h-[48px] rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] disabled:opacity-45 text-black text-sm font-extrabold flex items-center justify-center gap-2 transition-colors"
                  >
                    {isBusy ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        <span>Scanning via BLE...</span>
                      </>
                    ) : (
                      <>
                        <Radio size={18} />
                        <span>Scan &amp; Join Jam</span>
                      </>
                    )}
                  </button>
                )}
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
