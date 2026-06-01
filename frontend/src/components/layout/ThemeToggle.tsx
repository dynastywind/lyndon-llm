import { Sun, Moon } from 'lucide-react'
import { useAppStore } from '@/store'

export function ThemeToggle() {
  const { uiTheme, setUiTheme } = useAppStore()
  const isLight = uiTheme === 'light'

  return (
    <button
      onClick={() => setUiTheme(isLight ? 'dark' : 'light')}
      title={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'var(--lv-mute)',
        padding: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'color 0.2s var(--ease-snap)',
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--lv-ink)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--lv-mute)')}
    >
      {isLight ? <Moon size={14} strokeWidth={1.5} /> : <Sun size={14} strokeWidth={1.5} />}
    </button>
  )
}
