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
import SeriesStudies from './pages/SeriesStudies.jsx'
import Attendance from './pages/Attendance.jsx'
import People from './pages/People.jsx'
import Giving from './pages/Giving.jsx'
import Sidebar from './components/Sidebar.jsx'
import { confirmDiscardChanges } from './unsavedChanges.js'

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
  const [ceTarget, setCeTarget] = useState(null)

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
  const canAttendance = isAdmin || roles.includes('attendance')
  const canReviewGiving = isAdmin || roles.includes('finance') || roles.includes('giving')
  const canGiving = canReviewGiving || roles.includes('counter')
  // Counters who have no other staff role only ever see the Giving page.
  const isCounterOnly = roles.includes('counter') && !isAdmin && !roles.some(r => ['finance', 'giving', 'attendance', 'chair', 'teacher', 'fundraising'].includes(r))

  // Finance-only logins are scoped to Check Requests (plus Attendance and
  // People when they also take attendance), everywhere else.
  const financeOnlyPages = canAttendance ? ['check-requests', 'giving', 'attendance', 'people'] : ['check-requests', 'giving']
  useEffect(() => {
    if (isFinanceOnly && !financeOnlyPages.includes(page)) setPage('check-requests')
    if (isCounterOnly && page !== 'giving') setPage('giving')
  }, [isFinanceOnly, isCounterOnly, page, canAttendance])

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

  // Deep-links from the Dashboard into a specific CE class/session or series.
  // target: { classId, sessionId } for a session, or { seriesId } for a series.
  const navigateToCE = (target) => {
    setCeTarget(target)
    setPage('christian-education')
  }

  const renderPage = () => {
    if (isCounterOnly) return <Giving canReview={false} />
    if (isFinanceOnly && page === 'giving') return <Giving canReview />
    if (isFinanceOnly) return page === 'attendance' && canAttendance ? <Attendance /> : page === 'people' && canAttendance ? <People /> : <CheckRequests />

    switch (page) {
      case 'dashboard': return <Dashboard navigate={setPage} onViewService={navigateToService} onViewCE={navigateToCE} />
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
      case 'christian-education': return <ChristianEducation initialTarget={ceTarget} onConsumeTarget={() => setCeTarget(null)} />
      case 'series': return <SeriesStudies onOpenCE={navigateToCE} />
      case 'attendance': return <Attendance />
      case 'people': return <People />
      case 'giving': return canGiving ? <Giving canReview={canReviewGiving} /> : <Dashboard navigate={setPage} />
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
      <Sidebar page={page} navigate={(p) => { if (p !== page && !confirmDiscardChanges()) return; setPage(p) }} session={session} isFinanceOnly={isFinanceOnly} canFundraising={canFundraising} canAttendance={canAttendance} canGiving={canGiving} isCounterOnly={isCounterOnly} />
      <div className="main-content">
        {renderPage()}
      </div>
    </div>
  )
}