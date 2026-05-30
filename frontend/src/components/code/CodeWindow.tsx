import { useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import { GitCommit, Play, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { editFile, runTests, commitFiles } from '@/api/client'
import type { TestResult } from '@/types'

export function CodeWindow() {
  const { sessionId, currentDiff, setDiff } = useAppStore()

  const [filePath, setFilePath]       = useState('')
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading]         = useState(false)
  const [testResult, setTestResult]   = useState<TestResult | null>(null)
  const [commitMsg, setCommitMsg]     = useState('')
  const [tab, setTab]                 = useState<'edit' | 'review' | 'test'>('edit')

  const handleEdit = async () => {
    if (!filePath || !instruction) return
    setLoading(true)
    try {
      const diff = await editFile(filePath, instruction, sessionId ?? '')
      setDiff(diff)
      setTab('review')
    } finally {
      setLoading(false)
    }
  }

  const handleTest = async () => {
    setLoading(true)
    try {
      const result = await runTests(sessionId ?? '')
      setTestResult(result)
      setTab('test')
    } finally {
      setLoading(false)
    }
  }

  const handleCommit = async () => {
    if (!currentDiff || !commitMsg) return
    await commitFiles([currentDiff.file_path], commitMsg, sessionId ?? '')
    setDiff(null)
    setCommitMsg('')
  }

  const tabs = [
    { id: 'edit' as const,   label: 'Edit' },
    { id: 'review' as const, label: 'Review' },
    { id: 'test' as const,   label: 'Tests' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex gap-1 px-4 pt-4 border-b border-border pb-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors',
              tab === t.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden p-4">
        {/* Edit tab */}
        {tab === 'edit' && (
          <div className="flex flex-col gap-3 h-full">
            <input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="File path (e.g. src/api/auth.py)"
              className="bg-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono"
            />
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="What should I change? (e.g. Add JWT authentication to this endpoint)"
              rows={3}
              className="resize-none bg-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2">
              <button
                onClick={handleEdit}
                disabled={loading || !filePath || !instruction}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 flex items-center gap-2"
              >
                {loading && <Loader2 size={13} className="animate-spin" />}
                Generate Edit
              </button>
              <button
                onClick={handleTest}
                disabled={loading}
                className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-accent disabled:opacity-40 flex items-center gap-2"
              >
                <Play size={13} />
                Run Tests
              </button>
            </div>
          </div>
        )}

        {/* Review tab — Monaco diff editor */}
        {tab === 'review' && (
          <div className="flex flex-col gap-3 h-full">
            {currentDiff ? (
              <>
                <p className="text-sm text-muted-foreground font-mono">{currentDiff.file_path}</p>
                <div className="flex-1 rounded-lg overflow-hidden border border-border">
                  <DiffEditor
                    height="100%"
                    theme="vs-dark"
                    language="python"
                    original={currentDiff.is_new ? '' : ''}
                    modified={currentDiff.diff}
                    options={{ readOnly: true, minimap: { enabled: false } }}
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder="Commit message…"
                    className="flex-1 bg-input rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={handleCommit}
                    disabled={!commitMsg}
                    className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium disabled:opacity-40 flex items-center gap-2"
                  >
                    <GitCommit size={13} />
                    Commit
                  </button>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">No diff yet — generate an edit first.</p>
            )}
          </div>
        )}

        {/* Test tab */}
        {tab === 'test' && (
          <div className="flex flex-col gap-3 h-full">
            {testResult ? (
              <>
                <div className="flex items-center gap-3">
                  {testResult.success
                    ? <CheckCircle size={16} className="text-green-400" />
                    : <XCircle size={16} className="text-red-400" />}
                  <span className="text-sm font-medium">
                    {testResult.passed} passed · {testResult.failed} failed · {testResult.errors} errors
                  </span>
                </div>
                <div className="flex-1 overflow-auto rounded-lg border border-border bg-black/30 p-3">
                  <pre className="text-xs font-mono whitespace-pre-wrap">{testResult.output}</pre>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Run tests from the Edit tab.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
