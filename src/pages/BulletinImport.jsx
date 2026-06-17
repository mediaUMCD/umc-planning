import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

// ── EXTRACTION LOGIC ──
const PAGE_REFS = new Set([7, 8, 9, 10, 11, 12, 13, 14, 895, 830])
const LITURGY_SKIP = ["lord's prayer", "lord\u2019s prayer", 'apostle', 'great thanksgiving',
  'confession', 'pardon', 'doxology', 'invitation', 'offering', 'creed', 'pg.', 'mpg.']
const STORYTELLERS = ['Chrissy', 'Cassi', 'Sue', 'Cyndi', 'Betsy', 'Pastor Zach', 'Kids']

const BOOK_NAMES = `(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|(?:1|2)\\s*Samuel|(?:1|2)\\s*Kings|(?:1|2)\\s*Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|(?:1|2)\\s*Corinthians|Galatians|Ephesians|Philippians|Colossians|(?:1|2)\\s*Thessalonians|(?:1|2)\\s*Timothy|Titus|Philemon|Hebrews|James|(?:1|2|3)\\s*(?:Peter|John)|Jude|Revelation)`

const SEASON_PAT = new RegExp(
  `(\\d+(?:st|nd|rd|th)\\s+Sunday\\s+(?:after|of)\\s+\\w+|` +
  `(?:First|Second|Third|Fourth)\\s+Sunday\\s+(?:after|of)\\s+\\w+|` +
  `Ash Wednesday|Maundy Thursday|Good Friday|Palm Sunday|Passion Sunday|` +
  `Transfiguration Sunday|Trinity Sunday|All Saints Day|Christ the King Sunday|` +
  `Easter Sunday|Christmas(?:\\s+Day)?|Epiphany|Pentecost(?:\\s+Sunday)?|` +
  `Baptism of the Lord|Rally Day)`,
  'i'
)

