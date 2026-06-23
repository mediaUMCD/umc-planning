import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import BulletinGenerateModal from '../components/BulletinGenerateModal.jsx'

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
  // Bulletin content
  call_to_worship_text: '', call_to_worship_source: '',
  offertory_prayer_text: '', offering_prayer_source: 'Offering Prayer from umcdiscipleship.org',
  children_message_label: "CHILDREN'S MESSAGE", children_message_person: '',
  special_music_person: '',
  apostles_creed_ref: 'UMH #881', pastoral_prayer_person: 'Pastor Zach',
  lords_prayer_leader: 'Youth', doxology_ref: 'UMH #95',
  announcements_reader: '', announcements_list: '',
  next_week_liturgist: '',
  bulletin_orientation: 'landscape',
  special_designation: '', service_time: '10:15 a.m.',
  back_cover_photo_url: '',
}

const CHILDREN_MESSAGE_LABELS = ["CHILDREN'S MESSAGE", 'CELEBRATING OUR CHILDREN']

export default function ServicePlanner({ onViewService, editServiceId, onClearEditId }) {
  const [view, setView] = useState('list')
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('upcoming')
  const [searchDate, setSearchDate] = useState('')
  const [editingService, setEditingService] = useState(null)
  const [hymns, setHymns] = useState([])
  const hymnsRef = useRef([]) // always-current hymns for use in callbacks
  const [saveStatus, setSaveStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [serviceHymns, setServiceHymns] = useState([{ hymnal: 'UMH', number: '', title: '', sort_order: 1, is_closing: false }])
  const [hymnHistory, setHymnHistory] = useState({}) // key: "HYMNAL-NUMBER" → last service_date
  const [serviceScriptures, setServiceScriptures] = useState([{ reference: '', bible_version: 'CEB', is_call_and_response: false, sort_order: 1, page_reference: '', is_gospel: false }])

  useEffect(() => { 
    const init = async () => {
      const { data: hymnData } = await supabase.from('hymns').select('hymnal, number, title')
      const sorted = (hymnData || []).sort((a, b) => parseFloat(a.number) - parseFloat(b.number))
      setHymns(sorted)
      hymnsRef.current = sorted

      const { data: svcData } = await supabase.from('service_dates').select('*, service_hymns(*), service_scriptures(*)').order('service_date', { ascending: true })
      setServices(svcData || [])
      setLoading(false)

      // If we came from ServiceView's Edit button, open that service directly
      if (editServiceId && svcData) {
        const svc = svcData.find(s => s.id === editServiceId)
        if (svc) {
          startEdit(svc, sorted)
          if (onClearEditId) onClearEditId()
        }
      }

      loadHymnHistory()
    }
    init()
  }, [])

  async function loadServices() {
    setLoading(true)
    const { data } = await supabase.from('service_dates').select('*, service_hymns(*), service_scriptures(*)').order('service_date', { ascending: true })
    setServices(data || [])
    setLoading(false)
  }

  async function loadHymns() {
    // kept for compatibility but main load is now in useEffect init
    const { data } = await supabase.from('hymns').select('hymnal, number, title')
    const sorted = (data || []).sort((a, b) => parseFloat(a.number) - parseFloat(b.number))
    setHymns(sorted)
    setServiceHymns(prev => prev.map(h => ({
      ...h,
      title: h.title || lookupHymnTitle(h.hymnal, h.number, sorted)
    })))
  }

  async function loadHymnHistory() {
    // Get all past hymn uses with their service dates, newest first
    const { data } = await supabase
      .from('service_hymns')
      .select('hymnal, number, service_date_id, service_dates(service_date)')
      .order('service_date_id', { ascending: false })
    if (!data) return
    // Build lookup: first occurrence of each hymnal-number combo = most recent use
    const history = {}
    for (const h of data) {
      const key = `${h.hymnal}-${h.number}`
      if (!history[key] && h.service_dates?.service_date) {
        history[key] = h.service_dates.service_date
      }
    }
    setHymnHistory(history)
  }

  function lookupHymnTitle(hymnal, number, hymnsList) {
    const list = hymnsList || hymnsRef.current || hymns
    const num = parseFloat(number)
    const h = list.find(h => h.hymnal === hymnal && parseFloat(h.number) === num)
    return h ? h.title : ''
  }

  function handleHymnNumberChange(idx, number) {
    const num = parseFloat(number)
    // Only block PAGE_REFS for short numbers (1-2 digits) — don't block mid-typing of 710, 800, etc.
    if (number.length <= 2 && !isNaN(num) && PAGE_REFS.has(num)) {
      setServiceHymns(prev => prev.map((h, i) => i === idx ? { ...h, number } : h))
      return
    }
    // Respect the user's manual hymnal selection — only auto-switch to TFWS at 1000+
    const currentHymnal = serviceHymns[idx]?.hymnal || 'UMH'
    const hymnal = (!isNaN(num) && num >= 1000) ? 'TFWS' : currentHymnal
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

  function addHymn() { setServiceHymns(prev => [...prev, { hymnal: 'UMH', number: '', title: '', sort_order: prev.length + 1, is_closing: false }]) }
  function removeHymn(idx) { setServiceHymns(prev => prev.filter((_, i) => i !== idx).map((h, i) => ({ ...h, sort_order: i + 1 }))) }
  function addScripture() { setServiceScriptures(prev => [...prev, { reference: '', bible_version: 'CEB', is_call_and_response: false, sort_order: prev.length + 1, page_reference: '', is_gospel: false }]) }
  function removeScripture(idx) { setServiceScriptures(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, sort_order: i + 1 }))) }
  function updateScripture(idx, field, value) { setServiceScriptures(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s)) }
  function updateHymn(idx, field, value) { setServiceHymns(prev => prev.map((h, i) => i === idx ? { ...h, [field]: value } : h)) }

  function startNew() {
    setForm(EMPTY_FORM)
    setServiceHymns([{ hymnal: 'UMH', number: '', title: '', sort_order: 1, is_closing: false }])
    setServiceScriptures([{ reference: '', bible_version: 'CEB', is_call_and_response: false, sort_order: 1, page_reference: '', is_gospel: false }])
    setEditingService(null); setView('edit'); setSaveStatus(null)
  }

  function startEdit(svc, hymnsList = hymns) {
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
      // Bulletin content
      call_to_worship_text: svc.call_to_worship_text || '',
      call_to_worship_source: svc.call_to_worship_source || '',
      offertory_prayer_text: svc.offertory_prayer_text || '',
      offering_prayer_source: svc.offering_prayer_source || 'Offering Prayer from umcdiscipleship.org',
      children_message_label: svc.children_message_label || "CHILDREN'S MESSAGE",
      children_message_person: svc.children_message_person || '',
      special_music_person: svc.special_music_person || '',
      apostles_creed_ref: svc.apostles_creed_ref || 'UMH #881',
      pastoral_prayer_person: svc.pastoral_prayer_person || 'Pastor Zach',
      lords_prayer_leader: svc.lords_prayer_leader || 'Youth',
      doxology_ref: svc.doxology_ref || 'UMH #95',
      announcements_reader: svc.announcements_reader || '',
      announcements_list: svc.announcements_list || '',
      next_week_liturgist: svc.next_week_liturgist || '',
      bulletin_orientation: svc.bulletin_orientation || 'landscape',
      special_designation: svc.special_designation || '',
      service_time: svc.service_time || '10:15 a.m.',
      back_cover_photo_url: svc.back_cover_photo_url || '',
    })
    setServiceHymns(
      svc.service_hymns?.length
        ? svc.service_hymns.sort((a, b) => a.sort_order - b.sort_order).map(h => ({
            hymnal: h.hymnal, number: String(h.number),
            title: lookupHymnTitle(h.hymnal, h.number, hymnsList), sort_order: h.sort_order,
            is_closing: h.is_closing || false,
          }))
        : [{ hymnal: 'UMH', number: '', title: '', sort_order: 1, is_closing: false }]
    )
    setServiceScriptures(
      svc.service_scriptures?.length
        ? svc.service_scriptures.sort((a, b) => a.sort_order - b.sort_order).map(s => ({
            ...s, page_reference: s.page_reference || '', is_gospel: s.is_gospel || false,
          }))
        : [{ reference: '', bible_version: 'CEB', is_call_and_response: false, sort_order: 1, page_reference: '', is_gospel: false }]
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
          validHymns.map(h => ({ service_date_id: serviceId, hymnal: h.hymnal, number: parseInt(h.number), sort_order: h.sort_order, is_closing: h.is_closing || false }))
        )
      }
      const validScriptures = serviceScriptures.filter(s => s.reference)
      if (validScriptures.length > 0) {
        await supabase.from('service_scriptures').insert(
          validScriptures.map(s => ({ service_date_id: serviceId, reference: s.reference, bible_version: s.bible_version, is_call_and_response: s.is_call_and_response, sort_order: s.sort_order, page_reference: s.page_reference || null, is_gospel: s.is_gospel || false }))
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
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Today's Liturgist</label>
                  <input type="text" value={form.liturgist} onChange={e => setForm(f => ({ ...f, liturgist: e.target.value }))} placeholder="e.g. Cyndi Perkins" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Next Week's Liturgist</label>
                  <input type="text" value={form.next_week_liturgist} onChange={e => setForm(f => ({ ...f, next_week_liturgist: e.target.value }))} placeholder="e.g. Scott Richards" />
                </div>
              </div>
            </div>

            <div className="card">
              <h2 style={sectionHead}>🙏 Call to Worship</h2>
              <div className="form-group">
                <label className="form-label">Full Text</label>
                <textarea value={form.call_to_worship_text} onChange={e => setForm(f => ({ ...f, call_to_worship_text: e.target.value }))} placeholder="There is no one like you, God of Abraham and Sarah..." style={{ minHeight: '140px' }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Source Citation</label>
                <input type="text" value={form.call_to_worship_source} onChange={e => setForm(f => ({ ...f, call_to_worship_source: e.target.value }))} placeholder="e.g. Lectionary Worship Aids: Series VIII, Cycle A..." />
              </div>
            </div>

            <div className="card">
              <h2 style={sectionHead}>🕊️ Offertory Prayer</h2>
              <div className="form-group">
                <label className="form-label">Full Text</label>
                <textarea value={form.offertory_prayer_text} onChange={e => setForm(f => ({ ...f, offertory_prayer_text: e.target.value }))} placeholder="Listening God, you hear the cries we whisper..." style={{ minHeight: '140px' }} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Source Citation</label>
                <input type="text" value={form.offering_prayer_source} onChange={e => setForm(f => ({ ...f, offering_prayer_source: e.target.value }))} placeholder="e.g. Offering Prayer from umcdiscipleship.org" />
              </div>
            </div>

            <div className="card">
              <h2 style={sectionHead}>📋 Order of Service — Other Fields</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Children's Message Label</label>
                  <select value={form.children_message_label} onChange={e => setForm(f => ({ ...f, children_message_label: e.target.value }))}>
                    {CHILDREN_MESSAGE_LABELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Children's Message By</label>
                  <input type="text" value={form.children_message_person} onChange={e => setForm(f => ({ ...f, children_message_person: e.target.value }))} placeholder="e.g. Chrissy Pagano" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Special Music</label>
                <input type="text" value={form.special_music_person} onChange={e => setForm(f => ({ ...f, special_music_person: e.target.value }))} placeholder="e.g. Pastor Zach" />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Apostles' Creed</label>
                  <input type="text" value={form.apostles_creed_ref} onChange={e => setForm(f => ({ ...f, apostles_creed_ref: e.target.value }))} placeholder="UMH #881 (leave blank to omit)" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Doxology</label>
                  <input type="text" value={form.doxology_ref} onChange={e => setForm(f => ({ ...f, doxology_ref: e.target.value }))} placeholder="UMH #95" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Joys & Concerns / Pastoral Prayer</label>
                  <input type="text" value={form.pastoral_prayer_person} onChange={e => setForm(f => ({ ...f, pastoral_prayer_person: e.target.value }))} placeholder="e.g. Pastor Zach" />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Lord's Prayer Led By</label>
                  <input type="text" value={form.lords_prayer_leader} onChange={e => setForm(f => ({ ...f, lords_prayer_leader: e.target.value }))} placeholder="e.g. Youth" />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Weekly Announcements Read By</label>
                <input type="text" value={form.announcements_reader} onChange={e => setForm(f => ({ ...f, announcements_reader: e.target.value }))} placeholder="e.g. Betsy Kneeland" />
              </div>
            </div>

            <div className="card">
              <h2 style={sectionHead}>📣 Announcements List <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(Page 2)</span></h2>
              <textarea value={form.announcements_list} onChange={e => setForm(f => ({ ...f, announcements_list: e.target.value }))} placeholder={'One per line, e.g.:\nToday: Luncheon after Church – bring a side dish to share.\n6/27: Grief Group @ 10:15 a.m.'} style={{ minHeight: '100px' }} />
            </div>

            <div className="card">
              <h2 style={sectionHead}>🖨️ Bulletin Layout</h2>
              <div className="form-group">
                <label className="form-label">Orientation</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, bulletin_orientation: 'landscape' }))}
                    className="btn"
                    style={{ flex: 1, background: form.bulletin_orientation === 'landscape' ? 'var(--burgundy)' : 'var(--gray-100)', color: form.bulletin_orientation === 'landscape' ? 'white' : 'var(--gray-800)' }}
                  >
                    🖥️ Landscape (2-col)
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, bulletin_orientation: 'portrait' }))}
                    className="btn"
                    style={{ flex: 1, background: form.bulletin_orientation === 'portrait' ? 'var(--burgundy)' : 'var(--gray-100)', color: form.bulletin_orientation === 'portrait' ? 'white' : 'var(--gray-800)' }}
                  >
                    📄 Portrait (1-col)
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label">Special Designation</label>
                  <input type="text" value={form.special_designation} onChange={e => setForm(f => ({ ...f, special_designation: e.target.value }))} placeholder="e.g. Children's Sunday – 3rd After Pentecost" />
                </div>
                <div className="form-group" style={{ width: '120px', flexShrink: 0 }}>
                  <label className="form-label">Service Time</label>
                  <input type="text" value={form.service_time} onChange={e => setForm(f => ({ ...f, service_time: e.target.value }))} placeholder={form.special_designation ? 'Morning Service 10:15 a.m.' : '10:15 a.m.'} />
                </div>
              </div>
              {editingService && (
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  style={{ width: '100%', marginTop: '4px' }}
                  onClick={() => setShowGenerateModal(true)}
                >
                  📄 Generate Bulletin
                </button>
              )}
              {!editingService && (
                <div style={{ fontSize: '12px', color: 'var(--gray-400)', fontStyle: 'italic', marginTop: '4px' }}>
                  Save the service first to generate its bulletin.
                </div>
              )}
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
                    <div style={{ width: '100px', flexShrink: 0 }}>
                      <label className="form-label">Number</label>
                      <input type="text" value={hymn.number} onChange={e => handleHymnNumberChange(idx, e.target.value)} placeholder="###" style={{ padding: '6px 8px', fontSize: '13px', width: '100%' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="form-label">Title</label>
                      <input type="text" value={hymn.title} onChange={e => setServiceHymns(prev => prev.map((h, i) => i === idx ? { ...h, title: e.target.value } : h))} placeholder="Auto-filled from number" style={{ padding: '6px 8px', fontSize: '13px' }} />
                    </div>
                  </div>
                  {hymn.number && hymnHistory[`${hymn.hymnal}-${parseFloat(hymn.number)}`] && (
                    <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '4px' }}>
                      Last played: {new Date(hymnHistory[`${hymn.hymnal}-${parseFloat(hymn.number)}`] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  )}
                  <label className="checkbox-label" style={{ fontSize: '13px', marginTop: '8px' }}>
                    <input type="checkbox" checked={hymn.is_closing || false} onChange={e => updateHymn(idx, 'is_closing', e.target.checked)} />
                    Closing hymn (for bulletin)
                  </label>
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
                    <div style={{ width: '110px', flexShrink: 0 }}>
                      <label className="form-label">Page(s)</label>
                      <input type="text" value={s.page_reference || ''} onChange={e => updateScripture(idx, 'page_reference', e.target.value)} placeholder="e.g. 17-18" style={{ padding: '6px 8px', fontSize: '13px' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '14px' }}>
                      <label className="checkbox-label" style={{ fontSize: '13px' }}>
                        <input type="checkbox" checked={s.is_call_and_response} onChange={e => updateScripture(idx, 'is_call_and_response', e.target.checked)} />
                        Call & Response
                      </label>
                      <label className="checkbox-label" style={{ fontSize: '13px' }}>
                        <input type="checkbox" checked={s.is_gospel || false} onChange={e => updateScripture(idx, 'is_gospel', e.target.checked)} />
                        Gospel Lesson
                      </label>
                    </div>
                    {s.reference && <a href={buildBibleGatewayUrl(s.reference, s.bible_version)} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--burgundy)', fontWeight: 600 }}>🔗 Bible Gateway</a>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {showGenerateModal && editingService && (
          <BulletinGenerateModal
            service={{ ...form, id: editingService.id }}
            hymns={serviceHymns}
            scriptures={serviceScriptures}
            onClose={() => setShowGenerateModal(false)}
          />
        )}
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
                    <button className="btn btn-secondary btn-sm" onClick={() => startEdit(svc, hymnsRef.current)}>Edit</button>
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
