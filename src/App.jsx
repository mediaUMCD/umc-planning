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
import PhotoManager from './pages/PhotoManager.jsx'
import CheckRequests from './pages/CheckRequests.jsx'
import Fundraising from './pages/Fundraising.jsx'
import Approve from './pages/Approve.jsx'
import SetList from './pages/SetList.jsx'
import ChristianEducation from './pages/ChristianEducation.jsx'
import Sidebar from './components/Sidebar.jsx'

const PUBLIC_PATHS = ['/setlist', '/setlist/']
const APPROVE_PATHS = ['/approve', '/approve/']

export default function App() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [roles, setRoles] = useState([])
  const [rolesLoaded, setRolesLoaded] = useState(false)
  const [page, setPage] = useState('dashboard')
  const [selectedServiceId, setSelectedServiceId] = useState(null)
  const [editServiceId, setEditServiceId] = useState(null)

  // Public, unauthenticated route — no login required, no sidebar
  if (PUBLIC_PATHS.includes(window.location.pathname)) {
    return <SetList />
  }
  if (APPROVE_PATHS.includes(window.location.pathname)) {
    return <Approve />
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
      if (session) fetchRoles(session.user.id)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) fetchRoles(session.user.id)
      else { setRoles([]); setRolesLoaded(false) }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function fetchRoles(userId) {
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId)
    setRoles((data || []).map(r => r.role))
    setRolesLoaded(true)
  }

  const isAdmin = roles.includes('admin')
  const isFinanceOnly = roles.includes('finance') && !isAdmin
  const canFundraising = isAdmin || roles.includes('fundraising')

  // Finance-only logins are scoped to just Check Requests, everywhere else.
  useEffect(() => {
    if (isFinanceOnly && page !== 'check-requests') setPage('check-requests')
  }, [isFinanceOnly, page])

  if (authLoading || (session && !rolesLoaded)) {
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
    if (isFinanceOnly) return <CheckRequests />

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
      case 'christian-education': return <ChristianEducation />
      case 'uploads': return <UploadTracker />
      case 'import': return <BulletinImport />
      case 'bulletin-settings': return <BulletinSettings />
      case 'photos': return <PhotoManager />
      case 'check-requests': return <CheckRequests />
      case 'fundraising': return canFundraising ? <Fundraising /> : <Dashboard navigate={setPage} />
      default: return <Dashboard navigate={setPage} />
    }
  }

  return (
    <div className="app-layout">
      <Sidebar page={page} navigate={setPage} session={session} isFinanceOnly={isFinanceOnly} canFundraising={canFundraising} />
      <div className="main-content">
        {renderPage()}
      </div>
    </div>
  )
}