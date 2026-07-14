import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const BUCKET = 'event-photos'

function fmtDate(d) {
  return d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
}

async function uploadToStorage(file) {
  const ext = file.name.split('.').pop()
  const fileName = `${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(fileName, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
  return data.publicUrl
}

export default function PhotoManager() {
  const [galleries, setGalleries] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedGallery, setSelectedGallery] = useState(null)
  const [galleryImages, setGalleryImages] = useState([])
  const [showCreate, setShowCreate] = useState(false)

  // Create form
  const [title, setTitle] = useState('')
  const [eventDate, setEventDate] = useState('')
  const [isLocked, setIsLocked] = useState(false)
  const [accessCode, setAccessCode] = useState('')
  const [coverFile, setCoverFile] = useState(null)
  const [coverPreview, setCoverPreview] = useState(null)
  const [creating, setCreating] = useState(false)
  const [createStatus, setCreateStatus] = useState(null)

  // Edit existing gallery
  const [editTitle, setEditTitle] = useState('')
  const [editEventDate, setEditEventDate] = useState('')
  const [editIsLocked, setEditIsLocked] = useState(false)
  const [editAccessCode, setEditAccessCode] = useState('')
  const [editCoverFile, setEditCoverFile] = useState(null)
  const [editCoverPreview, setEditCoverPreview] = useState(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editStatus, setEditStatus] = useState(null)

  // Drag-and-drop upload queue
  const [dragOver, setDragOver] = useState(false)
  const [queue, setQueue] = useState([]) // [{ file, previewUrl }]
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [uploadDone, setUploadDone] = useState(false)

  useEffect(() => { loadGalleries() }, [])

  async function loadGalleries() {
    setLoading(true)
    const { data } = await supabase.from('photo_galleries').select('*').order('event_date', { ascending: false })
    setGalleries(data || [])
    setLoading(false)
  }

  async function loadGalleryImages(galleryId) {
    const { data } = await supabase.from('photo_gallery_images').select('*').eq('gallery_id', galleryId).order('sort_order', { ascending: true })
    setGalleryImages(data || [])
  }

  function handleCoverChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
  }

  async function handleCreateGallery(e) {
    e.preventDefault()
    setCreating(true)
    setCreateStatus(null)
    try {
      let coverUrl = null
      if (coverFile) coverUrl = await uploadToStorage(coverFile)
      const { error } = await supabase.from('photo_galleries').insert([{
        title,
        event_date: eventDate || null,
        is_locked: isLocked,
        access_code: isLocked ? (accessCode || null) : null,
        cover_image_url: coverUrl,
      }])
      if (error) throw error
      setCreateStatus('success')
      setTitle(''); setEventDate(''); setIsLocked(false); setAccessCode('')
      setCoverFile(null); setCoverPreview(null)
      loadGalleries()
      setTimeout(() => setShowCreate(false), 900)
    } catch (err) {
      setCreateStatus('error')
    }
    setCreating(false)
  }

  async function handleDeleteGallery(id) {
    if (!confirm('Delete this gallery and all its photos? This cannot be undone.')) return
    await supabase.from('photo_gallery_images').delete().eq('gallery_id', id)
    await supabase.from('photo_galleries').delete().eq('id', id)
    if (selectedGallery?.id === id) { setSelectedGallery(null); setGalleryImages([]) }
    loadGalleries()
  }

  function openGallery(g) {
    setSelectedGallery(g)
    setEditTitle(g.title || '')
    setEditEventDate(g.event_date || '')
    setEditIsLocked(g.is_locked || false)
    setEditAccessCode(g.access_code || '')
    setEditCoverFile(null)
    setEditCoverPreview(null)
    setEditStatus(null)
    setQueue([])
    setUploadDone(false)
    loadGalleryImages(g.id)
  }

  function handleEditCoverChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setEditCoverFile(file)
    setEditCoverPreview(URL.createObjectURL(file))
  }

  async function handleUpdateGallery(e) {
    e.preventDefault()
    setSavingEdit(true)
    setEditStatus(null)
    try {
      let coverUrl = selectedGallery.cover_image_url
      if (editCoverFile) coverUrl = await uploadToStorage(editCoverFile)
      const payload = {
        title: editTitle,
        event_date: editEventDate || null,
        is_locked: editIsLocked,
        access_code: editIsLocked ? (editAccessCode || null) : null,
        cover_image_url: coverUrl,
      }
      const { error } = await supabase.from('photo_galleries').update(payload).eq('id', selectedGallery.id)
      if (error) throw error
      setSelectedGallery(g => ({ ...g, ...payload }))
      setEditCoverFile(null); setEditCoverPreview(null)
      setEditStatus('success')
      loadGalleries()
    } catch (err) {
      setEditStatus('error')
    }
    setSavingEdit(false)
  }

  async function handleSetCoverFromPhoto(url) {
    await supabase.from('photo_galleries').update({ cover_image_url: url }).eq('id', selectedGallery.id)
    setSelectedGallery(g => ({ ...g, cover_image_url: url }))
    loadGalleries()
  }

  async function handleDeleteImage(id) {
    if (!confirm('Delete this photo?')) return
    await supabase.from('photo_gallery_images').delete().eq('id', id)
    loadGalleryImages(selectedGallery.id)
  }

  // ── Drag-and-drop queue ──
  function addToQueue(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    const additions = files.map(file => ({ file, previewUrl: URL.createObjectURL(file) }))
    setQueue(prev => [...prev, ...additions])
    setUploadDone(false)
  }

  function removeFromQueue(idx) {
    setQueue(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleUploadQueue() {
    if (!selectedGallery || queue.length === 0) return
    setUploading(true)
    setUploadDone(false)
    setUploadProgress({ done: 0, total: queue.length })

    const { data: existing } = await supabase
      .from('photo_gallery_images')
      .select('sort_order')
      .eq('gallery_id', selectedGallery.id)
      .order('sort_order', { ascending: false })
      .limit(1)
    let nextSort = (existing?.[0]?.sort_order ?? -1) + 1

    for (const item of queue) {
      try {
        const url = await uploadToStorage(item.file)
        await supabase.from('photo_gallery_images').insert([{
          gallery_id: selectedGallery.id,
          image_url: url,
          sort_order: nextSort++,
        }])
      } catch (err) {
        // continue on individual file errors
      }
      setUploadProgress(p => ({ ...p, done: p.done + 1 }))
    }

    setQueue([])
    setUploading(false)
    setUploadDone(true)
    loadGalleryImages(selectedGallery.id)
  }

  const pct = uploadProgress.total > 0 ? Math.round((uploadProgress.done / uploadProgress.total) * 100) : 0
  const currentCoverPreview = editCoverPreview || selectedGallery?.cover_image_url

  // ── GALLERY DETAIL ──
  if (selectedGallery) {
    return (
      <div>
        <div className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button className="btn btn-secondary" onClick={() => { setSelectedGallery(null); setGalleryImages([]) }}>← Back</button>
            <h1 className="page-title">{selectedGallery.title}</h1>
          </div>
        </div>

        <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="card">
              <h2 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--burgundy)', marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid var(--gray-100)' }}>
                ✏️ Gallery Details
              </h2>
              <form onSubmit={handleUpdateGallery}>
                <div className="form-group">
                  <label className="form-label">Title</label>
                  <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Event Date</label>
                  <input type="date" value={editEventDate} onChange={e => setEditEventDate(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Cover Photo</label>
                  {currentCoverPreview && (
                    <img src={currentCoverPreview} alt="" style={{ width: '100%', maxWidth: '220px', borderRadius: '8px', marginBottom: '8px', display: 'block' }} />
                  )}
                  <input type="file" accept="image/*" onChange={handleEditCoverChange} style={{ fontSize: '13px' }} />
                  <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px' }}>
                    Upload a new cover here, or click "★ Use as Cover" on any photo →
                  </div>
                </div>
                <label className="checkbox-label" style={{ marginBottom: '10px' }}>
                  <input type="checkbox" checked={editIsLocked} onChange={e => setEditIsLocked(e.target.checked)} />
                  🔒 Lock this gallery (requires access code)
                </label>
                {editIsLocked && (
                  <div className="form-group">
                    <label className="form-label">Access Code</label>
                    <input type="text" value={editAccessCode} onChange={e => setEditAccessCode(e.target.value)} placeholder="e.g. UMCD2026" />
                    <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '4px' }}>Share this code with parents/families via email or bulletin.</div>
                  </div>
                )}
                {editStatus === 'success' && <div className="alert alert-success">✓ Gallery updated!</div>}
                {editStatus === 'error' && <div className="alert alert-error">Something went wrong.</div>}
                <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '4px' }} disabled={savingEdit}>
                  {savingEdit ? 'Saving…' : '💾 Save Changes'}
                </button>
              </form>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="card">
              <h2 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--burgundy)', marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid var(--gray-100)' }}>
                📤 Upload Photos
              </h2>

              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); addToQueue(e.dataTransfer.files) }}
                onClick={() => document.getElementById('photo-drop-input').click()}
                style={{
                  border: `2px dashed ${dragOver ? 'var(--burgundy)' : 'var(--gray-200)'}`, borderRadius: '12px',
                  padding: '32px 16px', textAlign: 'center', background: dragOver ? 'var(--burgundy-light)' : 'var(--gray-50)',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '30px', marginBottom: '8px' }}>📸</div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--burgundy)', marginBottom: '4px' }}>Drop photos here or click to browse</div>
                <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>Drag a whole folder's worth at once — JPG, PNG, HEIC</div>
                <input id="photo-drop-input" type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => addToQueue(e.target.files)} />
              </div>

              {queue.length > 0 && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray-400)', marginBottom: '8px' }}>
                    {queue.length} photo{queue.length === 1 ? '' : 's'} ready to upload
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: '6px', marginBottom: '12px' }}>
                    {queue.map((item, i) => (
                      <div key={i} style={{ position: 'relative', aspectRatio: '1/1', borderRadius: '6px', overflow: 'hidden' }}>
                        <img src={item.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        {!uploading && (
                          <button
                            onClick={() => removeFromQueue(i)}
                            style={{ position: 'absolute', top: '2px', right: '2px', background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: '18px', height: '18px', fontSize: '10px', cursor: 'pointer', lineHeight: 1 }}
                          >✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {uploading && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--gray-600)' }}>Uploading photos…</span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--burgundy)' }}>{uploadProgress.done} / {uploadProgress.total} ({pct}%)</span>
                  </div>
                  <div style={{ background: 'var(--burgundy-light)', borderRadius: '999px', height: '10px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: '999px', background: 'var(--burgundy)', width: `${pct}%`, transition: 'width 0.3s ease' }} />
                  </div>
                </div>
              )}

              {uploadDone && !uploading && (
                <div className="alert alert-success" style={{ marginTop: '10px' }}>✓ All {uploadProgress.total} photo{uploadProgress.total === 1 ? '' : 's'} uploaded!</div>
              )}

              {queue.length > 0 && !uploading && (
                <button className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '10px' }} onClick={handleUploadQueue}>
                  Upload {queue.length} Photo{queue.length === 1 ? '' : 's'}
                </button>
              )}
            </div>

            <div className="card">
              <h2 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--burgundy)', marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid var(--gray-100)' }}>
                🖼️ Photos ({galleryImages.length})
              </h2>
              {galleryImages.length === 0 && <div style={{ fontSize: '13px', color: 'var(--gray-400)' }}>No photos uploaded yet.</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '10px' }}>
                {galleryImages.map(img => (
                  <div key={img.id} style={{ position: 'relative', aspectRatio: '1/1', borderRadius: '8px', overflow: 'hidden' }}>
                    <img src={img.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    {selectedGallery.cover_image_url === img.image_url && (
                      <span style={{ position: 'absolute', bottom: '4px', left: '4px', background: 'var(--burgundy)', color: 'white', borderRadius: '5px', padding: '3px 6px', fontSize: '10px', fontWeight: 700 }}>★ Cover</span>
                    )}
                    <button
                      onClick={() => handleDeleteImage(img.id)}
                      style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.6)', color: 'white', border: 'none', borderRadius: '50%', width: '22px', height: '22px', fontSize: '12px', cursor: 'pointer', lineHeight: 1 }}
                    >✕</button>
                    {selectedGallery.cover_image_url !== img.image_url && (
                      <button
                        onClick={() => handleSetCoverFromPhoto(img.image_url)}
                        style={{ position: 'absolute', bottom: '4px', left: '4px', right: '4px', background: 'rgba(0,0,0,0.65)', color: 'white', border: 'none', borderRadius: '5px', padding: '3px 0', fontSize: '10px', fontWeight: 700, cursor: 'pointer' }}
                      >★ Use as Cover</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── GALLERY LIST ──
  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Photo Manager</h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(s => !s)}>{showCreate ? '✕ Cancel' : '+ New Gallery'}</button>
      </div>

      <div className="page-body">
        {showCreate && (
          <div className="card" style={{ marginBottom: '20px', maxWidth: '480px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--burgundy)', marginBottom: '14px', paddingBottom: '8px', borderBottom: '1px solid var(--gray-100)' }}>
              Create Photo Gallery
            </h2>
            <form onSubmit={handleCreateGallery}>
              <div className="form-group">
                <label className="form-label">Gallery Title</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Vacation Bible School 2026" required />
              </div>
              <div className="form-group">
                <label className="form-label">Event Date</label>
                <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Cover Photo (optional)</label>
                <input type="file" accept="image/*" onChange={handleCoverChange} style={{ fontSize: '13px' }} />
                {coverPreview && <img src={coverPreview} alt="" style={{ width: '100%', maxWidth: '200px', borderRadius: '8px', marginTop: '6px', display: 'block' }} />}
              </div>
              <label className="checkbox-label" style={{ marginBottom: '10px' }}>
                <input type="checkbox" checked={isLocked} onChange={e => setIsLocked(e.target.checked)} />
                🔒 Lock this gallery (requires access code)
              </label>
              {isLocked && (
                <div className="form-group">
                  <label className="form-label">Access Code</label>
                  <input type="text" value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="e.g. UMCD2026" />
                </div>
              )}
              {createStatus === 'success' && <div className="alert alert-success">✓ Gallery created!</div>}
              {createStatus === 'error' && <div className="alert alert-error">Something went wrong.</div>}
              <button type="submit" className="btn btn-primary btn-lg" style={{ width: '100%', marginTop: '4px' }} disabled={creating || !title}>
                {creating ? 'Creating…' : 'Create Gallery'}
              </button>
            </form>
          </div>
        )}

        {loading ? <div className="spinner" /> : galleries.length === 0 ? (
          <div className="empty-state"><div className="icon">📷</div><p>No galleries yet. Create one above.</p></div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
            {galleries.map(g => (
              <div key={g.id} className="card" style={{ padding: 0, overflow: 'hidden', cursor: 'pointer' }} onClick={() => openGallery(g)}>
                <div style={{ aspectRatio: '4/3', background: 'var(--gray-100)', position: 'relative' }}>
                  {g.cover_image_url ? (
                    <img src={g.cover_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '32px', color: 'var(--gray-200)' }}>🖼️</div>
                  )}
                  {g.is_locked && (
                    <span style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.6)', color: 'white', borderRadius: '5px', padding: '3px 7px', fontSize: '11px', fontWeight: 700 }}>🔒 Locked</span>
                  )}
                </div>
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--gray-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.title}</div>
                  <div style={{ fontSize: '12px', color: 'var(--gray-400)', marginTop: '2px' }}>{fmtDate(g.event_date)}</div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                    <button className="btn btn-secondary btn-sm" onClick={e => { e.stopPropagation(); openGallery(g) }} style={{ flex: 1 }}>Manage</button>
                    <button className="btn btn-danger btn-sm" onClick={e => { e.stopPropagation(); handleDeleteGallery(g.id) }}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
