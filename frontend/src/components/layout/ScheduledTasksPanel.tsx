import { useEffect, useState } from 'react'
import { CalendarClock, Loader2, Play, Plus, Trash2 } from 'lucide-react'
import { useT } from '@/i18n'
import {
  createScheduledTask,
  deleteScheduledTask,
  runScheduledTaskNow,
  updateScheduledTask,
  type ScheduledTaskInput,
} from '@/api/client'
import { useScheduledTasks } from '@/hooks/useScheduledTasks'
import type { ScheduledTask, ScheduleKind } from '@/types'

const INPUT: React.CSSProperties = {
  background: 'var(--lv-elev)',
  border: '1px solid var(--lv-rule-strong)',
  borderRadius: 6,
  padding: '7px 10px',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  color: 'var(--lv-ink)',
  outline: 'none',
}

function scheduleSummary(
  t: ScheduledTask,
  tr: (k: string, v?: Record<string, string | number>) => string,
): string {
  if (t.schedule_kind === 'interval') {
    const s = t.interval_seconds ?? 0
    return s % 3600 === 0
      ? tr('settings.schedules.everyHours', { n: s / 3600 })
      : tr('settings.schedules.everyMinutes', { n: Math.round(s / 60) })
  }
  if (t.schedule_kind === 'daily') {
    return tr('settings.schedules.dailyAt', { time: t.time_of_day ?? '00:00' })
  }
  const wd = tr('settings.schedules.wd' + (t.weekday ?? 0))
  return tr('settings.schedules.weeklyAt', { day: wd, time: t.time_of_day ?? '00:00' })
}

