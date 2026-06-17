import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import ServicePlanner from './pages/ServicePlanner.jsx'
import ServiceView from './pages/ServiceView.jsx'
import HymnTracker from './pages/HymnTracker.jsx'
import UploadTracker from './pages/UploadTracker.jsx'
import BulletinImport from './pages/BulletinImport.jsx'
import Sidebar from './components/Sidebar.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [page, setPage] = useState('dashboard')
  const [selectedServiceId, setSelectedServiceId] = useState(null)

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

  const navigateToService = (id) => {
    setSelectedServiceId(id)
    setPage('service-view')
  }

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard navigate={setPage} />
      case 'planner': return <ServicePlanner onViewService={navigateToService} />
      case 'service-view': return (
        <ServiceView
          serviceId={selectedServiceId}
          onBack={() => setPage('planner')}
          onEdit={() => setPage('planner')}
        />
      )
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
