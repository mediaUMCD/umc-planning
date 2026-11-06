import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'

// ─────────────────────────────────────────────────────────────────────
// Series & Studies — one place for Sermon Series, Book Studies,
// Bible Studies and Sunday School. Saving here feeds (via database
// triggers in series_and_studies.sql):
//   • the shared calendar (events)       — every session, when published
//   • the home-page carousel (announcements) — when "Feature on home"
//   • Service Planner sermon series name — for Sermon Series Sundays
// Sessions for a series linked to a Christian Ed class come straight
// from Christian Education and update automatically.
// ─────────────────────────────────────────────────────────────────────

const BUCKET = 'series-images'

const SERIES_TYPES = [
  { value: 'sermon_series', label: 'Sermon Series', bg: 'var(--burgundy-light)', fg: 'var(--burgundy)' },
  { value: 'book_study',    label: 'Book Study',    bg: '#fff3e0', fg: '#b8860b' },
  { value: 'bible_study',   label: 'Bible Study',   bg: '#e8f5e9', fg: '#2d7a4f' },
  { value: 'sunday_school', label: 'Sunday School', bg: '#e3f2fd', fg: '#1565c0' },
  { value: 'other',         label: 'Other',         bg: 'var(--gray-100)', fg: 'var(--gray-600)' },
]

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const EMPTY_SERIES = {
  series_type: 'bible_study',
  title: '', subtitle: '', blurb: '', image_url: '',
  book_title: '', book_author: '', scripture_focus: '',
  audience: '', leader: '', location: '', zoom_link: '', register_url: '',
  default_time: '', ce_class_id: '', ce_series_id: '',
  is_ongoing: false, start_date: '', end_date: '',
  publish: false, add_to_calendar: true, feature_on_home: false,
  feature_start: '', feature_end: '', sort_order: 0,
}

// Columns we write. announcement_id is deliberately NOT here — the
// database trigger owns it.
const SERIES_FIELDS = Object.keys(EMPTY_SERIES)

function typeMeta(value) {
  return SERIES_TYPES.find(t => t.value === value) || SERIES_TYPES[SERIES_TYPES.length - 1]
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toDate(s) { return new Date(s + 'T12:00:00') }

function addDays(s, n) {
  const d = toDate(s)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(s, withYear = true) {
  if (!s) return '—'
  return toDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
}

function fmtLong(s) {
  return toDate(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function blankToNull(obj) {
  const out = {}
  for (const k of SERIES_FIELDS) {
    const v = obj[k]
    out[k] = v === '' || v === undefined ? null : v
  }
  return out
}

async function uploadImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const fileName = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(fileName, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
  return data.publicUrl
}

function imageDimensions(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url) }
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url) }
    img.src = url
  })
}

// "Sundays at 9:30 AM · Nov 8 – Dec 20" style line used on cards and the Facebook copy
function whenLine(series, sessions) {
  const live = (sessions || []).filter(s => !s.is_cancelled).sort((a, b) => a.session_date.localeCompare(b.session_date))
  const days = [...new Set(live.map(s => toDate(s.session_date).getDay()))]
  const dayPart = days.length === 1 ? `${WEEKDAYS[days[0]]}s` : ''
  const timePart = series.default_time ? `at ${series.default_time}` : ''
  let range = ''
  if (series.is_ongoing) range = 'Ongoing'
  else {
    const start = series.start_date || live[0]?.session_date
    const end = series.end_date || live[live.length - 1]?.session_date
    if (start && end && start !== end) range = `${fmtDate(start, false)} – ${fmtDate(end)}`
    else if (start) range = fmtDate(start)
  }
  return [[dayPart, timePart].filter(Boolean).join(' '), range].filter(Boolean).join(' · ')
}

