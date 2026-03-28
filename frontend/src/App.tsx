import { useEffect, useState, useCallback } from 'react'
import { useUIStore } from './store/uiStore'
import { SidebarLeft } from './components/SidebarLeft'
import { SidebarRight } from './components/SidebarRight'
import { ChatArea } from './components/ChatArea'
import { SettingsModal } from './components/SettingsModal'
import { AgentManager } from './components/AgentManager'
import { LoginScreen } from './components/LoginScreen'

interface ScratchpadState {
  consensus: string
  open_questions: string[]
  key_ideas: string[]
}

function App() {
  const { palette, themeFont } = useUIStore()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [selectedRoomId, setSelectedRoomId] = useState<number>(0)
  const [scratchpad, setScratchpad] = useState<ScratchpadState>({ consensus: '', open_questions: [], key_ideas: [] })
  const [telemetry, setTelemetry] = useState<{ data: any[]; budgets: Record<string, number> }>({ data: [], budgets: {} })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', palette)
    document.documentElement.setAttribute('data-font', themeFont)
  }, [palette, themeFont])

  const handleScratchpadUpdate = useCallback((s: ScratchpadState) => setScratchpad(s), [])
  const handleTelemetryUpdate = useCallback((data: any[], budgets: Record<string, number>) => setTelemetry({ data, budgets }), [])

  const handleSelectRoom = useCallback((id: number) => {
    setSelectedRoomId(id)
    // Reset scratchpad / telemetry when switching rooms
    setScratchpad({ consensus: '', open_questions: [], key_ideas: [] })
    setTelemetry({ data: [], budgets: {} })
  }, [])

  if (!isAuthenticated) {
    return <LoginScreen onLogin={() => setIsAuthenticated(true)} />
  }

  return (
    <div className="app-container">
      <SidebarLeft 
        selectedRoomId={selectedRoomId} 
        onSelectRoom={handleSelectRoom} 
      />

      <ChatArea
        roomId={selectedRoomId}
        onScratchpadUpdate={handleScratchpadUpdate}
        onTelemetryUpdate={handleTelemetryUpdate}
      />

      <SidebarRight 
        roomId={selectedRoomId} 
        scratchpad={scratchpad} 
        telemetry={telemetry} 
      />

      <SettingsModal />
      <AgentManager />
    </div>
  )
}

export default App
