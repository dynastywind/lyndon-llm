# Android App — Feasibility & Options

Can LyndonLLM ship as an Android app? **Yes — as a thin client to a hosted backend.** This doc explains why, what already helps, what a build would require, and the realistic options.

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

1. **Configurable backend URL (the crux).** `frontend/src/api/client.ts` hard-codes
   `BASE = IS_TAURI ? 'http://localhost:8000/api' : '/api'`. On Android, `localhost` is the
   *phone itself*, so this must become a **runtime-configurable base URL** (first-run/Settings
   field or build-time env), persisted in the store, and used for **both REST and the
   WebSocket/SSE URLs** (`ws://…` stream resume).
2. **CSP + cleartext.** `desktop/src-tauri/tauri.conf.json` `connect-src` whitelists only
   `http://localhost:8000` — it must allow the configured backend origin. Android **blocks
   cleartext HTTP by default**, so the backend should be **HTTPS** (recommended), or a LAN-only
   build needs an Android network-security-config exception.
3. **Android target tooling.** Install Android SDK/NDK + JDK, run `tauri android init`
   (generates `desktop/src-tauri/gen/android`), add an `android` bundle target, and set up a
   signing keystore. `bundle.targets` is macOS-only today.
4. **Backend hosting.** Deploy the existing stack (`docker-compose.yml`: backend + ChromaDB) on a
   reachable host with the LLM/embedding server reachable from it, behind HTTPS. "Connect to my
   own machine" also works (LAN IP or a tunnel like Tailscale / Cloudflare Tunnel) with the same
   URL-config + TLS caveats.
5. **Mobile feature scoping.** Chat, RAG/knowledge, voice (`getUserMedia` works in the Android
   webview), and Scheduled Tasks map cleanly to mobile. **Cowork/Code modes are desktop-bound**
   (local filesystem, `desktop_control`/`os_control`, directory pickers, desktop `IS_TAURI`
   gating) — gate these off on Android and treat it as a Chat-first companion.

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

## Verification (for a future Path-A build — out of scope of this doc)

`tauri android init` succeeds; an APK installs on a device/emulator; the in-app backend-URL field points at the hosted HTTPS backend; login + a chat round-trip works; voice and scheduled tasks function; Cowork/Code are hidden on Android.