function facebookText(series, sessions) {
  const lines = []
  lines.push(series.title)
  if (series.subtitle) lines.push(series.subtitle)
  if (series.book_title) lines.push(`📖 ${series.book_title}${series.book_author ? ` by ${series.book_author}` : ''}`)
  if (series.scripture_focus) lines.push(`✝️ ${series.scripture_focus}`)
  lines.push('')
  if (series.blurb) { lines.push(series.blurb); lines.push('') }
  const when = whenLine(series, sessions)
  if (when) lines.push(`🗓️ ${when}`)
  if (series.location) lines.push(`📍 ${series.location}`)
  if (series.leader) lines.push(`👤 Led by ${series.leader}`)
  if (series.zoom_link) lines.push(`💻 Join on Zoom: ${series.zoom_link}`)
  if (series.register_url) lines.push(`✍️ Sign up: ${series.register_url}`)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ═════════════════════════════════════════════════════════════════════
export default function SeriesStudies({ onOpenCE }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [filter, setFilter] = useState('current')
  const [editing, setEditing] = useState(null) // null | 'new' | series id
  const [ceClasses, setCeClasses] = useState([])
  const [ceSeries, setCeSeries] = useState([])

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    setLoadError(null)
    const [{ data, error }, { data: classes }, { data: cser }] = await Promise.all([
      supabase.from('series')
        .select('*, series_sessions(id, session_date, session_time, title, notes, is_cancelled, ce_session_id)')
        .order('sort_order', { ascending: true })
        .order('start_date', { ascending: false, nullsFirst: true }),
      supabase.from('ce_classes').select('id, name, class_type, is_active').order('name'),
      supabase.from('ce_series').select('id, name, class_id, start_date, end_date').order('start_date', { ascending: false }),
    ])
    if (error) setLoadError(error.message)
    setList(data || [])
    setCeClasses(classes || [])
    setCeSeries(cser || [])
    setLoading(false)
  }

  const today = todayStr()

  const filtered = useMemo(() => {
    return list.filter(s => {
      const sessions = s.series_sessions || []
      const lastDate = s.end_date || sessions.map(x => x.session_date).sort().pop()
      const isPast = !s.is_ongoing && lastDate && lastDate < today
      if (filter === 'current') return !isPast
      if (filter === 'past') return isPast
      return s.series_type === filter
    })
  }, [list, filter, today])

  if (editing) {
    const existing = editing === 'new' ? null : list.find(s => s.id === editing)
    return (
      <SeriesEditor
        key={editing}
        existing={existing}
        ceClasses={ceClasses}
        ceSeries={ceSeries}
        onOpenCE={onOpenCE}
        onClose={async (changed) => { setEditing(null); if (changed) await loadAll() }}
      />
    )
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Series &amp; Studies</div>
          <div style={{ fontSize: '13px', color: 'var(--gray-600)', marginTop: '2px' }}>
            Sermon series, book &amp; Bible studies, and Sunday School — enter once, shows on the calendar, app, website and home page.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ New Series</button>
      </div>

      <div className="page-body">
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '18px' }}>
          {[{ value: 'current', label: 'Current & Upcoming' }, ...SERIES_TYPES, { value: 'past', label: 'Past' }].map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className="btn btn-sm"
              style={{
                background: filter === f.value ? 'var(--burgundy)' : 'var(--white)',
                color: filter === f.value ? 'white' : 'var(--gray-600)',
                border: '1px solid ' + (filter === f.value ? 'var(--burgundy)' : 'var(--gray-200)'),
                borderRadius: '20px',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loadError && <div className="alert alert-error">Couldn't load series: {loadError}</div>}

        {loading ? <div className="spinner" /> : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="icon">📣</div>
            <p>No series here yet. Click <strong>+ New Series</strong> to add one.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
            {filtered.map(s => (
              <SeriesCard key={s.id} series={s} ceClasses={ceClasses} today={today} onClick={() => setEditing(s.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
function SeriesCard({ series, ceClasses, today, onClick }) {
  const t = typeMeta(series.series_type)
  const sessions = series.series_sessions || []
  const next = sessions.filter(x => !x.is_cancelled && x.session_date >= today).sort((a, b) => a.session_date.localeCompare(b.session_date))[0]
  const ceClass = ceClasses.find(c => c.id === series.ce_class_id)

  return (
    <div className="card" onClick={onClick} style={{ cursor: 'pointer', display: 'flex', gap: '14px', padding: '16px' }}>
      <div style={{
        width: 88, height: 88, borderRadius: 'var(--radius-sm)', flexShrink: 0, overflow: 'hidden',
        background: series.image_url ? `center / cover no-repeat url("${series.image_url}")` : 'var(--burgundy-light)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px',
      }}>
        {!series.image_url && '📣'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="season-badge" style={{ background: t.bg, color: t.fg, fontSize: '11px', padding: '2px 8px' }}>{t.label}</span>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, color: 'var(--burgundy)', marginTop: '4px', lineHeight: 1.25 }}>
          {series.title}
        </div>
        {series.subtitle && <div style={{ fontSize: '13px', color: 'var(--gray-600)' }}>{series.subtitle}</div>}
        <div style={{ fontSize: '12px', color: 'var(--gray-600)', marginTop: '4px' }}>
          {whenLine(series, sessions) || 'No dates yet'}
        </div>
        {next && (
          <div style={{ fontSize: '12px', color: 'var(--gray-800)', marginTop: '2px' }}>
            Next: {fmtDate(next.session_date, false)}{next.title ? ` — ${next.title}` : ''}
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
          <Chip on={series.publish} onLabel="Published" offLabel="Draft" />
          {series.publish && series.add_to_calendar && <Chip on label="On calendar" />}
          {series.publish && series.feature_on_home && <Chip on label="On home page" />}
          {ceClass && <Chip neutral label={`Christian Ed: ${ceClass.name}`} />}
        </div>
      </div>
    </div>
  )
}

function Chip({ on, label, onLabel, offLabel, neutral }) {
  const text = label || (on ? onLabel : offLabel)
  const style = neutral
    ? { background: '#e3f2fd', color: '#1565c0' }
    : on ? { background: 'var(--success-light)', color: 'var(--success)' } : { background: 'var(--warning-light)', color: 'var(--warning)' }
  return <span style={{ ...style, fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px' }}>{text}</span>
}

// ═════════════════════════════════════════════════════════════════════
function SeriesEditor({ existing, ceClasses, ceSeries, onOpenCE, onClose }) {
  const [form, setForm] = useState(() => {
    if (!existing) return { ...EMPTY_SERIES }
    const f = {}
    for (const k of SERIES_FIELDS) f[k] = existing[k] ?? EMPTY_SERIES[k]
    return f
  })
  // Sessions entered here (not from Christian Ed). _key keeps React rows stable for new rows.
  const [manual, setManual] = useState(() =>
    (existing?.series_sessions || [])
      .filter(s => !s.ce_session_id)
      .sort((a, b) => a.session_date.localeCompare(b.session_date))
      .map(s => ({ ...s, _key: s.id, session_time: s.session_time || '', title: s.title || '', notes: s.notes || '' }))
  )
  const [ceRows, setCeRows] = useState(() =>
    (existing?.series_sessions || []).filter(s => s.ce_session_id).sort((a, b) => a.session_date.localeCompare(b.session_date))
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [imageWarning, setImageWarning] = useState(null)
  const [copied, setCopied] = useState(false)
  const [showGenerator, setShowGenerator] = useState(false)
  const [showBook, setShowBook] = useState(() => !!existing?.book_title)

  const isSermon = form.series_type === 'sermon_series'
  const linkedToCE = !!form.ce_class_id
  const ceLinkChanged = existing && (existing.ce_class_id || '') !== (form.ce_class_id || '') || existing && (existing.ce_series_id || '') !== (form.ce_series_id || '')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function changeType(v) {
    setForm(f => {
      const next = { ...f, series_type: v }
      // Sundays are already on the calendar as "Sunday Worship", so sermon
      // series default to NOT adding a second calendar entry.
      if (!existing) next.add_to_calendar = v !== 'sermon_series'
      if (!existing && v === 'sermon_series' && !f.default_time) next.default_time = '10:15 AM'
      if (!existing && v === 'sunday_school' && !f.default_time) next.default_time = '9:30 AM'
      return next
    })
  }

  // Preview CE sessions when the link is changed (the database pulls them for real on save)
  useEffect(() => {
    if (!ceLinkChanged && existing) return
    let cancelled = false
    ;(async () => {
      if (!form.ce_class_id) { setCeRows([]); return }
      let q = supabase.from('ce_sessions')
        .select('id, session_date, topic, category, status, series_id, ce_series(name)')
        .eq('class_id', form.ce_class_id)
        .order('session_date')
      if (form.ce_series_id) q = q.eq('series_id', form.ce_series_id)
      const { data } = await q
      if (cancelled) return
      setCeRows((data || []).map(cs => ({
        id: 'preview-' + cs.id,
        ce_session_id: cs.id,
        session_date: cs.session_date,
        title: cs.topic || cs.ce_series?.name || (cs.category ? cs.category.replace('_', ' ').replace(/^\w/, c => c.toUpperCase()) : ''),
        is_cancelled: cs.status === 'cancelled' || cs.category === 'no_class',
      })))
    })()
    return () => { cancelled = true }
  }, [form.ce_class_id, form.ce_series_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const allSessions = useMemo(() => [...ceRows, ...manual.filter(m => m.session_date)], [ceRows, manual])
  const classSeries = ceSeries.filter(s => s.class_id === form.ce_class_id)

  async function handleImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImageWarning(null)
    setUploading(true)
    try {
      const dims = await imageDimensions(file)
      if (dims && Math.abs(dims.w - dims.h) > 2) {
        setImageWarning(`This image is ${dims.w}×${dims.h}, not square — the app and website will crop it to a square. A 1080×1080 image (same as your Facebook post) looks best.`)
      }
      const url = await uploadImage(file)
      set('image_url', url)
    } catch (err) {
      setError('Image upload failed: ' + (err.message || err))
    }
    setUploading(false)
  }

  async function copyForFacebook() {
    const text = facebookText(form, allSessions)
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function addSession() {
    const last = manual.filter(m => m.session_date).map(m => m.session_date).sort().pop()
    setManual(m => [...m, {
      _key: crypto.randomUUID(),
      session_date: last ? addDays(last, 7) : (form.start_date || ''),
      session_time: '', title: '', notes: '', is_cancelled: false,
    }])
  }

  function updateSession(key, field, value) {
    setManual(m => m.map(s => s._key === key ? { ...s, [field]: value } : s))
  }

  function removeSession(key) {
    setManual(m => m.filter(s => s._key !== key))
  }

  function generateWeekly({ from, until, count, everyNWeeks, titlePattern }) {
    const dates = []
    let d = from
    const step = 7 * (everyNWeeks || 1)
    const limit = count ? Number(count) : 104
    while (dates.length < limit && (!until || d <= until)) {
      dates.push(d)
      d = addDays(d, step)
    }
    const existingDates = new Set(manual.map(m => m.session_date))
    const startN = manual.length
    const rows = dates.filter(dt => !existingDates.has(dt)).map((dt, i) => ({
      _key: crypto.randomUUID(),
      session_date: dt,
      session_time: '',
      title: titlePattern ? titlePattern.replace(/\{n\}/g, String(startN + i + 1)) : '',
      notes: '',
      is_cancelled: false,
    }))
    setManual(m => [...m, ...rows].sort((a, b) => (a.session_date || '').localeCompare(b.session_date || '')))
    setShowGenerator(false)
  }

  async function handleSave() {
    setError(null)
    setNotice(null)
    if (!form.title.trim()) { setError('Please give the series a title.'); return }
    const badRow = manual.find(m => !m.session_date)
    if (badRow) { setError('Every session needs a date (or remove the empty row).'); return }

    setSaving(true)
    try {
      const payload = blankToNull({ ...form, title: form.title.trim() })
      if (!payload.ce_class_id) payload.ce_series_id = null

      // Fill start/end from the sessions when left blank
      if (!payload.is_ongoing) {
        const dates = allSessions.map(s => s.session_date).filter(Boolean).sort()
        if (!payload.start_date && dates.length) payload.start_date = dates[0]
        if (!payload.end_date && dates.length) payload.end_date = dates[dates.length - 1]
      }

      let seriesId = existing?.id
      if (seriesId) {
        const { error: e } = await supabase.from('series').update(payload).eq('id', seriesId)
        if (e) throw e
      } else {
        const { data, error: e } = await supabase.from('series').insert([payload]).select('id').single()
        if (e) throw e
        seriesId = data.id
      }

      // Manual sessions: delete removed, update existing, insert new
      const before = (existing?.series_sessions || []).filter(s => !s.ce_session_id)
      const keepIds = new Set(manual.filter(m => m.id).map(m => m.id))
      const toDelete = before.filter(b => !keepIds.has(b.id)).map(b => b.id)
      if (toDelete.length) {
        const { error: e } = await supabase.from('series_sessions').delete().in('id', toDelete)
        if (e) throw e
      }
      for (const m of manual.filter(m => m.id)) {
        const { error: e } = await supabase.from('series_sessions').update({
          session_date: m.session_date,
          session_time: m.session_time || null,
          title: m.title || null,
          notes: m.notes || null,
          is_cancelled: !!m.is_cancelled,
        }).eq('id', m.id)
        if (e) throw e
      }
      const inserts = manual.filter(m => !m.id).map(m => ({
        series_id: seriesId,
        session_date: m.session_date,
        session_time: m.session_time || null,
        title: m.title || null,
        notes: m.notes || null,
        is_cancelled: !!m.is_cancelled,
      }))
      if (inserts.length) {
        const { error: e } = await supabase.from('series_sessions').insert(inserts)
        if (e) throw e
      }

      setSaving(false)
      onClose(true)
    } catch (err) {
      setSaving(false)
      setError(err.message || String(err))
    }
  }

  async function handleDelete() {
    if (!existing) return
    if (!confirm(`Delete "${existing.title}"?\n\nThis removes it from the calendar, app, website and home page. Christian Ed classes and lessons are NOT affected.`)) return
    setSaving(true)
    const { error: e } = await supabase.from('series').delete().eq('id', existing.id)
    setSaving(false)
    if (e) { setError(e.message); return }
    onClose(true)
  }

  async function resyncFromCE() {
    if (!existing) return
    setNotice(null)
    const { error: e } = await supabase.rpc('series_pull_ce', { p_series_id: existing.id })
    if (e) { setError(e.message); return }
    const { data } = await supabase.from('series_sessions')
      .select('id, session_date, session_time, title, is_cancelled, ce_session_id')
      .eq('series_id', existing.id).not('ce_session_id', 'is', null).order('session_date')
    setCeRows(data || [])
    setNotice('Pulled the latest dates and lesson titles from Christian Education.')
  }

  const t = typeMeta(form.series_type)

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => onClose(false)}>← Back</button>
          <div className="page-title">{existing ? existing.title : 'New Series'}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-secondary" onClick={copyForFacebook}>{copied ? '✓ Copied!' : 'Copy for Facebook'}</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || uploading}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      <div className="page-body" style={{ maxWidth: 1000 }}>
        {error && <div className="alert alert-error">{error}</div>}
        {notice && <div className="alert alert-success">{notice}</div>}

        {/* ── Publishing ─────────────────────────────── */}
        <Section title="Where it shows">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.publish} onChange={e => set('publish', e.target.checked)} />
              <span><strong>Publish</strong> — show on the church app and website. Leave off while it's a draft.</span>
            </label>
            <label className="checkbox-label" style={{ opacity: form.publish ? 1 : 0.5 }}>
              <input type="checkbox" checked={form.add_to_calendar} onChange={e => set('add_to_calendar', e.target.checked)} />
              <span>
                Put every session on the <strong>calendar</strong>
                {isSermon && <span style={{ color: 'var(--gray-600)' }}> (usually off for sermon series — Sundays are already on the calendar as Sunday Worship. The series name still goes on each Sunday in the Service Planner.)</span>}
              </span>
            </label>
            <label className="checkbox-label" style={{ opacity: form.publish ? 1 : 0.5 }}>
              <input type="checkbox" checked={form.feature_on_home} onChange={e => set('feature_on_home', e.target.checked)} />
              <span>Feature on the <strong>home page</strong> carousel (app &amp; website)</span>
            </label>
            {form.feature_on_home && (
              <div className="grid-2" style={{ marginLeft: '24px' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Start featuring</label>
                  <input type="date" value={form.feature_start || ''} onChange={e => set('feature_start', e.target.value)} />
                  <Hint>Blank = right away</Hint>
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Stop featuring</label>
                  <input type="date" value={form.feature_end || ''} onChange={e => set('feature_end', e.target.value)} />
                  <Hint>Blank = when the series ends{form.is_ongoing ? ' (ongoing: stays up until you turn it off)' : ''}</Hint>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* ── Basics ─────────────────────────────────── */}
        <Section title="The basics">
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Type</label>
              <select value={form.series_type} onChange={e => changeType(e.target.value)}>
                {SERIES_TYPES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Title *</label>
              <input value={form.title} onChange={e => set('title', e.target.value)} placeholder={isSermon ? 'e.g. Advent: Waiting in Hope' : 'e.g. Wednesday Bible Study'} />
            </div>
            <div className="form-group">
              <label className="form-label">Subtitle / tagline</label>
              <input value={form.subtitle || ''} onChange={e => set('subtitle', e.target.value)} placeholder="Short line shown under the title" />
            </div>
            <div className="form-group">
              <label className="form-label">Who it's for</label>
              <input value={form.audience || ''} onChange={e => set('audience', e.target.value)} placeholder="Adults, Youth, All ages…" list="series-audiences" />
              <datalist id="series-audiences">
                <option value="Adults" /><option value="Youth" /><option value="Children" /><option value="All ages" />
              </datalist>
            </div>
            <div className="form-group">
              <label className="form-label">{isSermon ? 'Preacher' : 'Leader / Teacher'}</label>
              <input value={form.leader || ''} onChange={e => set('leader', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Scripture focus</label>
              <input value={form.scripture_focus || ''} onChange={e => set('scripture_focus', e.target.value)} placeholder="e.g. Matthew 5:1–12" />
            </div>
          </div>
          {(form.series_type === 'book_study' || showBook) && (
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Book title</label>
                <input value={form.book_title || ''} onChange={e => set('book_title', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Author</label>
                <input value={form.book_author || ''} onChange={e => set('book_author', e.target.value)} />
              </div>
            </div>
          )}
          {form.series_type !== 'book_study' && !showBook && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowBook(true)}>+ Add a book</button>
          )}
        </Section>

        {/* ── Promo ──────────────────────────────────── */}
        <Section title="Blurb & image">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 220px', gap: '20px' }} className="series-promo-grid">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Blurb (same text as your Facebook post)</label>
              <textarea rows={9} value={form.blurb || ''} onChange={e => set('blurb', e.target.value)} placeholder="What it's about, who should come, what to bring…" />
              <Hint>{(form.blurb || '').length} characters · Use <strong>Copy for Facebook</strong> (top right) to copy this plus the dates, place and sign-up link.</Hint>
            </div>
            <div>
              <label className="form-label">Square image</label>
              <div style={{
                width: 220, height: 220, borderRadius: 'var(--radius)', border: '1.5px dashed var(--gray-200)',
                background: form.image_url ? `center / cover no-repeat url("${form.image_url}")` : 'var(--gray-50)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-400)', fontSize: '13px', textAlign: 'center', whiteSpace: 'pre-line',
              }}>
                {uploading ? <div className="spinner" style={{ margin: 0 }} /> : !form.image_url && '1080 × 1080\nrecommended'}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                  {form.image_url ? 'Replace' : 'Upload image'}
                  <input type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
                </label>
                {form.image_url && <button className="btn btn-danger btn-sm" onClick={() => { set('image_url', ''); setImageWarning(null) }}>Remove</button>}
              </div>
              {imageWarning && <div className="alert alert-warning" style={{ marginTop: '8px', fontSize: '12px' }}>{imageWarning}</div>}
            </div>
          </div>
        </Section>

        {/* ── When & where ───────────────────────────── */}
        <Section title="When & where">
          <div className="grid-3">
            <div className="form-group">
              <label className="form-label">Usual time</label>
              <input value={form.default_time || ''} onChange={e => set('default_time', e.target.value)} placeholder="e.g. 9:30 AM" />
              <Hint>Any session can override it</Hint>
            </div>
            <div className="form-group">
              <label className="form-label">Location</label>
              <input value={form.location || ''} onChange={e => set('location', e.target.value)} placeholder="e.g. Fellowship Hall" />
            </div>
            <div className="form-group">
              <label className="form-label">Zoom link</label>
              <input value={form.zoom_link || ''} onChange={e => set('zoom_link', e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <div className="grid-3">
            <div className="form-group">
              <label className="form-label">Sign-up link</label>
              <input value={form.register_url || ''} onChange={e => set('register_url', e.target.value)} placeholder="https://… (optional)" />
            </div>
            <div className="form-group">
              <label className="form-label">Starts</label>
              <input type="date" value={form.start_date || ''} onChange={e => set('start_date', e.target.value)} disabled={form.is_ongoing} />
              <Hint>Blank = first session</Hint>
            </div>
            <div className="form-group">
              <label className="form-label">Ends</label>
              <input type="date" value={form.end_date || ''} onChange={e => set('end_date', e.target.value)} disabled={form.is_ongoing} />
              <Hint>Blank = last session</Hint>
            </div>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={form.is_ongoing} onChange={e => set('is_ongoing', e.target.checked)} />
            Ongoing — no end date (e.g. Sunday School)
          </label>
        </Section>

        {/* ── Christian Ed link ──────────────────────── */}
        {!isSermon && (
          <Section title="Pull sessions from Christian Education">
            <p style={{ fontSize: '13px', color: 'var(--gray-600)', marginBottom: '12px' }}>
              Link a Christian Ed class and its dates and lesson titles flow in automatically. When a teacher changes a lesson
              title or cancels a week in Christian Education, the calendar updates on its own.
            </p>
            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Christian Ed class</label>
                <select value={form.ce_class_id || ''} onChange={e => setForm(f => ({ ...f, ce_class_id: e.target.value, ce_series_id: '' }))}>
                  <option value="">— Not linked —</option>
                  {ceClasses.filter(c => c.is_active || c.id === form.ce_class_id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {linkedToCE && (
                <div className="form-group">
                  <label className="form-label">Which sessions</label>
                  <select value={form.ce_series_id || ''} onChange={e => set('ce_series_id', e.target.value)}>
                    <option value="">All sessions of this class</option>
                    {classSeries.map(cs => <option key={cs.id} value={cs.id}>Only the "{cs.name}" series</option>)}
                  </select>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ── Sessions ───────────────────────────────── */}
        <Section
          title={`Sessions (${allSessions.length})`}
          right={
            <div style={{ display: 'flex', gap: '6px' }}>
              {existing && linkedToCE && !ceLinkChanged && <button className="btn btn-secondary btn-sm" onClick={resyncFromCE}>↻ Refresh from Christian Ed</button>}
              <button className="btn btn-secondary btn-sm" onClick={() => setShowGenerator(g => !g)}>+ Add weekly dates</button>
              <button className="btn btn-secondary btn-sm" onClick={addSession}>+ Add one date</button>
            </div>
          }
        >
          {showGenerator && (
            <WeeklyGenerator
              defaultFrom={form.start_date || todayStr()}
              defaultUntil={form.end_date || ''}
              isSermon={isSermon}
              onGenerate={generateWeekly}
              onCancel={() => setShowGenerator(false)}
            />
          )}

          {linkedToCE && (
            <div style={{ marginBottom: manual.length ? '18px' : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div className="form-label" style={{ marginBottom: 0 }}>From Christian Education {ceLinkChanged && '(preview — saved when you click Save)'}</div>
                {onOpenCE && <button className="btn btn-sm" style={{ color: 'var(--burgundy)' }} onClick={() => onOpenCE({ classId: form.ce_class_id })}>Edit lesson titles in Christian Ed →</button>}
              </div>
              {ceRows.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--gray-400)', padding: '8px 0' }}>No sessions in Christian Education for this class yet.</div>
              ) : (
                <table className="data-table">
                  <thead><tr><th>Date</th><th>Title (from Christian Ed)</th><th>Status</th></tr></thead>
                  <tbody>
                    {ceRows.map(r => (
                      <tr key={r.id} style={{ opacity: r.is_cancelled ? 0.55 : 1 }}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtLong(r.session_date)}</td>
                        <td>{r.title || <span style={{ color: 'var(--gray-400)' }}>—</span>}</td>
                        <td>{r.is_cancelled ? 'No class / cancelled' : r.session_date < todayStr() ? 'Past' : 'Scheduled'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {(manual.length > 0 || !linkedToCE) && (
            <>
              {linkedToCE && <div className="form-label">Extra dates entered here</div>}
              {manual.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--gray-400)', padding: '8px 0' }}>
                  No dates yet — use <strong>+ Add weekly dates</strong> to fill in a whole series at once.
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 150 }}>Date</th>
                      <th style={{ width: 110 }}>Time</th>
                      <th>{isSermon ? 'Sermon title' : 'Topic / chapter / passage'}</th>
                      <th>Note</th>
                      <th style={{ width: 70 }}>Cancel</th>
                      <th style={{ width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manual.map(m => (
                      <tr key={m._key} style={{ opacity: m.is_cancelled ? 0.55 : 1 }}>
                        <td><input type="date" value={m.session_date} onChange={e => updateSession(m._key, 'session_date', e.target.value)} /></td>
                        <td><input value={m.session_time} onChange={e => updateSession(m._key, 'session_time', e.target.value)} placeholder={form.default_time || 'time'} /></td>
                        <td><input value={m.title} onChange={e => updateSession(m._key, 'title', e.target.value)} /></td>
                        <td><input value={m.notes} onChange={e => updateSession(m._key, 'notes', e.target.value)} placeholder="optional" /></td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={!!m.is_cancelled} onChange={e => updateSession(m._key, 'is_cancelled', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--burgundy)' }} />
                        </td>
                        <td><button onClick={() => removeSession(m._key)} title="Remove" style={{ color: 'var(--danger)', fontSize: '16px' }}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </Section>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', marginBottom: '40px' }}>
          {existing ? <button className="btn btn-danger" onClick={handleDelete} disabled={saving}>Delete series</button> : <span />}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span className="season-badge" style={{ background: t.bg, color: t.fg }}>{t.label}</span>
            <button className="btn btn-secondary" onClick={() => onClose(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || uploading}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .series-promo-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
function WeeklyGenerator({ defaultFrom, defaultUntil, isSermon, onGenerate, onCancel }) {
  const [from, setFrom] = useState(defaultFrom)
  const [mode, setMode] = useState(defaultUntil ? 'until' : 'count')
  const [until, setUntil] = useState(defaultUntil)
  const [count, setCount] = useState(6)
  const [every, setEvery] = useState(1)
  const [pattern, setPattern] = useState(isSermon ? 'Week {n}' : 'Session {n}')

  const weekday = from ? WEEKDAYS[toDate(from).getDay()] : ''

  return (
    <div style={{ background: 'var(--burgundy-light)', borderRadius: 'var(--radius-sm)', padding: '14px', marginBottom: '14px' }}>
      <div className="grid-3">
        <div className="form-group">
          <label className="form-label">First date</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          {weekday && <Hint>Repeats every {every > 1 ? `${every} weeks on ` : ''}{weekday}</Hint>}
        </div>
        <div className="form-group">
          <label className="form-label">How many</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <select value={mode} onChange={e => setMode(e.target.value)} style={{ width: 120 }}>
              <option value="count">Number</option>
              <option value="until">Until date</option>
            </select>
            {mode === 'count'
              ? <input type="number" min={1} max={104} value={count} onChange={e => setCount(e.target.value)} />
              : <input type="date" value={until} onChange={e => setUntil(e.target.value)} />}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Every</label>
          <select value={every} onChange={e => setEvery(Number(e.target.value))}>
            <option value={1}>Week</option>
            <option value={2}>2 weeks</option>
            <option value={4}>4 weeks</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Title for each (optional)</label>
        <input value={pattern} onChange={e => setPattern(e.target.value)} />
        <Hint>{'{n}'} becomes 1, 2, 3… — you can type real titles afterward</Hint>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={!from || (mode === 'until' && !until)}
          onClick={() => onGenerate({
            from,
            until: mode === 'until' ? until : null,
            count: mode === 'count' ? count : null,
            everyNWeeks: every,
            titlePattern: pattern.trim(),
          })}
        >
          Add dates
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function Section({ title, right, children }) {
  return (
    <div className="card" style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, color: 'var(--burgundy)' }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  )
}

function Hint({ children }) {
  return <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '4px' }}>{children}</div>
}
