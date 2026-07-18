import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const BUCKET = 'hymn-files'

async function uploadToStorage(file) {
  const ext = file.name.split('.').pop()
  const safeName = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(safeName, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(safeName)
  return data.publicUrl
}

export default function HymnTracker() {
  const [hymns, setHymns] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterHymnal, setFilterHymnal] = useState('all')
  const [filterCreated, setFilterCreated] = useState('all')
  const [selectedHymn, setSelectedHymn] = useState(null)
  const [hymnHistory, setHymnHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [updatingId, setUpdatingId] = useState(null)
  const [toggleError, setToggleError] = useState(null)

  // Add Hymn form
  const [showAddHymn, setShowAddHymn] = useState(false)
  const [newHymnal, setNewHymnal] = useState('UMH')
  const [newNumber, setNewNumber] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [addingHymn, setAddingHymn] = useState(false)
  const [addHymnError, setAddHymnError] = useState(null)

  // Files section
  const [hymnFiles, setHymnFiles] = useState([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [uploadLabel, setUploadLabel] = useState('')
  const [uploadFile, setUploadFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [fileError, setFileError] = useState(null)

  useEffect(() => { loadHymns() }, [])

  async function loadHymns() {
    setLoading(true)
    const { data } = await supabase
      .from('hymns')
      .select('*')
      .order('number', { ascending: true })
    setHymns(data || [])
    setLoading(false)
  }

  async function loadHymnHistory(hymn) {
    setSelectedHymn(hymn)
    setToggleError(null)
    setFileError(null)
    setHistoryLoading(true)
    const { data } = await supabase
      .from('service_hymns')
      .select('*, service_dates(service_date, season, liturgical_color)')
      .eq('hymnal', hymn.hymnal)
      .eq('number', hymn.number)
      .order('created_at', { ascending: false })
    setHymnHistory(data || [])
    setHistoryLoading(false)
    loadHymnFiles(hymn)
  }

  async function loadHymnFiles(hymn) {
    setFilesLoading(true)
    const { data } = await supabase
      .from('hymn_files')
      .select('*')
      .eq('hymnal', hymn.hymnal)
      .eq('number', hymn.number)
      .order('uploaded_at', { ascending: false })
    setHymnFiles(data || [])
    setFilesLoading(false)
  }

  async function toggleCreated(hymn) {
    setUpdatingId(hymn.id)
    setToggleError(null)
    const { error } = await supabase
      .from('hymns')
      .update({ is_created: !hymn.is_created })
      .eq('id', hymn.id)
    if (error) {
      setToggleError(`Couldn't save: ${error.message}`)
    } else {
      setHymns(prev => prev.map(h => h.id === hymn.id ? { ...h, is_created: !h.is_created } : h))
      if (selectedHymn?.id === hymn.id) setSelectedHymn(h => ({ ...h, is_created: !h.is_created }))
    }
    setUpdatingId(null)
  }

  async function handleAddHymn(e) {
    e.preventDefault()
    setAddingHymn(true)
    setAddHymnError(null)
    try {
      const { data, error } = await supabase
        .from('hymns')
        .insert([{ hymnal: newHymnal, number: parseInt(newNumber), title: newTitle, is_created: false }])
        .select()
        .single()
      if (error) throw error
      setHymns(prev => [...prev, data].sort((a, b) => parseFloat(a.number) - parseFloat(b.number)))
      setNewHymnal('UMH'); setNewNumber(''); setNewTitle('')
      setShowAddHymn(false)
    } catch (err) {
      setAddHymnError(err.message)
    }
    setAddingHymn(false)
  }

  async function handleUploadFile(e) {
    e.preventDefault()
    if (!uploadFile || !selectedHymn) return
    setUploading(true)
    setFileError(null)
    try {
      const url = await uploadToStorage(uploadFile)
      const { error } = await supabase.from('hymn_files').insert([{
        hymnal: selectedHymn.hymnal,
        number: selectedHymn.number,
        label: uploadLabel || uploadFile.name,
        file_name: uploadFile.name,
        file_url: url,
      }])
      if (error) throw error
      setUploadLabel('')
      setUploadFile(null)
      loadHymnFiles(selectedHymn)
    } catch (err) {
      setFileError(err.message)
    }
    setUploading(false)
  }

  async function handleDeleteFile(id) {
    if (!confirm('Delete this file?')) return
    await supabase.from('hymn_files').delete().eq('id', id)
    loadHymnFiles(selectedHymn)
  }

  const formatDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const filtered = hymns.filter(h => {
    if (filterHymnal !== 'all' && h.hymnal !== filterHymnal) return false
    if (filterCreated === 'created' && !h.is_created) return false
    if (filterCreated === 'not_created' && h.is_created) return false
    if (search) {
      const s = search.toLowerCase()
      return h.title.toLowerCase().includes(s) || String(h.number).includes(s)
    }
    return true
  })

  const seasonColor = (color) => {
    const map = { 'Purple': '#6B2D8B', 'White': '#b8860b', 'Green': '#2d7a4f', 'Red': '#c0392b', 'Grey': '#888' }
    return map[color] || '#5c5850'
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* Left panel — hymn list */}
      <div style={{ width: '420px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--gray-100)', background: 'white' }}>

        {/* Header */}
        <div style={{ padding: '20px', borderBottom: '1px solid var(--gray-100)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', color: 'var(--burgundy)' }}>Hymn Tracker</h1>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowAddHymn(s => !s)}>
              {showAddHymn ? '✕' : '+ Add Hymn'}
            </button>
          </div>

          {showAddHymn && (
            <form onSubmit={handleAddHymn} style={{ background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: '8px', padding: '10px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <select value={newHymnal} onChange={e => setNewHymnal(e.target.value)} style={{ padding: '6px 8px', fontSize: '12px', width: '80px' }}>
                  <option value="UMH">UMH</option>
                  <option value="TFWS">TFWS</option>
                </select>
                <input type="number" value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder="Number" required style={{ padding: '6px 8px', fontSize: '12px', width: '80px' }} />
                <input type="text" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Title" required style={{ padding: '6px 8px', fontSize: '12px', flex: 1 }} />
              </div>
              {addHymnError && <div style={{ fontSize: '11px', color: 'var(--danger)', marginBottom: '6px' }}>{addHymnError}</div>}
              <button type="submit" className="btn btn-primary btn-sm" disabled={addingHymn} style={{ width: '100%' }}>
                {addingHymn ? 'Adding…' : 'Add Hymn'}
              </button>
            </form>
          )}

          <input
            type="text"
            placeholder="Search by number or title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ marginBottom: '8px' }}
          />
          <div style={{ display: 'flex', gap: '6px' }}>
            {['all', 'UMH', 'TFWS'].map(f => (
              <button key={f} onClick={() => setFilterHymnal(f)} className="btn btn-sm"
                style={{ background: filterHymnal === f ? 'var(--burgundy)' : 'var(--gray-100)', color: filterHymnal === f ? 'white' : 'var(--gray-800)', flex: 1 }}>
                {f === 'all' ? 'All' : f}
              </button>
            ))}
            <select value={filterCreated} onChange={e => setFilterCreated(e.target.value)} style={{ fontSize: '12px', padding: '4px 8px', flex: 1 }}>
              <option value="all">All</option>
              <option value="created">✅ Created</option>
              <option value="not_created">⬜ Not Created</option>
            </select>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '8px' }}>
            {filtered.length} hymns · {hymns.filter(h => h.is_created).length} created
          </div>
          {toggleError && <div style={{ fontSize: '11px', color: 'var(--danger)', marginTop: '6px' }}>{toggleError}</div>}
        </div>

        {/* Hymn list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? <div className="spinner" /> : filtered.map(hymn => (
            <div
              key={hymn.id}
              onClick={() => loadHymnHistory(hymn)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px 16px',
                cursor: 'pointer',
                borderBottom: '1px solid var(--gray-100)',
                background: selectedHymn?.id === hymn.id ? 'var(--burgundy-light)' : 'white',
                transition: 'background 0.1s',
              }}
            >
              {/* Created checkbox */}
              <input
                type="checkbox"
                checked={hymn.is_created}
                onChange={e => { e.stopPropagation(); toggleCreated(hymn) }}
                disabled={updatingId === hymn.id}
                style={{ width: '15px', height: '15px', flexShrink: 0, cursor: 'pointer', accentColor: 'var(--burgundy)' }}
              />

              {/* Hymnal badge */}
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', flexShrink: 0,
                background: hymn.hymnal === 'UMH' ? 'var(--burgundy-light)' : '#e3f2fd',
                color: hymn.hymnal === 'UMH' ? 'var(--burgundy)' : '#1565c0',
              }}>
                {hymn.hymnal}
              </span>

              {/* Number */}
              <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--gray-600)', minWidth: '36px', flexShrink: 0 }}>
                {hymn.number}
              </span>

              {/* Title */}
              <span style={{ fontSize: '13px', color: 'var(--gray-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {hymn.title}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — hymn detail */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--gray-50)' }}>
        {!selectedHymn ? (
          <div className="empty-state" style={{ marginTop: '80px' }}>
            <div className="icon">🎵</div>
            <p>Select a hymn to see its history and files</p>
          </div>
        ) : (
          <div style={{ padding: '24px' }}>

            {/* Hymn header */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{
                      fontSize: '12px', fontWeight: 700, padding: '3px 8px', borderRadius: '4px',
                      background: selectedHymn.hymnal === 'UMH' ? 'var(--burgundy-light)' : '#e3f2fd',
                      color: selectedHymn.hymnal === 'UMH' ? 'var(--burgundy)' : '#1565c0',
                    }}>
                      {selectedHymn.hymnal} #{selectedHymn.number}
                    </span>
                    {hymnHistory.length > 0 && (
                      <span style={{ fontSize: '12px', color: 'var(--gray-400)' }}>
                        Last played: {formatDate(hymnHistory[0]?.service_dates?.service_date)}
                      </span>
                    )}
                  </div>
                  <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', color: 'var(--burgundy)' }}>
                    {selectedHymn.title}
                  </h2>
                </div>
                <label className="checkbox-label" style={{ flexShrink: 0 }}>
                  <input
                    type="checkbox"
                    checked={selectedHymn.is_created}
                    onChange={() => toggleCreated(selectedHymn)}
                    style={{ accentColor: 'var(--burgundy)' }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Created</span>
                </label>
              </div>
              {toggleError && <div style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '8px' }}>{toggleError}</div>}

              <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                <div style={{ textAlign: 'center', padding: '12px 20px', background: 'var(--gray-50)', borderRadius: '8px', flex: 1 }}>
                  <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--burgundy)' }}>{hymnHistory.length}</div>
                  <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>Times played</div>
                </div>
                <div style={{ textAlign: 'center', padding: '12px 20px', background: 'var(--gray-50)', borderRadius: '8px', flex: 1 }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--burgundy)' }}>
                    {hymnHistory.length > 0 ? formatDate(hymnHistory[0]?.service_dates?.service_date) : '—'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>Last played</div>
                </div>
                <div style={{ textAlign: 'center', padding: '12px 20px', background: 'var(--gray-50)', borderRadius: '8px', flex: 1 }}>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--burgundy)' }}>
                    {hymnHistory.length > 0 ? (() => {
                      const last = new Date(hymnHistory[0]?.service_dates?.service_date + 'T12:00:00')
                      const days = Math.floor((new Date() - last) / (1000 * 60 * 60 * 24))
                      return days < 30 ? `${days}d ago` : `${Math.floor(days/30)}mo ago`
                    })() : '—'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>Days since played</div>
                </div>
              </div>
            </div>

            {/* Files / versions — backup library */}
            <div className="card" style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '14px', color: 'var(--gray-800)' }}>
                📁 Files & Versions ({hymnFiles.length})
              </h3>

              <form onSubmit={handleUploadFile} style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <input
                  type="text"
                  value={uploadLabel}
                  onChange={e => setUploadLabel(e.target.value)}
                  placeholder="Label (e.g. Piano version, Key of G)"
                  style={{ flex: 1, minWidth: '180px', padding: '6px 8px', fontSize: '13px' }}
                />
                <input
                  type="file"
                  onChange={e => setUploadFile(e.target.files?.[0] || null)}
                  style={{ fontSize: '12px' }}
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!uploadFile || uploading}>
                  {uploading ? 'Uploading…' : '+ Add File'}
                </button>
              </form>
              {fileError && <div style={{ fontSize: '12px', color: 'var(--danger)', marginBottom: '10px' }}>{fileError}</div>}

              {filesLoading ? <div className="spinner" /> : hymnFiles.length === 0 ? (
                <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>No files uploaded yet for this hymn.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {hymnFiles.map(f => (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: 'var(--gray-50)', borderRadius: '6px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--gray-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label}</div>
                        <div style={{ fontSize: '11px', color: 'var(--gray-400)' }}>{f.file_name}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0 }}>
                        <a href={f.file_url} target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--burgundy)', fontWeight: 600 }}>⬇ Download</a>
                        <button onClick={() => handleDeleteFile(f.id)} style={{ fontSize: '12px', color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Play history */}
            <div className="card">
              <h3 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '14px', color: 'var(--gray-800)' }}>
                Play History
              </h3>

              {historyLoading ? <div className="spinner" /> : hymnHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--gray-400)', fontSize: '14px' }}>
                  No play history yet
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Season</th>
                      <th>Position</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hymnHistory.map((h, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{formatDate(h.service_dates?.service_date)}</td>
                        <td>
                          {h.service_dates?.season && (
                            <span style={{ fontSize: '12px', color: seasonColor(h.service_dates?.liturgical_color), fontWeight: 600 }}>
                              {h.service_dates.season}
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: '13px', color: 'var(--gray-400)' }}>Hymn {h.sort_order}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
