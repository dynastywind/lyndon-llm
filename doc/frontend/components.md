# Frontend Components

**Path**: `frontend/src/components/`
**Purpose**: Component inventory — purpose, key props, and notable patterns for each component.

---

## Chat

### `ChatWindow`
The main chat interface (~3000 lines). Handles the full message rendering pipeline.

**Key responsibilities:**
- Renders `sessionMessages[sessionId]` as a scrollable message list
- Each `Message` renders as a bubble: `user`, `assistant` (with Markdown + tool calls), or `tool`
- `ToolCallRecord` badges show tool name, status (running/done/error), and a collapsible preview
- Fenced ` ```chart ` blocks in assistant content are parsed and rendered via Recharts
- Fenced ` ```code ` blocks use `react-syntax-highlighter`
- Math (KaTeX) via `rehype-katex` + `remark-math` plugins on `ReactMarkdown`
- `ChartErrorBoundary` wraps chart renders to catch invalid spec errors
- File attachment area: drag-drop or click to add images/PDFs; Base64 encoded before send
- Auto-scroll: `bumpScrollToBottom` increments `scrollToBottomTick`, which triggers a `scrollIntoView` effect
- Integrates `useStream` for `send()` and `usePlanExecution` for plan confirmation
- `PlanPreviewCard` is rendered inline when `chatPendingPlan` is set in the store

### `PlanPreviewCard`
Displays a chat plan before and during execution.

**Props:**
- `plan: ChatPlan` — goal + steps array
- `stepStatuses: Record<string, StepStatus>` — per-step status from store
- `onConfirm, onCancel` — callbacks to `usePlanExecution`

**Step status badges:** `pending` (grey) → `running` (blue spinner) → `done` (green) → `failed` (red)

---

## Cowork / Code

### `DesktopSessionWindow`
Shared shell for Cowork and Code modes. A simpler chat-like interface without the full message history panel.

**Props:**
- `mode: "cowork" | "code"`

Uses `useStream.send()` for message submission, renders streaming responses inline.

### `CoworkWindow`
Thin wrapper rendering `<DesktopSessionWindow mode="cowork" />`. Adds mode-specific header and context.

### `CodeWindow`
Thin wrapper rendering `<DesktopSessionWindow mode="code" />`. Adds repo path display and git status panel.

---

## Sandbox

### `SandboxWindow`
Code execution playground with Monaco Editor.

**Key features:**
- Language tab bar — tabs for all available languages (fetched from `/api/sandbox/languages`)
- Monaco Editor instance per language (shared via `editor.setModel()`)
- Timeout selector: 5s / 10s / 30s / 60s
- `⌘↵` (macOS) / `Ctrl↵` keyboard shortcut to run
- Output panel: `stdout`, `stderr`, `exit_code`, wall-time display
- Syntax theme follows `codeTheme` from store
- Languages with `available: false` shown as disabled tabs

---

## Layout

### `Sidebar`
Left navigation panel, always visible.

**Key features:**
- Session history list via `useChatHistory(mode)` — infinite scroll, search, delete
- Mode switcher: Chat / Cowork / Code / Sandbox buttons
- New session button — clears `sessionId` from store
- Animated streaming indicator: asterisk icon pulses while `isStreaming(sessionId)` is true
- `IS_TAURI` flag: shows Tauri-specific elements (e.g. native window controls hint)
- Opens panel drawers: Settings, Skills, Tools Registry, Memory

### `SettingsDialog`
Modal for user preferences.

**Sections:**
- System prompt textarea
- Profession field
- Model selector (dropdown, populated from `/api/models`)
- Effort mode selector
- Theme toggle (light/dark)
- Code syntax theme selector
- Default repo path (Code mode)
- Account section: password reset, avatar upload/delete, delete account

### `SkillsPanel`
Slide-in panel for managing user skills.

**Features:**
- Lists installed skills from `/api/skills/`
- Each skill card shows: name, version, enabled toggle, tool list
- Click to expand: shows full SKILL.md (frontmatter + markdown body)
- Upload button: file picker → `uploadSkill(zip)` → reload list
- Delete confirmation dialog before removal

### `ToolsRegistryPanel`
Slide-in panel for MCP servers and internal tools.

**Sections:**
- **Internal tools** (read-only): lists tools by mode with name, description, permission level
- **MCP servers**: add server form (name + URL or command), per-server refresh, per-tool enable/disable toggle

### `MemoryPanel`
Slide-in panel showing current session and cross-session memory.

**Features:**
- Displays raw memory file content (Markdown)
- Per-session and cross-session tabs
- Delete button with confirmation

### `MetricsPanel`
Performance metrics panel showing request timing breakdowns.

**Data source**: `GET /api/metrics`
**Columns**: session, timestamp, total_ms, per-phase breakdown (orchestrate, rag, memory, tools, stream)

### `FileViewerModal`
Modal for viewing RAG-ingested files.

- Text files: rendered as pre-formatted text
- PDFs: multi-page rendered via `PdfPageThumbnail` + PDF.js

### `PdfPageThumbnail`
Renders a single PDF page as a `<canvas>` element using PDF.js. Used inside `FileViewerModal`.

### `ThemeToggle`
Sun/moon icon button that toggles `uiTheme` between `"light"` and `"dark"` in the store.

---

## Auth

### `LoginDialog`
Modal for authentication. Three states:
- **Login** — username + password form
- **Register** — username + password + confirm form
- **Complete OAuth** — new Google OAuth user chooses a username

Handles the full `pendingOAuthToken` → `completeOAuth()` flow for new OAuth users.

### `DeleteAccountDialog`
Confirmation dialog before `deleteAccount()`. Requires typing "DELETE" to confirm. On success, clears the store and closes the dialog.

---

## UI Primitives

### `Badge`
Small coloured label using Radix UI + CVA (class-variance-authority).

**Variants:** `default`, `secondary`, `destructive`, `outline`

Used for permission levels in the Tools panel, step statuses in PlanPreviewCard, and language tags in the Skills panel.
