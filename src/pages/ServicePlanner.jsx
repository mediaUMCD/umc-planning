import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const PREACHERS = ['Pastor Zach', 'Guest Speaker', 'Other']
const STORYTELLERS = ['Chrissy', 'Cassi', 'Sue', 'Cyndi', 'Betsy', 'Pastor Zach', 'Kids', 'Other']
const BIBLE_VERSIONS = ['CEB', 'NRSVue', 'NIV', 'NRSV', 'KJV', 'MSG', 'NLT', 'ESV']
const SERVICE_TYPES = ['Regular Sunday', 'Communion Sunday', 'Advent', 'Christmas Eve', 'Ash Wednesday', 'Maundy Thursday', 'Good Friday', 'Easter', 'Pentecost', 'Rally Day', 'Lessons & Carols', 'Special Service']
const PAGE_REFS = new Set([7, 8, 9, 10, 11, 12, 13, 14, 94, 95, 881, 882, 883, 884, 885, 886, 887, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 899, 900])

const SEASONS = [
  { name: '1st Sunday of Advent', color: 'Purple' },
  { name: '2nd Sunday of Advent', color: 'Purple' },
  { name: '3rd Sunday of Advent', color: 'Purple' },
  { name: '4th Sunday of Advent', color: 'Purple' },
  { name: 'Christmas', color: 'White' },
  { name: 'Baptism of the Lord', color: 'White' },
  { name: '1st Sunday after Epiphany', color: 'White' },
  { name: '2nd Sunday after Epiphany', color: 'Green' },
  { name: '3rd Sunday after Epiphany', color: 'Green' },
  { name: '4th Sunday after Epiphany', color: 'Green' },
  { name: '5th Sunday after Epiphany', color: 'Green' },
  { name: '6th Sunday after Epiphany', color: 'Green' },
  { name: '7th Sunday after Epiphany', color: 'Green' },
  { name: '8th Sunday after Epiphany', color: 'Green' },
  { name: 'Transfiguration Sunday', color: 'White' },
  { name: 'Ash Wednesday', color: 'Grey' },
  { name: '1st Sunday of Lent', color: 'Purple' },
  { name: '2nd Sunday of Lent', color: 'Purple' },
  { name: '3rd Sunday of Lent', color: 'Purple' },
  { name: '4th Sunday of Lent', color: 'Purple' },
  { name: '5th Sunday of Lent', color: 'Purple' },
  { name: 'Palm/Passion Sunday', color: 'Green' },
  { name: 'Maundy Thursday', color: 'Purple' },
  { name: 'Good Friday', color: 'Purple' },
  { name: 'Easter Sunday', color: 'White' },
  { name: '2nd Sunday of Easter', color: 'White' },
  { name: '3rd Sunday of Easter', color: 'White' },
  { name: '4th Sunday of Easter', color: 'White' },
  { name: '5th Sunday of Easter', color: 'White' },
  { name: '6th Sunday of Easter', color: 'White' },
  { name: 'Ascension Sunday', color: 'White' },
  { name: '7th Sunday of Easter', color: 'White' },
  { name: 'Pentecost', color: 'Red' },
  { name: 'Trinity Sunday', color: 'White' },
  { name: 'Season after Pentecost', color: 'Green' },
  { name: 'Rally Day', color: 'Green' },
  { name: 'All Saints Day', color: 'White' },
  { name: 'Thanksgiving', color: 'Green' },
  { name: 'Christ the King Sunday', color: 'White' },
]

