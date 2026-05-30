import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { getMetrics } from '@/api/client'
import type { MetricRecord, MetricsSummary } from '@/types'

const TOOLTIP_STYLE = {
  backgroundColor: '#181818',
  border: '1px solid #232323',
  borderRadius: 0,
  color: '#f4f1ea',
  fontSize: 11,
  fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
}
const AXIS_STYLE = { fill: '#6e695f', fontSize: 10 }

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

// ── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--lv-rule)',
        padding: '12px 16px',
        background: 'var(--lv-elev)',
        flex: 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9.5,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--lv-mute)',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontWeight: 500,
          fontSize: 22,
          letterSpacing: '-0.015em',
          color: 'var(--lv-gold)',
        }}
      >
        {value}
      </div>
    </div>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 9.5,
        letterSpacing: '0.28em',
        textTransform: 'uppercase',
        color: 'var(--lv-mute)',
        fontWeight: 500,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function MetricsPanel({ active = true }: { active?: boolean }) {
  const [data, setData] = useState<MetricRecord[]>([])
  const [summary, setSummary] = useState<MetricsSummary | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getMetrics({ limit: 100 })
      // reverse so charts go oldest → newest left → right
      setData([...res.metrics].reverse())
      setSummary(res.summary)
      setTotal(res.total)
    } catch {
      setData([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (active) load()
  }, [active, load])

  if (loading && !data.length) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '40px 0',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--lv-mute)',
        }}
      >
        <Loader2 size={13} className="animate-spin" />
        Loading metrics…
      </div>
    )
  }

  if (!data.length) {
    return (
      <div
        style={{
          padding: '40px 0',
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--lv-mute)',
        }}
      >
        No metrics yet — send a message to record the first data point.
      </div>
    )
  }

  // Build chart data
  const chartData = data.map((m) => ({
    time: fmtTime(m.created_at),
    total_ms: m.total_ms,
    ttft_ms: m.phases.ttft_ms ?? null,
    search_ms: m.phases.search_ms ?? null,
    route: m.route ?? 'direct',
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--lv-mute)',
          }}
        >
          {total} request{total !== 1 ? 's' : ''} recorded
        </span>
        <button
          onClick={load}
          title="Refresh"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--lv-mute)',
            padding: 4,
            lineHeight: 0,
          }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Summary stats */}
      {summary && (
        <div>
          <SectionLabel>Summary — last {data.length} requests</SectionLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatCard label="Avg total" value={fmtMs(summary.avg_total_ms)} />
            <StatCard label="p90 total" value={fmtMs(summary.p90_total_ms)} />
            <StatCard label="Avg TTFT" value={fmtMs(summary.avg_ttft_ms)} />
            <StatCard label="p90 TTFT" value={fmtMs(summary.p90_ttft_ms)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <StatCard label="Min" value={fmtMs(summary.min_total_ms)} />
            <StatCard label="Max" value={fmtMs(summary.max_total_ms)} />
            <StatCard label="Count" value={String(summary.count)} />
          </div>
        </div>
      )}

      {/* Response time over time */}
      <div>
        <SectionLabel>Response time (ms)</SectionLabel>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-total" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#c8a86a" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#c8a86a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#232323" />
              <XAxis dataKey="time" tick={AXIS_STYLE} interval="preserveStartEnd" />
              <YAxis
                tick={AXIS_STYLE}
                width={40}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}`)}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v) => [fmtMs(v as number), 'Total']}
              />
              <Area
                type="monotone"
                dataKey="total_ms"
                name="Total"
                stroke="#c8a86a"
                fill="url(#grad-total)"
                strokeWidth={1.5}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TTFT + Search breakdown */}
      <div>
        <SectionLabel>Phase breakdown (ms)</SectionLabel>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#232323" />
              <XAxis dataKey="time" tick={AXIS_STYLE} interval="preserveStartEnd" />
              <YAxis
                tick={AXIS_STYLE}
                width={40}
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}`)}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, name) => [fmtMs(v as number), name as string]}
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'var(--font-mono)' }} />
              <Bar dataKey="ttft_ms" name="TTFT" fill="#c8a86a" radius={[2, 2, 0, 0]} />
              <Bar dataKey="search_ms" name="Search" fill="#6e695f" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
