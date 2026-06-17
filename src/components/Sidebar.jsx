import { supabase } from '../lib/supabase.js'

const NAV_ITEMS = [
  { id: 'dashboard', icon: '🏠', label: 'Dashboard' },
  { id: 'planner', icon: '📅', label: 'Service Planner' },
  { id: 'hymns', icon: '🎵', label: 'Hymn Tracker' },
  { id: 'uploads', icon: '📤', label: 'Upload Tracker' },
  { id: 'import', icon: '📥', label: 'Bulletin Import' },
]

export default function Sidebar({ page, navigate, session }) {
  async function handleLogout() {
    await supabase.auth.signOut()
  }

  return (
    <div className="sidebar">
      <div style={{ padding: '24px 20px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize: '24px', marginBottom: '6px' }}>✝</div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 700, color: 'white', lineHeight: 1.3 }}>
          UMCD<br />Planning Hub
        </div>
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>Bumble Bee Studios</div>
      </div>

      <nav style={{ flex: 1, padding: '12px 0' }}>
        {NAV_ITEMS.map(item => (
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
            <span style={{ fontSize: '16px' }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginBottom: '8px' }}>{session?.user?.email}</div>
        <button onClick={handleLogout} style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Sign out →
        </button>
      </div>
    </div>
  )
}