export function ScheduledTasksPanel({ active }: { active: boolean }) {
  const { t } = useT()
  const { tasks, loading, refresh, upsertTask, removeTask } = useScheduledTasks()

  // Refresh whenever the dialog opens.
  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <CreateForm onCreated={upsertTask} />

      {loading && tasks.length === 0 ? (
        <div style={{ color: 'var(--lv-mute)', fontSize: 13 }}>{t('common.loading')}</div>
      ) : tasks.length === 0 ? (
        <div style={{ color: 'var(--lv-mute)', fontSize: 13 }}>{t('settings.schedules.empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              summary={scheduleSummary(task, t)}
              onChange={upsertTask}
              onRemove={removeTask}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TaskRow({
  task,
  summary,
  onChange,
  onRemove,
}: {
  task: ScheduledTask
  summary: string
  onChange: (t: ScheduledTask) => void
  onRemove: (id: string) => void
}) {
  const { t } = useT()
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    setBusy(true)
    try {
      onChange(await updateScheduledTask(task.id, { enabled: !task.enabled }))
    } finally {
      setBusy(false)
    }
  }

  const runNow = async () => {
    setBusy(true)
    try {
      await runScheduledTaskNow(task.id)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    onRemove(task.id)
    await deleteScheduledTask(task.id).catch(() => {})
  }

  const nextRun = task.next_run_at ? new Date(task.next_run_at).toLocaleString() : '—'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        border: '1px solid var(--lv-rule)',
        borderRadius: 8,
        padding: '12px 14px',
      }}
    >
      <CalendarClock size={16} style={{ flexShrink: 0, color: 'var(--lv-mute)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            fontWeight: 500,
            color: 'var(--lv-ink)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {task.name}
        </div>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--lv-mute)',
            marginTop: 3,
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span>{summary}</span>
          <span>
            {t('settings.schedules.nextRun')}: {task.enabled ? nextRun : '—'}
          </span>
          {task.last_status === 'error' && (
            <span style={{ color: 'var(--lv-gold)' }} title={task.last_error ?? ''}>
              {t('settings.schedules.statusError')}
            </span>
          )}
          {task.last_status === 'ok' && <span>{t('settings.schedules.statusOk')}</span>}
        </div>
      </div>

      {/* Enable toggle */}
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title={task.enabled ? t('settings.schedules.disable') : t('settings.schedules.enable')}
        style={{
          width: 38,
          height: 22,
          flexShrink: 0,
          borderRadius: 999,
          border: 'none',
          cursor: busy ? 'default' : 'pointer',
          background: task.enabled ? 'var(--lv-gold)' : 'var(--lv-rule-strong)',
          position: 'relative',
          transition: 'background 0.15s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 3,
            left: task.enabled ? 19 : 3,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: 'var(--lv-bg)',
            transition: 'left 0.15s',
          }}
        />
      </button>

      <button
        type="button"
        onClick={runNow}
        disabled={busy}
        title={t('settings.schedules.runNow')}
        style={iconBtn}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
      </button>
      <button type="button" onClick={remove} title={t('settings.schedules.delete')} style={iconBtn}>
        <Trash2 size={14} />
      </button>
    </div>
  )
}

const iconBtn: React.CSSProperties = {
  flexShrink: 0,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--lv-mute)',
  padding: 4,
  display: 'flex',
  alignItems: 'center',
}

function CreateForm({ onCreated }: { onCreated: (t: ScheduledTask) => void }) {
  const { t } = useT()
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [kind, setKind] = useState<ScheduleKind>('daily')
  const [intervalValue, setIntervalValue] = useState(30)
  const [intervalUnit, setIntervalUnit] = useState<'minutes' | 'hours'>('minutes')
  const [timeOfDay, setTimeOfDay] = useState('09:00')
  const [weekday, setWeekday] = useState(0)
  const [actingMode, setActingMode] = useState<'auto' | 'auto_safe'>('auto_safe')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || !goal.trim()) return
    const input: ScheduledTaskInput = {
      name: name.trim(),
      goal: goal.trim(),
      schedule_kind: kind,
      acting_mode: actingMode,
      enabled: true,
    }
    if (kind === 'interval') {
      input.interval_seconds = intervalValue * (intervalUnit === 'hours' ? 3600 : 60)
    } else {
      input.time_of_day = timeOfDay
      if (kind === 'weekly') input.weekday = weekday
    }
    setSaving(true)
    setError(null)
    try {
      onCreated(await createScheduledTask(input))
      setName('')
      setGoal('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--lv-rule)',
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('settings.schedules.namePlaceholder')}
        style={INPUT}
      />
      <textarea
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder={t('settings.schedules.goalPlaceholder')}
        rows={3}
        style={{ ...INPUT, resize: 'vertical', fontFamily: 'var(--font-sans)' }}
      />

      {/* Schedule kind */}
      <div style={{ display: 'flex', gap: 6 }}>
        {(['interval', 'daily', 'weekly'] as ScheduleKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              flex: 1,
              padding: '6px 0',
              borderRadius: 5,
              cursor: 'pointer',
              fontSize: 12,
              border: `1px solid ${kind === k ? 'var(--lv-gold)' : 'var(--lv-rule-strong)'}`,
              background: kind === k ? 'rgba(200,168,106,0.12)' : 'transparent',
              color: kind === k ? 'var(--lv-gold)' : 'var(--lv-soft)',
            }}
          >
            {t('settings.schedules.kind_' + k)}
          </button>
        ))}
      </div>

      {/* Schedule-specific inputs */}
      {kind === 'interval' ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--lv-mute)' }}>
            {t('settings.schedules.every')}
          </span>
          <input
            type="number"
            min={1}
            value={intervalValue}
            onChange={(e) => setIntervalValue(Math.max(1, Number(e.target.value)))}
            style={{ ...INPUT, width: 80 }}
          />
          <select
            value={intervalUnit}
            onChange={(e) => setIntervalUnit(e.target.value as 'minutes' | 'hours')}
            style={{ ...INPUT, cursor: 'pointer' }}
          >
            <option value="minutes">{t('settings.schedules.minutes')}</option>
            <option value="hours">{t('settings.schedules.hours')}</option>
          </select>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {kind === 'weekly' && (
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
              style={{ ...INPUT, cursor: 'pointer' }}
            >
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {t('settings.schedules.wd' + d)}
                </option>
              ))}
            </select>
          )}
          <input
            type="time"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            style={{ ...INPUT, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 11, color: 'var(--lv-mute)' }}>
            {t('settings.schedules.timeUtc')}
          </span>
        </div>
      )}

      {/* Acting mode */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {(['auto_safe', 'auto'] as const).map((m) => (
          <label
            key={m}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--lv-soft)',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="acting-mode"
              checked={actingMode === m}
              onChange={() => setActingMode(m)}
            />
            {t('settings.schedules.actingMode_' + m)}
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11, color: 'var(--lv-mute)', lineHeight: 1.5 }}>
        {t('settings.schedules.actingModeNote')}
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--lv-gold)' }}>{error}</div>}

      <button
        type="button"
        onClick={submit}
        disabled={saving || !name.trim() || !goal.trim()}
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderRadius: 6,
          border: 'none',
          cursor: saving || !name.trim() || !goal.trim() ? 'default' : 'pointer',
          background:
            saving || !name.trim() || !goal.trim() ? 'var(--lv-rule-strong)' : 'var(--lv-gold)',
          color: saving || !name.trim() || !goal.trim() ? 'var(--lv-mute)' : 'var(--lv-bg)',
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        {t('settings.schedules.create')}
      </button>
    </div>
  )
}
