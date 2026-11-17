# Xone

**Xone** is a standalone, local-first music streaming and audio playback application for Android. Built with Capacitor, React, and native Kotlin Media3 services, it runs entirely on-device with zero external backend servers required.

---

## Key Features

- **Clean Studio Track Search**: Filters out unofficial uploads, remixes, covers, slowed/reverb edits, and lyric videos to surface original studio tracks and metadata.
- **Background & Lock-Screen Playback**: Powered by native AndroidX Media3 (`ExoPlayer` + `MediaSessionService`) for uninterrupted background audio, lock-screen media controls, seek-bar scrubbing, automatic audio-focus handling, and Bluetooth headset support.
- **Real-Time Audio DSP (`8D` & `SR`)**: Live on-device PCM audio processing inside the Media3 pipeline—featuring spatial LFO auto-panning (`8D` mode) and real-time tempo/pitch adjustment paired with stereo reverb (`SR` / Slowed + Reverb mode) with zero extra downloads.
- **Public Folder Offline Downloads**: Saves tracks directly to the device's public `Music/Xone/` directory via chunked byte-range streaming for reliable offline playback in airplane mode, complete with an in-app folder shortcut.
- **Zero-Server BLE Jam & Multi-Speaker Sync**: Host or join local listening sessions using a 6-digit PIN over Bluetooth Low Energy (BLE). Guests can add tracks to a shared looping queue, with default Host-only audio output and an optional Multi-Speaker Mode that synchronizes playback across multiple devices using two-phase buffered starts and clock-offset calibration.
- **On-Device Library & Autoplay Radio**: Create and reorder custom playlists, manage Liked Songs, and generate vibe-matched radio queues automatically—persisted locally in IndexedDB.

---

## Architecture

- **Frontend Layer**: React 18, TypeScript, Vite, Tailwind CSS, and Zustand.
- **Mobile Bridge & Persistence**: Capacitor for Android (`com.xone.music`) with local IndexedDB storage for playlists, liked tracks, and offline library state.
- **Native Android Engine (Kotlin)**:
  - **Media3 Playback Service**: Hardware-accelerated background audio service with wake-lock management, audio-focus ducking, and local `MediaStore` file resolution.
  - **Real-Time PCM Audio Processor**: Custom Media3 `AudioProcessor` handling spatial 8D panning and Schroeder stereo reverb in real time.
  - **On-Device Stream & Metadata Resolver**: Client-side track discovery, radio queue generation, and cached stream resolution.
  - **BLE Jam Manager**: Custom BLE GATT profile handling 6-digit session discovery, shared queue state, and median clock-offset synchronization across speaker devices.

---

## Building from Source

1. **Install Dependencies & Build Web Assets**
   Navigate to the `frontend` directory, install Node packages, and generate the production web bundle (`npm install` followed by `npm run build`).

2. **Sync with Capacitor**
   Sync the compiled web assets and native plugins into the Android project (`npx cap sync android`).

3. **Compile the APK**
   Open the `frontend/android` directory in Android Studio (or run the Gradle wrapper task `assembleDebug` with JDK 21) to generate the installable APK.

---

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** — see the [LICENSE](LICENSE) file for details.

## Disclaimer

Xone is a personal passion project built for private, non-commercial use. No copyrighted media is hosted or distributed by this repository.
