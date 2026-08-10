import { useState } from 'react'
import { supabase } from '../lib/supabase.js'

const COLOR_OPTIONS = ['', 'Purple', 'White', 'Green', 'Red', 'Grey']

function formatDateShort(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

function getSeasonStyle(color) {
  const map = {
    'Purple': { bg: '#f3e5f5', color: '#6B2D8B' },
    'White': { bg: '#fff8e7', color: '#b8860b' },
    'Green': { bg: '#e8f5ee', color: '#2d7a4f' },
    'Red': { bg: '#fdecea', color: '#c0392b' },
    'Grey': { bg: '#f0f0f0', color: '#666' },
  }
  return map[color] || { bg: '#f0ede8', color: '#5c5850' }
}

// getSeasonFromDate is passed in from ServicePlanner so both the manual
// single-add flow and this bulk flow always compute the liturgical
// calendar the exact same way.
export default function BulkAddSundaysModal({ existingDates, getSeasonFromDate, onClose, onSaved }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [rows, setRows] = useState([]) // [{ service_date, season, liturgical_color, special_designation, skip }]
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saved, setSaved] = useState(0)

  function handleGenerate() {
    if (!startDate || !endDate) return
    const existing = new Set(existingDates)
    const out = []
    const d = new Date(startDate + 'T12:00:00')
    // Snap to the first Sunday on/after startDate
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7))
    const end = new Date(endDate + 'T12:00:00')
    while (d <= end) {
      const dateStr = d.toISOString().slice(0, 10)
      if (!existing.has(dateStr)) {
        const { season, color } = getSeasonFromDate(dateStr)
        out.push({ service_date: dateStr, season: season || '', liturgical_color: color || '', special_designation: '', skip: false })
      }
      d.setDate(d.getDate() + 7)
    }
    setRows(out)
    setSaveError(null)
    setSaved(0)
  }

  function updateRow(idx, patch) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  async function handleSaveAll() {
    const toInsert = rows.filter(r => !r.skip).map(r => ({
      service_date: r.service_date,
      season: r.season || null,
      liturgical_color: r.liturgical_color || null,
      special_designation: r.special_designation || null,
      service_type: 'Regular Sunday',
      service_time: '10:15 a.m.',
      bulletin_orientation: 'landscape',
    }))
    if (toInsert.length === 0) return
    setSaving(true)
    setSaveError(null)
    const { error } = await supabase.from('service_dates').insert(toInsert)
    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    setSaved(toInsert.length)
    onSaved()
  }

  const activeCount = rows.filter(r => !r.skip).length

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}>
      <div style={{ background: 'white', borderRadius: '12px', width: '100%', maxWidth: '760px' }}>
        <div style={{ position: 'sticky', top: 0, background: 'white', borderBottom: '1px solid var(--gray-100)', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1, borderRadius: '12px 12px 0 0' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--burgundy)' }}>Bulk Add Sundays</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕ Close</button>
        </div>

        <div style={{ padding: '24px' }}>
          {saved > 0 && (
            <div className="alert alert-success" style={{ marginBottom: '16px' }}>
              Added {saved} service date{saved === 1 ? '' : 's'}. You can generate another range below, or close this window.
            </div>
          )}

          <p style={{ fontSize: '13px', color: 'var(--gray-600)', marginBottom: '16px' }}>
            Pick a date range and every Sunday in it will be generated with its liturgical season/color auto-filled — the same calendar logic used everywhere else in this app. Dates you already have a service for are skipped automatically. Edit the color or add a special description (e.g. "Grandparents Day") on any row before saving, or uncheck a row to leave it out entirely.
          </p>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '18px', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: '170px' }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">End Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: '170px' }} />
            </div>
            <button className="btn btn-primary btn-sm" onClick={handleGenerate} disabled={!startDate || !endDate}>
              Generate Sundays
            </button>
          </div>

          {rows.length > 0 && (
            <>
              <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginBottom: '10px' }}>
                {rows.length} Sunday{rows.length === 1 ? '' : 's'} found · {activeCount} will be added
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto', marginBottom: '18px' }}>
                {rows.map((r, idx) => {
                  const style = getSeasonStyle(r.liturgical_color)
                  return (
                    <div key={r.service_date} style={{
                      display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px',
                      borderRadius: '8px', background: r.skip ? 'var(--gray-50)' : style.bg, opacity: r.skip ? 0.5 : 1,
                    }}>
                      <input type="checkbox" checked={!r.skip} onChange={e => updateRow(idx, { skip: !e.target.checked })}
                        style={{ width: '18px', height: '18px', marginTop: '4px', flexShrink: 0, accentColor: 'var(--burgundy)' }} />

                      <div style={{ width: '150px', flexShrink: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gray-800)' }}>{formatDateShort(r.service_date)}</div>
                        <div style={{ fontSize: '11px', color: style.color, fontWeight: 600 }}>{r.season || 'No season matched'}</div>
                      </div>

                      <select value={r.liturgical_color} onChange={e => updateRow(idx, { liturgical_color: e.target.value })}
                        disabled={r.skip} style={{ width: '100px', fontSize: '12px', padding: '6px 8px', flexShrink: 0 }}>
                        {COLOR_OPTIONS.map(c => <option key={c} value={c}>{c || '(none)'}</option>)}
                      </select>

                      <textarea
                        value={r.special_designation}
                        onChange={e => updateRow(idx, { special_designation: e.target.value })}
                        disabled={r.skip}
                        placeholder="Special description, e.g. Grandparents Day"
                        rows={1}
                        style={{ flex: 1, fontSize: '12px', padding: '6px 8px', minHeight: '34px', resize: 'vertical' }}
                      />
                    </div>
                  )
                })}
              </div>

              {saveError && <div className="alert alert-error">{saveError}</div>}

              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={handleSaveAll} disabled={saving || activeCount === 0}>
                {saving ? 'Saving…' : `Save ${activeCount} Service Date${activeCount === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
