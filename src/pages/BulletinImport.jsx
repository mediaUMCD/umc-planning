import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

const PAGE_REFS = new Set([7, 8, 9, 10, 11, 12, 13, 14, 94, 95, 881, 882, 883, 884, 885, 886, 887, 888, 889, 890, 891, 892, 893, 894, 895, 896, 897, 898, 899, 900])
const STORYTELLERS = ['Chrissy', 'Cassi', 'Sue', 'Cyndi', 'Betsy', 'Pastor Zach', 'Kids']
const BIBLE_VERSIONS = ['CEB', 'NRSVue', 'KJV', 'MSG', 'RSV', 'OTHER']

const BOOK_NAMES = `Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|(?:1|2)\\s*Samuel|(?:1|2)\\s*Kings|(?:1|2)\\s*Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|(?:1|2)\\s*Corinthians|Galatians|Ephesians|Philippians|Colossians|(?:1|2)\\s*Thessalonians|(?:1|2)\\s*Timothy|Titus|Philemon|Hebrews|James|(?:1|2|3)\\s*(?:Peter|John)|Jude|Revelation`

async function loadPDFJS() {
  if (window.pdfjsLib) return
  await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    script.onload = resolve
    script.onerror = reject
    document.head.appendChild(script)
  })
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
}

async function getPDFText(file) {
  await loadPDFJS()
  const buffer = await file.arrayBuffer()
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise
  const pages = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const pageWidth = viewport.width
    const midpoint = pageWidth / 2
    const content = await page.getTextContent()
    const items = content.items

    // Detect if page has 2 columns by checking x-distribution
    const leftItems = items.filter(item => item.transform[4] < midpoint)
    const rightItems = items.filter(item => item.transform[4] >= midpoint)
    const hasColumns = leftItems.length > 10 && rightItems.length > 10

    let lines = []
    if (hasColumns) {
      // Process left column first, then right column
      const colLines = (colItems) => {
        const lineMap = {}
        for (const item of colItems) {
          const y = Math.round(item.transform[5])
          if (!lineMap[y]) lineMap[y] = []
          lineMap[y].push(item.str)
        }
        return Object.keys(lineMap)
          .sort((a, b) => b - a) // descending y = top to bottom
          .map(y => lineMap[y].join(' ').trim())
          .filter(l => l.length > 0)
      }
      lines = [...colLines(leftItems), ...colLines(rightItems)]
    } else {
      // Single column — original approach
      const lineMap = {}
      for (const item of items) {
        const y = Math.round(item.transform[5])
        if (!lineMap[y]) lineMap[y] = []
        lineMap[y].push(item.str)
      }
      lines = Object.keys(lineMap)
        .sort((a, b) => b - a)
        .map(y => lineMap[y].join(' ').trim())
        .filter(l => l.length > 0)
    }
    pages.push(lines)
  }
  return pages
}