function getSeasonColor(season) {
  const found = SEASONS.find(s => s.name === season)
  return found ? found.color : ''
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

function getSeasonFromDate(dateStr) {
  if (!dateStr) return { season: '', color: '' }
  const d = new Date(dateStr + 'T12:00:00')
  const year = d.getFullYear()

  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100
    const d2 = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d2 - g + 15) % 30
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31)
    const day = ((h + l - 7 * m + 114) % 31) + 1
    return new Date(y, month - 1, day)
  }

  const e = easter(year)
  const addDays = (dt, n) => new Date(dt.getTime() + n * 86400000)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()

  const ashWed = addDays(e, -46)
  const palmSunday = addDays(e, -7)
  const maundyThursday = addDays(e, -3)
  const goodFriday = addDays(e, -2)
  const pentecost = addDays(e, 49)
  const trinity = addDays(pentecost, 7)
  const christmas = new Date(year, 11, 25)
  const christmasDow = christmas.getDay()
  const advent1 = addDays(christmas, -(christmasDow === 0 ? 28 : christmasDow + 21))

  if (sameDay(d, goodFriday)) return { season: 'Good Friday', color: 'Purple' }
  if (sameDay(d, maundyThursday)) return { season: 'Maundy Thursday', color: 'Purple' }
  if (sameDay(d, palmSunday)) return { season: 'Palm/Passion Sunday', color: 'Green' }
  if (sameDay(d, e)) return { season: 'Easter Sunday', color: 'White' }
  if (sameDay(d, pentecost)) return { season: 'Pentecost', color: 'Red' }
  if (sameDay(d, trinity)) return { season: 'Trinity Sunday', color: 'White' }
  if (sameDay(d, ashWed)) return { season: 'Ash Wednesday', color: 'Grey' }

  if (d >= advent1 && d < new Date(year, 11, 26)) {
    const week = Math.floor((d - advent1) / 86400000 / 7) + 1
    return { season: `${['1st','2nd','3rd','4th'][week-1]} Sunday of Advent`, color: 'Purple' }
  }
  if (d >= new Date(year, 11, 26) || d <= new Date(year, 0, 5)) return { season: 'Christmas', color: 'White' }

  const epiphany = new Date(year, 0, 6)
  const transfiguration = addDays(ashWed, -3)
  if (d >= epiphany && d <= transfiguration) {
    if (sameDay(d, transfiguration)) return { season: 'Transfiguration Sunday', color: 'White' }
    const week = Math.floor((d - epiphany) / 86400000 / 7)
    if (week === 0) return { season: 'Baptism of the Lord', color: 'White' }
    return { season: `${['1st','2nd','3rd','4th','5th','6th','7th','8th'][week]} Sunday after Epiphany`, color: week === 0 ? 'White' : 'Green' }
  }

  if (d > ashWed && d < palmSunday) {
    const week = Math.floor((d - ashWed) / 86400000 / 7) + 1
    return { season: `${['1st','2nd','3rd','4th','5th'][week-1]} Sunday of Lent`, color: 'Purple' }
  }

  if (d > e && d < pentecost) {
    const week = Math.floor((d - e) / 86400000 / 7)
    return { season: `${['2nd','3rd','4th','5th','6th','7th'][week-1]} Sunday of Easter`, color: 'White' }
  }

  if (d > pentecost) {
    const christKing = addDays(advent1, -7)
    if (sameDay(d, christKing)) return { season: 'Christ the King Sunday', color: 'White' }
    if (d.getMonth() === 8 && d.getDate() <= 7) return { season: 'Rally Day', color: 'Green' }
    if (d.getMonth() === 10 && d.getDate() <= 7) return { season: 'All Saints Day', color: 'White' }
    return { season: 'Season after Pentecost', color: 'Green' }
  }

  return { season: '', color: '' }
}

