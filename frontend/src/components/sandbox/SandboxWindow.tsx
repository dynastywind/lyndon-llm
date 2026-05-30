import { useCallback, useEffect, useRef, useState } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { Play, Loader2, Trash2, Copy, Check, Terminal } from 'lucide-react'
import { getSandboxLanguages, runSandbox } from '@/api/client'
import type { SandboxLanguage, SandboxResult } from '@/types'

// ── default snippets per language ────────────────────────────────────────────

const DEFAULTS: Record<string, string> = {
  python: `# Python sandbox
import sys

def greet(name: str) -> str:
    return f"Hello, {name}!"

print(greet("world"))
print(f"Python {sys.version.split()[0]}")
`,
  javascript: `// JavaScript sandbox
const greet = (name) => \`Hello, \${name}!\`

console.log(greet("world"))
console.log(\`Node \${process.version}\`)
`,
  bash: `#!/usr/bin/env bash
echo "Hello, world!"
echo "Running on: $(uname -s)"
date
`,
  typescript: `// TypeScript sandbox
const greet = (name: string): string => \`Hello, \${name}!\`

console.log(greet("world"))
`,
}

const MONACO_LANG: Record<string, string> = {
  python: 'python',
  javascript: 'javascript',
  bash: 'shell',
  typescript: 'typescript',
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`
}

// ── OutputLine ────────────────────────────────────────────────────────────────

function OutputPanel({ result, running }: { result: SandboxResult | null; running: boolean }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    const text = [result?.stdout, result?.stderr].filter(Boolean).join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    })
  }

  const hasOutput = result && (result.stdout || result.stderr)

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '1px solid var(--lv-rule)',
        minWidth: 0,
        background: '#0d0d0d',
      }}
    >
      {/* Output header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--lv-rule)',
          flexShrink: 0,
        }}
      >
        <Terminal size={12} style={{ color: 'var(--lv-mute)' }} />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--lv-mute)',
            fontWeight: 500,
            flex: 1,
          }}
        >
          Output
        </span>

        {result && (
          <>
            {/* Status badge */}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: result.timed_out
                  ? '#e8a045'
                  : result.exit_code === 0
                    ? '#6ab187'
                    : '#e06c75',
                border: `1px solid ${result.timed_out ? '#e8a04540' : result.exit_code === 0 ? '#6ab18740' : '#e06c7540'}`,
                padding: '1px 6px',
              }}
            >
              {result.timed_out
                ? 'timeout'
                : result.exit_code === 0
                  ? 'ok'
                  : `exit ${result.exit_code}`}
            </span>
            {/* Timing */}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--lv-mute)',
              }}
            >
              {fmtMs(result.duration_ms)}
            </span>
            {/* Runtime badge */}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 9,
                color: result.runtime === 'docker' ? 'var(--lv-gold)' : 'var(--lv-mute)',
                letterSpacing: '0.1em',
              }}
            >
              {result.runtime}
            </span>
            {/* Copy */}
            {hasOutput && (
              <button
                onClick={handleCopy}
                title="Copy output"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--lv-mute)',
                  padding: 2,
                  lineHeight: 0,
                }}
                className="hover:!text-[var(--lv-ink)] transition-colors"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
          </>
        )}

        {running && (
          <Loader2 size={12} className="animate-spin" style={{ color: 'var(--lv-gold)' }} />
        )}
      </div>

      {/* Output content */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 16px',
          fontFamily: 'var(--font-mono)',
          fontSize: 12.5,
          lineHeight: 1.65,
        }}
      >
        {!result && !running && (
          <p style={{ color: 'var(--lv-mute)', fontSize: 11, userSelect: 'none' }}>
            Run your code to see output here.
          </p>
        )}
        {running && <p style={{ color: 'var(--lv-mute)', fontSize: 11 }}>Running…</p>}
        {result && (
          <>
            {result.stdout && (
              <pre
                style={{
                  color: '#e8e3d8',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {result.stdout}
              </pre>
            )}
            {result.stderr && (
              <pre
                style={{
                  color: '#e06c75',
                  margin: 0,
                  marginTop: result.stdout ? 12 : 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {result.stderr}
              </pre>
            )}
            {!result.stdout && !result.stderr && (
              <p style={{ color: 'var(--lv-mute)', fontSize: 11 }}>(no output)</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── SandboxWindow ─────────────────────────────────────────────────────────────

export function SandboxWindow() {
  const [languages, setLanguages] = useState<SandboxLanguage[]>([])
  const [language, setLanguage] = useState('python')
  const [code, setCode] = useState(DEFAULTS['python'])
  const [result, setResult] = useState<SandboxResult | null>(null)
  const [running, setRunning] = useState(false)
  const [timeout, setTimeout_] = useState(10)
  const codeRef = useRef(code)

  // Keep ref in sync so the keyboard handler always has latest code
  useEffect(() => {
    codeRef.current = code
  }, [code])

  // Load available languages on mount
  useEffect(() => {
    getSandboxLanguages()
      .then(({ languages: langs }) => setLanguages(langs))
      .catch(() => {})
  }, [])

  const handleRun = useCallback(async () => {
    if (running) return
    setRunning(true)
    setResult(null)
    try {
      const res = await runSandbox(language, codeRef.current, timeout)
      setResult(res)
    } catch (e) {
      setResult({
        stdout: '',
        stderr: e instanceof Error ? e.message : 'Unexpected error',
        exit_code: 1,
        duration_ms: 0,
        timed_out: false,
        runtime: 'error',
      })
    } finally {
      setRunning(false)
    }
  }, [running, language, timeout])

  const switchLanguage = (lang: string) => {
    setLanguage(lang)
    setCode(DEFAULTS[lang] ?? '')
    setResult(null)
  }

  const handleClear = () => {
    setCode(DEFAULTS[language] ?? '')
    setResult(null)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--lv-bg)',
        color: 'var(--lv-ink)',
      }}
    >
      {/* ── Toolbar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '10px 16px',
          borderBottom: '1px solid var(--lv-rule)',
          flexShrink: 0,
        }}
      >
        {/* Language tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          {(languages.length > 0
            ? languages
            : Object.keys(DEFAULTS).map((id) => ({
                id,
                label: id,
                available: true,
                runtime: 'process' as const,
              }))
          ).map((lang) => (
            <button
              key={lang.id}
              onClick={() => switchLanguage(lang.id)}
              title={!lang.available ? `${lang.label} not available` : undefined}
              style={{
                background: language === lang.id ? 'var(--lv-elev)' : 'none',
                border:
                  language === lang.id
                    ? '1px solid var(--lv-rule-strong)'
                    : '1px solid transparent',
                cursor: 'pointer',
                padding: '4px 12px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color:
                  language === lang.id
                    ? 'var(--lv-ink)'
                    : lang.available
                      ? 'var(--lv-mute)'
                      : 'var(--lv-rule-strong)',
                transition: 'color 0.15s',
                letterSpacing: '0.05em',
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Timeout selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--lv-mute)',
            }}
          >
            timeout
          </span>
          <select
            value={timeout}
            onChange={(e) => setTimeout_(Number(e.target.value))}
            style={{
              background: 'var(--lv-elev)',
              border: '1px solid var(--lv-rule-strong)',
              color: 'var(--lv-soft)',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              padding: '2px 6px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {[5, 10, 15, 30].map((t) => (
              <option key={t} value={t}>
                {t}s
              </option>
            ))}
          </select>
        </div>

        {/* Clear */}
        <button
          onClick={handleClear}
          title="Reset to default"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--lv-mute)',
            padding: 4,
            lineHeight: 0,
          }}
          className="hover:!text-[var(--lv-ink)] transition-colors"
        >
          <Trash2 size={13} />
        </button>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={running}
          title="Run  (⌘↵)"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: running ? 'var(--lv-elev)' : 'var(--lv-gold)',
            border: 'none',
            cursor: running ? 'not-allowed' : 'pointer',
            padding: '6px 14px',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 600,
            color: running ? 'var(--lv-mute)' : 'var(--lv-bg)',
            transition: 'background 0.15s',
            letterSpacing: '0.05em',
          }}
        >
          {running ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Running…
            </>
          ) : (
            <>
              <Play size={12} /> Run
            </>
          )}
        </button>
      </div>

      {/* ── Editor + Output (split) ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Editor */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <MonacoEditor
            height="100%"
            language={MONACO_LANG[language] ?? language}
            value={code}
            onChange={(v) => setCode(v ?? '')}
            theme="vs-dark"
            options={{
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: 'ui-monospace, SF Mono, Menlo, monospace',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderLineHighlight: 'line',
              padding: { top: 16, bottom: 16 },
              tabSize: 2,
              wordWrap: 'on',
              lineNumbers: 'on',
              glyphMargin: false,
              folding: true,
              scrollbar: {
                verticalScrollbarSize: 6,
                horizontalScrollbarSize: 6,
              },
            }}
            onMount={(editor, monacoInstance) => {
              // ⌘↵ / Ctrl+↵ to run
              editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () =>
                handleRun(),
              )
            }}
          />
        </div>

        {/* Output */}
        <OutputPanel result={result} running={running} />
      </div>
    </div>
  )
}
