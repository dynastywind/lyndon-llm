# Desktop — Overview

**Path**: `desktop/`
**Purpose**: Tauri v2 wrapper that packages the React frontend as a native macOS application (`.app` bundle / `.dmg` installer).

---

## What It Is

The desktop app is a **thin shell** around the React SPA. There is no custom Rust business logic — the Rust entry point (`lib.rs`) is 7 lines. All application logic lives in the FastAPI backend and the React frontend.

Tauri provides:
- A native WebView (WKWebView on macOS) rendering the React SPA
- A native window with configurable dimensions
- The `tauri-plugin-opener` for opening URLs and files with the system default handler
- `.app` + `.dmg` packaging for macOS distribution

---

## Key Files

| File | Role |
|---|---|
| `desktop/src-tauri/tauri.conf.json` | Tauri app configuration |
| `desktop/src-tauri/src/lib.rs` | Rust entry point — initialises Tauri + opener plugin |
| `desktop/src-tauri/src/main.rs` | Binary entry point — prevents Windows console, calls `lib::run()` |
| `desktop/src-tauri/build.rs` | Tauri build script (minimal) |
| `desktop/src-tauri/Cargo.toml` | Rust dependencies |
| `desktop/src-tauri/capabilities/default.json` | Security ACL for the main window |
| `desktop/src-tauri/icons/` | App icons (macOS `.icns`, Windows `.ico`, PNG variants) |

---

## `tauri.conf.json` — Key Settings

```json
{
  "productName": "LyndonLLM",
  "version": "0.1.0",
  "identifier": "com.lyndon.llm",
  "build": {
    "beforeDevCommand": "npm --prefix ../frontend run dev",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "npm --prefix ../frontend run build",
    "frontendDist": "../../frontend/dist"
  },
  "app": {
    "windows": [{
      "title": "LyndonLLM",
      "width": 1280, "height": 860,
      "minWidth": 900, "minHeight": 600,
      "resizable": true, "fullscreen": false
    }]
  },
  "bundle": {
    "targets": ["dmg", "app"],
    "macOS": { "minimumSystemVersion": "13.0" }
  }
}
```

---

## Content Security Policy

The CSP allows the WebView to connect to the local backend:

```
connect-src 'self' http://localhost:8000 ws://localhost:8000;
```

All other external origins are blocked. This means the frontend cannot make requests to any URL other than the local backend — appropriate for a local-first app.

---

## Security Capabilities

`capabilities/default.json` grants the main window:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",       // standard Tauri APIs (window, events, etc.)
    "opener:default"      // open URLs/files with system default handler
  ]
}
```

No filesystem, shell, or dialog capabilities are granted — the app does not need them because all such operations go through the backend API.

---

## Build Workflow

### Development

```bash
cd desktop
npm run tauri dev
# Runs: "npm --prefix ../frontend run dev" first
# Then opens a native window pointed at http://localhost:5173
# Hot-reload works — changes in frontend/src reload instantly in the window
```

### Production Build

```bash
cd desktop
npm run tauri build
# Runs: "npm --prefix ../frontend run build" first
# Packages frontend/dist into the .app bundle
# Output: desktop/src-tauri/target/release/bundle/
#   macos/LyndonLLM.app
#   dmg/LyndonLLM_0.1.0_aarch64.dmg
```

### Prerequisites

- Rust toolchain (stable)
- Xcode Command Line Tools (macOS)
- Node.js (for frontend build)

---

## Tauri Detection in the Frontend

The React SPA detects it is running inside Tauri via:

```typescript
const IS_TAURI = Boolean((window as any).__TAURI_INTERNALS__)
```

When `IS_TAURI` is true:
- `BASE` URL resolves to `http://localhost:8000/api` (full URL, no Vite proxy)
- `Sidebar` may show Tauri-specific UI elements (e.g. native window drag region)

---

## Platform Notes

| Platform | Status | Bundle target |
|---|---|---|
| macOS (Apple Silicon / Intel) | Primary | `.app`, `.dmg` |
| Windows | Configured (Cargo.toml) | Not tested |
| Linux | Not configured | — |

Minimum macOS version: **13.0 (Ventura)**

---

## Rust Dependencies (`Cargo.toml`)

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

No custom Tauri commands are defined — the Rust code does nothing beyond initialising the Tauri builder and attaching the opener plugin.
