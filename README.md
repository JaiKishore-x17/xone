# Xone

**Xone** is an ad-free, local-first personal music streaming web application designed with a high-contrast **Black (`#000000` / `#121212` / `#181818`) & Hyper Coral (`#FF5E4D`)** interface.

---

## Architecture

- **Frontend (`/frontend`)**: React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons, Zustand state store, browser Media Session API, keyboard shortcuts, and smart next-track standby prefetching.
- **Backend (`/backend`)**: Python 3.11+, FastAPI, Uvicorn, `ytmusicapi`, `yt-dlp`, `httpx`, and SQLite (`aiosqlite` -> `backend/xone.db`).

### Key Engineering Highlights

1. **Clean "Original Track Only" Search (`GET /api/search?q=...`)**
   - Queries `ytmusicapi` unauthenticated with `filter="songs"` (`limit=20`) alongside a `limit=5` general query for the `Top result` hero card.
   - Prefers `MUSIC_VIDEO_TYPE_ATV` (Audio Track Video) results when available.
   - Filters out noise keywords (`remix`, `live`, `sped up`, `slowed`, `reverb`, `cover`, `karaoke`, `instrumental`, `8d audio`) unless explicitly requested in the query.
   - Deduplicates tracks by `(normalized_base_title, primary_artist)`.

2. **Zero-Delay Direct Audio Streaming & Byte-Range Proxy**
   - `GET /api/stream/{video_id}` extracts audio-only streams (`bestaudio[acodec=opus]/bestaudio/best`, `download=False`) strictly unauthenticated without cookies.
   - 4-hour in-memory TTL cache resolves repeat plays and queue jumps in `<5ms`.
   - `GET /api/proxy/{video_id}` streams upstream bytes asynchronously via `httpx` with full `Range` header forwarding (`206 Partial Content`) for instant HTML5 `<audio>` scrubbing and automatic 1-time refresh recovery on expired/403 URLs.

3. **Data-Conscious Smart Prefetching**
   - Never prefetches search result lists.
   - Automatically warms and preloads **only Track N+1** in the active queue into a standby `Audio()` instance after Track N passes **15 seconds** of playback.

4. **Local SQLite Library (`backend/xone.db`)**
   - Full CRUD for playlists (`GET/POST/DELETE /api/playlists`), playlist tracks (`POST/DELETE /api/playlists/{id}/tracks`, `PUT /api/playlists/{id}/tracks/reorder`), and Liked Songs (`GET /api/likes`, `POST /api/likes/{video_id}`).

5. **OS & Keyboard Controls**
   - Native `navigator.mediaSession` metadata and action handlers (hardware media keys, lock screen, Bluetooth controls).
   - `Space` (Play/Pause), `ArrowLeft` / `ArrowRight` (Seek ±5s), `Ctrl/Cmd + K` (Focus search).

---

## Setup & Running Locally

### 1. Backend (`/backend`)

```bash
cd backend
python -m venv .venv
# Windows PowerShell:
.\.venv\Scripts\Activate.ps1
# macOS/Linux:
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

The backend API will run at `http://127.0.0.1:8000` (health check: `http://127.0.0.1:8000/api/health`).

### 2. Frontend (`/frontend`)

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. Vite proxies `/api/*` requests directly to `http://127.0.0.1:8000`.
