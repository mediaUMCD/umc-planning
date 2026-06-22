import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const sectionHead = { fontFamily: 'var(--font-display)', fontSize: '15px', fontWeight: 700, color: 'var(--burgundy)', marginBottom: '14px', textTransform: 'uppercase', letterSpacing: '0.03em' }

function emptyDay() { return { day: '', lines: [''] } }
function emptyZoom() { return { label: '', meeting_id: '' } }
function emptyStaff() { return { role: '', name: '' } }

export default function BulletinSettings() {
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.from('bulletin_static_content').select('*').limit(1).single()
    if (error) {
      setError('Could not load bulletin settings. ' + error.message)
    } else {
      setRow({
        ...data,
        weekly_schedule: (data.weekly_schedule || []).map(d => ({ day: d.day || '', lines: d.lines?.length ? d.lines : [''] })),
        zoom_info: data.zoom_info?.length ? data.zoom_info : [emptyZoom()],
        staff_directory: data.staff_directory?.length ? data.staff_directory : [emptyStaff()],
      })
    }
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    setSaveStatus(null)
    const payload = {
      weekly_schedule: row.weekly_schedule
        .map(d => ({ day: d.day.trim(), lines: d.lines.map(l => l.trim()).filter(Boolean) }))
        .filter(d => d.day && d.lines.length),
      zoom_info: row.zoom_info.map(z => ({ label: z.label.trim(), meeting_id: z.meeting_id.trim() })).filter(z => z.label),
      staff_directory: row.staff_directory.map(s => ({ role: s.role.trim(), name: s.name.trim() })).filter(s => s.role),
      church_office_hours: row.church_office_hours,
      church_office_phone: row.church_office_phone,
      pastor_office_hours: row.pastor_office_hours,
      pastor_cell: row.pastor_cell,
      church_tagline: row.church_tagline,
      default_back_cover_photo_url: row.default_back_cover_photo_url,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('bulletin_static_content').update(payload).eq('id', row.id)
    setSaving(false)
    if (error) {
      setSaveStatus({ type: 'error', message: error.message })
    } else {
      setSaveStatus({ type: 'success', message: 'Saved!' })
      setTimeout(() => setSaveStatus(null), 2500)
    }
  }

  // ── Weekly schedule helpers ──
  function updateDay(idx, field, value) {
    setRow(r => ({ ...r, weekly_schedule: r.weekly_schedule.map((d, i) => i === idx ? { ...d, [field]: value } : d) }))
  }
  function updateDayLine(dayIdx, lineIdx, value) {
    setRow(r => ({
      ...r,
      weekly_schedule: r.weekly_schedule.map((d, i) => i === dayIdx
        ? { ...d, lines: d.lines.map((l, j) => j === lineIdx ? value : l) }
        : d),
    }))
  }
  function addDayLine(dayIdx) {
    setRow(r => ({ ...r, weekly_schedule: r.weekly_schedule.map((d, i) => i === dayIdx ? { ...d, lines: [...d.lines, ''] } : d) }))
  }
  function removeDayLine(dayIdx, lineIdx) {
    setRow(r => ({
      ...r,
      weekly_schedule: r.weekly_schedule.map((d, i) => i === dayIdx
        ? { ...d, lines: d.lines.filter((_, j) => j !== lineIdx) }
        : d),
    }))
  }
  function addDay() { setRow(r => ({ ...r, weekly_schedule: [...r.weekly_schedule, emptyDay()] })) }
  function removeDay(idx) { setRow(r => ({ ...r, weekly_schedule: r.weekly_schedule.filter((_, i) => i !== idx) })) }

  // ── Zoom helpers ──
  function updateZoom(idx, field, value) { setRow(r => ({ ...r, zoom_info: r.zoom_info.map((z, i) => i === idx ? { ...z, [field]: value } : z) })) }
  function addZoom() { setRow(r => ({ ...r, zoom_info: [...r.zoom_info, emptyZoom()] })) }
  function removeZoom(idx) { setRow(r => ({ ...r, zoom_info: r.zoom_info.filter((_, i) => i !== idx) })) }

  // ── Staff helpers ──
  function updateStaff(idx, field, value) { setRow(r => ({ ...r, staff_directory: r.staff_directory.map((s, i) => i === idx ? { ...s, [field]: value } : s) })) }
  function addStaff() { setRow(r => ({ ...r, staff_directory: [...r.staff_directory, emptyStaff()] })) }
  function removeStaff(idx) { setRow(r => ({ ...r, staff_directory: r.staff_directory.filter((_, i) => i !== idx) })) }

  if (loading) {
    return <div className="page-body"><div className="spinner" /></div>
  }

  if (error || !row) {
    return (
      <div className="page-body">
        <div className="alert alert-error">{error || 'No bulletin_static_content row found.'}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">🖨️ Bulletin Settings</h1>
          <p style={{ fontSize: '13px', color: 'var(--gray-400)', marginTop: '4px', maxWidth: '560px' }}>
            Edit the fixed Page 2 content used in every generated bulletin — weekly schedule, Zoom info, and staff directory. Changes here apply to all future bulletins immediately, no code changes needed.
          </p>
        </div>
        <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : '💾 Save Changes'}
        </button>
      </div>

      {saveStatus && (
        <div className={saveStatus.type === 'error' ? 'alert alert-error' : 'alert alert-success'} style={{ marginBottom: '16px' }}>
          {saveStatus.message}
        </div>
      )}

      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Weekly Schedule */}
          <div className="card">
            <h2 style={sectionHead}>📅 Another Week in the World</h2>
            {row.weekly_schedule.map((day, dIdx) => (
              <div key={dIdx} style={{ border: '1px solid var(--gray-100)', borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '8px' }}>
                  <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                    <label className="form-label">Day / Frequency Label</label>
                    <input type="text" value={day.day} onChange={e => updateDay(dIdx, 'day', e.target.value)} placeholder="e.g. Sunday, 3rd Tuesday of the Month" style={{ padding: '6px 8px', fontSize: '13px' }} />
                  </div>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => removeDay(dIdx)} style={{ padding: '6px 10px', fontSize: '12px' }}>✕</button>
                </div>
                {day.lines.map((line, lIdx) => (
                  <div key={lIdx} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                    <input type="text" value={line} onChange={e => updateDayLine(dIdx, lIdx, e.target.value)} placeholder="e.g. 9:30 a.m. Sunday School (Up/Downstairs)" style={{ flex: 1, padding: '6px 8px', fontSize: '13px' }} />
                    <button type="button" className="btn btn-secondary" onClick={() => removeDayLine(dIdx, lIdx)} style={{ padding: '6px 10px', fontSize: '12px' }}>✕</button>
                  </div>
                ))}
                <button type="button" className="btn btn-secondary" onClick={() => addDayLine(dIdx)} style={{ fontSize: '12px', padding: '5px 10px' }}>+ Add line</button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={addDay}>+ Add Day / Entry</button>
          </div>

          {/* Zoom Info */}
          <div className="card">
            <h2 style={sectionHead}>💻 Zoom Info</h2>
            {row.zoom_info.map((z, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Label</label>
                  <input type="text" value={z.label} onChange={e => updateZoom(idx, 'label', e.target.value)} placeholder="e.g. Adult Sunday School" style={{ padding: '6px 8px', fontSize: '13px' }} />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Meeting ID</label>
                  <input type="text" value={z.meeting_id} onChange={e => updateZoom(idx, 'meeting_id', e.target.value)} placeholder="e.g. 862 3566 5633" style={{ padding: '6px 8px', fontSize: '13px' }} />
                </div>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeZoom(idx)} style={{ padding: '6px 10px', fontSize: '12px' }}>✕</button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={addZoom}>+ Add Zoom Entry</button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Staff Directory */}
          <div className="card">
            <h2 style={sectionHead}>👥 Staff Directory</h2>
            {row.staff_directory.map((s, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-end' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Role</label>
                  <input type="text" value={s.role} onChange={e => updateStaff(idx, 'role', e.target.value)} placeholder="e.g. Reverend" style={{ padding: '6px 8px', fontSize: '13px' }} />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Name</label>
                  <input type="text" value={s.name} onChange={e => updateStaff(idx, 'name', e.target.value)} placeholder="e.g. Zach LeCrone" style={{ padding: '6px 8px', fontSize: '13px' }} />
                </div>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeStaff(idx)} style={{ padding: '6px 10px', fontSize: '12px' }}>✕</button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary" onClick={addStaff}>+ Add Staff Member</button>

            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--gray-100)' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Church Office Hours</label>
                  <input type="text" value={row.church_office_hours || ''} onChange={e => setRow(r => ({ ...r, church_office_hours: e.target.value }))} placeholder="Tues: 8:30 a.m.- 12 p.m." />
                </div>
                <div className="form-group" style={{ width: '150px', flexShrink: 0 }}>
                  <label className="form-label">Church Office Phone</label>
                  <input type="text" value={row.church_office_phone || ''} onChange={e => setRow(r => ({ ...r, church_office_phone: e.target.value }))} placeholder="860-779-2018" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Pastor's Office Hours</label>
                <input type="text" value={row.pastor_office_hours || ''} onChange={e => setRow(r => ({ ...r, pastor_office_hours: e.target.value }))} placeholder="Tues: 9:30 a.m. – 12 p.m.; Wed: 10 a.m. - 12 p.m.; Thurs by appointment." />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Pastor's Cell</label>
                <input type="text" value={row.pastor_cell || ''} onChange={e => setRow(r => ({ ...r, pastor_cell: e.target.value }))} placeholder="217 840-1623" />
              </div>
            </div>
          </div>

          {/* Back cover defaults */}
          <div className="card">
            <h2 style={sectionHead}>⛪ Back Cover Defaults</h2>
            <div className="form-group">
              <label className="form-label">Church Tagline</label>
              <input type="text" value={row.church_tagline || ''} onChange={e => setRow(r => ({ ...r, church_tagline: e.target.value }))} placeholder="Repentance, Renewal, Reform" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Default Back Cover Photo URL</label>
              <input type="text" value={row.default_back_cover_photo_url || ''} onChange={e => setRow(r => ({ ...r, default_back_cover_photo_url: e.target.value }))} placeholder="https://..." />
              <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px' }}>
                Used when a service doesn't have its own photo set. Individual services can override this from the Service Planner.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
