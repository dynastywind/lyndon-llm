# Transcription Module

**Path**: `backend/core/transcription/`
**Purpose**: Local speech-to-text for the voice-input feature. Powers the mic button in every chat/cowork/code composer — the browser records audio, posts it here, and gets back text that's inserted into the message box.

---

## Key Files

| File | Role |
|---|---|
| `core/transcription/whisper.py` | `Transcriber` — lazily-loaded `faster-whisper` singleton |
| `api/routes/transcribe.py` | `POST /api/transcribe/` endpoint (multipart audio) |

Runs fully **on-device / offline** — no external STT service, matching the app's local-first design.

---

## How It Works

```
Browser (MediaRecorder) ── audio blob ──▶ POST /api/transcribe/  (multipart: file, language?)
                                                │
                                                ▼
                                   Transcriber.transcribe(bytes, language)
                                     • lazy-load WhisperModel on first use
                                     • decode via PyAV (handles webm/opus, mp4)
                                     • run in a worker thread (asyncio.to_thread)
                                     • VAD-filtered → joined segment text
                                                │
                                                ▼
                                       { "text": "…" }  ──▶ inserted into the composer
```

- The model is loaded (and downloaded on first ever run) **lazily**, so it never adds to server start-up time; the first request is slow, subsequent ones are fast.
- `language` is an optional hint (`"en"` / `"zh"`), passed from the current UI language for better accuracy.
- The endpoint uses `get_optional_user` (anonymous-friendly, like chat) and caps upload size (25 MB).

---

## Text-to-Speech (client side)

The complementary "read aloud" on assistant messages is **frontend-only** — it uses the browser `SpeechSynthesis` API with the OS voices (auto-selecting the best voice for English/Chinese), so there's no backend TTS. See `frontend/src/hooks/useSpeech.ts` and `useAudioRecorder.ts`.

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `transcription_enabled` | `True` | Toggle the endpoint |
| `whisper_model` | `"base"` | `tiny` \| `base` \| `small` \| `medium` \| `large-v3` |
| `whisper_device` | `"cpu"` | `cpu` \| `cuda` |
| `whisper_compute_type` | `"int8"` | `int8` (cpu) \| `float16` (gpu) |

---

## Integration Points

| Dependency | Used for |
|---|---|
| `faster-whisper` (CTranslate2 + PyAV) | Model inference + audio decoding |
| `api/main.py` | Router registration (`/api/transcribe`) |
| Frontend `useAudioRecorder` + `transcribeAudio()` | Record + upload from the composer |