function extractData(pages) {
  const page1Lines = pages[0] || []
  const allLines = pages.flat()
  const fullText = allLines.join('\n')

  const result = {
    service_date: null, season: null, spark_title: null,
    spark_preacher: 'Pastor Zach', kids_story_teller: null, liturgist: null,
    hymns: [], scriptures: [], is_communion: false,
  }

  // ── DATE ──
  for (const line of allLines) {
    const m = line.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}/i)
    if (m) {
      try {
        const d = new Date(m[0].replace(',', ''))
        if (!isNaN(d)) { result.service_date = d.toISOString().slice(0, 10); break }
      } catch (e) {}
    }
  }

  // ── SEASON ──
  // Format 1: line 2 of page 1 (e.g. "4th SUNDAY AFTER PENTECOST")
  // Format 2: appears in page 2 near date
  const seasonKeywords = ['sunday after', 'sunday of', 'advent', 'lent', 'easter', 'pentecost',
    'epiphany', 'christmas', 'ash wed', 'maundy', 'good friday', 'transfig', 'trinity',
    'all saints', 'christ the king', 'baptism of', 'rally day']

  for (const line of page1Lines.slice(0, 6)) {
    const lower = line.toLowerCase()
    if (seasonKeywords.some(kw => lower.includes(kw))) {
      if (!['welcome', 'united methodist', 'morning', 'www', '@', 'a.m.', 'p.m.', 'zoom', 'davis'].some(s => lower.includes(s))) {
        // Normalize caps — title case
        result.season = line.trim()
        break
      }
    }
  }

  if (!result.season) {
    // Format 2 — search all lines
    const seasonPat = /(\d+(?:st|nd|rd|th)\s+Sunday\s+(?:after|of)\s+\w+|(?:First|Second|Third|Fourth)\s+Sunday\s+(?:after|of)\s+\w+|Children(?:'s)?\s+Sunday[^\n,]*|Ash Wednesday|Maundy Thursday|Good Friday|Palm Sunday|Transfiguration Sunday|Trinity Sunday|All Saints Day|Christ the King Sunday|Easter Sunday|Pentecost(?:\s+Sunday)?|Baptism of the Lord|Rally Day)/i
    for (const line of allLines) {
      const m = seasonPat.exec(line)
      if (m && !line.toLowerCase().includes('davis place') && !line.toLowerCase().includes('sunday school')) {
        result.season = m[1].trim()
        break
      }
    }
  }

  // ── HYMNS ── Process page 1 line by line in order (top to bottom)
  const seenNums = new Set()
  const hymnLinePat = new RegExp(`(UMH|TFWS)\\s*#?\\s*(\\d+)`, 'gi')
  const skipKeywords = ["lord's prayer", "lord\u2019s prayer", 'apostle', 'great thanksgiving',
    'confession', 'pardon', 'doxology', 'invitation', 'creed', 'call to worship',
    'response to', 'offertory', 'joys and concerns', 'pastoral prayer']

  for (const line of page1Lines) {
    const lower = line.toLowerCase()
    if (skipKeywords.some(s => lower.includes(s))) continue

    hymnLinePat.lastIndex = 0
    let m
    while ((m = hymnLinePat.exec(line)) !== null) {
      const number = parseInt(m[2])
      if (PAGE_REFS.has(number) || number < 50) continue
      if (seenNums.has(number)) continue

      const prefix = line.slice(0, m.index).trim()
      let title = prefix
        .replace(/^(?:HYMN\s+(?:OF\s+\w+\s+)?|OPENING\s+HYMN\s+|CLOSING\s+HYMN\s+)/i, '')
        .replace(/^["\u201c\u201e]|["\u201d\u201f]$/g, '')
        .trim()

      seenNums.add(number)
      // Push in bulletin order — page1Lines is already sorted top-to-bottom
      result.hymns.push({ hymnal: m[1].toUpperCase(), number: String(number), title, is_closing: false })
    }
  }

  // ── SCRIPTURES ──
const seenRefs = new Set()
const bookPat = new RegExp(
  `(${BOOK_NAMES})\\s+(\\d+:\\d+[\\d\\s:;,\\-]*)`,
  'gi'
)
const searchLines = [...page1Lines]
for (let i = 0; i < page1Lines.length - 1; i++) {
  searchLines.push(page1Lines[i] + ' ' + page1Lines[i + 1])
}
for (const line of searchLines) {
  const lower = line.toLowerCase()
  const hasKeyword = ['scripture', 'gospel', 'reading', 'lesson', 'epistle', 'psalm'].some(k => lower.includes(k))
  if (!hasKeyword) continue
  if (/^(APOSTLES?|CREED|LORD|DOXOLOGY|OFFERING|PRAYER|JOYS|CONCERNS|PASTORAL|WEEKLY|ANNOUNCE)/i.test(line.trim())) continue
  bookPat.lastIndex = 0
  let m
  while ((m = bookPat.exec(line)) !== null) {
    let verses = m[2].trim()
    verses = verses.replace(/\s+(?:p\.|mpg\.|pg\.)\s*[\d,\-\s]+.*$/, '').trim()
    verses = verses.replace(/[;,\s]+$/, '').trim()
    const ref = `${m[1]} ${verses}`.trim()
    if (!seenRefs.has(ref) && ref.length > 3 && /\d/.test(ref)) {
      const version = line.includes('NRSVue') ? 'NRSVue' : line.includes('NRSV') ? 'NRSV' : 'CEB'
      result.scriptures.push({ reference: ref, bible_version: version, is_call_and_response: false, page_reference: '', is_gospel: false })
      seenRefs.add(ref)
    }
  }
  const psalmM = /^PSALM\s+((?:Psalm\s+)?\d+(?::\d+(?:-\d+)?)?)/i.exec(line)
  if (psalmM && !lower.includes('umh') && !lower.includes('mpg')) {
    const raw = psalmM[1].trim()
    const ref = raw.toLowerCase().startsWith('psalm') ? raw : `Psalm ${raw}`
    if (!seenRefs.has(ref)) {
      result.scriptures.push({ reference: ref, bible_version: 'CEB', is_call_and_response: false, page_reference: '', is_gospel: false })
      seenRefs.add(ref)
    }
  }
}

  // ── MESSAGE TITLE ──
  for (const line of page1Lines) {
    if (/^MESSAGE\b/i.test(line)) {
      // Check for quoted title
      const mq = line.match(/[\u201c\u2018"](.+?)[\u201d\u2019"]/)
      if (mq) { result.spark_title = mq[1].trim(); break }
      // Unquoted title: "MESSAGE What Troubles You, Hagar? Pastor Zach"
      const mu = line.match(/^MESSAGE\s+(.+?)(?:\s+Pastor\s+Zach)?$/i)
      if (mu) {
        const title = mu[1].trim()
        if (title && !['Pastor', 'A SERVICE', 'RESPONSE'].some(s => title.startsWith(s))) {
          result.spark_title = title
        }
      }
      break
    }
  }

  // ── KIDS STORY TELLER ──
  for (const line of page1Lines) {
    if (/CHILDREN[\u2019'.]*S\s+(?:MESSAGE|STORY)/i.test(line)) {
      for (const name of STORYTELLERS) {
        if (line.toLowerCase().includes(name.toLowerCase())) {
          result.kids_story_teller = name
          break
        }
      }
      break
    }
  }

  // ── LITURGIST ──
  for (const line of allLines) {
    const m = line.match(/Today[\u2019']?s\s+Liturgist\s*[–-]\s*(.+)/i)
    if (m) { result.liturgist = m[1].trim(); break }
  }

  // ── COMMUNION ──
  const ftLower = fullText.toLowerCase()
  result.is_communion = ftLower.includes('great thanksgiving') && ftLower.includes('breaking the bread')

  return result
}

export default function BulletinImport() {
  const [files, setFiles] = useState([])
  const [results, setResults] = useState([])
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = useCallback(async (newFiles) => {
    const pdfs = Array.from(newFiles).filter(f => f.name.toLowerCase().endsWith('.pdf'))
    if (!pdfs.length) return
    setFiles(pdfs); setResults([]); setProcessing(true); setSavedCount(0)

    const extracted = []
    for (const file of pdfs) {
      try {
        const pages = await getPDFText(file)
        const data = extractData(pages)
        extracted.push({ file: file.name, data, status: 'ready', error: null })
      } catch (err) {
        extracted.push({ file: file.name, data: null, status: 'error', error: err.message })
      }
      setResults([...extracted])
    }
    setProcessing(false)
  }, [])

  const updateField = (idx, field, value) =>
    setResults(prev => prev.map((r, i) => i === idx ? { ...r, data: { ...r.data, [field]: value } } : r))

  const updateHymn = (idx, hi, field, value) =>
    setResults(prev => prev.map((r, i) => {
      if (i !== idx) return r
      return { ...r, data: { ...r.data, hymns: r.data.hymns.map((h, j) => j === hi ? { ...h, [field]: value } : h) } }
    }))

  const addHymn = (idx) =>
    setResults(prev => prev.map((r, i) => {
      if (i !== idx) return r
      return { ...r, data: { ...r.data, hymns: [...r.data.hymns, { hymnal: 'UMH', number: '', title: '', is_closing: false }] } }
    }))

  const removeHymn = (idx, hi) =>
    setResults(prev => prev.map((r, i) => {
      if (i !== idx) return r
      return { ...r, data: { ...r.data, hymns: r.data.hymns.filter((_, j) => j !== hi) } }
    }))

  const updateScripture = (idx, si, field, value) =>
    setResults(prev => prev.map((r, i) => {
      if (i !== idx) return r
      return { ...r, data: { ...r.data, scriptures: r.data.scriptures.map((s, j) => j === si ? { ...s, [field]: value } : s) } }
    }))

  const addScripture = (idx) =>
    setResults(prev => prev.map((r, i) => {
      if (i !== idx) return r
      return { ...r, data: { ...r.data, scriptures: [...r.data.scriptures, { reference: '', bible_version: 'CEB', is_call_and_response: false, page_reference: '', is_gospel: false }] } }
    }))

  const removeScripture = (idx, si) =>
    setResults(prev => prev.map((r, i) => {
      if (i !== idx) return r
      return { ...r, data: { ...r.data, scriptures: r.data.scriptures.filter((_, j) => j !== si) } }
    }))

  const removeResult = (idx) => setResults(prev => prev.filter((_, i) => i !== idx))

  const saveAll = async () => {
    setSaving(true)
    let count = 0
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status !== 'ready' || !result.data?.service_date) continue
      try {
        const { data: existing } = await supabase.from('service_dates').select('id, season, liturgical_color').eq('service_date', result.data.service_date).single()
        let serviceId

        const payload = {
          spark_title: result.data.spark_title || null,
          spark_preacher: result.data.spark_preacher,
          kids_story_teller: result.data.kids_story_teller || null,
          liturgist: result.data.liturgist || null,
          is_communion: result.data.is_communion,
          season: result.data.season || null,
        }

        if (existing) {
         // Don't overwrite existing season if already set
          if (existing.season) delete payload.season
          if (existing.liturgical_color) delete payload.liturgical_color
          const { error: updateErr } = await supabase.from('service_dates').update(payload).eq('id', existing.id)
          if (updateErr) throw updateErr
          serviceId = existing.id
        } else {
          const { data: newSvc, error } = await supabase.from('service_dates')
            .insert([{ ...payload, service_date: result.data.service_date }]).select().single()
          if (error) throw error
          serviceId = newSvc.id
          const { error: trackerErr } = await supabase.from('upload_tracker').insert(
           ['service','children','spark','music','special','podcast_spark','podcast_music']
            .map(t => ({ service_date_id: serviceId, upload_type: t, is_uploaded: false, podcast_published: false }))
          )
          if (trackerErr) throw trackerErr
        }

        // Hymns
        await supabase.from('service_hymns').delete().eq('service_date_id', serviceId)
        const validHymns = result.data.hymns.filter(h => h.number && !PAGE_REFS.has(parseInt(h.number)))
        if (validHymns.length > 0) {
          const { error: hymnErr } = await supabase.from('service_hymns').insert(
           validHymns.map((h, j) => ({ service_date_id: serviceId, hymnal: h.hymnal, number: parseInt(h.number), sort_order: j + 1, is_closing: h.is_closing || false }))
          )
          if (hymnErr) throw new Error(`Hymns didn't save: ${hymnErr.message}`)
        }

        // Scriptures
        await supabase.from('service_scriptures').delete().eq('service_date_id', serviceId)
        const validScriptures = result.data.scriptures.filter(s => s.reference)
        if (validScriptures.length > 0) {
        const { error: scriptErr } = await supabase.from('service_scriptures').insert(
          validScriptures.map((s, j) => ({
            service_date_id: serviceId, reference: s.reference, bible_version: s.bible_version,
            is_call_and_response: s.is_call_and_response, sort_order: j + 1,
            page_reference: s.page_reference || null, is_gospel: s.is_gospel || false,
          }))
        )
        if (scriptErr) throw new Error(`Scriptures didn't save: ${scriptErr.message}`)
        }

        count++
        setResults(prev => prev.map((r, ri) => ri === i ? { ...r, status: 'saved' } : r))
      } catch (err) {
        setResults(prev => prev.map((r, ri) => ri === i ? { ...r, status: 'error', error: err.message } : r))
      }
    }
    setSavedCount(count)
    setSaving(false)
  }

  const readyCount = results.filter(r => r.status === 'ready' && r.data?.service_date).length

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bulletin Import</h1>
          <p style={{ fontSize: '13px', color: 'var(--gray-400)', marginTop: '2px' }}>Upload PDF bulletins to auto-extract service data</p>
        </div>
        {readyCount > 0 && (
          <button className="btn btn-primary btn-lg" onClick={saveAll} disabled={saving}>
            {saving ? 'Saving…' : `💾 Save ${readyCount} Service${readyCount !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      <div className="page-body">
        {savedCount > 0 && <div className="alert alert-success" style={{ marginBottom: '16px' }}>✓ {savedCount} service{savedCount !== 1 ? 's' : ''} saved!</div>}

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
          onClick={() => document.getElementById('pdf-upload').click()}
          style={{ border: `2px dashed ${dragOver ? 'var(--burgundy)' : 'var(--gray-200)'}`, borderRadius: '12px', padding: '40px', textAlign: 'center', background: dragOver ? 'var(--burgundy-light)' : 'white', marginBottom: '24px', transition: 'all 0.15s', cursor: 'pointer' }}
        >
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>📄</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--burgundy)', marginBottom: '6px' }}>Drop PDF bulletins here or click to browse</div>
          <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>Select multiple files at once — up to 52 PDFs</div>
          <input id="pdf-upload" type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
        </div>

        {processing && (
          <div className="card" style={{ textAlign: 'center', padding: '32px' }}>
            <div className="spinner" style={{ marginBottom: '12px' }} />
            <div style={{ fontSize: '14px', color: 'var(--gray-600)' }}>Extracting… {results.length}/{files.length}</div>
          </div>
        )}

        {results.map((result, idx) => (
          <div key={idx} className="card" style={{ marginBottom: '16px', border: result.status === 'saved' ? '2px solid var(--success)' : result.status === 'error' ? '2px solid var(--danger)' : '1px solid var(--gray-100)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>{result.status === 'saved' ? '✅' : result.status === 'error' ? '❌' : '📄'}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px' }}>{result.file}</div>
                  {result.status === 'saved' && <div style={{ fontSize: '12px', color: 'var(--success)' }}>Saved!</div>}
                  {result.status === 'error' && <div style={{ fontSize: '12px', color: 'var(--danger)' }}>{result.error}</div>}
                </div>
              </div>
              {result.status !== 'saved' && <button className="btn btn-secondary btn-sm" onClick={() => removeResult(idx)}>Remove</button>}
            </div>

            {result.data && result.status !== 'error' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Service Date</label>
                    <input type="date" value={result.data.service_date || ''} onChange={e => updateField(idx, 'service_date', e.target.value)} style={{ padding: '6px 10px', fontSize: '13px' }} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Season</label>
                    <input type="text" value={result.data.season || ''} onChange={e => updateField(idx, 'season', e.target.value)} style={{ padding: '6px 10px', fontSize: '13px' }} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Spark Title</label>
                    <input type="text" value={result.data.spark_title || ''} onChange={e => updateField(idx, 'spark_title', e.target.value)} placeholder="(not found)" style={{ padding: '6px 10px', fontSize: '13px' }} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Kids Story Teller</label>
                    <input type="text" value={result.data.kids_story_teller || ''} onChange={e => updateField(idx, 'kids_story_teller', e.target.value)} style={{ padding: '6px 10px', fontSize: '13px' }} />
                  </div>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Liturgist</label>
                    <input type="text" value={result.data.liturgist || ''} onChange={e => updateField(idx, 'liturgist', e.target.value)} style={{ padding: '6px 10px', fontSize: '13px' }} />
                  </div>
                  <label className="checkbox-label" style={{ fontSize: '13px' }}>
                    <input type="checkbox" checked={result.data.is_communion} onChange={e => updateField(idx, 'is_communion', e.target.checked)} style={{ accentColor: 'var(--burgundy)' }} />
                    🥖 Communion Sunday
                  </label>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label className="form-label" style={{ margin: 0 }}>Hymns ({result.data.hymns.length})</label>
                      <button className="btn btn-secondary btn-sm" onClick={() => addHymn(idx)}>+ Add Hymn</button>
                    </div>
                    {result.data.hymns.length === 0 && <div style={{ fontSize: '13px', color: 'var(--gray-400)', marginBottom: '6px' }}>None found — add manually if needed</div>}
                    {result.data.hymns.map((h, hi) => (
                      <div key={hi} style={{ border: '1px solid var(--gray-100)', borderRadius: '6px', padding: '8px', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                          <select value={h.hymnal} onChange={e => updateHymn(idx, hi, 'hymnal', e.target.value)} style={{ padding: '4px 6px', fontSize: '12px', width: '72px', flexShrink: 0 }}>
                            <option value="UMH">UMH</option>
                            <option value="TFWS">TFWS</option>
                          </select>
                          <input type="text" value={h.number} onChange={e => updateHymn(idx, hi, 'number', e.target.value)} placeholder="###" style={{ padding: '4px 6px', fontSize: '12px', width: '60px', flexShrink: 0 }} />
                          <input type="text" value={h.title} onChange={e => updateHymn(idx, hi, 'title', e.target.value)} placeholder="Title" style={{ padding: '4px 8px', fontSize: '12px', flex: 1 }} />
                          <button onClick={() => removeHymn(idx, hi)} style={{ fontSize: '11px', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                        </div>
                        <label className="checkbox-label" style={{ fontSize: '11px' }}>
                          <input type="checkbox" checked={h.is_closing || false} onChange={e => updateHymn(idx, hi, 'is_closing', e.target.checked)} />
                          Closing hymn
                        </label>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <label className="form-label" style={{ margin: 0 }}>Scriptures ({result.data.scriptures.length})</label>
                      <button className="btn btn-secondary btn-sm" onClick={() => addScripture(idx)}>+ Add</button>
                    </div>
                    {result.data.scriptures.length === 0 && <div style={{ fontSize: '13px', color: 'var(--gray-400)', marginBottom: '6px' }}>None found — add manually if needed</div>}
                    {result.data.scriptures.map((s, si) => (
                      <div key={si} style={{ border: '1px solid var(--gray-100)', borderRadius: '6px', padding: '8px', marginBottom: '6px' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                          <input type="text" value={s.reference} onChange={e => updateScripture(idx, si, 'reference', e.target.value)} placeholder="e.g. John 3:16" style={{ padding: '4px 8px', fontSize: '12px', flex: 1 }} />
                          <select value={s.bible_version} onChange={e => updateScripture(idx, si, 'bible_version', e.target.value)} style={{ padding: '4px 6px', fontSize: '12px', width: '80px', flexShrink: 0 }}>
                            {BIBLE_VERSIONS.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                          <input type="text" value={s.page_reference || ''} onChange={e => updateScripture(idx, si, 'page_reference', e.target.value)} placeholder="Page(s)" style={{ padding: '4px 6px', fontSize: '12px', width: '70px', flexShrink: 0 }} />
                          <button onClick={() => removeScripture(idx, si)} style={{ fontSize: '11px', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', gap: '12px' }}>
                          <label className="checkbox-label" style={{ fontSize: '11px' }}>
                            <input type="checkbox" checked={s.is_call_and_response || false} onChange={e => updateScripture(idx, si, 'is_call_and_response', e.target.checked)} />
                            Call & Response
                          </label>
                          <label className="checkbox-label" style={{ fontSize: '11px' }}>
                            <input type="checkbox" checked={s.is_gospel || false} onChange={e => updateScripture(idx, si, 'is_gospel', e.target.checked)} />
                            Gospel Lesson
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
