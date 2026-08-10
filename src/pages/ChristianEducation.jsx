import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import { supabase } from '../lib/supabase.js'
import { SEASONS, getSeasonStyle, getSeasonFromDate } from '../lib/liturgicalCalendar.js'
import BulkAddCeSessionsModal from '../components/BulkAddCeSessionsModal.jsx'

const CLASS_TYPES = [
  { value: 'adult_sunday_school', label: 'Adult Sunday School', bg: 'var(--burgundy-light)', fg: 'var(--burgundy)' },
  { value: 'youth_sunday_school', label: 'Youth Sunday School', bg: '#e3f2fd', fg: '#1565c0' },
  { value: 'bible_study', label: 'Bible Study', bg: '#e8f5e9', fg: '#2d7a4f' },
  { value: 'workshop', label: 'Workshop', bg: '#fff3e0', fg: '#b8860b' },
]

const EVENT_TYPE_BY_CLASS_TYPE = {
  adult_sunday_school: 'sunday_school',
  youth_sunday_school: 'sunday_school',
  bible_study: 'bible_study',
  workshop: 'workshop',
}

const CATEGORIES = [
  { value: 'lesson', label: 'Lesson' },
  { value: 'craft', label: 'Craft' },
  { value: 'rehearsal', label: 'Rehearsal' },
  { value: 'party', label: 'Party' },
  { value: 'no_class', label: 'No Class' },
  { value: 'pageant', label: 'Pageant' },
  { value: 'special', label: 'Special' },
]

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'select', label: 'Dropdown' },
  { value: 'date', label: 'Date' },
  { value: 'person', label: 'Person (Teacher lookup)' },
]

function typeMeta(value) {
  return CLASS_TYPES.find(t => t.value === value) || { label: value, bg: 'var(--gray-100)', fg: 'var(--gray-600)' }
}

function categoryLabel(value) {
  return CATEGORIES.find(c => c.value === value)?.label || value
}

function slugify(label) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function personLabel(p) {
  if (!p) return 'Unassigned'
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ')
  return name || p.email || p.phone || p.id
}

const CE_TAG_NAME = 'Christian Ed'

const STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function ChristianEducation() {
  const [view, setView] = useState('sessions') // 'sessions' | 'templates'

  const [classes, setClasses] = useState([])
  const [loadingClasses, setLoadingClasses] = useState(true)
  const [filterType, setFilterType] = useState('all')
  const [selectedClass, setSelectedClass] = useState(null)

  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [selectedSession, setSelectedSession] = useState(null)

  const [templates, setTemplates] = useState([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [teachers, setTeachers] = useState([])

  // Add Class form
  const [showAddClass, setShowAddClass] = useState(false)
  const [newClassType, setNewClassType] = useState('adult_sunday_school')
  const [newClassName, setNewClassName] = useState('')
  const [newMeetingDay, setNewMeetingDay] = useState('')
  const [newMeetingTime, setNewMeetingTime] = useState('')
  const [newLocation, setNewLocation] = useState('')
  const [newLeader, setNewLeader] = useState('')
  const [addingClass, setAddingClass] = useState(false)
  const [addClassError, setAddClassError] = useState(null)

  // Add Session form
  const [showAddSession, setShowAddSession] = useState(false)
  const [newSessionDate, setNewSessionDate] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [newCategory, setNewCategory] = useState('lesson')
  const [newTemplateId, setNewTemplateId] = useState('')
  const [addingSession, setAddingSession] = useState(false)
  const [addSessionError, setAddSessionError] = useState(null)

  // Session detail edit
  const [topic, setTopic] = useState('')
  const [curriculumNotes, setCurriculumNotes] = useState('')
  const [materialsNeeded, setMaterialsNeeded] = useState('')
  const [status, setStatus] = useState('planned')
  const [savingSession, setSavingSession] = useState(false)
  const [savingSessionOk, setSavingSessionOk] = useState(false)
  const [sessionError, setSessionError] = useState(null)

  // Dynamic template field values for the selected session
  const [fieldValues, setFieldValues] = useState({})
  const [savingFields, setSavingFields] = useState(false)
  const [savingFieldsOk, setSavingFieldsOk] = useState(false)
  const [fieldsError, setFieldsError] = useState(null)

  // Attendance / push
  const [headcount, setHeadcount] = useState('')
  const [savingHeadcount, setSavingHeadcount] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [pushError, setPushError] = useState(null)

  // Template editor
  const [editingTemplate, setEditingTemplate] = useState(null) // template object being edited, or 'new'
  const [templateCategory, setTemplateCategory] = useState('lesson')
  const [templateName, setTemplateName] = useState('')
  const [templateFields, setTemplateFields] = useState([]) // [{key,label,type,options}]
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateError, setTemplateError] = useState(null)

  // Teachers (people tagged "Christian Ed")
  const [ceTagId, setCeTagId] = useState(null)
  const [teacherSearch, setTeacherSearch] = useState('')
  const [teacherSearchResults, setTeacherSearchResults] = useState([])
  const [teacherSearchLoading, setTeacherSearchLoading] = useState(false)
  const [newPersonFirst, setNewPersonFirst] = useState('')
  const [newPersonLast, setNewPersonLast] = useState('')
  const [newPersonPhone, setNewPersonPhone] = useState('')
  const [newPersonEmail, setNewPersonEmail] = useState('')
  const [addingPerson, setAddingPerson] = useState(false)
  const [addPersonError, setAddPersonError] = useState(null)
  const [taggingId, setTaggingId] = useState(null)

  // Special Sunday (shared with Service Planner via the service_dates table)
  const [specialDay, setSpecialDay] = useState(null) // existing service_dates row, or null
  const [specialDayLoading, setSpecialDayLoading] = useState(false)
  const [specialSeason, setSpecialSeason] = useState('')
  const [specialColor, setSpecialColor] = useState('')
  const [specialDescription, setSpecialDescription] = useState('')
  const [savingSpecialDay, setSavingSpecialDay] = useState(false)
  const [savingSpecialDayOk, setSavingSpecialDayOk] = useState(false)
  const [specialDayError, setSpecialDayError] = useState(null)

  // Bulk add / export / template
  const [showBulkAddSessions, setShowBulkAddSessions] = useState(false)
  const [importingTemplate, setImportingTemplate] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const fileInputRef = useRef(null)

  // Series
  const [seriesList, setSeriesList] = useState([])
  const [loadingSeries, setLoadingSeries] = useState(true)
  const [expandedSeriesId, setExpandedSeriesId] = useState(null)
  const [showNewSeries, setShowNewSeries] = useState(false)
  const [newSeriesClassId, setNewSeriesClassId] = useState('')
  const [newSeriesName, setNewSeriesName] = useState('')
  const [newSeriesDescription, setNewSeriesDescription] = useState('')
  const [newSeriesCategory, setNewSeriesCategory] = useState('lesson')
  const [newSeriesTemplateId, setNewSeriesTemplateId] = useState('')
  const [newSeriesDates, setNewSeriesDates] = useState([{ date: '', title: '', info: '' }])
  const [savingSeries, setSavingSeries] = useState(false)
  const [seriesError, setSeriesError] = useState(null)

  useEffect(() => { loadClasses(); loadTemplates(); loadTeachers(); loadSeries() }, [])

  async function loadClasses() {
    setLoadingClasses(true)
    const { data } = await supabase.from('ce_classes').select('*').order('name', { ascending: true })
    setClasses(data || [])
    setLoadingClasses(false)
  }

  async function loadTemplates() {
    setLoadingTemplates(true)
    const { data } = await supabase.from('ce_session_templates').select('*').order('category', { ascending: true })
    setTemplates(data || [])
    setLoadingTemplates(false)
  }

  async function loadTeachers() {
    // Find (or create) the "Christian Ed" tag, then load everyone who has it.
    let tagId = ceTagId
    if (!tagId) {
      const { data: existing } = await supabase.from('tags').select('id').eq('name', CE_TAG_NAME).maybeSingle()
      if (existing) {
        tagId = existing.id
      } else {
        const { data: created, error } = await supabase.from('tags').insert([{ name: CE_TAG_NAME, color: '#7A0047' }]).select().single()
        if (error) { setTeachers([]); return }
        tagId = created.id
      }
      setCeTagId(tagId)
    }
    const { data } = await supabase
      .from('person_tags')
      .select('people(*)')
      .eq('tag_id', tagId)
    setTeachers((data || []).map(row => row.people).filter(Boolean).sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '')))
  }

  async function loadSeries() {
    setLoadingSeries(true)
    const { data } = await supabase
      .from('ce_series')
      .select('*, ce_classes(name), ce_sessions(id, session_date, topic)')
      .order('created_at', { ascending: false })
    setSeriesList(data || [])
    setLoadingSeries(false)
  }

  function addSeriesDateRow() {
    setNewSeriesDates(prev => [...prev, { date: '', title: '', info: '' }])
  }
  function updateSeriesDateRow(idx, patch) {
    setNewSeriesDates(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))
  }
  function removeSeriesDateRow(idx) {
    setNewSeriesDates(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleCreateSeries(e) {
    e.preventDefault()
    setSavingSeries(true)
    setSeriesError(null)
    try {
      const validDates = newSeriesDates.filter(r => r.date)
      if (validDates.length === 0) throw new Error('Add at least one date.')

      const sortedDates = [...validDates].sort((a, b) => a.date.localeCompare(b.date))
      const { data: series, error: seriesErr } = await supabase
        .from('ce_series')
        .insert([{
          class_id: newSeriesClassId,
          name: newSeriesName,
          description: newSeriesDescription || null,
          start_date: sortedDates[0].date,
          end_date: sortedDates[sortedDates.length - 1].date,
        }])
        .select()
        .single()
      if (seriesErr) throw seriesErr

      const sessionsToInsert = validDates.map(r => ({
        class_id: newSeriesClassId,
        series_id: series.id,
        session_date: r.date,
        topic: r.title || null,
        curriculum_notes: r.info || null,
        category: newSeriesCategory,
        template_id: newSeriesTemplateId || null,
      }))
      const { error: sessionsErr } = await supabase.from('ce_sessions').insert(sessionsToInsert)
      if (sessionsErr) throw sessionsErr

      setNewSeriesClassId(''); setNewSeriesName(''); setNewSeriesDescription('')
      setNewSeriesCategory('lesson'); setNewSeriesTemplateId('')
      setNewSeriesDates([{ date: '', title: '', info: '' }])
      setShowNewSeries(false)
      loadSeries()
      if (selectedClass?.id === newSeriesClassId) selectClass(selectedClass)
    } catch (err) {
      setSeriesError(err.message)
    }
    setSavingSeries(false)
  }

  async function handleDeleteSeries(series) {
    if (!confirm(`Delete "${series.name}"? This removes the series and all ${series.ce_sessions?.length || 0} of its sessions.`)) return
    await supabase.from('ce_series').delete().eq('id', series.id)
    setSeriesList(prev => prev.filter(s => s.id !== series.id))
  }

  async function handleSearchPeople(e) {
    e.preventDefault()
    if (!teacherSearch.trim()) { setTeacherSearchResults([]); return }
    setTeacherSearchLoading(true)
    const q = teacherSearch.trim()
    const { data } = await supabase
      .from('people')
      .select('*')
      .or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(15)
    setTeacherSearchResults(data || [])
    setTeacherSearchLoading(false)
  }

  async function handleTagAsTeacher(personId) {
    if (!ceTagId) return
    setTaggingId(personId)
    await supabase.from('person_tags').upsert([{ person_id: personId, tag_id: ceTagId }], { onConflict: 'person_id,tag_id' })
    await loadTeachers()
    setTaggingId(null)
  }

  async function handleUntagTeacher(personId) {
    if (!ceTagId) return
    if (!confirm('Remove the Christian Ed tag from this person? They\'ll no longer show up in Teacher fields.')) return
    setTaggingId(personId)
    await supabase.from('person_tags').delete().eq('person_id', personId).eq('tag_id', ceTagId)
    await loadTeachers()
    setTaggingId(null)
  }

  async function handleAddPerson(e) {
    e.preventDefault()
    setAddingPerson(true)
    setAddPersonError(null)
    try {
      const { data: person, error } = await supabase
        .from('people')
        .insert([{
          first_name: newPersonFirst,
          last_name: newPersonLast,
          phone: newPersonPhone || null,
          email: newPersonEmail || null,
          person_type: 'staff',
        }])
        .select()
        .single()
      if (error) throw error
      if (ceTagId) {
        await supabase.from('person_tags').insert([{ person_id: person.id, tag_id: ceTagId }])
      }
      setNewPersonFirst(''); setNewPersonLast(''); setNewPersonPhone(''); setNewPersonEmail('')
      await loadTeachers()
    } catch (err) {
      setAddPersonError(err.message)
    }
    setAddingPerson(false)
  }

  async function selectClass(cls) {
    setSelectedClass(cls)
    setSelectedSession(null)
    setPushError(null)
    setSessionsLoading(true)
    const { data } = await supabase
      .from('ce_sessions')
      .select('*')
      .eq('class_id', cls.id)
      .order('session_date', { ascending: false })
    setSessions(data || [])
    setSessionsLoading(false)
  }

  function selectSession(session) {
    setSelectedSession(session)
    setTopic(session.topic || '')
    setCurriculumNotes(session.curriculum_notes || '')
    setMaterialsNeeded(session.materials_needed || '')
    setStatus(session.status || 'planned')
    setHeadcount(session.headcount ?? '')
    setFieldValues(session.field_values || {})
    setSessionError(null)
    setFieldsError(null)
    setPushError(null)
    setSavingSessionOk(false)
    setSavingFieldsOk(false)
    loadSpecialDay(session.session_date)
  }

  async function loadSpecialDay(dateStr) {
    setSpecialDayLoading(true)
    setSpecialDayError(null)
    setSavingSpecialDayOk(false)
    const { data } = await supabase
      .from('service_dates')
      .select('id, season, liturgical_color, special_designation')
      .eq('service_date', dateStr)
      .maybeSingle()
    if (data) {
      setSpecialDay(data)
      setSpecialSeason(data.season || '')
      setSpecialColor(data.liturgical_color || '')
      setSpecialDescription(data.special_designation || '')
    } else {
      // No service_dates row yet — suggest the auto-computed season so
      // there's still something useful to look at before she saves anything.
      const guess = getSeasonFromDate(dateStr)
      setSpecialDay(null)
      setSpecialSeason(guess.season || '')
      setSpecialColor(guess.color || '')
      setSpecialDescription('')
    }
    setSpecialDayLoading(false)
  }

  async function handleSaveSpecialDay() {
    if (!selectedSession) return
    setSavingSpecialDay(true)
    setSpecialDayError(null)
    setSavingSpecialDayOk(false)
    const patch = {
      season: specialSeason.trim() || null,
      liturgical_color: specialColor || null,
      special_designation: specialDescription.trim() || null,
    }
    try {
      if (specialDay?.id) {
        const { error } = await supabase.from('service_dates').update(patch).eq('id', specialDay.id)
        if (error) throw error
        setSpecialDay(prev => ({ ...prev, ...patch }))
      } else {
        const { data, error } = await supabase
          .from('service_dates')
          .insert([{
            service_date: selectedSession.session_date,
            service_type: 'Regular Sunday',
            service_time: '10:15 a.m.',
            bulletin_orientation: 'landscape',
            ...patch,
          }])
          .select('id, season, liturgical_color, special_designation')
          .single()
        if (error) throw error
        setSpecialDay(data)
      }
      setSavingSpecialDayOk(true)
      setTimeout(() => setSavingSpecialDayOk(false), 2000)
    } catch (err) {
      setSpecialDayError(err.message)
    }
    setSavingSpecialDay(false)
  }

  const templatesForCategory = (cat) => templates.filter(t => t.category === cat && t.is_active)
  const activeTemplate = selectedSession?.template_id ? templates.find(t => t.id === selectedSession.template_id) : null

  async function handleAddClass(e) {
    e.preventDefault()
    setAddingClass(true)
    setAddClassError(null)
    try {
      const { data, error } = await supabase
        .from('ce_classes')
        .insert([{
          class_type: newClassType,
          name: newClassName,
          meeting_day: newMeetingDay || null,
          meeting_time: newMeetingTime || null,
          location: newLocation || null,
          leader_name: newLeader || null,
        }])
        .select()
        .single()
      if (error) throw error
      setClasses(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewClassType('adult_sunday_school'); setNewClassName(''); setNewMeetingDay('')
      setNewMeetingTime(''); setNewLocation(''); setNewLeader('')
      setShowAddClass(false)
    } catch (err) {
      setAddClassError(err.message)
    }
    setAddingClass(false)
  }

  async function handleAddSession(e) {
    e.preventDefault()
    if (!selectedClass) return
    setAddingSession(true)
    setAddSessionError(null)
    try {
      const { data, error } = await supabase
        .from('ce_sessions')
        .insert([{
          class_id: selectedClass.id,
          session_date: newSessionDate,
          topic: newTopic || null,
          category: newCategory || null,
          template_id: newTemplateId || null,
        }])
        .select()
        .single()
      if (error) throw error
      const updated = [data, ...sessions].sort((a, b) => b.session_date.localeCompare(a.session_date))
      setSessions(updated)
      setNewSessionDate(''); setNewTopic(''); setNewCategory('lesson'); setNewTemplateId('')
      setShowAddSession(false)
      selectSession(data)
    } catch (err) {
      setAddSessionError(err.message)
    }
    setAddingSession(false)
  }

  function normalizeDate(cell) {
    if (!cell) return ''
    if (cell instanceof Date) {
      const y = cell.getUTCFullYear(), m = String(cell.getUTCMonth() + 1).padStart(2, '0'), d = String(cell.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    const s = String(cell).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    const parsed = new Date(s)
    if (!isNaN(parsed)) {
      const y = parsed.getFullYear(), m = String(parsed.getMonth() + 1).padStart(2, '0'), d = String(parsed.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
    return s
  }

  function sessionTeacherName(s) {
    const teacherId = s.field_values?.teacher
    if (!teacherId) return ''
    return personLabel(teachers.find(t => t.id === teacherId))
  }

  function csvEscape(val) {
    const s = (val ?? '').toString()
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  function handleExportSessionsCsv() {
    const headers = ['Date', 'Category', 'Topic', 'Status', 'Teacher', 'Scripture', 'Curriculum Notes', 'Materials Needed', 'Headcount', 'Pushed to Attendance']
    const rows = sessions.map(s => [
      s.session_date, categoryLabel(s.category) || '', s.topic || '', s.status || '',
      sessionTeacherName(s), s.field_values?.scripture || '',
      s.curriculum_notes || '', s.materials_needed || '', s.headcount ?? '', s.attendance_pushed ? 'Yes' : '',
    ])
    const csv = [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ce-sessions-${selectedClass.name.replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleExportSessionsExcel() {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'UMCD Planning Hub'
    wb.created = new Date()
    const ws = wb.addWorksheet('Sessions')
    ws.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Category', key: 'category', width: 14 },
      { header: 'Topic', key: 'topic', width: 26 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Teacher', key: 'teacher', width: 20 },
      { header: 'Scripture', key: 'scripture', width: 20 },
      { header: 'Curriculum Notes', key: 'notes', width: 32 },
      { header: 'Materials Needed', key: 'materials', width: 28 },
      { header: 'Headcount', key: 'headcount', width: 10 },
      { header: 'Pushed to Attendance', key: 'pushed', width: 16 },
    ]
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D0026' } }
    for (const s of sessions) {
      ws.addRow({
        date: s.session_date, category: categoryLabel(s.category) || '', topic: s.topic || '', status: s.status || '',
        teacher: sessionTeacherName(s), scripture: s.field_values?.scripture || '',
        notes: s.curriculum_notes || '', materials: s.materials_needed || '',
        headcount: s.headcount ?? '', pushed: s.attendance_pushed ? 'Yes' : '',
      })
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ce-sessions-${selectedClass.name.replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Round-trip bulk-edit template — intentionally scoped to the fixed
  // fields (topic, notes, materials, status, headcount), not the
  // per-template dynamic fields, to keep re-import unambiguous.
  function handleDownloadSessionsTemplate() {
    const rows = sessions.map(s => ({
      'Date': s.session_date,
      'Class (reference only)': selectedClass.name,
      'Category (reference only)': categoryLabel(s.category) || '',
      'Topic': s.topic || '',
      'Curriculum Notes': s.curriculum_notes || '',
      'Materials Needed': s.materials_needed || '',
      'Status': s.status || 'planned',
      'Headcount': s.headcount ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.min(Math.max(k.length, 14), 40) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sessions')
    XLSX.writeFile(wb, `ce-sessions-template-${selectedClass.name.replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  async function handleImportSessionsTemplate(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportingTemplate(true)
    setImportResult(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const byDate = {}
      sessions.forEach(s => { byDate[s.session_date] = s })

      let updated = 0
      const skipped = []
      for (const row of rows) {
        const dateStr = normalizeDate(row['Date'])
        if (!dateStr) continue
        const svc = byDate[dateStr]
        if (!svc) { skipped.push(dateStr); continue }
        const patch = {
          topic: row['Topic'] || null,
          curriculum_notes: row['Curriculum Notes'] || null,
          materials_needed: row['Materials Needed'] || null,
          status: row['Status'] || 'planned',
          headcount: row['Headcount'] === '' ? null : parseInt(row['Headcount']),
        }
        const { error } = await supabase.from('ce_sessions').update(patch).eq('id', svc.id)
        if (!error) updated++
      }
      setImportResult({ updated, skipped })
      selectClass(selectedClass)
    } catch (err) {
      setImportResult({ error: err.message })
    }
    setImportingTemplate(false)
    e.target.value = ''
  }

  async function handleSaveSession() {
    if (!selectedSession) return
    setSavingSession(true)
    setSessionError(null)
    setSavingSessionOk(false)
    const updates = {
      topic: topic.trim() || null,
      curriculum_notes: curriculumNotes.trim() || null,
      materials_needed: materialsNeeded.trim() || null,
      status,
    }
    const { error } = await supabase.from('ce_sessions').update(updates).eq('id', selectedSession.id)
    if (error) {
      setSessionError(`Couldn't save: ${error.message}`)
    } else {
      const merged = { ...selectedSession, ...updates }
      setSelectedSession(merged)
      setSessions(prev => prev.map(s => s.id === merged.id ? merged : s))
      setSavingSessionOk(true)
      setTimeout(() => setSavingSessionOk(false), 2000)
    }
    setSavingSession(false)
  }

  async function handleSaveFields() {
    if (!selectedSession) return
    setSavingFields(true)
    setFieldsError(null)
    setSavingFieldsOk(false)
    const { error } = await supabase.from('ce_sessions').update({ field_values: fieldValues }).eq('id', selectedSession.id)
    if (error) {
      setFieldsError(`Couldn't save: ${error.message}`)
    } else {
      const merged = { ...selectedSession, field_values: fieldValues }
      setSelectedSession(merged)
      setSessions(prev => prev.map(s => s.id === merged.id ? merged : s))
      setSavingFieldsOk(true)
      setTimeout(() => setSavingFieldsOk(false), 2000)
    }
    setSavingFields(false)
  }

  async function handleSaveHeadcount() {
    if (!selectedSession) return
    setSavingHeadcount(true)
    setSessionError(null)
    const val = headcount === '' ? null : parseInt(headcount)
    const { error } = await supabase.from('ce_sessions').update({ headcount: val }).eq('id', selectedSession.id)
    if (error) {
      setSessionError(`Couldn't save headcount: ${error.message}`)
    } else {
      const merged = { ...selectedSession, headcount: val }
      setSelectedSession(merged)
      setSessions(prev => prev.map(s => s.id === merged.id ? merged : s))
    }
    setSavingHeadcount(false)
  }

  async function handlePushAttendance() {
    if (!selectedSession || !selectedClass) return
    setPushing(true)
    setPushError(null)
    const val = headcount === '' ? null : parseInt(headcount)
    if (val === null) {
      setPushError('Enter a headcount before pushing to the Attendance Tracker.')
      setPushing(false)
      return
    }
    try {
      const eventType = EVENT_TYPE_BY_CLASS_TYPE[selectedClass.class_type] || 'other'
      let attendanceEventId = selectedSession.attendance_event_id

      if (attendanceEventId) {
        const { error } = await supabase
          .from('attendance_events')
          .update({ headcount: val, event_name: `${selectedClass.name}${topic ? ' — ' + topic : ''}` })
          .eq('id', attendanceEventId)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('attendance_events')
          .insert([{
            event_name: `${selectedClass.name}${topic ? ' — ' + topic : ''}`,
            event_date: selectedSession.session_date,
            event_type: eventType,
            source_app: 'ce_planning',
            headcount: val,
          }])
          .select()
          .single()
        if (error) throw error
        attendanceEventId = data.id
      }

      const updates = {
        headcount: val,
        attendance_pushed: true,
        attendance_pushed_at: new Date().toISOString(),
        attendance_event_id: attendanceEventId,
      }
      const { error: sessErr } = await supabase.from('ce_sessions').update(updates).eq('id', selectedSession.id)
      if (sessErr) throw sessErr

      const merged = { ...selectedSession, ...updates }
      setSelectedSession(merged)
      setSessions(prev => prev.map(s => s.id === merged.id ? merged : s))
    } catch (err) {
      setPushError(err.message)
    }
    setPushing(false)
  }

  // ---- Template editor ----

  function startNewTemplate(defaultCategory) {
    setEditingTemplate('new')
    setTemplateCategory(defaultCategory || 'lesson')
    setTemplateName('')
    setTemplateFields([{ key: 'teacher', label: 'Teacher', type: 'person' }])
    setTemplateError(null)
  }

  function startEditTemplate(t) {
    setEditingTemplate(t)
    setTemplateCategory(t.category)
    setTemplateName(t.name)
    setTemplateFields((t.fields || []).map(f => ({ ...f })))
    setTemplateError(null)
  }

  function addTemplateField() {
    setTemplateFields(prev => [...prev, { key: '', label: '', type: 'text' }])
  }

  function updateTemplateField(idx, patch) {
    setTemplateFields(prev => prev.map((f, i) => {
      if (i !== idx) return f
      const next = { ...f, ...patch }
      if (patch.label !== undefined) next.key = slugify(patch.label) || f.key
      return next
    }))
  }

  function removeTemplateField(idx) {
    setTemplateFields(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSaveTemplate(e) {
    e.preventDefault()
    setSavingTemplate(true)
    setTemplateError(null)
    const cleanFields = templateFields
      .filter(f => f.label.trim())
      .map(f => ({
        key: f.key || slugify(f.label),
        label: f.label.trim(),
        type: f.type,
        ...(f.type === 'select' ? { options: (f.optionsText ?? (f.options || []).join(', ')).split(',').map(o => o.trim()).filter(Boolean) } : {}),
      }))
    try {
      if (editingTemplate === 'new') {
        const { data, error } = await supabase
          .from('ce_session_templates')
          .insert([{ category: templateCategory, name: templateName, fields: cleanFields }])
          .select()
          .single()
        if (error) throw error
        setTemplates(prev => [...prev, data])
      } else {
        const { error } = await supabase
          .from('ce_session_templates')
          .update({ category: templateCategory, name: templateName, fields: cleanFields })
          .eq('id', editingTemplate.id)
        if (error) throw error
        setTemplates(prev => prev.map(t => t.id === editingTemplate.id ? { ...t, category: templateCategory, name: templateName, fields: cleanFields } : t))
      }
      setEditingTemplate(null)
    } catch (err) {
      setTemplateError(err.message)
    }
    setSavingTemplate(false)
  }

  async function handleDeleteTemplate(t) {
    if (!confirm(`Delete template "${t.name}"? Sessions using it keep their saved field values.`)) return
    await supabase.from('ce_session_templates').delete().eq('id', t.id)
    setTemplates(prev => prev.filter(x => x.id !== t.id))
  }

  const formatDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const filteredClasses = classes.filter(c => filterType === 'all' ? true : c.class_type === filterType)

  // ---- Dynamic field renderer ----
  function renderFieldInput(field) {
    const val = fieldValues[field.key] ?? ''
    const set = (v) => setFieldValues(prev => ({ ...prev, [field.key]: v }))
    if (field.type === 'textarea') {
      return <textarea value={val} onChange={e => set(e.target.value)} rows={3}
        style={{ width: '100%', padding: '6px 8px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical' }} />
    }
    if (field.type === 'date') {
      return <input type="date" value={val} onChange={e => set(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }} />
    }
    if (field.type === 'select') {
      return (
        <select value={val} onChange={e => set(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }}>
          <option value="">—</option>
          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    if (field.type === 'person') {
      return (
        <select value={val} onChange={e => set(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }}>
          <option value="">— Select —</option>
          {teachers.map(p => <option key={p.id} value={p.id}>{personLabel(p)}</option>)}
        </select>
      )
    }
    return <input type="text" value={val} onChange={e => set(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }} />
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ============ TEMPLATES VIEW ============ */}
      {view === 'templates' ? (
        <div style={{ flex: 1, overflowY: 'auto', background: 'var(--gray-50)' }}>
          <div style={{ padding: '24px', maxWidth: '760px', margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', color: 'var(--burgundy)' }}>Session Templates</h1>
                <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>Define what fields each category of session captures.</div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setView('sessions')}>← Back to Classes</button>
                <button className="btn btn-primary btn-sm" onClick={() => startNewTemplate()}>+ New Template</button>
              </div>
            </div>

            {editingTemplate && (
              <form onSubmit={handleSaveTemplate} className="card" style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', color: 'var(--gray-800)' }}>
                  {editingTemplate === 'new' ? 'New Template' : `Edit: ${editingTemplate.name}`}
                </h3>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Category</label>
                    <select value={templateCategory} onChange={e => setTemplateCategory(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }}>
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 2 }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Template Name</label>
                    <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)} required placeholder="e.g. Standard Lesson"
                      style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }} />
                  </div>
                </div>

                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '6px' }}>Fields</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                  {templateFields.map((f, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'center', background: 'var(--gray-50)', padding: '8px', borderRadius: '6px' }}>
                      <input type="text" value={f.label} onChange={e => updateTemplateField(idx, { label: e.target.value })} placeholder="Field label (e.g. Scripture)"
                        style={{ flex: 2, padding: '6px 8px', fontSize: '12px' }} />
                      <select value={f.type} onChange={e => updateTemplateField(idx, { type: e.target.value })} style={{ flex: 1, padding: '6px 8px', fontSize: '12px' }}>
                        {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      {f.type === 'select' && (
                        <input type="text" value={f.optionsText ?? (f.options || []).join(', ')}
                          onChange={e => updateTemplateField(idx, { optionsText: e.target.value })}
                          placeholder="Options, comma separated"
                          style={{ flex: 2, padding: '6px 8px', fontSize: '12px' }} />
                      )}
                      <button type="button" onClick={() => removeTemplateField(idx)}
                        style={{ fontSize: '12px', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={addTemplateField} style={{ marginBottom: '12px' }}>+ Add Field</button>

                {templateError && <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '10px' }}>{templateError}</div>}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={savingTemplate}>
                    {savingTemplate ? 'Saving…' : 'Save Template'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingTemplate(null)}>Cancel</button>
                </div>
              </form>
            )}

            {loadingTemplates ? <div className="spinner" /> : CATEGORIES.map(cat => {
              const catTemplates = templates.filter(t => t.category === cat.value)
              return (
                <div key={cat.value} className="card" style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--gray-800)' }}>{cat.label}</h3>
                    <button className="btn btn-secondary btn-sm" onClick={() => startNewTemplate(cat.value)}>+ Add</button>
                  </div>
                  {catTemplates.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>No template yet for this category.</div>
                  ) : catTemplates.map(t => (
                    <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--gray-50)', borderRadius: '6px', marginBottom: '6px' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-800)' }}>{t.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--gray-400)' }}>
                          {(t.fields || []).map(f => f.label).join(', ') || 'No fields'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                        <button onClick={() => startEditTemplate(t)} style={{ fontSize: '12px', color: 'var(--burgundy)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>Edit</button>
                        <button onClick={() => handleDeleteTemplate(t)} style={{ fontSize: '12px', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}

            {teachers.length === 0 && (
              <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '10px' }}>
                No one is tagged "{CE_TAG_NAME}" yet — head to the Teachers tab to add people so they show up in Person-type fields.
              </div>
            )}
          </div>
        </div>
      ) : view === 'teachers' ? (

      /* ============ TEACHERS VIEW ============ */
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--gray-50)' }}>
        <div style={{ padding: '24px', maxWidth: '640px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', color: 'var(--burgundy)' }}>Teachers</h1>
              <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>
                Anyone tagged "{CE_TAG_NAME}" shows up in Teacher/Person fields on session templates.
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => setView('sessions')}>← Back to Classes</button>
          </div>

          {/* Currently tagged */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px', color: 'var(--gray-800)' }}>
              Tagged "{CE_TAG_NAME}" ({teachers.length})
            </h3>
            {teachers.length === 0 ? (
              <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>No one tagged yet — search or add someone below.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {teachers.map(p => (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--gray-50)', borderRadius: '6px' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-800)' }}>{personLabel(p)}</div>
                      {(p.phone || p.email) && (
                        <div style={{ fontSize: '11px', color: 'var(--gray-400)' }}>{[p.phone, p.email].filter(Boolean).join(' · ')}</div>
                      )}
                    </div>
                    <button onClick={() => handleUntagTeacher(p.id)} disabled={taggingId === p.id}
                      style={{ fontSize: '12px', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                      Remove Tag
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Search existing people */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px', color: 'var(--gray-800)' }}>
              Search People
            </h3>
            <form onSubmit={handleSearchPeople} style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <input type="text" value={teacherSearch} onChange={e => setTeacherSearch(e.target.value)} placeholder="Search by name or phone…"
                style={{ flex: 1, padding: '6px 8px', fontSize: '13px' }} />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={teacherSearchLoading}>
                {teacherSearchLoading ? 'Searching…' : 'Search'}
              </button>
            </form>
            {teacherSearchResults.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {teacherSearchResults.map(p => {
                  const alreadyTagged = teachers.some(t => t.id === p.id)
                  return (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--gray-50)', borderRadius: '6px' }}>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-800)' }}>{personLabel(p)}</div>
                        {(p.phone || p.email) && (
                          <div style={{ fontSize: '11px', color: 'var(--gray-400)' }}>{[p.phone, p.email].filter(Boolean).join(' · ')}</div>
                        )}
                      </div>
                      {alreadyTagged ? (
                        <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>Already tagged</span>
                      ) : (
                        <button onClick={() => handleTagAsTeacher(p.id)} disabled={taggingId === p.id}
                          className="btn btn-primary btn-sm">
                          + Tag as {CE_TAG_NAME}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Add a brand new person */}
          <div className="card">
            <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px', color: 'var(--gray-800)' }}>
              Add New Person
            </h3>
            <form onSubmit={handleAddPerson}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input type="text" value={newPersonFirst} onChange={e => setNewPersonFirst(e.target.value)} placeholder="First name" required
                  style={{ flex: 1, padding: '6px 8px', fontSize: '13px' }} />
                <input type="text" value={newPersonLast} onChange={e => setNewPersonLast(e.target.value)} placeholder="Last name" required
                  style={{ flex: 1, padding: '6px 8px', fontSize: '13px' }} />
              </div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input type="text" value={newPersonPhone} onChange={e => setNewPersonPhone(e.target.value)} placeholder="Phone (optional)"
                  style={{ flex: 1, padding: '6px 8px', fontSize: '13px' }} />
                <input type="email" value={newPersonEmail} onChange={e => setNewPersonEmail(e.target.value)} placeholder="Email (optional)"
                  style={{ flex: 1, padding: '6px 8px', fontSize: '13px' }} />
              </div>
              {addPersonError && <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '8px' }}>{addPersonError}</div>}
              <button type="submit" className="btn btn-primary btn-sm" disabled={addingPerson}>
                {addingPerson ? 'Adding…' : `+ Add & Tag as ${CE_TAG_NAME}`}
              </button>
            </form>
          </div>
        </div>
      </div>
      ) : view === 'series' ? (

      /* ============ SERIES VIEW ============ */
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--gray-50)' }}>
        <div style={{ padding: '24px', maxWidth: '720px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', color: 'var(--burgundy)' }}>Series</h1>
              <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>
                A named set of dated sessions — Bible study, or anything else. Creating one emails {' '}
                <span style={{ fontWeight: 600 }}>media@umcdanielson.org</span> automatically so it gets advertised.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setView('sessions')}>← Back to Classes</button>
              <button className="btn btn-primary btn-sm" onClick={() => setShowNewSeries(s => !s)}>
                {showNewSeries ? '✕ Cancel' : '+ New Series'}
              </button>
            </div>
          </div>

          {showNewSeries && (
            <form onSubmit={handleCreateSeries} className="card" style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', color: 'var(--gray-800)' }}>New Series</h3>

              <div className="grid-2" style={{ marginBottom: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Class</label>
                  <select value={newSeriesClassId} onChange={e => setNewSeriesClassId(e.target.value)} required style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }}>
                    <option value="">— Select class —</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Series Name</label>
                  <input type="text" value={newSeriesName} onChange={e => setNewSeriesName(e.target.value)} required placeholder="e.g. Fall Bible Study: Romans"
                    style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }} />
                </div>
              </div>

              <div style={{ marginBottom: '10px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Description (optional)</label>
                <textarea value={newSeriesDescription} onChange={e => setNewSeriesDescription(e.target.value)} rows={2} placeholder="Overview shown in the alert email"
                  style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }} />
              </div>

              <div className="grid-2" style={{ marginBottom: '14px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Category (applies to every date)</label>
                  <select value={newSeriesCategory} onChange={e => { setNewSeriesCategory(e.target.value); setNewSeriesTemplateId('') }} style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Template (optional)</label>
                  <select value={newSeriesTemplateId} onChange={e => setNewSeriesTemplateId(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '13px' }}>
                    <option value="">No template</option>
                    {templatesForCategory(newSeriesCategory).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>

              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '6px' }}>Dates</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                {newSeriesDates.map((row, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', background: 'var(--gray-50)', padding: '8px', borderRadius: '6px' }}>
                    <input type="date" value={row.date} onChange={e => updateSeriesDateRow(idx, { date: e.target.value })}
                      style={{ width: '150px', padding: '6px 8px', fontSize: '12px', flexShrink: 0 }} />
                    <input type="text" value={row.title} onChange={e => updateSeriesDateRow(idx, { title: e.target.value })} placeholder="Title for this date"
                      style={{ flex: 1, padding: '6px 8px', fontSize: '12px' }} />
                    <textarea value={row.info} onChange={e => updateSeriesDateRow(idx, { info: e.target.value })} placeholder="Info / details" rows={1}
                      style={{ flex: 2, padding: '6px 8px', fontSize: '12px', minHeight: '34px', resize: 'vertical' }} />
                    <button type="button" onClick={() => removeSeriesDateRow(idx)}
                      style={{ fontSize: '12px', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, marginTop: '6px' }}>✕</button>
                  </div>
                ))}
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addSeriesDateRow} style={{ marginBottom: '14px' }}>+ Add Date</button>

              {seriesError && <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '10px' }}>{seriesError}</div>}
              <button type="submit" className="btn btn-primary btn-sm" disabled={savingSeries || !newSeriesClassId || !newSeriesName}>
                {savingSeries ? 'Creating…' : 'Create Series'}
              </button>
            </form>
          )}

          {loadingSeries ? <div className="spinner" /> : seriesList.length === 0 ? (
            <div className="empty-state"><div className="icon">📖</div><p>No series yet.</p></div>
          ) : seriesList.map(series => {
            const sortedSessions = [...(series.ce_sessions || [])].sort((a, b) => a.session_date.localeCompare(b.session_date))
            const expanded = expandedSeriesId === series.id
            return (
              <div key={series.id} className="card" style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => setExpandedSeriesId(expanded ? null : series.id)}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--gray-800)' }}>{series.name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                      {series.ce_classes?.name} · {sortedSessions.length} date{sortedSessions.length === 1 ? '' : 's'}
                      {series.start_date && series.end_date && ` · ${series.start_date} to ${series.end_date}`}
                    </div>
                  </div>
                  <button onClick={() => handleDeleteSeries(series)} style={{ fontSize: '12px', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                    Delete
                  </button>
                </div>
                {series.description && <div style={{ fontSize: '13px', color: 'var(--gray-600)', marginTop: '8px' }}>{series.description}</div>}
                {expanded && (
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--gray-100)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {sortedSessions.map(s => (
                      <div key={s.id} style={{ fontSize: '13px', color: 'var(--gray-800)' }}>
                        <strong>{new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong>
                        {s.topic ? ` — ${s.topic}` : ''}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      ) : (
      <>
      {/* ============ CLASSES / SESSIONS VIEW ============ */}

      {/* Left panel — class list */}
      <div style={{ width: '380px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--gray-100)', background: 'white' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--gray-100)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '19px', color: 'var(--burgundy)' }}>Christian Education</h1>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAddClass(s => !s)} style={{ flex: 1 }}>
              {showAddClass ? '✕ Cancel' : '+ Add Class'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setView('templates')} style={{ flex: 1 }}>
              🗂️ Templates
            </button>
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setView('teachers')} style={{ flex: 1 }}>
              🏷️ Teachers ({teachers.length})
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setView('series')} style={{ flex: 1 }}>
              📖 Series
            </button>
          </div>

          {showAddClass && (
            <form onSubmit={handleAddClass} style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: '8px', padding: '10px', marginBottom: '12px' }}>
              <select value={newClassType} onChange={e => setNewClassType(e.target.value)} style={{ width: '100%', padding: '6px 8px', fontSize: '12px', marginBottom: '6px' }}>
                {CLASS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input type="text" value={newClassName} onChange={e => setNewClassName(e.target.value)} placeholder="Class name" required
                style={{ width: '100%', padding: '6px 8px', fontSize: '12px', marginBottom: '6px' }} />
              <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <input type="text" value={newMeetingDay} onChange={e => setNewMeetingDay(e.target.value)} placeholder="Meeting day"
                  style={{ flex: 1, padding: '6px 8px', fontSize: '12px' }} />
                <input type="text" value={newMeetingTime} onChange={e => setNewMeetingTime(e.target.value)} placeholder="Time"
                  style={{ flex: 1, padding: '6px 8px', fontSize: '12px' }} />
              </div>
              <input type="text" value={newLocation} onChange={e => setNewLocation(e.target.value)} placeholder="Location"
                style={{ width: '100%', padding: '6px 8px', fontSize: '12px', marginBottom: '6px' }} />
              <input type="text" value={newLeader} onChange={e => setNewLeader(e.target.value)} placeholder="Leader / teacher name"
                style={{ width: '100%', padding: '6px 8px', fontSize: '12px', marginBottom: '6px' }} />
              {addClassError && <div style={{ fontSize: '11px', color: 'var(--danger)', marginBottom: '6px' }}>{addClassError}</div>}
              <button type="submit" className="btn btn-primary btn-sm" disabled={addingClass} style={{ width: '100%' }}>
                {addingClass ? 'Adding…' : 'Add Class'}
              </button>
            </form>
          )}

          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            <button onClick={() => setFilterType('all')} className="btn btn-sm"
              style={{ background: filterType === 'all' ? 'var(--burgundy)' : 'var(--gray-100)', color: filterType === 'all' ? 'white' : 'var(--gray-800)' }}>
              All
            </button>
            {CLASS_TYPES.map(t => (
              <button key={t.value} onClick={() => setFilterType(t.value)} className="btn btn-sm"
                style={{ background: filterType === t.value ? 'var(--burgundy)' : 'var(--gray-100)', color: filterType === t.value ? 'white' : 'var(--gray-800)' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadingClasses ? <div className="spinner" /> : filteredClasses.length === 0 ? (
            <div style={{ padding: '24px', fontSize: '13px', color: 'var(--gray-400)', textAlign: 'center' }}>
              No classes yet. Add one to get started.
            </div>
          ) : filteredClasses.map(cls => {
            const meta = typeMeta(cls.class_type)
            return (
              <div
                key={cls.id}
                onClick={() => selectClass(cls)}
                style={{
                  padding: '12px 16px', cursor: 'pointer',
                  borderBottom: '1px solid var(--gray-100)',
                  background: selectedClass?.id === cls.id ? 'var(--burgundy-light)' : 'white',
                }}
              >
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: meta.bg, color: meta.fg }}>
                  {meta.label}
                </span>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--gray-800)', marginTop: '4px' }}>{cls.name}</div>
                {(cls.meeting_day || cls.meeting_time) && (
                  <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                    {[cls.meeting_day, cls.meeting_time].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Middle panel — sessions for selected class */}
      <div style={{ width: '340px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--gray-100)', background: 'white' }}>
        {!selectedClass ? (
          <div className="empty-state" style={{ marginTop: '80px' }}>
            <div className="icon">📚</div>
            <p>Select a class to see its sessions</p>
          </div>
        ) : (
          <>
            <div style={{ padding: '20px', borderBottom: '1px solid var(--gray-100)' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '17px', color: 'var(--burgundy)', marginBottom: '4px' }}>
                {selectedClass.name}
              </h2>
              {selectedClass.leader_name && (
                <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginBottom: '10px' }}>Led by {selectedClass.leader_name}</div>
              )}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowAddSession(s => !s)} style={{ flex: 1 }}>
                  {showAddSession ? '✕ Cancel' : '+ Add Session'}
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setShowBulkAddSessions(true)} style={{ flex: 1 }}>
                  📅 Bulk Add
                </button>
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                <button className="btn btn-secondary btn-sm" onClick={handleExportSessionsCsv} disabled={sessions.length === 0} style={{ flex: 1 }}>
                  ⬇ CSV
                </button>
                <button className="btn btn-secondary btn-sm" onClick={handleExportSessionsExcel} disabled={sessions.length === 0} style={{ flex: 1 }}>
                  📊 Excel
                </button>
                <button className="btn btn-secondary btn-sm" onClick={handleDownloadSessionsTemplate} disabled={sessions.length === 0} style={{ flex: 1 }}>
                  📝 Template
                </button>
              </div>
              <div style={{ marginTop: '6px' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={importingTemplate} style={{ width: '100%' }}>
                  {importingTemplate ? 'Importing…' : '⬆ Upload Filled Template'}
                </button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImportSessionsTemplate} />
                {importResult && (
                  <div style={{ fontSize: '11px', color: importResult.error ? 'var(--danger)' : 'var(--gray-400)', marginTop: '6px' }}>
                    {importResult.error || `Updated ${importResult.updated} session(s)${importResult.skipped?.length ? `, ${importResult.skipped.length} date(s) not found` : ''}.`}
                  </div>
                )}
              </div>
              {showAddSession && (
                <form onSubmit={handleAddSession} style={{ marginTop: '10px', background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: '8px', padding: '10px' }}>
                  <input type="date" value={newSessionDate} onChange={e => setNewSessionDate(e.target.value)} required
                    style={{ width: '100%', padding: '6px 8px', fontSize: '12px', marginBottom: '6px' }} />
                  <select value={newCategory} onChange={e => { setNewCategory(e.target.value); setNewTemplateId('') }}
                    style={{ width: '100%', padding: '6px 8px', fontSize: '12px', marginBottom: '6px' }}>
                    {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <select value={newTemplateId} onChange={e => setNewTemplateId(e.target.value)}
                    style={{ width: '100%', padding: '6px 8px', fontSize: '12px', marginBottom: '6px' }}>
                    <option value="">No template (blank session)</option>
                    {templatesForCategory(newCategory).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <input type="text" value={newTopic} onChange={e => setNewTopic(e.target.value)} placeholder="Topic (optional)"
                    style={{ width: '100%', padding: '6px 8px', fontSize: '12px', marginBottom: '6px' }} />
                  {addSessionError && <div style={{ fontSize: '11px', color: 'var(--danger)', marginBottom: '6px' }}>{addSessionError}</div>}
                  <button type="submit" className="btn btn-primary btn-sm" disabled={addingSession} style={{ width: '100%' }}>
                    {addingSession ? 'Adding…' : 'Add Session'}
                  </button>
                </form>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {sessionsLoading ? <div className="spinner" /> : sessions.length === 0 ? (
                <div style={{ padding: '24px', fontSize: '13px', color: 'var(--gray-400)', textAlign: 'center' }}>
                  No sessions planned yet.
                </div>
              ) : sessions.map(s => (
                <div
                  key={s.id}
                  onClick={() => selectSession(s)}
                  style={{
                    padding: '10px 16px', cursor: 'pointer',
                    borderBottom: '1px solid var(--gray-100)',
                    background: selectedSession?.id === s.id ? 'var(--burgundy-light)' : 'white',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-800)' }}>{formatDate(s.session_date)}</span>
                    {s.attendance_pushed && <span title="Pushed to Attendance Tracker" style={{ fontSize: '11px' }}>✅</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                    {s.category && (
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: 'var(--gray-100)', color: 'var(--gray-600)' }}>
                        {categoryLabel(s.category)}
                      </span>
                    )}
                    {s.topic && <span style={{ fontSize: '12px', color: 'var(--gray-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.topic}</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Right panel — session detail + attendance */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--gray-50)' }}>
        {!selectedSession ? (
          <div className="empty-state" style={{ marginTop: '80px' }}>
            <div className="icon">🗓️</div>
            <p>Select a session to plan it and take attendance</p>
          </div>
        ) : (
          <div style={{ padding: '24px' }}>
            <div className="card" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--burgundy)' }}>
                    {formatDate(selectedSession.session_date)}
                  </h2>
                  {selectedSession.category && (
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'var(--gray-100)', color: 'var(--gray-600)' }}>
                      {categoryLabel(selectedSession.category)}{activeTemplate ? ` · ${activeTemplate.name}` : ''}
                    </span>
                  )}
                </div>
                <select value={status} onChange={e => setStatus(e.target.value)} style={{ fontSize: '12px', padding: '4px 8px' }}>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Topic</label>
              <input type="text" value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Parable of the Prodigal Son"
                style={{ width: '100%', padding: '6px 8px', fontSize: '13px', marginBottom: '10px' }} />

              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Curriculum / Planning Notes</label>
              <textarea value={curriculumNotes} onChange={e => setCurriculumNotes(e.target.value)} rows={3}
                style={{ width: '100%', padding: '6px 8px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', marginBottom: '10px' }} />

              <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Materials Needed</label>
              <textarea value={materialsNeeded} onChange={e => setMaterialsNeeded(e.target.value)} rows={2}
                style={{ width: '100%', padding: '6px 8px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', marginBottom: '10px' }} />

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button className="btn btn-primary btn-sm" onClick={handleSaveSession} disabled={savingSession}>
                  {savingSession ? 'Saving…' : 'Save Session'}
                </button>
                {savingSessionOk && <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>✓ Saved</span>}
              </div>
              {sessionError && <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '8px' }}>{sessionError}</div>}
            </div>

            {/* Special Sunday — shared with Service Planner via service_dates */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '6px', color: 'var(--gray-800)' }}>
                🎉 Special Sunday
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--gray-400)', marginBottom: '12px' }}>
                Shared with Service Planner — entering it here updates the same record, and vice versa. Use it as a suggestion for the lesson or activity below.
              </p>

              {specialDayLoading ? <div className="spinner" style={{ margin: '10px auto' }} /> : (
                <>
                  {specialDescription && (
                    <div style={{
                      background: getSeasonStyle(specialColor).bg, color: getSeasonStyle(specialColor).color,
                      borderRadius: '8px', padding: '10px 12px', fontSize: '13px', fontWeight: 600, marginBottom: '12px',
                    }}>
                      💡 {specialDescription} — consider a themed activity or lesson!
                    </div>
                  )}

                  <div className="grid-2" style={{ marginBottom: '10px' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Season</label>
                      <input type="text" list="ce-season-options" value={specialSeason} onChange={e => setSpecialSeason(e.target.value)} placeholder="e.g. Season after Pentecost" />
                      <datalist id="ce-season-options">
                        {SEASONS.map(s => <option key={s.name} value={s.name} />)}
                      </datalist>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Liturgical Color</label>
                      <select value={specialColor} onChange={e => setSpecialColor(e.target.value)}>
                        {['', 'Purple', 'White', 'Green', 'Red', 'Grey'].map(c => <option key={c} value={c}>{c || '(none)'}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Special Description</label>
                    <textarea value={specialDescription} onChange={e => setSpecialDescription(e.target.value)} rows={2} placeholder="e.g. Grandparents Day" />
                  </div>

                  {!specialDay && <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginBottom: '10px' }}>No Service Planner entry exists yet for this date — saving here will create one.</div>}

                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveSpecialDay} disabled={savingSpecialDay}>
                      {savingSpecialDay ? 'Saving…' : 'Save'}
                    </button>
                    {savingSpecialDayOk && <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>✓ Saved</span>}
                  </div>
                  {specialDayError && <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '8px' }}>{specialDayError}</div>}
                </>
              )}
            </div>

            {/* Dynamic template fields */}
            {activeTemplate && activeTemplate.fields && activeTemplate.fields.length > 0 && (
              <div className="card" style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', color: 'var(--gray-800)' }}>
                  {activeTemplate.name} Details
                </h3>
                {activeTemplate.fields.map(f => (
                  <div key={f.key} style={{ marginBottom: '10px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>{f.label}</label>
                    {renderFieldInput(f)}
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button className="btn btn-primary btn-sm" onClick={handleSaveFields} disabled={savingFields}>
                    {savingFields ? 'Saving…' : 'Save Details'}
                  </button>
                  {savingFieldsOk && <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>✓ Saved</span>}
                </div>
                {fieldsError && <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '8px' }}>{fieldsError}</div>}
              </div>
            )}

            {/* Attendance capture */}
            <div className="card">
              <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px', color: 'var(--gray-800)' }}>
                ✅ Attendance
              </h3>
              <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginBottom: '10px' }}>
                Per-person attendance will be available once the Attendance Tracker app is live and rosters are set up. For now, record a headcount and push it — it'll already be sitting in the shared attendance data once that app exists.
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '12px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--gray-400)', display: 'block', marginBottom: '4px' }}>Headcount</label>
                  <input type="number" min="0" value={headcount} onChange={e => setHeadcount(e.target.value)}
                    style={{ width: '100px', padding: '6px 8px', fontSize: '13px' }} />
                </div>
                <button className="btn btn-secondary btn-sm" onClick={handleSaveHeadcount} disabled={savingHeadcount}>
                  {savingHeadcount ? 'Saving…' : 'Save Headcount'}
                </button>
              </div>

              <button className="btn btn-primary btn-sm" onClick={handlePushAttendance} disabled={pushing}>
                {pushing ? 'Pushing…' : selectedSession.attendance_pushed ? '↻ Update in Attendance Tracker' : '→ Push to Attendance Tracker'}
              </button>
              {selectedSession.attendance_pushed && (
                <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '8px' }}>
                  ✅ Last pushed {new Date(selectedSession.attendance_pushed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
              )}
              {pushError && <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '8px' }}>{pushError}</div>}
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {showBulkAddSessions && selectedClass && (
        <BulkAddCeSessionsModal
          cls={selectedClass}
          existingDates={sessions.map(s => s.session_date)}
          templates={templates}
          onClose={() => setShowBulkAddSessions(false)}
          onSaved={() => selectClass(selectedClass)}
        />
      )}
    </div>
  )
}