function buildBibleGatewayUrl(reference, version) {
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(reference)}&version=${encodeURIComponent(version || 'CEB')}`
}

const sectionHead = {
  fontSize: '14px', fontWeight: 700, color: 'var(--burgundy)',
  marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid var(--gray-100)',
}

const EMPTY_FORM = {
  service_date: '', season: '', liturgical_color: '', service_type: 'Regular Sunday',
  is_communion: false, sermon_series: '', spark_title: '', spark_preacher: 'Pastor Zach',
  kids_story_teller: '', liturgist: '', notes: '',
}

export default function ServicePlanner({ onViewService }) {
  const [view, setView] = useState('list')
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('upcoming')
  const [searchDate, setSearchDate] = useState('')
  const [editingService, setEditingService] = useState(null)
  const [hymns, setHymns] = useState([])
  const [saveStatus, setSaveStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [serviceHymns, setServiceHymns] = useState([{ hymnal: 'UMH', number: '', title: '', sort_order: 1 }])
  const [serviceScriptures, setServiceScriptures] = useState([{ reference: '', bible_version: 'CEB', is_call_and_response: false, sort_order: 1 }])

  useEffect(() => { loadServices(); loadHymns() }, [])

  async function loadServices() {
    setLoading(true)
    const { data } = await supabase.from('service_dates').select('*, service_hymns(*), service_scriptures(*)').order('service_date', { ascending: true })
    setServices(data || [])
    setLoading(false)
  }

  async function loadHymns() {
    const { data } = await supabase.from('hymns').select('hymnal, number, title').order('number')
    setHymns(data || [])
  }

  function lookupHymnTitle(hymnal, number) {
    const h = hymns.find(h => h.hymnal === hymnal && h.number === parseInt(number))
    return h ? h.title : ''
  }

  function handleHymnNumberChange(idx, number) {
    const num = parseInt(number)
    if (PAGE_REFS.has(num)) return
    const hymnal = num >= 1000 ? 'TFWS' : 'UMH'
    const title = lookupHymnTitle(hymnal, number)
    setServiceHymns(prev => prev.map((h, i) => i === idx ? { ...h, number, hymnal, title } : h))
  }

  function handleDateChange(val) {
    const { season, color } = getSeasonFromDate(val)
    const isFirst = val ? new Date(val + 'T12:00:00').getDate() <= 7 : false
    setForm(f => ({
      ...f,
      service_date: val,
      season: season || f.season,
      liturgical_color: color || f.liturgical_color,
      is_communion: isFirst,
      service_type: isFirst ? 'Communion Sunday' : 'Regular Sunday',
    }))
  }

  function addHymn() { setServiceHymns(prev => [...prev, { hymnal: 'UMH', number: '', title: '', sort_order: prev.length + 1 }]) }
  function removeHymn(idx) { setServiceHymns(prev => prev.filter((_, i) => i !== idx).map((h, i) => ({ ...h, sort_order: i + 1 }))) }
  function addScripture() { setServiceScriptures(prev => [...prev, { reference: '', bible_version: 'CEB', is_call_and_response: false, sort_order: prev.length + 1 }]) }
  function removeScripture(idx) { setServiceScriptures(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, sort_order: i + 1 }))) }
  function updateScripture(idx, field, value) { setServiceScriptures(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s)) }

  function startNew() {
    setForm(EMPTY_FORM)
    setServiceHymns([{ hymnal: 'UMH', number: '', title: '', sort_order: 1 }])
    setServiceScriptures([{ reference: '', bible_version: 'CEB', is_call_and_response: false, sort_order: 1 }])
    setEditingService(null); setView('edit'); setSaveStatus(null)
  }

  function startEdit(svc) {
    const auto = (!svc.season && !svc.liturgical_color) ? getSeasonFromDate(svc.service_date) : {}
    setForm({
      service_date: svc.service_date,
      season: svc.season || auto.season || '',
      liturgical_color: svc.liturgical_color || auto.color || '',
      service_type: svc.service_type || 'Regular Sunday',
      is_communion: svc.is_communion || false,
      sermon_series: svc.sermon_series || '',
      spark_title: svc.spark_title || '',
      spark_preacher: svc.spark_preacher || 'Pastor Zach',
      kids_story_teller: svc.kids_story_teller || '',
      liturgist: svc.liturgist || '',
      notes: svc.notes || '',
    })
    setServiceHymns(
      svc.service_hymns?.length
        ? svc.service_hymns.sort((a, b) => a.sort_order - b.sort_order).map(h => ({
            hymnal: h.hymnal, number: String(h.number),
            title: lookupHymnTitle(h.hymnal, h.number), sort_order: h.sort_order,
          }))
        : [{ hymnal: 'UMH', number: '', title: '', sort_order: 1 }]
    )
    setServiceScriptures(
      svc.service_scriptures?.length
        ? svc.service_scriptures.sort((a, b) => a.sort_order - b.sort_order)
        : [{ reference: '', bible_version: 'CEB', is_call_and_response: false, sort_order: 1 }]
    )
    setEditingService(svc); setView('edit'); setSaveStatus(null)
  }

  async function handleSave() {
    if (!form.service_date) return
    setSaving(true); setSaveStatus(null)
    try {
      let serviceId
      if (editingService) {
        const { error } = await supabase.from('service_dates').update({ ...form }).eq('id', editingService.id)
        if (error) throw error
        serviceId = editingService.id
        await supabase.from('service_hymns').delete().eq('service_date_id', serviceId)
        await supabase.from('service_scriptures').delete().eq('service_date_id', serviceId)
      } else {
        const { data, error } = await supabase.from('service_dates').insert([{ ...form }]).select().single()
        if (error) throw error
        serviceId = data.id
        await supabase.from('upload_tracker').insert(
          ['service','children','spark','music','special','podcast_spark','podcast_music']
            .map(t => ({ service_date_id: serviceId, upload_type: t, is_uploaded: false, podcast_published: false }))
        )
      }
      const validHymns = serviceHymns.filter(h => h.number && !PAGE_REFS.has(parseInt(h.number)))
      if (validHymns.length > 0) {
        await supabase.from('service_hymns').insert(
          validHymns.map(h => ({ service_date_id: serviceId, hymnal: h.hymnal, number: parseInt(h.number), sort_order: h.sort_order }))
        )
      }
      const validScriptures = serviceScriptures.filter(s => s.reference)
      if (validScriptures.length > 0) {
        await supabase.from('service_scriptures').insert(
          validScriptures.map(s => ({ service_date_id: serviceId, reference: s.reference, bible_version: s.bible_version, is_call_and_response: s.is_call_and_response, sort_order: s.sort_order }))
        )
      }
      setSaveStatus('success'); loadServices()
      setTimeout(() => setView('list'), 800)
    } catch (err) { console.error(err); setSaveStatus('error') }
    setSaving(false)
  }

  async function handleDelete(svc) {
    if (!confirm(`Delete service for ${formatDate(svc.service_date)}?`)) return
    await supabase.from('service_dates').delete().eq('id', svc.id)
    loadServices()
  }

  const formatDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const today = new Date().toISOString().slice(0, 10)
  const filteredServices = services.filter(s => {
    if (searchDate) return s.service_date === searchDate
    if (filter === 'upcoming') return s.service_date >= today
    if (filter === 'past') return s.service_date < today
    return true
  })

  // ── EDIT VIEW ──
  if (view === 'edit') {
    const seasonStyle = getSeasonStyle(form.liturgical_color)
    return (
      <div>
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={() => setView('list')}>← Back</button>
            <h1 className="page-title">{editingService ? `Edit: ${formatDate(editingService.service_date)}` : 'New Service'}</h1>
          </div>
          <button className="btn btn-primary btn-lg" onClick={handleSave} disabled={!form.service_date || saving}>
            {saving ? 'Saving…' : '💾 Save Service'}
          </button>
        </div>
        {saveStatus === 'success' && <div className="alert alert-success" style={{ margin: '12px 28px 0' }}>✓ Saved!</div>}
        {saveStatus === 'error' && <div className="alert alert-error" style={{ margin: '12px 28px 0' }}>Something went wrong.</div>}

        <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="card">
              <h2 style={sectionHead}>📅 Date & Season</h2>
              {form.liturgical_color && (
                <div style={{ background: seasonStyle.bg, color: seasonStyle.color, padding: '8px 12px', borderRadius: '8px', marginBottom: '12px', fontSize: '13px', fontWeight: 600 }}>
                  🎨 Altar color: <strong>{form.liturgical_color}</strong>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Service Date *</label>
                <input type="date" value={form.service_date} onChange={e => handleDateChange(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Season</label>
                <select value={form.season} onChange={e => setForm(f => ({ ...f, season: e.target.value, liturgical_color: getSeasonColor(e.target.value) || f.liturgical_color }))}>
                  <option value="">Select season…</option>
                  {SEASONS.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Liturgical Color</label>
                <select value={form.liturgical_color} onChange={e => setForm(f => ({ ...f, liturgical_color: e.target.value }))}>
                  <option value="">Select color…</option>
                  {['Purple', 'White', 'Green', 'Red', 'Grey', 'Gold'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Service Type</label>
                <select value={form.service_type} onChange={e => setForm(f => ({ ...f, service_type: e.target.value }))}>
                  {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <label className="checkbox-label">
                <input type="checkbox" checked={form.is_communion} onChange={e => setForm(f => ({ ...f, is_communion: e.target.checked }))} />
                🥖 Communion Sunday
              </label>
            </div>

            <div className="card">
              <h2 style={sectionHead}>✨ Sunday Spark</h2>
              <div className="form-group">
                <label className="form-label">Series Title <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                <input type="text" value={form.sermon_series} onChange={e => setForm(f => ({ ...f, sermon_series: e.target.value }))} placeholder="e.g. Walking the Way" />
              </div>
              <div className="form-group">
                <label className="form-label">Spark Title</label>
                <input type="text" value={form.spark_title} onChange={e => setForm(f => ({ ...f, spark_title: e.target.value }))} placeholder="e.g. The Road Home" />
              </div>
              <div className="form-group">
                <label className="form-label">Preacher</label>
                <select value={form.spark_preacher} onChange={e => setForm(f => ({ ...f, spark_preacher: e.target.value }))}>
                  {PREACHERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>

            <div className="card">
              <h2 style={sectionHead}>👥 Kids Story & Liturgist</h2>
              <div className="form-group">
                <label className="form-label">Story Teller</label>
                <select value={form.kids_story_teller} onChange={e => setForm(f => ({ ...f, kids_story_teller: e.target.value }))}>
                  <option value="">Select…</option>
                  {STORYTELLERS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Liturgist</label>
                <input type="text" value={form.liturgist} onChange={e => setForm(f => ({ ...f, liturgist: e.target.value }))} placeholder="e.g. Cyndi Perkins" />
              </div>
            </div>

            <div className="card">
              <h2 style={sectionHead}>📝 Notes</h2>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional notes…" />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ ...sectionHead, margin: 0 }}>🎵 Hymns</h2>
                <button className="btn btn-secondary btn-sm" onClick={addHymn}>+ Add Hymn</button>
              </div>
              {serviceHymns.map((hymn, idx) => (
                <div key={idx} style={{ border: '1px solid var(--gray-100)', borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-400)' }}>HYMN {idx + 1}</span>
                    {serviceHymns.length > 1 && <button onClick={() => removeHymn(idx)} style={{ fontSize: '12px', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ width: '80px', flexShrink: 0 }}>
                      <label className="form-label">Book</label>
                      <select value={hymn.hymnal} onChange={e => setServiceHymns(prev => prev.map((h, i) => i === idx ? { ...h, hymnal: e.target.value } : h))} style={{ padding: '6px 8px', fontSize: '13px' }}>
                        <option value="UMH">UMH</option>
                        <option value="TFWS">TFWS</option>
                      </select>
                    </div>
                    <div style={{ width: '80px', flexShrink: 0 }}>
                      <label className="form-label">Number</label>
                      <input type="text" value={hymn.number} onChange={e => handleHymnNumberChange(idx, e.target.value)} placeholder="###" style={{ padding: '6px 8px', fontSize: '13px' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="form-label">Title</label>
                      <input type="text" value={hymn.title} onChange={e => setServiceHymns(prev => prev.map((h, i) => i === idx ? { ...h, title: e.target.value } : h))} placeholder="Auto-filled from number" style={{ padding: '6px 8px', fontSize: '13px' }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ ...sectionHead, margin: 0 }}>📖 Scripture Readings</h2>
                <button className="btn btn-secondary btn-sm" onClick={addScripture}>+ Add</button>
              </div>
              {serviceScriptures.map((s, idx) => (
                <div key={idx} style={{ border: '1px solid var(--gray-100)', borderRadius: '8px', padding: '12px', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-400)' }}>{s.is_call_and_response ? 'CALL & RESPONSE' : `READING ${idx + 1}`}</span>
                    {serviceScriptures.length > 1 && <button onClick={() => removeScripture(idx)} style={{ fontSize: '12px', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Remove</button>}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <label className="form-label">Reference</label>
                      <input type="text" value={s.reference} onChange={e => updateScripture(idx, 'reference', e.target.value)} placeholder="e.g. John 3:16" style={{ padding: '6px 8px', fontSize: '13px' }} />
                    </div>
                    <div style={{ width: '100px', flexShrink: 0 }}>
                      <label className="form-label">Version</label>
                      <select value={s.bible_version} onChange={e => updateScripture(idx, 'bible_version', e.target.value)} style={{ padding: '6px 8px', fontSize: '13px' }}>
                        {BIBLE_VERSIONS.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label className="checkbox-label" style={{ fontSize: '13px' }}>
                      <input type="checkbox" checked={s.is_call_and_response} onChange={e => updateScripture(idx, 'is_call_and_response', e.target.checked)} />
                      Call & Response
                    </label>
                    {s.reference && <a href={buildBibleGatewayUrl(s.reference, s.bible_version)} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--burgundy)', fontWeight: 600 }}>🔗 Bible Gateway</a>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── LIST VIEW ──
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Service Planner</h1>
        <button className="btn btn-primary" onClick={startNew}>+ New Service</button>
      </div>
      <div className="page-body">
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
          {['upcoming', 'past', 'all'].map(f => (
            <button key={f} onClick={() => { setFilter(f); setSearchDate('') }} className="btn"
              style={{ background: filter === f && !searchDate ? 'var(--burgundy)' : 'var(--gray-100)', color: filter === f && !searchDate ? 'white' : 'var(--gray-800)' }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-600)', whiteSpace: 'nowrap' }}>Jump to date:</label>
            <input type="date" value={searchDate} onChange={e => setSearchDate(e.target.value)} style={{ width: '160px', padding: '6px 10px', fontSize: '13px' }} />
            {searchDate && <button className="btn btn-secondary btn-sm" onClick={() => setSearchDate('')}>Clear</button>}
          </div>
        </div>

        {loading ? <div className="spinner" /> : filteredServices.length === 0 ? (
          <div className="empty-state"><div className="icon">📅</div><p>No services found.</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {filteredServices.map(svc => {
              const style = getSeasonStyle(svc.liturgical_color)
              const isPast = svc.service_date < today
              return (
                <div
                  key={svc.id}
                  style={{ background: 'white', border: '1px solid var(--gray-100)', borderRadius: '10px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '16px', opacity: isPast ? 0.8 : 1, transition: 'box-shadow 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(61,0,38,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                >
                  <div style={{ width: '6px', height: '48px', borderRadius: '3px', background: style.color, flexShrink: 0 }} />

                  {/* Clickable date area */}
                  <div
                    style={{ minWidth: '180px', cursor: 'pointer' }}
                    onClick={() => onViewService(svc.id)}
                  >
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--burgundy)', textDecoration: 'underline', textDecorationColor: 'rgba(61,0,38,0.3)' }}>
                      {formatDate(svc.service_date)}
                    </div>
                    {svc.season && <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>{svc.season}</div>}
                  </div>

                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
                    {svc.service_type && <span style={{ fontSize: '11px', background: 'var(--gray-100)', color: 'var(--gray-600)', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>{svc.service_type}</span>}
                    {svc.is_communion && <span style={{ fontSize: '11px', background: '#fff3cd', color: '#856404', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>🥖 Communion</span>}
                    {svc.spark_title && <span style={{ fontSize: '12px', color: 'var(--gray-800)' }}>"{svc.spark_title}"</span>}
                    {svc.liturgist && <span style={{ fontSize: '11px', color: 'var(--gray-400)' }}>⛪ {svc.liturgist}</span>}
                  </div>

                  <div style={{ fontSize: '13px', color: 'var(--gray-400)', minWidth: '60px', textAlign: 'center' }}>
                    🎵 {svc.service_hymns?.length || 0}
                  </div>

                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => onViewService(svc.id)}>View</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => startEdit(svc)}>Edit</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(svc)}>Delete</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