async function extractFromPDF(file) {
  // Use PDF.js via CDN to read PDF text
  const arrayBuffer = await file.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  // Load PDF.js
  if (!window.pdfjsLib) {
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

  const pdf = await window.pdfjsLib.getDocument({ data: uint8Array }).promise
  const pagesText = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items.map(item => item.str).join(' ')
    pagesText.push(text)
  }

  const fullText = pagesText.join('\n')
  const page1 = pagesText[0] || ''
  const lines1 = page1.split(/\s{2,}|\n/).map(l => l.trim()).filter(Boolean)
  const linesAll = fullText.split(/\s{2,}|\n/).map(l => l.trim()).filter(Boolean)

  const result = {
    service_date: null, season: null, spark_title: null,
    spark_preacher: 'Pastor Zach', kids_story_teller: null,
    hymns: [], scriptures: [], is_communion: false,
  }

  // DATE
  for (const line of linesAll) {
    const m = line.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}/i)
    if (m) {
      try {
        const d = new Date(m[0].replace(',', ''))
        if (!isNaN(d)) {
          result.service_date = d.toISOString().slice(0, 10)
          break
        }
      } catch (e) {}
    }
  }

  // SEASON - check first few lines of page 1 for Format 1
  for (const line of lines1.slice(0, 8)) {
    const lower = line.toLowerCase()
    if (['sunday after', 'sunday of', 'advent', 'lent', 'easter', 'pentecost', 'epiphany',
      'christmas', 'ash wed', 'maundy', 'good friday', 'transfig', 'trinity',
      'all saints', 'christ the king', 'baptism of'].some(kw => lower.includes(kw))) {
      if (!['welcome', 'united methodist', 'morning', 'www', '@', 'a.m.', 'p.m.', 'zoom'].some(s => lower.includes(s))) {
        result.season = line.trim()
        break
      }
    }
  }

  // Format 2: season anywhere with pattern
  if (!result.season) {
    for (const line of linesAll) {
      const m = SEASON_PAT.exec(line)
      if (m && !line.toLowerCase().includes('davis place') && !line.toLowerCase().includes('sunday school')) {
        result.season = m[1].trim()
        break
      }
    }
  }

  // HYMNS
  const seenNums = new Set()
  const hymnPat = /(UMH|TFWS)\s*#\s*(\d+)/gi
  for (const line of lines1) {
    const lower = line.toLowerCase()
    if (LITURGY_SKIP.some(s => lower.includes(s))) continue
    if (lower.includes('call to worship')) continue
    let m
    hymnPat.lastIndex = 0
    while ((m = hymnPat.exec(line)) !== null) {
      const number = parseInt(m[2])
      const hymnal = number >= 1000 ? 'TFWS' : 'UMH'
      if (PAGE_REFS.has(number) || number < 50) continue
      if (!seenNums.has(number)) {
        const prefix = line.slice(0, m.index).trim()
        let title = prefix.replace(/^(?:HYMN\s+(?:OF\s+\w+\s+)?|CLOSING\s+HYMN\s+|OPENING\s+HYMN\s+)/i, '').trim()
        title = title.replace(/^["\u201c\u201e]|["\u201d\u201f]$/g, '').trim()
        seenNums.add(number)
        result.hymns.push({ hymnal, number, title })
      }
    }
  }

  // SCRIPTURES
  const readingPat = new RegExp(
    `(?:FIRST|SECOND|THIRD|GOSPEL|EPISTLE|OLD\\s+TESTAMENT|NEW\\s+TESTAMENT|READING|LESSON)\\s+(?:READING\\s+)?(${BOOK_NAMES}\\s+\\d+:\\d+(?:-\\d+)?(?:,\\s*\\d+(?:-\\d+)?)*)`,
    'gi'
  )
  const psalmPat = /^PSALM\s+(Psalm\s+\d+(?::\d+(?:-\d+)?)?|\d+(?::\d+(?:-\d+)?)?)/i
  const pgReadingPat = new RegExp(
    `(?:FIRST|SECOND|THIRD|GOSPEL|READING|LESSON)\\s+(${BOOK_NAMES}\\s+\\d+:\\d+(?:-\\d+)?)`,
    'i'
  )

  const seenRefs = new Set()
  for (const line of lines1) {
    const lower = line.toLowerCase()
    if (lower.includes('mpg.')) continue

    let m = readingPat.exec(line)
    readingPat.lastIndex = 0
    if (m) {
      const ref = m[1].trim()
      if (!seenRefs.has(ref)) {
        const version = line.includes('NRSVue') ? 'NRSVue' : line.includes('NRSV') ? 'NRSV' : 'CEB'
        result.scriptures.push({ reference: ref, bible_version: version, is_call_and_response: false })
        seenRefs.add(ref)
      }
    }

    const m2 = psalmPat.exec(line)
    if (m2 && !lower.includes('mpg') && !lower.includes('umh')) {
      const raw = m2[1].trim()
      const ref = raw.toLowerCase().startsWith('psalm') ? raw : `Psalm ${raw}`
      if (!seenRefs.has(ref)) {
        result.scriptures.push({ reference: ref, bible_version: 'CEB', is_call_and_response: false })
        seenRefs.add(ref)
      }
    }

    if (lower.includes('pg.')) {
      const m3 = pgReadingPat.exec(line)
      if (m3) {
        const ref = m3[1].trim()
        if (!seenRefs.has(ref)) {
          result.scriptures.push({ reference: ref, bible_version: 'CEB', is_call_and_response: false })
          seenRefs.add(ref)
        }
      }
    }
  }

  // MESSAGE TITLE
  for (let i = 0; i < lines1.length; i++) {
    if (/^MESSAGE\b/i.test(lines1[i])) {
      const m = lines1[i].match(/[\u201c\u2018"](.+?)[\u201d\u2019"]/);
      if (m) { result.spark_title = m[1].trim(); break }
      if (i + 1 < lines1.length) {
        const m2 = lines1[i + 1].match(/[\u201c\u2018"](.+?)[\u201d\u2019"]/)
        if (m2) result.spark_title = m2[1].trim()
      }
      break
    }
  }

  // KIDS STORY TELLER
  for (const line of lines1) {
    if (/CHILDREN[\u2019']S\s+(?:MESSAGE|STORY)/i.test(line)) {
      for (const name of STORYTELLERS) {
        if (line.toLowerCase().includes(name.toLowerCase())) {
          result.kids_story_teller = name
          break
        }
      }
      break
    }
  }

  // COMMUNION
  const ftLower = fullText.toLowerCase()
  result.is_communion = ftLower.includes('great thanksgiving') && ftLower.includes('breaking the bread')

  return result
}

