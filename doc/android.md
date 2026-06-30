# Mobile App (Android & iOS) — Feasibility & Options

Can LyndonLLM ship as a mobile app? **Yes — as a Tauri v2 thin client to a hosted backend**, on both Android and iOS. This doc explains why, what already helps, what a build requires, and how to run it locally on a Mac. The same app code targets both platforms; the differences are toolchain + per-OS network/permission config (covered in the run guides below).

---

## Current architecture (why this matters)

```
Android phone                         Hosted server / your machine
┌───────────────────┐                 ┌──────────────────────────────┐
│ React SPA          │   REST + SSE    │ FastAPI backend (:8000)       │
│ (Tauri v2 webview) │ ──────────────▶ │  ├── SQLite                   │
│  JWT Bearer auth   │   WebSocket     │  └── ChromaDB (:8001)         │
└───────────────────┘                 │ LLM/embeddings server (:52415)│
                                       │  (EXO / Ollama)               │
                                       └──────────────────────────────┘
```

The frontend is a pure web SPA; the **heavy lifting is all backend-side** (PyTorch via `open-clip-torch`, `faster-whisper`, ChromaDB, and a separate local LLM server). None of that can reasonably run on a phone — so the Android app must be the **frontend only**, pointing at a backend hosted on a server or your own machine.

---

## Verdict

**Feasible as a hosted-backend thin client.** On-device execution is impractical: `open-clip-torch` alone pulls in PyTorch (>1 GB, hard to cross-compile for ARM64), and the app expects an external LLM/embedding server at `:52415`. The phone runs the UI; everything else stays hosted.

---

## Already in our favor

- **Mobile entrypoint exists.** `desktop/src-tauri/src/lib.rs` already has `#[cfg_attr(mobile, tauri::mobile_entry_point)]` — the Tauri v2 mobile hook is in place.
- **Web SPA + JWT.** The frontend is a webview app and auth is JWT Bearer (`frontend/src/api/client.ts` `authHeader()`), which works unchanged against a remote backend. CORS is configurable backend-side.
- **Localized & responsive-ish.** UI is en/zh localized and largely flow-based.

---

## What a hosted-backend Android build needs (Path A)

App-side changes — **implemented** (✅):

1. ✅ **Configurable backend URL (the crux).** `frontend/src/api/client.ts` no longer hard-codes
   the host — `apiBase()` reads a user override from the store (Settings → AI & Chat → **Backend
   URL**, persisted via `apiBaseUrl`), falling back to the desktop default. On Android `localhost`
   is the *phone itself*, so you point this at the host (e.g. `http://10.0.2.2:8000`). Chat uses
   **SSE over fetch**, so there's no separate WebSocket base to configure.
2. ✅ **CSP broadened.** `desktop/src-tauri/tauri.conf.json` `connect-src`/`img-src` now allow any
   `http:`/`https:`/`ws:`/`wss:` origin so the configured backend is reachable.
3. ✅ **Mobile feature scoping.** New `frontend/src/lib/platform.ts` exposes `IS_DESKTOP`
   (`IS_TAURI && !IS_MOBILE`). Cowork/Code mode tabs and the Code tool group are now gated on
   `IS_DESKTOP`, so on Android the app is **Chat-first** (Chat + Knowledge + Voice + Scheduled
   Tasks). Cowork/Code (local filesystem, `desktop_control`) stay desktop-only.

Environment work — **you do this on your machine** (see the run guide below):

4. **Android target tooling.** Install Android SDK/NDK + JDK 17, add the Rust Android targets, and
   run `tauri android init` (generates `desktop/src-tauri/gen/android`). Not committed — it's a
   generated, machine-specific project.
5. **Cleartext (dev) or HTTPS (prod).** Android blocks cleartext HTTP by default. For LAN dev,
   enable `android:usesCleartextTraffic` in the generated manifest; for a real deployment, host the
   backend behind **HTTPS**.
6. **Backend hosting.** Run the existing stack (`docker-compose.yml`: backend + ChromaDB) plus the
   LLM/embedding server, reachable from the phone — on your Mac (LAN/emulator) or a server.

---

## Options

| Option | What it is | Effort | Trade-offs |
|---|---|---|---|
| **A — Tauri v2 Android thin client** (recommended) | Reuse the existing frontend + mobile entrypoint; point it at a hosted backend | ~1–2 weeks | Real installable APK / Play Store possible; needs Android tooling + the URL/CSP/TLS work |
| **B — PWA** (fastest stopgap) | Serve the SPA over HTTPS pointing at the hosted backend; "Add to Home Screen" | ~same day | Near-zero native tooling; no Play Store, slightly less native feel |
| **C — On-device / native rewrite** | Embed Python (PyO3) or port inference to Rust + ONNX with a small quantized LLM | months | True offline; loses the Python ecosystem and desktop code-sharing — not recommended now |

Options A and B share the same prerequisite: a **configurable backend URL + HTTPS hosting**. Build that first regardless of which path you pick.

---

## Recommendation

Lead with **Option A** for a shippable Android app. Consider **Option B (PWA)** as a same-day stopgap — it needs only the configurable-URL change plus HTTPS hosting, both of which Path A requires anyway.

---

## Running an Android build on your Mac

The app-side changes (above) are committed. The remaining steps install the Android toolchain and run the app against the LyndonLLM backend on your Mac. Targets the latest stable Android (API 35 / Android 15+).

### 1. One-time toolchain install

```bash
# Rust Android targets (rustup)
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# JDK 17 (Android Gradle Plugin needs 17 — newer JDKs can break the build)
brew install openjdk@17
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
```

