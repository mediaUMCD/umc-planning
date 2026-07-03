import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const UPLOAD_TYPES = [
  { key: 'service', label: 'Full Service', icon: '📹' },
  { key: 'children', label: "Children's Story", icon: '👦' },
  { key: 'spark', label: 'Sunday Spark', icon: '✨' },
  { key: 'music', label: 'Special Music', icon: '🎵' },
  { key: 'special', label: 'Special Video', icon: '⭐' },
  { key: 'podcast_spark', label: 'Podcast (Spark)', icon: '🎙' },
  { key: 'podcast_music', label: 'Podcast (Music)', icon: '🎧' },
]

function getSeasonStyle(color) {
  const map = {
    'Purple': { color: '#6B2D8B' },
    'White': { color: '#b8860b' },
    'Green': { color: '#2d7a4f' },
    'Red': { color: '#c0392b' },
    'Grey': { color: '#888' },
  }
  return map[color] || { color: '#5c5850' }
}

export default function UploadTracker() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('recent')
  const [expandedId, setExpandedId] = useState(null)
  const [editingUrl, setEditingUrl] = useState(null)
  const [urlValue, setUrlValue] = useState('')

  useEffect(() => { loadData() }, [filter])

  async function loadData() {
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)

    let query = supabase
      .from('service_dates')
      .select('*, upload_tracker(*)')
      .lte('service_date', today)
      .order('service_date', { ascending: false })

    if (filter === 'recent') {
      query = query.limit(12)
    }

    const { data } = await query
    setServices(data || [])
    setLoading(false)
  }

  async function toggleUpload(trackerId, currentValue) {
    await supabase.from('upload_tracker').update({ is_uploaded: !currentValue }).eq('id', trackerId)
    setServices(prev => prev.map(svc => ({
      ...svc,
      upload_tracker: svc.upload_tracker?.map(t =>
        t.id === trackerId ? { ...t, is_uploaded: !currentValue } : t
      )
    })))
  }

  async function togglePodcast(trackerId, currentValue) {
    await supabase.from('upload_tracker').update({ podcast_published: !currentValue }).eq('id', trackerId)
    setServices(prev => prev.map(svc => ({
      ...svc,
      upload_tracker: svc.upload_tracker?.map(t =>
        t.id === trackerId ? { ...t, podcast_published: !currentValue } : t
      )
    })))
  }

  async function saveUrl(trackerId) {
    await supabase.from('upload_tracker').update({ url: urlValue || null }).eq('id', trackerId)
    setServices(prev => prev.map(svc => ({
      ...svc,
      upload_tracker: svc.upload_tracker?.map(t =>
        t.id === trackerId ? { ...t, url: urlValue || null } : t
      )
    })))
    setEditingUrl(null)
    setUrlValue('')
  }

  const formatDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

  const getTracker = (svc, key) => svc.upload_tracker?.find(t => t.upload_type === key)

  const getCompletionCount = (svc) => {
    const relevant = UPLOAD_TYPES.filter(t => !t.key.startsWith('podcast'))
    const done = relevant.filter(t => getTracker(svc, t.key)?.is_uploaded).length
    return { done, total: relevant.length }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Upload Tracker</h1>
          <p style={{ fontSize: '13px', color: 'var(--gray-400)', marginTop: '2px' }}>
            Track YouTube uploads and podcast publishing per service
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['recent', 'all'].map(f => (
            <button key={f} className="btn" onClick={() => setFilter(f)}
              style={{ background: filter === f ? 'var(--burgundy)' : 'var(--gray-100)', color: filter === f ? 'white' : 'var(--gray-800)' }}>
              {f === 'recent' ? 'Recent (12)' : 'All'}
            </button>
          ))}
        </div>
      </div>

      <div className="page-body">
        {loading ? <div className="spinner" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {services.map(svc => {
              const { done, total } = getCompletionCount(svc)
              const isExpanded = expandedId === svc.id
              const allDone = done === total
              const seasonStyle = getSeasonStyle(svc.liturgical_color)

              return (
                <div key={svc.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>

                  {/* Row header */}
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : svc.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px',
                      cursor: 'pointer', background: allDone ? '#f0faf4' : 'white',
                    }}
                  >
                    <div style={{ width: '4px', height: '40px', borderRadius: '2px', background: seasonStyle.color, flexShrink: 0 }} />

                    <div style={{ minWidth: '220px' }}>
                      <div style={{ fontWeight: 700, fontSize: '14px' }}>{formatDate(svc.service_date)}</div>
                      {svc.season && <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>{svc.season}</div>}
                    </div>

                    <div style={{ minWidth: '240px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {svc.spark_title && (
                        <div style={{ fontSize: '12px', color: 'var(--gray-800)' }} title="Sunday Spark title">
                          ✨ {svc.spark_title}
                        </div>
                      )}
                      {svc.kids_story_teller && (
                        <div style={{ fontSize: '12px', color: 'var(--gray-400)' }} title="Children's story teller">
                          👦 {svc.kids_story_teller}
                        </div>
                      )}
                      {svc.special_music_title && (
                        <div style={{ fontSize: '12px', color: 'var(--gray-400)' }} title="Special music">
                          🎵 {svc.special_music_title}{svc.special_music_person ? ` — ${svc.special_music_person}` : ''}
                        </div>
                      )}
                      {!svc.spark_title && !svc.kids_story_teller && !svc.special_music_title && (
                        <div style={{ fontSize: '12px', color: 'var(--gray-400)', fontStyle: 'italic' }}>No details entered yet</div>
                      )}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>Uploads</span>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: allDone ? 'var(--success)' : 'var(--gray-600)' }}>
                          {done}/{total} {allDone ? '✓' : ''}
                        </span>
                      </div>
                      <div style={{ height: '6px', background: 'var(--gray-100)', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(done / total) * 100}%`, background: allDone ? 'var(--success)' : 'var(--burgundy)', borderRadius: '3px', transition: 'width 0.3s' }} />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      {UPLOAD_TYPES.filter(t => !t.key.startsWith('podcast')).map(t => {
                        const tracker = getTracker(svc, t.key)
                        return (
                          <div key={t.key} title={t.label} style={{ width: '10px', height: '10px', borderRadius: '50%', background: tracker?.is_uploaded ? 'var(--success)' : 'var(--gray-200)' }} />
                        )
                      })}
                    </div>

                    <span style={{ color: 'var(--gray-400)', fontSize: '14px', flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ borderTop: '1px solid var(--gray-100)', padding: '16px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                        {UPLOAD_TYPES.map(type => {
                          const tracker = getTracker(svc, type.key)
                          if (!tracker) return null
                          const isPodcast = type.key.startsWith('podcast')

                          return (
                            <div key={type.key} style={{ border: '1px solid var(--gray-100)', borderRadius: '8px', padding: '12px', background: 'var(--gray-50)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 600 }}>{type.icon} {type.label}</span>
                                {!isPodcast ? (
                                  <label className="checkbox-label" style={{ fontSize: '12px' }}>
                                    <input type="checkbox" checked={tracker.is_uploaded || false}
                                      onChange={() => toggleUpload(tracker.id, tracker.is_uploaded)}
                                      style={{ accentColor: 'var(--burgundy)' }} />
                                    Uploaded
                                  </label>
                                ) : (
                                  <label className="checkbox-label" style={{ fontSize: '12px' }}>
                                    <input type="checkbox" checked={tracker.podcast_published || false}
                                      onChange={() => togglePodcast(tracker.id, tracker.podcast_published)}
                                      style={{ accentColor: 'var(--burgundy)' }} />
                                    Published
                                  </label>
                                )}
                              </div>

                              <div>
                                {editingUrl === tracker.id ? (
                                  <div style={{ display: 'flex', gap: '6px' }}>
                                    <input type="url" value={urlValue} onChange={e => setUrlValue(e.target.value)}
                                      placeholder={isPodcast ? 'https://yourshow.rss.com/episode-...' : 'https://youtube.com/...'}
                                      style={{ fontSize: '12px', padding: '4px 8px', flex: 1 }} />
                                    <button className="btn btn-primary btn-sm" onClick={() => saveUrl(tracker.id)}>Save</button>
                                    <button className="btn btn-secondary btn-sm" onClick={() => { setEditingUrl(null); setUrlValue('') }}>✕</button>
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    {tracker.url ? (
                                      <a href={tracker.url} target="_blank" rel="noreferrer"
                                        style={{ fontSize: '12px', color: 'var(--burgundy)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                        {isPodcast ? '🎧 View Episode' : '▶ View on YouTube'}
                                      </a>
                                    ) : (
                                      <span style={{ fontSize: '12px', color: 'var(--gray-400)', flex: 1 }}>No URL</span>
                                    )}
                                    <button className="btn btn-secondary btn-sm"
                                      onClick={() => { setEditingUrl(tracker.id); setUrlValue(tracker.url || '') }}>
                                      {tracker.url ? 'Edit' : '+ URL'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