// ── COMPONENT ──
export default function BulletinImport() {
  const [files, setFiles] = useState([])
  const [results, setResults] = useState([])
  const [processing, setProcessing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = useCallback(async (newFiles) => {
    const pdfs = Array.from(newFiles).filter(f => f.name.endsWith('.pdf'))
    if (!pdfs.length) return
    setFiles(pdfs)
    setResults([])
    setProcessing(true)
    setSavedCount(0)

    const extracted = []
    for (const file of pdfs) {
      try {
        const data = await extractFromPDF(file)
        extracted.push({ file: file.name, data, status: 'ready', error: null })
      } catch (err) {
        extracted.push({ file: file.name, data: null, status: 'error', error: err.message })
      }
      setResults([...extracted])
    }
    setProcessing(false)
  }, [])

  const updateField = (idx, field, value) => {
    setResults(prev => prev.map((r, i) => i === idx ? { ...r, data: { ...r.data, [field]: value } } : r))
  }

  const updateHymn = (idx, hymIdx, field, value) => {
    setResults(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const hymns = r.data.hymns.map((h, hi) => hi === hymIdx ? { ...h, [field]: value } : h)
      return { ...r, data: { ...r.data, hymns } }
    }))
  }

  const removeResult = (idx) => {
    setResults(prev => prev.filter((_, i) => i !== idx))
  }

  const saveAll = async () => {
    setSaving(true)
    let count = 0
    for (const result of results) {
      if (result.status !== 'ready' || !result.data?.service_date) continue
      try {
        // Upsert service date
        const { data: existing } = await supabase
          .from('service_dates')
          .select('id')
          .eq('service_date', result.data.service_date)
          .single()

        let serviceId
        if (existing) {
          await supabase.from('service_dates').update({
            season: result.data.season,
            spark_title: result.data.spark_title,
            spark_preacher: result.data.spark_preacher,
            kids_story_teller: result.data.kids_story_teller,
            is_communion: result.data.is_communion,
          }).eq('id', existing.id)
          serviceId = existing.id
        } else {
          const { data: newSvc } = await supabase.from('service_dates').insert([{
            service_date: result.data.service_date,
            season: result.data.season,
            spark_title: result.data.spark_title,
            spark_preacher: result.data.spark_preacher,
            kids_story_teller: result.data.kids_story_teller,
            is_communion: result.data.is_communion,
          }]).select().single()
          serviceId = newSvc.id

          // Create upload tracker rows
          const uploadTypes = ['service', 'children', 'spark', 'music', 'special', 'podcast_spark', 'podcast_music']
          await supabase.from('upload_tracker').insert(
            uploadTypes.map(t => ({ service_date_id: serviceId, upload_type: t, is_uploaded: false, podcast_published: false }))
          )
        }

        // Delete existing hymns and re-insert
        await supabase.from('service_hymns').delete().eq('service_date_id', serviceId)
        const validHymns = result.data.hymns.filter(h => h.number)
        if (validHymns.length > 0) {
          await supabase.from('service_hymns').insert(
            validHymns.map((h, i) => ({ service_date_id: serviceId, hymnal: h.hymnal, number: parseInt(h.number), sort_order: i + 1 }))
          )
        }

        // Delete existing scriptures and re-insert
        await supabase.from('service_scriptures').delete().eq('service_date_id', serviceId)
        const validScriptures = result.data.scriptures.filter(s => s.reference)
        if (validScriptures.length > 0) {
          await supabase.from('service_scriptures').insert(
            validScriptures.map((s, i) => ({ service_date_id: serviceId, reference: s.reference, bible_version: s.bible_version, is_call_and_response: s.is_call_and_response, sort_order: i + 1 }))
          )
        }

        count++
        setResults(prev => prev.map((r, i) => results.indexOf(result) === i ? { ...r, status: 'saved' } : r))
      } catch (err) {
        setResults(prev => prev.map((r, i) => results.indexOf(result) === i ? { ...r, status: 'error', error: err.message } : r))
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
          <p style={{ fontSize: '13px', color: 'var(--gray-400)', marginTop: '2px' }}>
            Upload PDF bulletins to auto-extract service data
          </p>
        </div>
        {readyCount > 0 && (
          <button className="btn btn-primary btn-lg" onClick={saveAll} disabled={saving}>
            {saving ? 'Saving…' : `💾 Save ${readyCount} Service${readyCount !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      <div className="page-body">
        {savedCount > 0 && (
          <div className="alert alert-success" style={{ marginBottom: '16px' }}>
            ✓ {savedCount} service{savedCount !== 1 ? 's' : ''} saved successfully!
          </div>
        )}

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
          style={{
            border: `2px dashed ${dragOver ? 'var(--burgundy)' : 'var(--gray-200)'}`,
            borderRadius: '12px',
            padding: '40px',
            textAlign: 'center',
            background: dragOver ? 'var(--burgundy-light)' : 'white',
            marginBottom: '24px',
            transition: 'all 0.15s',
            cursor: 'pointer',
          }}
          onClick={() => document.getElementById('pdf-upload').click()}
        >
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>📄</div>
          <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--burgundy)', marginBottom: '6px' }}>
            Drop PDF bulletins here or click to browse
          </div>
          <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>
            Select multiple files at once — up to 52 PDFs
          </div>
          <input
            id="pdf-upload"
            type="file"
            accept=".pdf"
            multiple
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
        </div>

        {processing && (
          <div className="card" style={{ textAlign: 'center', padding: '32px' }}>
            <div className="spinner" style={{ marginBottom: '12px' }} />
            <div style={{ fontSize: '14px', color: 'var(--gray-600)' }}>
              Extracting data from PDFs… {results.length}/{files.length}
            </div>
          </div>
        )}

        {/* Results */}
        {results.map((result, idx) => (
          <div key={idx} className="card" style={{ marginBottom: '16px', border: result.status === 'saved' ? '2px solid var(--success)' : result.status === 'error' ? '2px solid var(--danger)' : '1px solid var(--gray-100)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>
                  {result.status === 'saved' ? '✅' : result.status === 'error' ? '❌' : '📄'}
                </span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '14px' }}>{result.file}</div>
                  {result.status === 'saved' && <div style={{ fontSize: '12px', color: 'var(--success)' }}>Saved!</div>}
                  {result.status === 'error' && <div style={{ fontSize: '12px', color: 'var(--danger)' }}>{result.error}</div>}
                </div>
              </div>
              {result.status !== 'saved' && (
                <button className="btn btn-secondary btn-sm" onClick={() => removeResult(idx)}>Remove</button>
              )}
            </div>

            {result.data && result.status !== 'error' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                {/* Left */}
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
                  <label className="checkbox-label" style={{ fontSize: '13px' }}>
                    <input type="checkbox" checked={result.data.is_communion} onChange={e => updateField(idx, 'is_communion', e.target.checked)} style={{ accentColor: 'var(--burgundy)' }} />
                    🥖 Communion Sunday
                  </label>
                </div>

                {/* Right */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label className="form-label">Hymns ({result.data.hymns.length})</label>
                    {result.data.hymns.length === 0 && <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>None found</div>}
                    {result.data.hymns.map((h, hi) => (
                      <div key={hi} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, background: h.hymnal === 'UMH' ? 'var(--burgundy-light)' : '#e3f2fd', color: h.hymnal === 'UMH' ? 'var(--burgundy)' : '#1565c0', padding: '2px 6px', borderRadius: '4px', flexShrink: 0 }}>{h.hymnal}</span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-600)', minWidth: '32px' }}>#{h.number}</span>
                        <input type="text" value={h.title} onChange={e => updateHymn(idx, hi, 'title', e.target.value)} style={{ padding: '4px 8px', fontSize: '12px', flex: 1 }} />
                      </div>
                    ))}
                  </div>

                  <div>
                    <label className="form-label">Scriptures ({result.data.scriptures.length})</label>
                    {result.data.scriptures.length === 0 && <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>None found</div>}
                    {result.data.scriptures.map((s, si) => (
                      <div key={si} style={{ display: 'flex', gap: '6px', marginBottom: '4px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: 'var(--gray-400)', minWidth: '50px' }}>{s.bible_version}</span>
                        <span style={{ fontSize: '13px', color: 'var(--gray-800)' }}>{s.reference}</span>
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
