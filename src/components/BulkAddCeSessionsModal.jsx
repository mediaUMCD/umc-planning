import { useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { getSeasonFromDate } from '../lib/liturgicalCalendar.js'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const CATEGORIES = [
  { value: 'lesson', label: 'Lesson' },
  { value: 'craft', label: 'Craft' },
  { value: 'rehearsal', label: 'Rehearsal' },
  { value: 'party', label: 'Party' },
  { value: 'no_class', label: 'No Class' },
  { value: 'pageant', label: 'Pageant' },
  { value: 'special', label: 'Special' },
]

function guessWeekday(meetingDay) {
  if (!meetingDay) return 0
  const idx = WEEKDAYS.findIndex(w => w.toLowerCase().startsWith(meetingDay.trim().toLowerCase().slice(0, 3)))
  return idx === -1 ? 0 : idx
}

export default function BulkAddCeSessionsModal({ cls, existingDates, templates, onClose, onSaved }) {
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [weekday, setWeekday] = useState(guessWeekday(cls.meeting_day))

  const [alternate, setAlternate] = useState(false)
  const [category, setCategory] = useState('lesson')
  const [templateId, setTemplateId] = useState('')
  const [categoryB, setCategoryB] = useState('craft')
  const [templateIdB, setTemplateIdB] = useState('')

  const [rows, setRows] = useState([]) // [{ session_date, topic, skip, special, category, template_id }]
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saved, setSaved] = useState(0)

  const templatesForCategory = (cat) => templates.filter(t => t.category === cat && t.is_active)

  async function handleGenerate() {
    if (!startDate || !endDate) return
    const existing = new Set(existingDates)
    const dates = []
    const d = new Date(startDate + 'T12:00:00')
    d.setDate(d.getDate() + ((Number(weekday) - d.getDay() + 7) % 7))
    const end = new Date(endDate + 'T12:00:00')
    while (d <= end) {
      const dateStr = d.toISOString().slice(0, 10)
      if (!existing.has(dateStr)) dates.push(dateStr)
      d.setDate(d.getDate() + 7)
    }

    // Pull any Special Sunday info already entered (via Service Planner or
    // another CE session) so it shows as a hint while picking dates.
    let specialByDate = {}
    if (dates.length > 0) {
      const { data } = await supabase.from('service_dates').select('service_date, special_designation').in('service_date', dates)
      for (const row of (data || [])) {
        if (row.special_designation) specialByDate[row.service_date] = row.special_designation
      }
    }

    setRows(dates.map((dateStr, i) => {
      const useB = alternate && i % 2 === 1
      return {
        session_date: dateStr,
        topic: '',
        skip: false,
        special: specialByDate[dateStr] || getSeasonFromDate(dateStr).season || '',
        category: useB ? categoryB : category,
        template_id: useB ? templateIdB : templateId,
      }
    }))
    setSaveError(null)
    setSaved(0)
  }

  function updateRow(idx, patch) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }

  async function handleSaveAll() {
    const toInsert = rows.filter(r => !r.skip).map(r => ({
      class_id: cls.id,
      session_date: r.session_date,
      topic: r.topic || null,
      category: r.category,
      template_id: r.template_id || null,
    }))
    if (toInsert.length === 0) return
    setSaving(true)
    setSaveError(null)
    const { error } = await supabase.from('ce_sessions').insert(toInsert)
    setSaving(false)
    if (error) { setSaveError(error.message); return }
    setSaved(toInsert.length)
    onSaved()
  }

  const activeCount = rows.filter(r => !r.skip).length

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}>
      <div style={{ background: 'white', borderRadius: '12px', width: '100%', maxWidth: '760px' }}>
        <div style={{ position: 'sticky', top: 0, background: 'white', borderBottom: '1px solid var(--gray-100)', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1, borderRadius: '12px 12px 0 0' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--burgundy)' }}>Bulk Add Sessions — {cls.name}</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕ Close</button>
        </div>

        <div style={{ padding: '24px' }}>
          {saved > 0 && (
            <div className="alert alert-success" style={{ marginBottom: '16px' }}>
              Added {saved} session{saved === 1 ? '' : 's'}. Generate another range below, or close this window.
            </div>
          )}

          <p style={{ fontSize: '13px', color: 'var(--gray-600)', marginBottom: '16px' }}>
            Pick a date range and a weekday, and every matching date gets a draft session — skipping any that already exist for this class. Dates with a Special Sunday already on file (from Service Planner or elsewhere in Christian Ed) show as a hint. Every row's category is editable afterward, so exceptions (holidays, special Sundays) are easy to fix up before saving.
          </p>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '12px', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ width: '150px' }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">End Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ width: '150px' }} />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Weekday</label>
              <select value={weekday} onChange={e => setWeekday(e.target.value)} style={{ width: '130px' }}>
                {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}
              </select>
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '13px', color: 'var(--gray-700)', marginBottom: '12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={alternate} onChange={e => setAlternate(e.target.checked)} />
            Alternate between two categories every other week (e.g. Lesson / Craft)
          </label>

          {!alternate ? (
            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '18px', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Category</label>
                <select value={category} onChange={e => { setCategory(e.target.value); setTemplateId('') }} style={{ width: '150px' }}>
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Template</label>
                <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={{ width: '200px' }}>
                  <option value="">No template (blank)</option>
                  {templatesForCategory(category).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '16px', marginBottom: '18px', flexWrap: 'wrap' }}>
              <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: '8px', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gray-400)', width: '100%' }}>Week 1, 3, 5…</div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Category</label>
                  <select value={category} onChange={e => { setCategory(e.target.value); setTemplateId('') }} style={{ width: '150px' }}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Template</label>
                  <select value={templateId} onChange={e => setTemplateId(e.target.value)} style={{ width: '180px' }}>
                    <option value="">No template (blank)</option>
                    {templatesForCategory(category).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--gray-50)', borderRadius: '8px', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--gray-400)', width: '100%' }}>Week 2, 4, 6…</div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Category</label>
                  <select value={categoryB} onChange={e => { setCategoryB(e.target.value); setTemplateIdB('') }} style={{ width: '150px' }}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Template</label>
                  <select value={templateIdB} onChange={e => setTemplateIdB(e.target.value)} style={{ width: '180px' }}>
                    <option value="">No template (blank)</option>
                    {templatesForCategory(categoryB).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}

          <button className="btn btn-primary btn-sm" onClick={handleGenerate} disabled={!startDate || !endDate} style={{ marginBottom: '18px' }}>
            Generate Sessions
          </button>

          {rows.length > 0 && (
            <>
              <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginBottom: '10px' }}>
                {rows.length} date{rows.length === 1 ? '' : 's'} found · {activeCount} will be added
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '420px', overflowY: 'auto', marginBottom: '18px' }}>
                {rows.map((r, idx) => (
                  <div key={r.session_date} style={{
                    display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 12px',
                    borderRadius: '8px', background: r.skip ? 'var(--gray-50)' : 'var(--burgundy-light)', opacity: r.skip ? 0.5 : 1, flexWrap: 'wrap',
                  }}>
                    <input type="checkbox" checked={!r.skip} onChange={e => updateRow(idx, { skip: !e.target.checked })}
                      style={{ width: '18px', height: '18px', flexShrink: 0, accentColor: 'var(--burgundy)' }} />
                    <div style={{ width: '120px', flexShrink: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gray-800)' }}>
                        {new Date(r.session_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      {r.special && <div style={{ fontSize: '11px', color: 'var(--burgundy)' }}>💡 {r.special}</div>}
                    </div>
                    <select
                      value={r.category}
                      onChange={e => updateRow(idx, { category: e.target.value, template_id: '' })}
                      disabled={r.skip}
                      style={{ fontSize: '12px', padding: '6px 8px', width: '120px', flexShrink: 0 }}
                    >
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <select
                      value={r.template_id}
                      onChange={e => updateRow(idx, { template_id: e.target.value })}
                      disabled={r.skip}
                      style={{ fontSize: '12px', padding: '6px 8px', width: '140px', flexShrink: 0 }}
                    >
                      <option value="">No template</option>
                      {templatesForCategory(r.category).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <input
                      type="text"
                      value={r.topic}
                      onChange={e => updateRow(idx, { topic: e.target.value })}
                      disabled={r.skip}
                      placeholder="Topic (optional)"
                      style={{ flex: 1, minWidth: '120px', fontSize: '12px', padding: '6px 8px' }}
                    />
                  </div>
                ))}
              </div>

              {saveError && <div className="alert alert-error">{saveError}</div>}

              <button className="btn btn-primary btn-lg" style={{ width: '100%' }} onClick={handleSaveAll} disabled={saving || activeCount === 0}>
                {saving ? 'Saving…' : `Save ${activeCount} Session${activeCount === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
