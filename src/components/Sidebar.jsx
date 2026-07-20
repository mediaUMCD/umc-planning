import { supabase } from '../lib/supabase.js'

const NAV_ITEMS = [
  { id: 'dashboard', icon: '/icons/icon-dashboard.png', label: 'Dashboard' },
  { id: 'planner', icon: '/icons/icon-service-planner.png', label: 'Service Planner' },
  { id: 'hymns', icon: '/icons/icon-hymn-tracker.png', label: 'Hymn Tracker' },
  { id: 'uploads', icon: '/icons/icon-upload-tracker.png', label: 'Upload Tracker' },
  { id: 'import', icon: '/icons/icon-bulletin-import.png', label: 'Bulletin Import' },
  { id: 'bulletin-settings', icon: '/icons/icon-weekly-bulletin.png', label: 'Bulletin Settings' },
  { id: 'photos', icon: '/icons/icon-event-photos.png', label: 'Photo Manager' },
  { id: 'check-requests', icon: '/icons/icon-upload-tracker.png', label: 'Check Requests' },
]

const FINANCE_ONLY_NAV_ITEMS = [
  { id: 'check-requests', icon: '/icons/icon-upload-tracker.png', label: 'Check Requests' },
]

const OTHER_APPS = [
  { label: 'Church App',  href: 'https://app.umcdanielson.org',      icon: '📱' },
  { label: 'One Board',   href: 'https://board.umcdanielson.org',     icon: '📋' },
  { label: 'Website',     href: 'https://umcdanielson.org',           icon: '🌐' },
  { label: 'Public Set List', href: '/setlist',                       icon: '🎵' },
]

export default function Sidebar({ page, navigate, session, isFinanceOnly }) {
  async function handleLogout() {
    await supabase.auth.signOut()
  }

  const items = isFinanceOnly ? FINANCE_ONLY_NAV_ITEMS : NAV_ITEMS

  return (
    <div className="sidebar">
      {/* Logo */}
      <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <img src="/icons/icon-service-planner.png" alt="" style={{ width: '32px', height: '32px', marginBottom: '6px' }} />
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 700, color: 'white', lineHeight: 1.3 }}>
          UMCD<br />{isFinanceOnly ? 'Finance' : 'Planning Hub'}
        </div>
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>Bumble Bee Studios</div>
      </div>

      {/* Main nav */}
      <nav style={{ flex: 1, padding: '12px 0' }}>
        {items.map(item => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
              padding: '11px 20px',
              background: page === item.id ? 'rgba(255,255,255,0.15)' : 'none',
              border: 'none',
              color: page === item.id ? 'white' : 'rgba(255,255,255,0.65)',
              fontSize: '14px', fontWeight: page === item.id ? 600 : 400,
              cursor: 'pointer', textAlign: 'left',
              borderLeft: page === item.id ? '3px solid var(--gold)' : '3px solid transparent',
              transition: 'all 0.15s',
            }}
          >
            <img src={item.icon} alt="" style={{ width: '20px', height: '20px', flexShrink: 0 }} />
            {item.label}
          </button>
        ))}
      </nav>

      {/* Other Apps — hidden for finance-only logins to keep things simple */}
      {!isFinanceOnly && (
        <div style={{ padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{
            fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.1em', color: 'rgba(255,255,255,0.35)',
            padding: '4px 20px 8px',
          }}>
            Other Apps
          </div>
          {OTHER_APPS.map(app => (
            <a
              key={app.href}
              href={app.href}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '9px 20px',
                color: 'rgba(255,255,255,0.55)',
                fontSize: '13px',
                textDecoration: 'none',
                borderLeft: '3px solid transparent',
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'white'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'}
            >
              <span style={{ fontSize: '15px' }}>{app.icon}</span>
              {app.label}
            </a>
          ))}
        </div>
      )}

      {/* Sign out */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>{session?.user?.email}</div>
        <button onClick={handleLogout} style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Sign out →
        </button>
      </div>
    </div>
  )
}
