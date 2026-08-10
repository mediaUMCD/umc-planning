import { useState, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import { supabase } from '../lib/supabase.js'
import { getSundayNumber } from '../lib/sundayNumber.js'

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

// Small self-contained text field that saves to service_dates on blur,
// so the parent doesn't re-render/re-fetch on every keystroke.
function RecapField({ label, placeholder, value, multiline, onSave }) {
  const [local, setLocal] = useState(value || '')
  const [saved, setSaved] = useState(false)

  useEffect(() => { setLocal(value || '') }, [value])

  const commit = () => {
    if (local === (value || '')) return
    onSave(local)
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  const Field = multiline ? 'textarea' : 'input'

  return (
    <div className="form-group" style={{ marginBottom: '10px' }}>
      <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {label}
        {saved && <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '11px' }}>✓ Saved</span>}
      </label>
      <Field
        type={multiline ? undefined : 'text'}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={commit}
        placeholder={placeholder}
        style={multiline ? { minHeight: '70px', fontSize: '13px', padding: '6px 8px' } : { fontSize: '13px', padding: '6px 8px' }}
      />
    </div>
  )
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

// Small colored status pill for the approval workflow.
function ApprovalBadge({ status }) {
  const map = {
    approved: { bg: '#d1f5dd', color: '#1a7a3c', label: '✓ Approved' },
    pending: { bg: '#fff3cd', color: '#8a6400', label: '⏳ Pending' },
  }
  const cfg = map[status]
  if (!cfg) return null
  return (
    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  )
}

export default function UploadTracker() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('recent')
  const [expandedId, setExpandedId] = useState(null)
  const [editingUrl, setEditingUrl] = useState(null)
  const [urlValue, setUrlValue] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [userEmail, setUserEmail] = useState(null)
  const [sendingApproval, setSendingApproval] = useState(null) // `${serviceId}-${contentType}` while in flight
  const [importHistory, setImportHistory] = useState([])
  const [showImportHistory, setShowImportHistory] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => { loadData() }, [filter])
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data?.user?.email || null))
    loadImportHistory()
  }, [])

  async function loadImportHistory() {
    const { data } = await supabase.from('import_log').select('*').order('run_at', { ascending: false }).limit(20)
    setImportHistory(data || [])
  }

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
    await supabase.from('upload_tracker').update({ is_uploaded: !currentValue, is_na: false }).eq('id', trackerId)
    setServices(prev => prev.map(svc => ({
      ...svc,
      upload_tracker: svc.upload_tracker?.map(t =>
        t.id === trackerId ? { ...t, is_uploaded: !currentValue, is_na: false } : t
      )
    })))
  }

  async function togglePodcast(trackerId, currentValue) {
    await supabase.from('upload_tracker').update({ podcast_published: !currentValue, is_na: false }).eq('id', trackerId)
    setServices(prev => prev.map(svc => ({
      ...svc,
      upload_tracker: svc.upload_tracker?.map(t =>
        t.id === trackerId ? { ...t, podcast_published: !currentValue, is_na: false } : t
      )
    })))
  }

  async function toggleNA(trackerId, currentValue, isPodcast) {
    const next = !currentValue
    const patch = next
      ? { is_na: true, is_uploaded: false, ...(isPodcast ? { podcast_published: false } : {}) }
      : { is_na: false }
    await supabase.from('upload_tracker').update(patch).eq('id', trackerId)
    setServices(prev => prev.map(svc => ({
      ...svc,
      upload_tracker: svc.upload_tracker?.map(t =>
        t.id === trackerId ? { ...t, ...patch } : t
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

  async function saveRecapField(serviceId, field, value) {
    const payload = { [field]: value || null }
    await supabase.from('service_dates').update(payload).eq('id', serviceId)
    setServices(prev => prev.map(svc => svc.id === serviceId ? { ...svc, ...payload } : svc))
  }

  async function sendForApproval(svc, contentType) {
    const key = `${svc.id}-${contentType}`
    setSendingApproval(key)
    try {
      const { data, error } = await supabase.functions.invoke('content-approval', {
        body: { action: 'request', serviceId: svc.id, contentType, requestedByEmail: userEmail },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      const statusField = `${contentType}_approval_status`
      setServices(prev => prev.map(s => s.id === svc.id ? { ...s, [statusField]: 'pending' } : s))
    } catch (err) {
      alert(`Couldn't send for approval: ${err.message || 'unknown error'}`)
    }
    setSendingApproval(null)
  }

  async function selfApprove(svc, contentType) {
    if (!confirm(`Mark this ${contentType === 'sermon' ? 'sermon' : 'special music'} as approved yourself? Pastor Zach won't be emailed.`)) return
    const statusField = `${contentType}_approval_status`
    const approvedAtField = `${contentType}_approved_at`
    const tokenField = `${contentType}_approval_token`
    const payload = { [statusField]: 'approved', [approvedAtField]: new Date().toISOString(), [tokenField]: null }
    await supabase.from('service_dates').update(payload).eq('id', svc.id)
    setServices(prev => prev.map(s => s.id === svc.id ? { ...s, ...payload } : s))
  }

  const formatDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

  const getTracker = (svc, key) => svc.upload_tracker?.find(t => t.upload_type === key)

  const getCompletionCount = (svc) => {
    const relevant = UPLOAD_TYPES.filter(t => !t.key.startsWith('podcast'))
    const done = relevant.filter(t => {
      const tracker = getTracker(svc, t.key)
      return tracker?.is_uploaded || tracker?.is_na
    }).length
    return { done, total: relevant.length }
  }

  // ── Excel Template Download ──
  function downloadTemplate() {
    const rows = services.map(svc => {
      const row = {
        'Date': svc.service_date,
        'Sunday # (reference only)': getSundayNumber(svc.service_date),
        'Season (reference only)': svc.season || '',
        'Spark Title (reference only)': svc.spark_title || '',
      }
      UPLOAD_TYPES.forEach(t => {
        const tracker = getTracker(svc, t.key)
        const isPodcast = t.key.startsWith('podcast')
        const doneFlag = isPodcast ? tracker?.podcast_published : tracker?.is_uploaded
        const status = tracker?.is_na ? 'na' : doneFlag ? (isPodcast ? 'published' : 'uploaded') : ''
        row[`${t.label} — Status`] = status
        row[`${t.label} — URL`] = tracker?.url || ''
      })
      row['Song Title (as sung)'] = svc.special_music_title || ''
      row['Sermon Title'] = svc.spark_title || ''
      row['Sermon Podcast Summary'] = svc.podcast_summary || ''
      row['Music Podcast Summary'] = svc.music_podcast_summary || ''
      row['Sermon Approval Status (reference only)'] = svc.sermon_approval_status || 'draft'
      row['Music Approval Status (reference only)'] = svc.music_approval_status || 'draft'
      return row
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = Object.keys(rows[0] || {}).map(k => ({ wch: Math.min(Math.max(k.length, 14), 40) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Upload Tracker')
    XLSX.writeFile(wb, `upload-tracker-${filter}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // ── Clean report export (separate from the round-trip bulk-edit
  //    template above) — for viewing/printing/sharing, not re-importing.
  const REPORT_FILL = { 'Purple': 'D9C2E9', 'White': 'FFF8E7', 'Green': 'C6E5C0', 'Red': 'F2C4C4', 'Grey': 'E0E0E0' }
  const REPORT_FONT = { 'Purple': '6B2D8B', 'White': 'B8860B', 'Green': '2D7A4F', 'Red': 'C0392B', 'Grey': '5C5850' }

  function statusLabel(svc, t) {
    const tracker = getTracker(svc, t.key)
    if (!tracker) return ''
    if (tracker.is_na) return 'N/A'
    const isPodcast = t.key.startsWith('podcast')
    const done = isPodcast ? tracker.podcast_published : tracker.is_uploaded
    return done ? '✓' : ''
  }

  function csvEscape(val) {
    const s = (val ?? '').toString()
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  function handleExportReportCsv() {
    const headers = ['Date', 'Day', 'Season', 'Special Description', 'Sermon Title', ...UPLOAD_TYPES.map(t => t.label), 'Sermon Approval', 'Music Approval']
    const rows = services.map(svc => [
      svc.service_date,
      new Date(svc.service_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }),
      svc.season || '', svc.special_designation || '', svc.spark_title || '',
      ...UPLOAD_TYPES.map(t => statusLabel(svc, t)),
      svc.sermon_approval_status || 'draft', svc.music_approval_status || 'draft',
    ])
    const csv = [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `upload-tracker-report-${filter}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleExportReportExcel() {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'UMCD Planning Hub'
    wb.created = new Date()
    const ws = wb.addWorksheet('Upload Tracker')
    ws.columns = [
      { header: 'Date', key: 'date', width: 14 },
      { header: 'Day', key: 'day', width: 12 },
      { header: 'Season', key: 'season', width: 26 },
      { header: 'Special Description', key: 'special', width: 28 },
      { header: 'Sermon Title', key: 'spark', width: 26 },
      ...UPLOAD_TYPES.map(t => ({ header: t.label, key: t.key, width: 14 })),
      { header: 'Sermon Approval', key: 'sermonApproval', width: 16 },
      { header: 'Music Approval', key: 'musicApproval', width: 16 },
    ]
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D0026' } }

    for (const svc of services) {
      const rowData = {
        date: svc.service_date,
        day: new Date(svc.service_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }),
        season: svc.season || '', special: svc.special_designation || '', spark: svc.spark_title || '',
        sermonApproval: svc.sermon_approval_status || 'draft', musicApproval: svc.music_approval_status || 'draft',
      }
      UPLOAD_TYPES.forEach(t => { rowData[t.key] = statusLabel(svc, t) })
      const row = ws.addRow(rowData)

      const fill = REPORT_FILL[svc.liturgical_color]
      const font = REPORT_FONT[svc.liturgical_color]
      if (fill) row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${fill}` } } })
      if (font) row.getCell('season').font = { color: { argb: `FF${font}` }, bold: true }
      if (svc.special_designation) row.getCell('special').font = { bold: true }
      UPLOAD_TYPES.forEach(t => {
        const val = rowData[t.key]
        if (val === '✓') row.getCell(t.key).font = { color: { argb: 'FF2D7A4F' }, bold: true }
        else if (val === 'N/A') row.getCell(t.key).font = { color: { argb: 'FF9B9690' } }
      })
    }
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `upload-tracker-report-${filter}-${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Excel Import ──
  async function handleImportFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportResult(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      // Fetch a fresh, complete lookup so backlog dates outside the current filter still match
      const { data: allServices } = await supabase.from('service_dates').select('id, service_date, upload_tracker(*)')
      const byDate = {}
      ;(allServices || []).forEach(s => { byDate[s.service_date] = s })

      let updated = 0
      const skipped = []
      const noChanges = []

      for (const row of rows) {
        const dateStr = normalizeDate(row['Date'])
        if (!dateStr) continue
        const svc = byDate[dateStr]
        if (!svc) { skipped.push(dateStr); continue }

        const trackerPatches = []
        for (const t of UPLOAD_TYPES) {
          const statusRaw = String(row[`${t.label} — Status`] || '').trim().toLowerCase()
          const urlRaw = String(row[`${t.label} — URL`] || '').trim()
          if (!statusRaw && !urlRaw) continue
          const isPodcast = t.key.startsWith('podcast')
          const tracker = svc.upload_tracker?.find(x => x.upload_type === t.key)
          const patch = { service_date_id: svc.id, upload_type: t.key }
          if (tracker) patch.id = tracker.id
          if (statusRaw === 'na' || statusRaw === 'n/a') {
            patch.is_na = true
            if (isPodcast) patch.podcast_published = false
            else patch.is_uploaded = false
          } else if (statusRaw === 'uploaded' || statusRaw === 'published') {
            patch.is_na = false
            if (isPodcast) patch.podcast_published = true
            else patch.is_uploaded = true
          }
          if (urlRaw) patch.url = urlRaw
          trackerPatches.push(patch)
        }
        if (trackerPatches.length > 0) {
          await supabase.from('upload_tracker').upsert(trackerPatches, { onConflict: 'service_date_id,upload_type' })
        }

        const recapPatch = {}
        const song = String(row['Song Title (as sung)'] || '').trim()
        const sermon = String(row['Sermon Title'] || '').trim()
        const sermonSummary = String(row['Sermon Podcast Summary'] ?? row['Podcast Summary'] ?? '').trim()
        const musicSummary = String(row['Music Podcast Summary'] || '').trim()
        if (song) recapPatch.special_music_title = song
        if (sermon) recapPatch.spark_title = sermon
        if (sermonSummary) recapPatch.podcast_summary = sermonSummary
        if (musicSummary) recapPatch.music_podcast_summary = musicSummary
        if (Object.keys(recapPatch).length > 0) {
          await supabase.from('service_dates').update(recapPatch).eq('id', svc.id)
        }

        if (trackerPatches.length > 0 || Object.keys(recapPatch).length > 0) updated++
        else noChanges.push(dateStr)
      }

      setImportResult({ updated, skipped, noChanges, total: rows.length })
      await supabase.from('import_log').insert([{
        file_name: file.name,
        run_by_email: userEmail,
        updated_count: updated,
        skipped_count: skipped.length,
        no_changes_count: noChanges.length,
        total_rows: rows.length,
      }])
      loadImportHistory()
      await loadData()
    } catch (err) {
      console.error(err)
      setImportResult({ error: true })
    }
    setImporting(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {['recent', 'all'].map(f => (
            <button key={f} className="btn" onClick={() => setFilter(f)}
              style={{ background: filter === f ? 'var(--burgundy)' : 'var(--gray-100)', color: filter === f ? 'white' : 'var(--gray-800)' }}>
              {f === 'recent' ? 'Recent (12)' : 'All'}
            </button>
          ))}
          <div style={{ width: '1px', height: '24px', background: 'var(--gray-100)', margin: '0 4px' }} />
          <button className="btn btn-secondary" onClick={downloadTemplate} disabled={services.length === 0}>
            ⬇ Download Template
          </button>
          <div style={{ width: '1px', height: '24px', background: 'var(--gray-100)', margin: '0 4px' }} />
          <button className="btn btn-secondary" onClick={handleExportReportCsv} disabled={services.length === 0}>
            ⬇ Report CSV
          </button>
          <button className="btn btn-secondary" onClick={handleExportReportExcel} disabled={services.length === 0}>
            📊 Report Excel
          </button>
          <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()} disabled={importing}>
            {importing ? 'Importing…' : '⬆ Import Spreadsheet'}
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleImportFile} />
          <button className="btn btn-secondary" onClick={() => setShowImportHistory(s => !s)}>
            🕓 Import History
          </button>
        </div>
      </div>

      {showImportHistory && (
        <div style={{ margin: '0 28px 16px' }} className="card">
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--burgundy)', marginBottom: '10px' }}>Recent Imports</div>
          {importHistory.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>No imports logged yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {importHistory.map(run => (
                <div key={run.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--gray-50)', borderRadius: '6px', fontSize: '12px' }}>
                  <div>
                    <span style={{ fontWeight: 600 }}>{new Date(run.run_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    {run.file_name && <span style={{ color: 'var(--gray-400)' }}> — {run.file_name}</span>}
                    {run.run_by_email && <span style={{ color: 'var(--gray-400)' }}> · {run.run_by_email}</span>}
                  </div>
                  <div style={{ color: 'var(--gray-600)' }}>
                    ✓ {run.updated_count} updated
                    {run.no_changes_count > 0 && <span style={{ color: 'var(--gray-400)' }}> · {run.no_changes_count} no changes</span>}
                    {run.skipped_count > 0 && <span style={{ color: 'var(--danger)' }}> · {run.skipped_count} skipped</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {importResult && (
        <div style={{ margin: '0 28px' }}>
          {importResult.error ? (
            <div className="alert alert-error">Something went wrong reading that file. Make sure it's the same format as the downloaded template.</div>
          ) : (
            <div className="alert alert-success" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span>✓ Updated {importResult.updated} of {importResult.total} row{importResult.total === 1 ? '' : 's'}.</span>
              {importResult.skipped.length > 0 && (
                <span style={{ color: 'var(--danger)' }}>
                  {importResult.skipped.length} date{importResult.skipped.length === 1 ? '' : 's'} didn't match an existing service and were skipped: {importResult.skipped.join(', ')}
                </span>
              )}
              {importResult.noChanges && importResult.noChanges.length > 0 && (
                <details style={{ color: 'var(--gray-600)' }}>
                  <summary style={{ cursor: 'pointer' }}>
                    {importResult.noChanges.length} date{importResult.noChanges.length === 1 ? '' : 's'} matched a service but had nothing filled in — nothing to update
                  </summary>
                  <div style={{ marginTop: '6px', fontSize: '12px' }}>{importResult.noChanges.join(', ')}</div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

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
                      <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                        {svc.season ? `${svc.season} · ` : ''}Sunday #{getSundayNumber(svc.service_date)}
                      </div>
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
                        const dotColor = tracker?.is_uploaded ? 'var(--success)' : tracker?.is_na ? '#A8A8A8' : 'var(--gray-200)'
                        return (
                          <div key={t.key} title={`${t.label}${tracker?.is_na ? ' — N/A' : ''}`} style={{ width: '10px', height: '10px', borderRadius: '50%', background: dotColor }} />
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
                          const isNA = tracker.is_na || false

                          return (
                            <div key={type.key} style={{ border: '1px solid var(--gray-100)', borderRadius: '8px', padding: '12px', background: isNA ? '#f4f4f4' : 'var(--gray-50)', opacity: isNA ? 0.85 : 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '13px', fontWeight: 600 }}>{type.icon} {type.label}</span>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                  {!isPodcast ? (
                                    <label className="checkbox-label" style={{ fontSize: '12px', opacity: isNA ? 0.5 : 1 }}>
                                      <input type="checkbox" checked={tracker.is_uploaded || false} disabled={isNA}
                                        onChange={() => toggleUpload(tracker.id, tracker.is_uploaded)}
                                        style={{ accentColor: 'var(--burgundy)' }} />
                                      Uploaded
                                    </label>
                                  ) : (
                                    <label className="checkbox-label" style={{ fontSize: '12px', opacity: isNA ? 0.5 : 1 }}>
                                      <input type="checkbox" checked={tracker.podcast_published || false} disabled={isNA}
                                        onChange={() => togglePodcast(tracker.id, tracker.podcast_published)}
                                        style={{ accentColor: 'var(--burgundy)' }} />
                                      Published
                                    </label>
                                  )}
                                  <label className="checkbox-label" style={{ fontSize: '12px' }} title="Nothing to upload this week">
                                    <input type="checkbox" checked={isNA}
                                      onChange={() => toggleNA(tracker.id, isNA, isPodcast)}
                                      style={{ accentColor: '#A8A8A8' }} />
                                    N/A
                                  </label>
                                </div>
                              </div>

                              {!isNA && (
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
                              )}
                              {isNA && (
                                <div style={{ fontSize: '12px', color: 'var(--gray-400)', fontStyle: 'italic' }}>Marked N/A — nothing to upload this week</div>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      {/* Post-Service Recap */}
                      <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--gray-100)' }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--burgundy)', marginBottom: '10px' }}>
                          📝 Post-Service Recap
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', alignItems: 'start' }}>

                          {/* Sermon */}
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-600)' }}>🎤 Sermon</span>
                              <ApprovalBadge status={svc.sermon_approval_status} />
                            </div>
                            <RecapField
                              label="Sermon Title"
                              placeholder="e.g. The Road Home"
                              value={svc.spark_title}
                              onSave={val => saveRecapField(svc.id, 'spark_title', val)}
                            />
                            <RecapField
                              label="Sermon Podcast Summary"
                              placeholder="Episode summary for the sermon podcast…"
                              value={svc.podcast_summary}
                              multiline
                              onSave={val => saveRecapField(svc.id, 'podcast_summary', val)}
                            />
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={sendingApproval === `${svc.id}-sermon` || svc.sermon_approval_status === 'approved'}
                              onClick={() => sendForApproval(svc, 'sermon')}
                              style={{ width: '100%' }}
                            >
                              {sendingApproval === `${svc.id}-sermon` ? 'Sending…'
                                : svc.sermon_approval_status === 'approved' ? '✓ Approved'
                                : svc.sermon_approval_status === 'pending' ? '↻ Resend for Approval'
                                : '✉️ Send for Approval'}
                            </button>
                            {svc.sermon_approval_status !== 'approved' && (
                              <button
                                onClick={() => selfApprove(svc, 'sermon')}
                                style={{ width: '100%', marginTop: '4px', background: 'none', border: 'none', color: 'var(--gray-400)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                              >
                                or approve it yourself (e.g. for backlog)
                              </button>
                            )}
                          </div>

                          {/* Special Music */}
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-600)' }}>🎵 Special Music</span>
                              <ApprovalBadge status={svc.music_approval_status} />
                            </div>
                            <RecapField
                              label="Song Title (as sung)"
                              placeholder="e.g. Great Is Thy Faithfulness"
                              value={svc.special_music_title}
                              onSave={val => saveRecapField(svc.id, 'special_music_title', val)}
                            />
                            <RecapField
                              label="Music Podcast Summary"
                              placeholder="Episode summary for the Set List podcast…"
                              value={svc.music_podcast_summary}
                              multiline
                              onSave={val => saveRecapField(svc.id, 'music_podcast_summary', val)}
                            />
                            <button
                              className="btn btn-secondary btn-sm"
                              disabled={sendingApproval === `${svc.id}-music` || svc.music_approval_status === 'approved'}
                              onClick={() => sendForApproval(svc, 'music')}
                              style={{ width: '100%' }}
                            >
                              {sendingApproval === `${svc.id}-music` ? 'Sending…'
                                : svc.music_approval_status === 'approved' ? '✓ Approved'
                                : svc.music_approval_status === 'pending' ? '↻ Resend for Approval'
                                : '✉️ Send for Approval'}
                            </button>
                            {svc.music_approval_status !== 'approved' && (
                              <button
                                onClick={() => selfApprove(svc, 'music')}
                                style={{ width: '100%', marginTop: '4px', background: 'none', border: 'none', color: 'var(--gray-400)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                              >
                                or approve it yourself (e.g. for backlog)
                              </button>
                            )}
                          </div>
                        </div>
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
