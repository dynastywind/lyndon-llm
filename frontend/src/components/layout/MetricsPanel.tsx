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
import { useT } from '@/i18n'
import type { MetricRecord, MetricsSummary } from '@/types'

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--lv-card)',
  border: '1px solid var(--lv-rule)',
  borderRadius: 0,
  color: 'var(--lv-ink)',
  fontSize: 11,
  fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
}
const AXIS_STYLE = { fill: 'var(--lv-mute)', fontSize: 10 }

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtMs(
  ms: number | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (ms == null) return '—'
  return ms >= 1000
    ? t('metrics.unitSeconds', { value: (ms / 1000).toFixed(1) })
    : t('metrics.unitMillis', { value: ms })
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
  const { t, tn } = useT()
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
        {t('metrics.loading')}
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
        {t('metrics.empty')}
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
          {tn('metrics.requestsRecorded', total)}
        </span>
        <button
          onClick={load}
          title={t('metrics.refresh')}
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
          <SectionLabel>{t('metrics.summaryLast', { count: data.length })}</SectionLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatCard label={t('metrics.avgTotal')} value={fmtMs(summary.avg_total_ms, t)} />
            <StatCard label={t('metrics.p90Total')} value={fmtMs(summary.p90_total_ms, t)} />
            <StatCard label={t('metrics.avgTtft')} value={fmtMs(summary.avg_ttft_ms, t)} />
            <StatCard label={t('metrics.p90Ttft')} value={fmtMs(summary.p90_ttft_ms, t)} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <StatCard label={t('metrics.min')} value={fmtMs(summary.min_total_ms, t)} />
            <StatCard label={t('metrics.max')} value={fmtMs(summary.max_total_ms, t)} />
            <StatCard label={t('metrics.count')} value={String(summary.count)} />
          </div>
        </div>
      )}

      {/* Response time over time */}
      <div>
        <SectionLabel>{t('metrics.responseTime')}</SectionLabel>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="grad-total" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#c8a86a" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#c8a86a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--lv-rule)" />
              <XAxis dataKey="time" tick={AXIS_STYLE} interval="preserveStartEnd" />
              <YAxis
                tick={AXIS_STYLE}
                width={40}
                tickFormatter={(v) =>
                  v >= 1000 ? t('metrics.unitSeconds', { value: (v / 1000).toFixed(1) }) : `${v}`
                }
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v) => [fmtMs(v as number, t), t('metrics.seriesTotal')]}
              />
              <Area
                type="monotone"
                dataKey="total_ms"
                name={t('metrics.seriesTotal')}
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
        <SectionLabel>{t('metrics.phaseBreakdown')}</SectionLabel>
        <div style={{ height: 180 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--lv-rule)" />
              <XAxis dataKey="time" tick={AXIS_STYLE} interval="preserveStartEnd" />
              <YAxis
                tick={AXIS_STYLE}
                width={40}
                tickFormatter={(v) =>
                  v >= 1000 ? t('metrics.unitSeconds', { value: (v / 1000).toFixed(1) }) : `${v}`
                }
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v, name) => [fmtMs(v as number, t), name as string]}
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'var(--font-mono)' }} />
              <Bar
                dataKey="ttft_ms"
                name={t('metrics.seriesTtft')}
                fill="#c8a86a"
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="search_ms"
                name={t('metrics.seriesSearch')}
                fill="#6e695f"
                radius={[2, 2, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
