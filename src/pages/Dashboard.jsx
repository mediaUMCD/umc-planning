import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

function getSeasonStyle(color) {
  const map = {
    'Purple': { bg: '#f3e5f5', color: '#6B2D8B', dot: '#6B2D8B' },
    'White': { bg: '#fff8e7', color: '#b8860b', dot: '#C9A84C' },
    'Gold': { bg: '#fff8e7', color: '#b8860b', dot: '#C9A84C' },
    'Green': { bg: '#e8f5ee', color: '#2d7a4f', dot: '#2d7a4f' },
    'Red': { bg: '#fdecea', color: '#c0392b', dot: '#c0392b' },
    'Grey': { bg: '#f0f0f0', color: '#666', dot: '#888' },
  }
  return map[color] || { bg: '#f0ede8', color: '#5c5850', dot: '#9b9690' }
}

export default function Dashboard({ navigate }) {
  const [upcoming, setUpcoming] = useState([])
  const [stats, setStats] = useState({ totalDates: 0, totalHymns: 0, pendingUploads: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const today = new Date().toISOString().slice(0, 10)

      const { data: upcomingData } = await supabase
        .from('service_dates')
        .select('*, service_hymns(*)')
        .gte('service_date', today)
        .order('service_date', { ascending: true })
        .limit(5)

      const { count: totalDates } = await supabase
        .from('service_dates')
        .select('*', { count: 'exact', head: true })

      const { count: totalHymns } = await supabase
        .from('hymns')
        .select('*', { count: 'exact', head: true })

      const { count: pendingUploads } = await supabase
        .from('upload_tracker')
        .select('*', { count: 'exact', head: true })
        .eq('is_uploaded', false)

      setUpcoming(upcomingData || [])
      setStats({ totalDates, totalHymns, pendingUploads })
      setLoading(false)
    }
    load()
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const formatDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p style={{ fontSize: '13px', color: 'var(--gray-400)', marginTop: '2px' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>

      <div className="page-body">
        {loading ? <div className="spinner" /> : (
          <>
            <div className="grid-3" style={{ marginBottom: '24px' }}>
              {[
                { label: 'Service Dates', value: stats.totalDates, icon: '📅', color: 'var(--burgundy-light)', accent: 'var(--burgundy)' },
                { label: 'Hymns in Database', value: stats.totalHymns, icon: '🎵', color: '#e8f5ee', accent: 'var(--success)' },
                { label: 'Pending Uploads', value: stats.pendingUploads, icon: '📤', color: stats.pendingUploads > 0 ? 'var(--warning-light)' : '#e8f5ee', accent: stats.pendingUploads > 0 ? 'var(--warning)' : 'var(--success)' },
              ].map(stat => (
                <div key={stat.label} className="card" style={{ background: stat.color }}>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>{stat.icon}</div>
                  <div style={{ fontSize: '28px', fontWeight: 700, color: stat.accent }}>{stat.value}</div>
                  <div style={{ fontSize: '13px', color: 'var(--gray-600)', marginTop: '2px' }}>{stat.label}</div>
                </div>
              ))}
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Upcoming Services</h2>
                <button className="btn btn-primary btn-sm" onClick={() => navigate('planner')}>View All →</button>
              </div>

              {upcoming.length === 0 ? (
                <div className="empty-state">
                  <div className="icon">📅</div>
                  <p>No upcoming services planned yet.</p>
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Season</th>
                      <th>Type</th>
                      <th>Spark</th>
                      <th>Hymns</th>
                      <th>Communion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.map(svc => {
                      const style = getSeasonStyle(svc.liturgical_color)
                      const isToday = svc.service_date === today
                      return (
                        <tr key={svc.id} style={{ background: isToday ? 'var(--burgundy-light)' : '' }}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{formatDate(svc.service_date)}</div>
                            {isToday && <span style={{ fontSize: '11px', color: 'var(--burgundy)', fontWeight: 700 }}>TODAY</span>}
                          </td>
                          <td>
                            <span className="season-badge" style={{ background: style.bg, color: style.color }}>
                              <span className="status-dot" style={{ background: style.dot }} />
                              {svc.season || '—'}
                            </span>
                          </td>
                          <td style={{ fontSize: '13px', color: 'var(--gray-600)' }}>{svc.service_type || '—'}</td>
                          <td style={{ fontSize: '13px' }}>{svc.spark_title || '—'}</td>
                          <td style={{ fontSize: '13px' }}>{svc.service_hymns?.length || 0}</td>
                          <td>{svc.is_communion ? '🥖' : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="grid-2" style={{ marginTop: '16px' }}>
              <button className="card" onClick={() => navigate('planner')} style={{ textAlign: 'left', cursor: 'pointer', border: '2px dashed var(--gray-200)', background: 'none' }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>📅</div>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>Plan a Service</div>
                <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>Add hymns, scriptures, spark title and more</div>
              </button>
              <button className="card" onClick={() => navigate('hymns')} style={{ textAlign: 'left', cursor: 'pointer', border: '2px dashed var(--gray-200)', background: 'none' }}>
                <div style={{ fontSize: '24px', marginBottom: '8px' }}>🎵</div>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>Hymn Lookup</div>
                <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>Search by number, see last played dates</div>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
