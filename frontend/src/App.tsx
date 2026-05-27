import { useAppStore } from '@/store'
import { Sidebar } from '@/components/layout/Sidebar'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { CoworkWindow } from '@/components/cowork/CoworkWindow'
import { CodeWindow } from '@/components/code/CodeWindow'

export default function App() {
  const { mode } = useAppStore()

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        {mode === 'chat'   && <ChatWindow />}
        {mode === 'cowork' && <CoworkWindow />}
        {mode === 'code'   && <CodeWindow />}
      </main>
    </div>
  )
}
