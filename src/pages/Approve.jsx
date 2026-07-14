import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const CONTENT_LABELS = {
  sermon: 'Sunday Spark Sermon',
  music: 'Sunday Spark: The Set List',
}

function formatServiceDate(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function Approve() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  const type = params.get('type')
  const serviceId = params.get('service')

  const [loading, setLoading] = useState(true)
  const [svc, setSvc] = useState(null)
  const [error, setError] = useState(null)
  const [approving, setApproving] = useState(false)
  const [approved, setApproved] = useState(false)
  const [editedTitle, setEditedTitle] = useState('')
  const [editedBlurb, setEditedBlurb] = useState('')

  useEffect(() => {
    async function load() {
      if (!token || !type || !serviceId || !CONTENT_LABELS[type]) {
        setError('This link is missing information and can\u2019t be used.')
        setLoading(false)
        return
      }
      const { data, error: fetchErr } = await supabase
        .from('service_dates')
        .select('id, service_date, spark_title, podcast_summary, special_music_title, special_music_person, music_podcast_summary, sermon_approval_status, sermon_approval_token, music_approval_status, music_approval_token')
        .eq('id', serviceId)
        .single()

      if (fetchErr || !data) {
        setError('This service could not be found.')
        setLoading(false)
        return
      }

      const statusField = `${type}_approval_status`
      const tokenField = `${type}_approval_token`

      if (data[statusField] === 'approved') {
        setApproved(true)
        setSvc(data)
        setLoading(false)
        return
      }
      if (data[tokenField] !== token) {
        setError('This approval link is invalid or has already been used.')
        setLoading(false)
        return
      }

      setSvc(data)
      setEditedTitle((type === 'sermon' ? data.spark_title : data.special_music_title) || '')
      setEditedBlurb((type === 'sermon' ? data.podcast_summary : data.music_podcast_summary) || '')
      setLoading(false)
    }
    load()
  }, [])

  async function handleApprove() {
    setApproving(true)
    setError(null)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('content-approval', {
        body: { action: 'approve', serviceId, contentType: type, token, title: editedTitle, blurb: editedBlurb },
      })
      if (fnError) throw fnError
      if (data?.error) throw new Error(data.error)
      setApproved(true)
    } catch (err) {
      setError(err.message || 'Something went wrong — please try again or let Corissa know.')
    }
    setApproving(false)
  }

  const label = CONTENT_LABELS[type]

  return (
    <div style={{ minHeight: '100vh', background: '#FAF7F8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', fontFamily: 'Georgia, serif' }}>
      <div style={{ background: 'white', borderRadius: '14px', boxShadow: '0 4px 24px rgba(61,0,38,0.12)', padding: '36px', maxWidth: '480px', width: '100%' }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: '30px 0' }}>
            <div style={{ width: '32px', height: '32px', border: '3px solid #F7E6F0', borderTop: '3px solid #3D0026', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
          </div>
        )}

        {!loading && error && !approved && (
          <div>
            <div style={{ fontSize: '32px', marginBottom: '12px', textAlign: 'center' }}>⚠️</div>
            <p style={{ textAlign: 'center', color: '#7A0047', fontWeight: 700 }}>{error}</p>
          </div>
        )}

        {!loading && approved && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>✓</div>
            <h1 style={{ fontSize: '20px', color: '#3D0026', marginBottom: '8px' }}>Approved!</h1>
            <p style={{ color: '#666', fontSize: '14px' }}>
              {label} {svc?.service_date ? `for ${formatServiceDate(svc.service_date)}` : ''} has been marked approved.
              {editedTitle && <> Thanks for reviewing "<strong>{editedTitle}</strong>."</>}
            </p>
          </div>
        )}

        {!loading && !error && !approved && svc && (
          <div>
            <div style={{ fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#7A0047', fontWeight: 700, marginBottom: '6px' }}>
              {label}
            </div>
            <h1 style={{ fontSize: '20px', color: '#3D0026', marginBottom: '4px' }}>{formatServiceDate(svc.service_date)}</h1>
            <p style={{ fontSize: '13px', color: '#888', marginBottom: '20px' }}>Edit if anything's off, then approve.</p>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#7A0047', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Title</label>
              <input
                type="text"
                value={editedTitle}
                onChange={e => setEditedTitle(e.target.value)}
                placeholder="(none entered)"
                style={{ width: '100%', fontSize: '16px', color: '#1a1a1a', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e0d5db', boxSizing: 'border-box', fontFamily: 'inherit', marginBottom: '14px' }}
              />

              <label style={{ fontSize: '11px', fontWeight: 700, color: '#7A0047', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>Episode Summary</label>
              <textarea
                value={editedBlurb}
                onChange={e => setEditedBlurb(e.target.value)}
                placeholder="(none entered)"
                rows={5}
                style={{ width: '100%', fontSize: '14px', color: '#1a1a1a', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e0d5db', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.5, resize: 'vertical' }}
              />
            </div>

            {error && <p style={{ color: '#c62828', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

            <button
              onClick={handleApprove}
              disabled={approving}
              style={{
                width: '100%', padding: '14px', background: '#3D0026', color: 'white', border: 'none',
                borderRadius: '8px', fontSize: '16px', fontWeight: 700, cursor: approving ? 'default' : 'pointer',
                opacity: approving ? 0.6 : 1,
              }}
            >
              {approving ? 'Approving…' : '✓ Approve'}
            </button>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
