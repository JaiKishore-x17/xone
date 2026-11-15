import React from "react";
import {
  Heart,
  Home,
  Library,
  ListMusic,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { usePlayerStore } from "../store/usePlayerStore";
import { XoneLogo } from "./XoneLogo";

export const Sidebar: React.FC = () => {
  const activeView = usePlayerStore((s) => s.activeView);
  const playlists = usePlayerStore((s) => s.playlists);
  const likedSongs = usePlayerStore((s) => s.likedSongs);
  const queue = usePlayerStore((s) => s.queue);
  const navigate = usePlayerStore((s) => s.navigate);
  const setNewPlaylistModalOpen = usePlayerStore((s) => s.setNewPlaylistModalOpen);
  const deletePlaylist = usePlayerStore((s) => s.deletePlaylist);

  return (
    <aside className="hidden md:flex w-[260px] shrink-0 flex-col gap-2 h-full select-none bg-black">
      {/* Top Navigation Card */}
      <div className="bg-[#121212] rounded-lg px-3 py-4 flex flex-col gap-1">
        <button
          type="button"
          onClick={() => navigate({ type: "home" })}
          className="flex items-center gap-2.5 px-3 pb-3 mb-1 text-left group"
        >
          <XoneLogo
            size={30}
            className="transition-transform duration-200 group-hover:scale-105"
          />
          <div className="flex flex-col">
            <span className="text-[20px] font-extrabold tracking-tight text-white leading-none">
              Xone
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#FF5E4D] mt-0.5">
              Direct Audio
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate({ type: "home" })}
          className={`flex items-center gap-4 px-3 py-2.5 rounded-md font-semibold text-sm transition-colors relative ${
            activeView.type === "home"
              ? "text-white bg-[#282828]/70"
              : "text-[#B3B3B3] hover:text-white"
          }`}
        >
          {activeView.type === "home" && (
            <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[#FF5E4D]" />
          )}
          <Home
            size={21}
            className={activeView.type === "home" ? "text-[#FF5E4D]" : ""}
          />
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
          className={`flex items-center gap-4 px-3 py-2.5 rounded-md font-semibold text-sm transition-colors relative ${
            activeView.type === "search"
              ? "text-white bg-[#282828]/70"
              : "text-[#B3B3B3] hover:text-white"
          }`}
        >
          {activeView.type === "search" && (
            <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[#FF5E4D]" />
          )}
          <Search
            size={21}
            className={activeView.type === "search" ? "text-[#FF5E4D]" : ""}
          />
          <span>Search</span>
        </button>

        <button
          type="button"
          onClick={() => navigate({ type: "queue" })}
          className={`flex items-center justify-between px-3 py-2.5 rounded-md font-semibold text-sm transition-colors relative ${
            activeView.type === "queue"
              ? "text-white bg-[#282828]/70"
              : "text-[#B3B3B3] hover:text-white"
          }`}
        >
          {activeView.type === "queue" && (
            <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[#FF5E4D]" />
          )}
          <div className="flex items-center gap-4">
            <ListMusic
              size={21}
              className={activeView.type === "queue" ? "text-[#FF5E4D]" : ""}
            />
            <span>Active Queue</span>
          </div>
          {queue.length > 0 && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#282828] text-[#FF5E4D]">
              {queue.length}
            </span>
          )}
        </button>
      </div>

      {/* Your Library & Playlists Card */}
      <div className="bg-[#121212] rounded-lg flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-[#B3B3B3]">
            <Library size={20} />
            <span className="font-bold text-sm tracking-tight text-white">
              Your Library
            </span>
          </div>
          <button
            type="button"
            onClick={() => setNewPlaylistModalOpen(true)}
            title="New Playlist"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-[#181818] hover:bg-[#282828] text-xs font-semibold text-[#B3B3B3] hover:text-[#FF5E4D] transition-colors"
          >
            <Plus size={15} />
            <span>New Playlist</span>
          </button>
        </div>

        {/* Scrollable Library List */}
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
          {/* Liked Songs Shortcut */}
          <button
            type="button"
            onClick={() => navigate({ type: "likes" })}
            className={`w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors ${
              activeView.type === "likes"
                ? "bg-[#282828]"
                : "hover:bg-[#181818]"
            }`}
          >
            <div
              className="w-12 h-12 rounded-md shrink-0 flex items-center justify-center shadow-md"
              style={{
                background:
                  "linear-gradient(135deg, #FF5E4D 0%, #9E1B12 65%, #3B0704 100%)",
              }}
            >
              <Heart size={20} className="text-white fill-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-semibold truncate ${
                  activeView.type === "likes" ? "text-[#FF5E4D]" : "text-white"
                }`}
              >
                Liked Songs
              </p>
              <p className="text-xs text-[#B3B3B3] truncate">
                Playlist • {likedSongs.length}{" "}
                {likedSongs.length === 1 ? "song" : "songs"}
              </p>
            </div>
          </button>

          {/* User Playlists */}
          {playlists.length === 0 ? (
            <div className="mt-4 mx-2 p-4 rounded-lg bg-[#181818] border border-white/5">
              <p className="text-sm font-bold text-white">
                Create your first playlist
              </p>
              <p className="text-xs text-[#B3B3B3] mt-1 leading-relaxed">
                Organize studio tracks locally in SQLite with drag-and-drop ordering.
              </p>
              <button
                type="button"
                onClick={() => setNewPlaylistModalOpen(true)}
                className="mt-3 px-4 py-1.5 rounded-full bg-[#FF5E4D] hover:bg-[#FF7466] text-black text-xs font-bold transition-colors"
              >
                Create playlist
              </button>
            </div>
          ) : (
            playlists.map((pl) => {
              const isSelected =
                activeView.type === "playlist" && activeView.playlistId === pl.id;
              return (
                <div
                  key={pl.id}
                  className={`group flex items-center gap-3 p-2 rounded-md transition-colors ${
                    isSelected ? "bg-[#282828]" : "hover:bg-[#181818]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => navigate({ type: "playlist", playlistId: pl.id })}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
                  >
                    <div
                      className="w-12 h-12 rounded-md shrink-0 overflow-hidden flex items-center justify-center shadow"
                      style={{
                        background:
                          pl.thumbnails.length === 0
                            ? `linear-gradient(135deg, ${pl.cover_color} 0%, #181818 100%)`
                            : "#181818",
                      }}
                    >
                      {pl.thumbnails.length >= 4 ? (
                        <div className="grid grid-cols-2 grid-rows-2 w-full h-full">
                          {pl.thumbnails.slice(0, 4).map((thumb, idx) => (
                            <img
                              key={idx}
                              src={thumb}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                          ))}
                        </div>
                      ) : pl.thumbnails.length > 0 ? (
                        <img
                          src={pl.thumbnails[0]}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <ListMusic size={20} className="text-white/90" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-semibold truncate ${
                          isSelected ? "text-[#FF5E4D]" : "text-white"
                        }`}
                      >
                        {pl.name}
                      </p>
                      <p className="text-xs text-[#B3B3B3] truncate">
                        Playlist • {pl.track_count}{" "}
                        {pl.track_count === 1 ? "song" : "songs"}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deletePlaylist(pl.id);
                    }}
                    title="Delete playlist"
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full text-[#B3B3B3] hover:text-[#FF5E4D] hover:bg-black/40 transition-all"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
};
