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

const formatDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
})
const formatShortDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
  month: 'short', day: 'numeric'
})

export default function Dashboard({ navigate, onViewService, onViewCE }) {
  const [upcoming, setUpcoming] = useState([])
  const [youthSessions, setYouthSessions] = useState({}) // date -> session[]
  const [adultSessions, setAdultSessions] = useState([])
  const [bibleStudy, setBibleStudy] = useState(null) // { id, name, upcomingSessions } | null
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const today = new Date().toISOString().slice(0, 10)

      const { data: upcomingData } = await supabase
        .from('service_dates')
        .select('*, service_hymns(*)')
        .gte('service_date', today)
        .order('service_date', { ascending: true })
        .limit(4)
      setUpcoming(upcomingData || [])

      const serviceDates = (upcomingData || []).map(s => s.service_date)

      if (serviceDates.length > 0) {
        const { data: youthData } = await supabase
          .from('ce_sessions')
          .select('*, ce_classes!inner(id, name, class_type)')
          .eq('ce_classes.class_type', 'youth_sunday_school')
          .in('session_date', serviceDates)
        const byDate = {}
        for (const s of (youthData || [])) {
          if (!byDate[s.session_date]) byDate[s.session_date] = []
          byDate[s.session_date].push(s)
        }
        setYouthSessions(byDate)
      }

      const { data: adultData } = await supabase
        .from('ce_sessions')
        .select('*, ce_classes!inner(id, name, class_type)')
        .eq('ce_classes.class_type', 'adult_sunday_school')
        .gte('session_date', today)
        .order('session_date', { ascending: true })
        .limit(2)
      setAdultSessions(adultData || [])

      const { data: seriesData } = await supabase
        .from('ce_series')
        .select('id, name, class_id, ce_classes(class_type, name), ce_sessions(id, session_date, topic)')
      const bibleSeries = (seriesData || [])
        .filter(s => s.ce_classes?.class_type === 'bible_study')
        .map(s => ({ ...s, upcomingSessions: (s.ce_sessions || []).filter(sess => sess.session_date >= today).sort((a, b) => a.session_date.localeCompare(b.session_date)) }))
        .filter(s => s.upcomingSessions.length > 0)
        .sort((a, b) => a.upcomingSessions[0].session_date.localeCompare(b.upcomingSessions[0].session_date))
      setBibleStudy(bibleSeries[0] || null)

      try {
        const { data: eventsData, error } = await supabase
          .from('events')
          .select('id, event_name, event_date, event_time, location, category, status, is_public')
          .eq('status', 'approved')
          .gte('event_date', today)
          .order('event_date', { ascending: true })
          .limit(3)
        if (!error) setEvents(eventsData || [])
      } catch {
        setEvents([])
      }

      setLoading(false)
    }
    load()
  }, [])

  const today = new Date().toISOString().slice(0, 10)

  function goToCESession(session) {
    onViewCE?.({ classId: session.ce_classes?.id || session.class_id, sessionId: session.id })
  }
  function goToBibleStudySeries() {
    if (bibleStudy) onViewCE?.({ seriesId: bibleStudy.id })
    else navigate('christian-education')
  }

  const rowStyle = { cursor: 'pointer' }
  const dateLinkStyle = { fontWeight: 700, color: 'var(--burgundy)', textDecoration: 'underline', textDecorationColor: 'rgba(61,0,38,0.3)' }

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
            <div className="card" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Upcoming Services</h2>
                <button className="btn btn-primary btn-sm" onClick={() => navigate('planner')}>View All →</button>
              </div>

              {upcoming.length === 0 ? (
                <div className="empty-state"><div className="icon">📅</div><p>No upcoming services planned yet.</p></div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th><th>Season</th><th>Type</th><th>Spark</th><th>Hymns</th><th>Communion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcoming.map(svc => {
                      const style = getSeasonStyle(svc.liturgical_color)
                      const isToday = svc.service_date === today
                      return (
                        <tr key={svc.id} style={{ background: isToday ? 'var(--burgundy-light)' : '', ...rowStyle }}
                          onClick={() => onViewService(svc.id)}
                          onMouseEnter={e => { if (!isToday) e.currentTarget.style.background = 'var(--gray-50)' }}
                          onMouseLeave={e => { if (!isToday) e.currentTarget.style.background = '' }}>
                          <td>
                            <div style={dateLinkStyle}>{formatDate(svc.service_date)}</div>
                            {isToday && <span style={{ fontSize: '11px', color: 'var(--burgundy)', fontWeight: 700 }}>TODAY</span>}
                          </td>
                          <td>{svc.season ? (
                            <span className="season-badge" style={{ background: style.bg, color: style.color }}>
                              <span className="status-dot" style={{ background: style.dot }} />{svc.season}
                            </span>
                          ) : '—'}</td>
                          <td style={{ fontSize: '13px', color: 'var(--gray-600)' }}>{svc.service_type || '—'}</td>
                          <td style={{ fontSize: '13px' }}>{svc.spark_title ? `"${svc.spark_title}"` : '—'}</td>
                          <td style={{ fontSize: '13px' }}>{svc.service_hymns?.length || 0}</td>
                          <td>{svc.is_communion ? '🥖' : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Youth Christian Education</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('christian-education')}>View All →</button>
              </div>
              {upcoming.length === 0 ? (
                <div className="empty-state"><div className="icon">🌟</div><p>No service dates to match against yet.</p></div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Class</th><th>Topic</th></tr></thead>
                  <tbody>
                    {upcoming.map(svc => {
                      const sessions = youthSessions[svc.service_date] || []
                      if (sessions.length === 0) {
                        return (
                          <tr key={svc.id}>
                            <td style={{ fontSize: '13px', fontWeight: 600 }}>{formatShortDate(svc.service_date)}</td>
                            <td colSpan={2} style={{ fontSize: '13px', color: 'var(--gray-400)', fontStyle: 'italic' }}>Not yet entered</td>
                          </tr>
                        )
                      }
                      return sessions.map(s => (
                        <tr key={s.id} style={rowStyle} onClick={() => goToCESession(s)}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <td style={{ fontSize: '13px', fontWeight: 600 }}>{formatShortDate(svc.service_date)}</td>
                          <td style={{ fontSize: '13px' }}>{s.ce_classes?.name || '—'}</td>
                          <td style={{ fontSize: '13px', color: 'var(--gray-600)' }}>{s.topic || '—'}</td>
                        </tr>
                      ))
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Adult Christian Education</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('christian-education')}>View All →</button>
              </div>
              {adultSessions.length === 0 ? (
                <div className="empty-state"><div className="icon">📖</div><p>No upcoming sessions scheduled.</p></div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Class</th><th>Topic</th></tr></thead>
                  <tbody>
                    {adultSessions.map(s => (
                      <tr key={s.id} style={rowStyle} onClick={() => goToCESession(s)}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <td style={{ fontSize: '13px', fontWeight: 600 }}>{formatShortDate(s.session_date)}</td>
                        <td style={{ fontSize: '13px' }}>{s.ce_classes?.name || '—'}</td>
                        <td style={{ fontSize: '13px', color: 'var(--gray-600)' }}>{s.topic || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Bible Study</h2>
                <button className="btn btn-secondary btn-sm" onClick={() => navigate('christian-education')}>View All →</button>
              </div>
              {!bibleStudy ? (
                <div className="empty-state"><div className="icon">📚</div><p>None scheduled at this time.</p></div>
              ) : (
                <div style={rowStyle} onClick={goToBibleStudySeries}>
                  <div style={{ fontWeight: 700, color: 'var(--burgundy)', marginBottom: '8px' }}>{bibleStudy.name}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {bibleStudy.upcomingSessions.map(s => (
                      <span key={s.id} className="season-badge" style={{ background: '#e8f5e9', color: '#2d7a4f' }}>
                        {formatShortDate(s.session_date)}{s.topic ? ` — ${s.topic}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700 }}>Upcoming Events</h2>
                <a href="https://board.umcdanielson.org/events" target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                  Open in One Board →
                </a>
              </div>
              {events.length === 0 ? (
                <div className="empty-state"><div className="icon">🗓️</div><p>No upcoming approved events.</p></div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Event</th><th>Location</th><th></th></tr></thead>
                  <tbody>
                    {events.map(ev => (
                      <tr key={ev.id} style={rowStyle}
                        onClick={() => window.open('https://board.umcdanielson.org/events', '_blank')}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <td style={{ fontSize: '13px', fontWeight: 600 }}>{formatShortDate(ev.event_date)}</td>
                        <td style={{ fontSize: '13px' }}>{ev.event_name}</td>
                        <td style={{ fontSize: '13px', color: 'var(--gray-600)' }}>{ev.location || '—'}</td>
                        <td>
                          <span className="season-badge" style={ev.is_public === false ? { background: '#fff3e0', color: '#b8860b' } : { background: '#e8f5ee', color: '#2d7a4f' }}>
                            {ev.is_public === false ? '🔒 In-house' : 'Public'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
