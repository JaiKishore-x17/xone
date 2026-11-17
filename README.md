# Xone

**Xone** is a standalone, local-first personal music player for Android designed with a pure **OLED Black & Hyper Coral** interface. Built with Capacitor, React, and native Kotlin audio services, it runs completely on-device with zero external servers required.

---

## Features

- **Pure OLED Dark UI**: Seamless edge-to-edge system bars, notch blending, ambient gradient accents, and a full-screen Now Playing sheet.
- **Original Studio Track Search**: Filters out unofficial uploads, remixes, covers, slowed/reverb edits, and lyric videos to surface clean studio tracks and high-resolution cover art.
- **Background & Lock-Screen Playback**: Powered by native Android Media3 (`ExoPlayer` + `MediaSessionService`) for uninterrupted background audio, lock-screen media controls, seek-bar scrubbing, automatic call/audio-focus handling, and Bluetooth headset support.
- **Offline Downloads**: Save any track directly to internal storage using chunked byte-range streaming for reliable, instant offline playback in airplane mode.
- **Zero-Server BLE Jam & Multi-Speaker Sync**: Host or join local listening sessions using a 6-digit PIN over Bluetooth Low Energy (BLE). Guests can add songs to the shared looping queue, and the host can select multiple connected phones to act as synchronized wireless speakers.
- **On-Device Library & Autoplay Radio**: Create and reorder custom playlists, manage Liked Songs, and discover similar tracks automatically through vibe-matched radio queues—all stored locally in IndexedDB.

---

## Architecture

- **UI Layer**: React 18, TypeScript, Vite, Tailwind CSS, Zustand, and Lucide Icons.
- **Mobile Bridge & Storage**: Capacitor for Android (`com.xone.music`) with local IndexedDB persistence for playlists, liked tracks, and offline download metadata.
- **Native Android Engine (Kotlin)**:
  - **Media3 Playback Service**: Hardware-accelerated background audio service with wake-lock management, audio-focus ducking, and local file resolution.
  - **On-Device Stream & Metadata Resolver**: Direct client-side track discovery, radio queue generation, and cached audio stream resolution.
  - **BLE Jam Manager**: Custom BLE GATT profile handling 6-digit session discovery, shared queue synchronization, and clock-offset calibration across active speaker devices.

---

## Building the Android APK

1. **Install Dependencies & Build Web Assets**
   Navigate to the `frontend` directory, install Node packages, and generate the production web bundle (`npm install` followed by `npm run build`).

2. **Sync with Capacitor**
   Sync the compiled web assets and native plugins into the Android project (`npx cap sync android`).

3. **Compile the APK**
   Open the `frontend/android` folder in Android Studio (or run the Gradle wrapper task `assembleDebug` with JDK 21) to generate the installable APK at `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.

---

## Disclaimer

Xone is a personal passion project built for private, non-commercial use. No copyrighted media is hosted or distributed by this repository.

## License

This project is licensed under the **GNU General Public License v3.0 (GPL-3.0)** — see the [LICENSE](LICENSE) file for details.
