import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import ServicePlanner from './pages/ServicePlanner.jsx'
import HymnTracker from './pages/HymnTracker.jsx'
import UploadTracker from './pages/UploadTracker.jsx'
import Sidebar from './components/Sidebar.jsx'
import BulletinImport from './pages/BulletinImport.jsx'


export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [page, setPage] = useState('dashboard')

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    )
  }

  if (!session) return <Login />

  const renderPage = () => {
  switch (page) {
    case 'dashboard': return <Dashboard navigate={setPage} />
    case 'planner': return <ServicePlanner />
    case 'hymns': return <HymnTracker />
    case 'uploads': return <UploadTracker />
    case 'import': return <BulletinImport />
    default: return <Dashboard navigate={setPage} />
  }
}

  return (
    <div className="app-layout">
      <Sidebar page={page} navigate={setPage} session={session} />
      <div className="main-content">
        {renderPage()}
      </div>
    </div>
  )
}
