import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

function getSeasonStyle(color) {
  const map = {
    'Purple': { color: '#6B2D8B' },
    'White': { color: '#b8860b' },
    'Green': { color: '#2d7a4f' },
    'Red': { color: '#c0392b' },
    'Grey': { color: '#888' },
  }
  return map[color] || { color: '#9b9690' }
}

const formatDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
})

export default function SetList() {
  const [services, setServices] = useState([])
  const [hymnTitles, setHymnTitles] = useState({})
  const [loading, setLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(10)

  useEffect(() => {
    const load = async () => {
      const today = new Date().toISOString().slice(0, 10)
      const [{ data: svcData }, { data: hymnDb }] = await Promise.all([
        supabase
          .from('service_dates')
          .select('id, service_date, season, liturgical_color, special_music_title, special_music_person, service_hymns(*), upload_tracker(upload_type, url)')
          .lte('service_date', today)
          .order('service_date', { ascending: false }),
        supabase.from('hymns').select('hymnal, number, title'),
      ])
      const lookup = {}
      for (const h of (hymnDb || [])) lookup[`${h.hymnal}-${h.number}`] = h.title
      setHymnTitles(lookup)
      setServices(svcData || [])
      setLoading(false)
    }
    load()
  }, [])

  const visible = services.slice(0, visibleCount)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--gray-50)' }}>
      {/* Header */}
      <div style={{ background: 'var(--burgundy)', padding: '48px 20px 40px', textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '13px', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginBottom: '10px' }}>
          Sunday Spark
        </div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '36px', fontWeight: 700, color: 'white', margin: 0 }}>
          The Set List
        </h1>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.7)', marginTop: '10px', maxWidth: '480px', marginLeft: 'auto', marginRight: 'auto' }}>
          The hymns and special music from worship each week at United Methodist Church of Danielson —
          with links to watch or listen.
        </p>
      </div>

      {/* List */}
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 20px 60px' }}>
        {loading ? (
          <div className="spinner" style={{ margin: '60px auto' }} />
        ) : visible.length === 0 ? (
          <div className="empty-state"><div className="icon">🎵</div><p>No set lists posted yet — check back soon!</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {visible.map(svc => {
              const style = getSeasonStyle(svc.liturgical_color)
              const hymns = (svc.service_hymns || []).sort((a, b) => a.sort_order - b.sort_order)
              const musicUrl = svc.upload_tracker?.find(t => t.upload_type === 'music')?.url
              const podcastUrl = svc.upload_tracker?.find(t => t.upload_type === 'podcast_music')?.url
              const hasMusic = svc.special_music_title || musicUrl || podcastUrl

              return (
                <div key={svc.id} className="card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: style.color, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--burgundy)' }}>{formatDate(svc.service_date)}</div>
                      {svc.season && <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>{svc.season}</div>}
                    </div>
                  </div>

                  {hymns.length > 0 && (
                    <div style={{ marginBottom: hasMusic ? '14px' : 0 }}>
                      {hymns.map((h, i) => (
                        <div key={h.id || i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderBottom: i < hymns.length - 1 || hasMusic ? '1px solid var(--gray-100)' : 'none' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', flexShrink: 0, background: h.hymnal === 'UMH' ? 'var(--burgundy-light)' : '#e3f2fd', color: h.hymnal === 'UMH' ? 'var(--burgundy)' : '#1565c0' }}>
                            {h.hymnal} #{h.number}
                          </span>
                          <span style={{ fontSize: '14px', color: 'var(--gray-800)' }}>{hymnTitles[`${h.hymnal}-${h.number}`] || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {hasMusic && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                      <div>
                        {svc.special_music_title && (
                          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--gray-800)' }}>
                            🎵 {svc.special_music_title}
                          </div>
                        )}
                        {svc.special_music_person && (
                          <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>{svc.special_music_person}</div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {musicUrl && (
                          <a href={musicUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none', display: 'inline-block' }}>
                            ▶ Watch
                          </a>
                        )}
                        {podcastUrl && (
                          <a href={podcastUrl} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm" style={{ textDecoration: 'none', display: 'inline-block' }}>
                            🎧 Listen
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {hymns.length === 0 && !hasMusic && (
                    <div style={{ fontSize: '13px', color: 'var(--gray-400)', fontStyle: 'italic' }}>No music details posted for this week</div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!loading && visibleCount < services.length && (
          <div style={{ textAlign: 'center', marginTop: '24px' }}>
            <button className="btn btn-secondary" onClick={() => setVisibleCount(c => c + 10)}>Load more</button>
          </div>
        )}
      </div>
    </div>
  )
}