Install **Android Studio**, then in its **SDK Manager** install: *SDK Platform* (latest, API 35), *Android SDK Platform-Tools*, *NDK (Side by side)*, and *CMake*. Then set:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/$(ls "$ANDROID_HOME/ndk" | sort -V | tail -1)"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

(Put the four `export`s in your `~/.zshrc`.) Create an emulator in Android Studio's **Device Manager** (a Pixel + latest API system image), or plug in a physical device with USB debugging on.

### 2. Generate the Android project

```bash
cd desktop
npx tauri android init      # creates desktop/src-tauri/gen/android (machine-specific; not committed)
```

For LAN/dev over plain HTTP, allow cleartext: in `desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml` add to the `<application>` tag:

```xml
android:usesCleartextTraffic="true"
```

For microphone (voice-to-text), add inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
```

### 3. Start the backend on your Mac

```bash
# LLM/embedding server (EXO/Ollama) must be running on :52415, then:
cd backend
.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` lets the emulator/device reach it. Make sure `CORS_ORIGINS` allows the app origin (the Tauri webview origin) or is permissive for local dev.

### 4. Run on the emulator/device

```bash
cd desktop
npx tauri android dev       # builds, installs, and launches on the running emulator/device
```

### 5. Point the app at the backend

In the app: **Settings → AI & Chat → Backend URL** →
- **Emulator:** `http://10.0.2.2:8000` (the emulator's alias for the Mac's loopback).
- **Physical device (same Wi-Fi):** `http://<your-mac-LAN-ip>:8000`.

Then register/log in and start chatting. Cowork/Code are hidden on Android; Chat, Knowledge, Voice, and Scheduled Tasks work.

### 6. Build an installable APK (optional)

```bash
cd desktop
npx tauri android build --apk      # output under desktop/src-tauri/gen/android/app/build/outputs/apk/
```

A debug APK is fine for personal use; a Play Store release needs a signing keystore (configure in the generated Gradle project) and an **HTTPS** backend (drop the cleartext flag).

---

## Running an iOS build on your Mac

Same app code, same configurable Backend URL. iOS-specific differences: Xcode toolchain, WKWebView's App Transport Security (ATS), and simulator networking.

### 1. One-time toolchain

> **You must install the full Xcode app, not just the Command Line Tools.** `xcode-select --install` only installs the CLT, which lacks `simctl` and fails iOS builds with `xcrun: error: unable to find utility "simctl"` (exit code 72).

```bash
# 1) Install Xcode from the Mac App Store (large download), then point the
#    toolchain at it and finish first-launch setup:
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -runFirstLaunch
# Open Xcode once → Settings → Components (or Platforms) → install an iOS Simulator runtime.

# 2) Make sure Rust/cargo is on your shell PATH (Tauri shells out to `cargo`):
echo '. "$HOME/.cargo/env"' >> ~/.zshrc
. "$HOME/.cargo/env"

# 3) CocoaPods + Rust iOS targets (device + simulator):
brew install cocoapods
rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
```

### 2. Generate the iOS project

```bash
cd desktop
npx tauri ios init          # creates desktop/src-tauri/gen/apple (Xcode project; machine-specific, not committed)
```

In the generated `desktop/src-tauri/gen/apple/<app>_iOS/Info.plist` add:

```xml
<!-- Allow plain-HTTP to localhost / LAN during dev (WKWebView blocks cleartext by default) -->
<key>NSAppTransportSecurity</key>
<dict><key>NSAllowsLocalNetworking</key><true/></dict>
<!-- Microphone for voice-to-text -->
<key>NSMicrophoneUsageDescription</key>
<string>LyndonLLM uses the microphone to transcribe your speech into the message box.</string>
```

### 3. Start the backend (same as Android)

```bash
cd backend
.venv/bin/uvicorn api.main:app --host 0.0.0.0 --port 8000
```

### 4. Run on the simulator/device

```bash
cd desktop
npx tauri ios dev           # builds and launches on the iOS Simulator (or a connected device)
```

### 5. Point the app at the backend

**Settings → AI & Chat → Backend URL** →
- **iOS Simulator:** `http://localhost:8000` — the simulator shares the Mac's network, so loopback reaches your backend directly (no `10.0.2.2` equivalent needed).
- **Physical iPhone/iPad (same Wi-Fi):** `http://<your-mac-LAN-ip>:8000`.

Then log in and chat. Cowork/Code are hidden on iOS too; Chat, Knowledge, Voice, and Scheduled Tasks work.

### 6. Device & release notes

- The **Simulator needs no signing**. A **physical device** needs a development team: open `gen/apple/*.xcodeproj` in Xcode once and select your (free) Apple ID team under *Signing & Capabilities*, or run `npx tauri ios build`.
- An App Store / TestFlight release needs a paid Apple Developer account and an **HTTPS** backend (drop the ATS exception).

---

## Verification

- Frontend: `cd frontend && npx tsc --noEmit && npx eslint . --ext ts,tsx --max-warnings 0` (done for the app-side changes).
- Android: `tauri android init` + `tauri android dev` launch the app; **Backend URL** = `http://10.0.2.2:8000`, login yields a working chat round-trip; voice + scheduled tasks work; Cowork/Code tabs absent.
- iOS: `tauri ios init` + `tauri ios dev` launch on the Simulator; **Backend URL** = `http://localhost:8000`, login yields a working chat round-trip; voice + scheduled tasks work; Cowork/Code tabs absent.
