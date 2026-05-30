import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  createMcpServer,
  deleteMcpServer,
  getToolRegistry,
  refreshMcpServer,
  toggleMcpTool,
} from '@/api/client'
import type { McpServer, McpServerCreate, RegistryTool, ToolRegistry } from '@/types'

// ─── Internal tools (read-only) ───────────────────────────────────────────────

function InternalToolsSection({ tools }: { tools: RegistryTool[] }) {
  const byMode = tools.reduce<Record<string, RegistryTool[]>>((acc, t) => {
    const mode = t.mode ?? 'unknown'
    ;(acc[mode] ??= []).push(t)
    return acc
  }, {})

  return (
    <section>
      <SectionLabel>Built-in tools</SectionLabel>
      <p className="text-xs text-muted-foreground mb-3">
        Shipped with LyndonLLM. These cannot be edited or removed.
      </p>
      {Object.entries(byMode).filter(([mode]) => mode !== 'cowork').map(([mode, modeTools]) => (
        <div key={mode} className="mb-4">
          <p className="text-xs font-medium text-muted-foreground mb-1.5 capitalize">{mode}</p>
          <ul className="space-y-1.5">
            {modeTools.map((t) => (
              <li
                key={`${mode}-${t.name}`}
                className="flex items-start gap-3 bg-background rounded-lg px-3 py-2"
              >
                <Wrench size={14} className="text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">{t.name}</span>
                    <Lock size={11} className="text-muted-foreground/50" />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
                      {t.permission}
                    </span>
                  </div>
                  {t.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {t.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

// ─── MCP server card ──────────────────────────────────────────────────────────

function McpServerCard({
  server,
  onChange,
}: {
  server: McpServer
  onChange: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await refreshMcpServer(server.id)
      onChange()
    } finally {
      setRefreshing(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Remove MCP server "${server.name}"?`)) return
    await deleteMcpServer(server.id)
    onChange()
  }

  const handleToggleTool = async (qualifiedName: string, enabled: boolean) => {
    await toggleMcpTool(server.id, qualifiedName, enabled)
    onChange()
  }

  return (
    <li className="bg-background rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Server size={14} className="text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{server.name}</p>
          <p className="text-[10px] text-muted-foreground font-mono">
            {server.transport}
            {server.transport === 'stdio' && server.command
              ? ` · ${server.command}`
              : ''}
            {server.transport === 'sse' && server.url ? ` · ${server.url}` : ''}
          </p>
        </div>
        <span
          className={cn(
            'text-[10px] px-1.5 py-0.5 rounded',
            server.enabled
              ? 'bg-green-500/10 text-green-400'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {server.enabled ? 'on' : 'off'}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh tools from server"
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="text-muted-foreground hover:text-red-400 p-1"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {server.last_error && (
        <p className="px-3 pb-2 text-xs text-red-400 flex items-start gap-1">
          <AlertCircle size={12} className="shrink-0 mt-0.5" />
          {server.last_error}
        </p>
      )}

      {expanded && (
        <ul className="border-t border-border px-3 py-2 space-y-1">
          {server.tools.length === 0 ? (
            <li className="text-xs text-muted-foreground">No tools discovered yet.</li>
          ) : (
            server.tools.map((t) => (
              <li key={t.qualified_name} className="flex items-center gap-2 text-xs">
                <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={t.enabled}
                    onChange={(e) => handleToggleTool(t.qualified_name, e.target.checked)}
                    className="rounded border-border"
                  />
                  <span className="font-mono truncate">{t.mcp_name}</span>
                </label>
              </li>
            ))
          )}
        </ul>
      )}
    </li>
  )
}

// ─── Add server form ──────────────────────────────────────────────────────────

function AddMcpServerForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<McpServerCreate>({
    name: '',
    transport: 'stdio',
    command: '',
    args: [],
    env: {},
    url: '',
    enabled: true,
  })
  const [argsText, setArgsText] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const args = argsText
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const body: McpServerCreate = {
        name: form.name.trim(),
        description: form.description || null,
        transport: form.transport,
        command: form.transport === 'stdio' ? form.command?.trim() || null : null,
        args: form.transport === 'stdio' ? args : [],
        url: form.transport === 'sse' ? form.url?.trim() || null : null,
        enabled: form.enabled ?? true,
      }
      await createMcpServer(body)
      setOpen(false)
      setForm({ name: '', transport: 'stdio', command: '', args: [], env: {}, url: '', enabled: true })
      setArgsText('')
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add server')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-primary hover:text-primary/80 transition-colors"
      >
        <Plus size={14} />
        Add MCP server
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-background rounded-lg border border-border p-4 space-y-3">
      <p className="text-sm font-medium">New MCP server</p>
      <input
        required
        placeholder="Display name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm"
      />
      <select
        value={form.transport}
        onChange={(e) =>
          setForm({ ...form, transport: e.target.value as 'stdio' | 'sse' })
        }
        className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm"
      >
        <option value="stdio">stdio (local process)</option>
        <option value="sse">sse (remote URL)</option>
      </select>
      {form.transport === 'stdio' ? (
        <>
          <input
            required
            placeholder="Command (e.g. npx, python, node)"
            value={form.command ?? ''}
            onChange={(e) => setForm({ ...form, command: e.target.value })}
            className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm font-mono"
          />
          <input
            placeholder="Arguments (space-separated)"
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm font-mono"
          />
        </>
      ) : (
        <input
          required
          placeholder="Server URL (https://…)"
          value={form.url ?? ''}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
          className="w-full bg-card border border-border rounded px-3 py-1.5 text-sm font-mono"
        />
      )}
      {error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle size={12} />
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : 'Save & connect'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function ToolsRegistryPanel({ active = true }: { active?: boolean }) {
  const [registry, setRegistry] = useState<ToolRegistry | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getToolRegistry()
      setRegistry(data)
    } catch {
      setRegistry({ internal_tools: [], mcp_servers: [] })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active) load()
  }, [active, load])

  if (loading && !registry) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 size={14} className="animate-spin" />
        Loading tool registry…
      </div>
    )
  }

  const internal = registry?.internal_tools ?? []
  const servers = registry?.mcp_servers ?? []

  return (
    <div className="space-y-7">
      <InternalToolsSection tools={internal} />

      <section>
        <SectionLabel>MCP servers</SectionLabel>
        <p className="text-xs text-muted-foreground mb-3">
          Connect external MCP servers. Tools are discovered on save and can be refreshed
          anytime.
        </p>
        <AddMcpServerForm onAdded={load} />
        {servers.length > 0 && (
          <ul className="mt-4 space-y-2">
            {servers.map((s) => (
              <McpServerCard key={s.id} server={s} onChange={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
      {children}
    </h3>
  )
}
