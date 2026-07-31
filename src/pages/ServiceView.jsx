import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import VolunteerRolesPanel from '../components/VolunteerRolesPanel.jsx'
import BulletinGenerateModal from '../components/BulletinGenerateModal.jsx'

function getSeasonStyle(color) {
  const map = {
    'Purple': { bg: '#f3e5f5', color: '#6B2D8B', strip: '#6B2D8B' },
    'White': { bg: '#fff8e7', color: '#b8860b', strip: '#C9A84C' },
    'Green': { bg: '#e8f5ee', color: '#2d7a4f', strip: '#2d7a4f' },
    'Red': { bg: '#fdecea', color: '#c0392b', strip: '#c0392b' },
    'Grey': { bg: '#f0f0f0', color: '#666', strip: '#888' },
  }
  return map[color] || { bg: '#f0ede8', color: '#5c5850', strip: '#9b9690' }
}

function buildBibleGatewayUrl(reference, version) {
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(reference)}&version=${encodeURIComponent(version || 'CEB')}`
}

const formatDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
})

export default function ServiceView({ serviceId, onBack, onEdit }) {
  const [service, setService] = useState(null)
  const [hymns, setHymns] = useState([])
  const [scriptures, setScriptures] = useState([])
  const [hymnTitles, setHymnTitles] = useState({})
  const [loading, setLoading] = useState(true)
  const [showGenerateModal, setShowGenerateModal] = useState(false)

  useEffect(() => {
    const load = async () => {
      const [{ data: svc }, { data: hymnDb }] = await Promise.all([
        supabase.from('service_dates')
          .select('*, service_hymns(*), service_scriptures(*)')
          .eq('id', serviceId)
          .single(),
        supabase.from('hymns').select('hymnal, number, title')
      ])

      if (svc) {
        setService(svc)
        setHymns(svc.service_hymns?.sort((a, b) => a.sort_order - b.sort_order) || [])
        setScriptures(svc.service_scriptures?.sort((a, b) => a.sort_order - b.sort_order) || [])
      }

      // Build hymn title lookup
      const lookup = {}
      for (const h of (hymnDb || [])) {
        lookup[`${h.hymnal}-${h.number}`] = h.title
      }
      setHymnTitles(lookup)
      setLoading(false)
    }
    load()
  }, [serviceId])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
      <div className="spinner" />
    </div>
  )

  if (!service) return (
    <div className="empty-state"><div className="icon">📅</div><p>Service not found.</p></div>
  )

  const style = getSeasonStyle(service.liturgical_color)

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={onBack}>← Back</button>
          <div>
            <h1 className="page-title">{formatDate(service.service_date)}</h1>
            {service.season && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: style.color, background: style.bg, padding: '3px 10px', borderRadius: '20px', marginTop: '4px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: style.strip, flexShrink: 0 }} />
                {service.season}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-secondary" onClick={() => setShowGenerateModal(true)}>📄 Generate Bulletin</button>
          <button className="btn btn-primary" onClick={onEdit}>✏️ Edit Service</button>
        </div>
      </div>

      {showGenerateModal && (
        <BulletinGenerateModal
          service={service}
          hymns={hymns}
          scriptures={scriptures}
          onClose={() => setShowGenerateModal(false)}
        />
      )}

      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>

        {/* LEFT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Service Info */}
          <div className="card">
            <h2 style={sHead}>📅 Service Details</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {service.liturgical_color && (
                <Row label="Altar Color">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: style.strip, display: 'inline-block' }} />
                    {service.liturgical_color}
                  </span>
                </Row>
              )}
              <Row label="Service Type">{service.service_type || '—'}</Row>
              <Row label="Communion">
                {service.is_communion ? <span style={{ color: '#856404', fontWeight: 600 }}>🥖 Yes</span> : '—'}
              </Row>
              {service.special_designation && <Row label="Designation">{service.special_designation}</Row>}
              <Row label="Service Time">{service.service_time || '—'}</Row>
            </div>
          </div>

          {/* Sunday Spark */}
          <div className="card">
            <h2 style={sHead}>✨ Sunday Spark</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {service.sermon_series && <Row label="Series">{service.sermon_series}</Row>}
              <Row label="Spark Title">
                <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--burgundy)' }}>
                  {service.spark_title || '—'}
                </span>
              </Row>
              <Row label="Preacher">{service.spark_preacher || '—'}</Row>
            </div>
          </div>

          {/* People */}
          <div className="card">
            <h2 style={sHead}>👥 People</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Row label="Kids Story">{service.kids_story_teller || '—'}</Row>
              <Row label="Liturgist">{service.liturgist || '—'}</Row>
            </div>
          </div>

          {/* Call to Worship */}
          {service.call_to_worship_text && (
            <div className="card">
              <h2 style={sHead}>🙏 Call to Worship</h2>
              <div style={{ fontSize: '14px', color: 'var(--gray-800)', lineHeight: 1.6 }}
                dangerouslySetInnerHTML={{ __html: service.call_to_worship_text }} />
              {service.call_to_worship_source && (
                <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '8px' }}>{service.call_to_worship_source}</div>
              )}
            </div>
          )}

          {/* Offertory Prayer */}
          {service.offertory_prayer_text && (
            <div className="card">
              <h2 style={sHead}>🕊️ Offertory Prayer</h2>
              <div style={{ fontSize: '14px', color: 'var(--gray-800)', lineHeight: 1.6 }}
                dangerouslySetInnerHTML={{ __html: service.offertory_prayer_text }} />
              {service.offering_prayer_source && (
                <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '8px' }}>{service.offering_prayer_source}</div>
              )}
            </div>
          )}

          {/* Announcements */}
          {(service.announcements_list || service.announcements_reader) && (
            <div className="card">
              <h2 style={sHead}>📢 Announcements</h2>
              {service.announcements_reader && <Row label="Reader">{service.announcements_reader}</Row>}
              {service.announcements_list && (
                <p style={{ fontSize: '14px', color: 'var(--gray-800)', lineHeight: 1.6, whiteSpace: 'pre-wrap', marginTop: service.announcements_reader ? '10px' : 0 }}>
                  {service.announcements_list}
                </p>
              )}
            </div>
          )}

          {/* Notes */}
          {service.notes && (
            <div className="card">
              <h2 style={sHead}>📝 Notes</h2>
              <p style={{ fontSize: '14px', color: 'var(--gray-800)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{service.notes}</p>
            </div>
          )}
        </div>

        {/* RIGHT COLUMN */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Hymns */}
          <div className="card">
            <h2 style={sHead}>🎵 Hymns</h2>
            {hymns.length === 0 ? (
              <div style={{ fontSize: '14px', color: 'var(--gray-400)', fontStyle: 'italic' }}>No hymns planned yet</div>
            ) : hymns.map((h, i) => {
              const title = hymnTitles[`${h.hymnal}-${h.number}`] || ''
              return (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: i < hymns.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                  <div style={{ fontSize: '12px', color: 'var(--gray-400)', minWidth: '16px', fontWeight: 700 }}>{i + 1}</div>
                  <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', flexShrink: 0, background: h.hymnal === 'UMH' ? 'var(--burgundy-light)' : '#e3f2fd', color: h.hymnal === 'UMH' ? 'var(--burgundy)' : '#1565c0' }}>
                    {h.hymnal} #{h.number}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--gray-800)' }}>{title || '—'}</div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Scriptures */}
          <div className="card">
            <h2 style={sHead}>📖 Scripture Readings</h2>
            {scriptures.length === 0 ? (
              <div style={{ fontSize: '14px', color: 'var(--gray-400)', fontStyle: 'italic' }}>No scriptures planned yet</div>
            ) : scriptures.map((s, i) => (
              <div key={s.id} style={{ padding: '10px 0', borderBottom: i < scriptures.length - 1 ? '1px solid var(--gray-100)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                      {s.is_call_and_response && (
                        <span style={{ fontSize: '10px', fontWeight: 700, background: '#e8f5ee', color: '#2d7a4f', padding: '1px 6px', borderRadius: '10px' }}>CALL & RESPONSE</span>
                      )}
                      <span style={{ fontSize: '11px', color: 'var(--gray-400)', fontWeight: 600 }}>{s.bible_version}</span>
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--gray-800)' }}>{s.reference}</div>
                  </div>
                  <a href={buildBibleGatewayUrl(s.reference, s.bible_version)} target="_blank" rel="noreferrer"
                    style={{ fontSize: '12px', color: 'var(--burgundy)', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                    🔗 Read
                  </a>
                </div>
              </div>
            ))}
          </div>

          <VolunteerRolesPanel serviceId={service.id} serviceDate={service.service_date} serviceTime={service.service_time} />

        </div>
      </div>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.5px', minWidth: '100px', paddingTop: '2px' }}>{label}</span>
      <span style={{ fontSize: '14px', color: 'var(--gray-800)', flex: 1 }}>{children}</span>
    </div>
  )
}

const sHead = {
  fontSize: '14px', fontWeight: 700, color: 'var(--burgundy)',
  marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid var(--gray-100)',
}
