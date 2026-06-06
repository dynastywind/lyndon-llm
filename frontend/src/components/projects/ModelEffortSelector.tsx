// Interactive model + effort selector for the project composer — mirrors the
// selector in the main chat input (ChatWindow), reading from the same store so
// the choice carries into the chat that gets created.

import { useEffect, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown } from 'lucide-react'
import { getModels } from '@/api/client'
import { useAppStore } from '@/store'
import { useT } from '@/i18n'

export function ModelEffortSelector() {
  const { t } = useT()
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const effortMode = useAppStore((s) => s.effortMode)
  const setEffortMode = useAppStore((s) => s.setEffortMode)

  const [availableModels, setAvailableModels] = useState<string[]>([])
  useEffect(() => {
    getModels()
      .then(({ models }) => {
        setAvailableModels(models)
        if (models.length > 0 && !selectedModel) setSelectedModel(models[0])
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--lv-soft)',
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--lv-gold)',
              flexShrink: 0,
            }}
          />
          {selectedModel ?? '—'}
          <span style={{ color: 'var(--lv-mute)' }}>·</span>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t(`chat.effort_${effortMode}`)}
          </span>
          <ChevronDown size={10} style={{ color: 'var(--lv-mute)' }} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={8}
          style={{
            zIndex: 200,
            minWidth: 220,
            background: 'var(--lv-card)',
            border: '1px solid var(--lv-rule-strong)',
            borderRadius: 8,
            padding: '4px 0',
            boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          }}
        >
          {/* Model section */}
          <div
            style={{
              padding: '4px 10px 6px',
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: 'var(--lv-mute)',
            }}
          >
            {t('chat.model')}
          </div>
          {availableModels.length === 0 ? (
            <div
              style={{
                padding: '8px 14px',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--lv-mute)',
              }}
            >
              {t('chat.noModels')}
            </div>
          ) : (
            availableModels.map((m) => (
              <DropdownMenu.Item
                key={m}
                onSelect={() => setSelectedModel(m)}
                style={{ outline: 'none', cursor: 'pointer' }}
                className="hover:bg-accent focus:bg-accent transition-colors"
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px' }}>
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: m === selectedModel ? 'var(--lv-gold)' : 'transparent',
                      border: m === selectedModel ? 'none' : '1px solid var(--lv-mute)',
                    }}
                  />
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10.5,
                      color: m === selectedModel ? 'var(--lv-ink)' : 'var(--lv-soft)',
                    }}
                  >
                    {m}
                  </span>
                </div>
              </DropdownMenu.Item>
            ))
          )}

          {/* Effort section */}
          <div style={{ height: 1, background: 'var(--lv-rule)', margin: '4px 0' }} />
          <div
            style={{
              padding: '4px 10px 4px',
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: 'var(--lv-mute)',
            }}
          >
            {t('chat.effort')}
          </div>
          <div
            style={{
              display: 'flex',
              border: '1px solid var(--lv-rule)',
              borderRadius: 999,
              margin: '4px 8px 8px',
              overflow: 'hidden',
            }}
          >
            {(['low', 'medium', 'high'] as const).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEffortMode(e)}
                style={{
                  flex: 1,
                  background: effortMode === e ? 'var(--lv-wash)' : 'transparent',
                  color: effortMode === e ? 'var(--lv-ink)' : 'var(--lv-mute)',
                  border: 'none',
                  padding: '5px 0',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  fontWeight: effortMode === e ? 600 : 400,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  borderRadius: 999,
                  transition: 'all 0.15s',
                }}
              >
                {t(`chat.effort_${e}`)}
              </button>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
