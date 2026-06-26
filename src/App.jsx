import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase.js'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import ServicePlanner from './pages/ServicePlanner.jsx'
import ServiceView from './pages/ServiceView.jsx'
import HymnTracker from './pages/HymnTracker.jsx'
import UploadTracker from './pages/UploadTracker.jsx'
import BulletinImport from './pages/BulletinImport.jsx'
import BulletinSettings from './pages/BulletinSettings.jsx'
import EventPlanner from './pages/EventPlanner.jsx'
import Sidebar from './components/Sidebar.jsx'

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [page, setPage] = useState('dashboard')
  const [selectedServiceId, setSelectedServiceId] = useState(null)
  const [editServiceId, setEditServiceId] = useState(null)

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
    setEditServiceId(null)
    setPage('service-view')
  }

  const navigateToEdit = (id) => {
    setEditServiceId(id)
    setPage('planner')
  }

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard navigate={setPage} onViewService={navigateToService} />
      case 'planner': return (
        <ServicePlanner
          onViewService={navigateToService}
          editServiceId={editServiceId}
          onClearEditId={() => setEditServiceId(null)}
        />
      )
      case 'service-view': return (
        <ServiceView
          serviceId={selectedServiceId}
          onBack={() => setPage('planner')}
          onEdit={() => navigateToEdit(selectedServiceId)}
        />
      )
      case 'hymns': return <HymnTracker />
      case 'uploads': return <UploadTracker />
      case 'import': return <BulletinImport />
      case 'bulletin-settings': return <BulletinSettings />
      case 'event-planner': return <EventPlanner />
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
