import { useAppStore } from '@/store'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { CoworkWindow } from '@/components/cowork/CoworkWindow'
import { CodeWindow } from '@/components/code/CodeWindow'

export default function App() {
  const { mode, sessionId } = useAppStore()

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        {/*
          key=sessionId forces a full remount whenever the active session
          changes.  This guarantees all local state (scroll refs, pagination
          cursors, hasMore flags) is reset to its initial value and that
          loadInitial always fetches messages for the correct session.
          React 18 batches the setSessionId + addMessage calls from the lazy
          creation path, so the remounted component's effect correctly sees
          messages.length > 0 and skips the unnecessary DB fetch.
        */}
        {mode === 'chat'   && <ChatWindow key={sessionId ?? '__new__'} />}
        {mode === 'cowork' && <CoworkWindow />}
        {mode === 'code'   && <CodeWindow />}
      </main>
    </div>
  )
}
