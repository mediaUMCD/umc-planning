import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const ROW_TYPE_OPTIONS = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'call_to_worship', label: 'Call to worship' },
  { key: 'hymn', label: 'Hymn' },
  { key: 'prayer_of_illumination', label: 'Prayer of Illumination' },
  { key: 'scripture', label: 'Scripture reading' },
  { key: 'childrens_message', label: "Children's message" },
  { key: 'special_music', label: 'Special music' },
  { key: 'sermon', label: 'Sermon' },
  { key: 'apostles_creed', label: "Apostles' creed" },
  { key: 'confession_pardon', label: 'Confession & Pardon' },
  { key: 'invitation', label: 'Invitation' },
  { key: 'great_thanksgiving', label: 'Great Thanksgiving' },
  { key: 'breaking_the_bread', label: 'Breaking the Bread' },
  { key: 'communion', label: 'Communion (Giving the Bread and Cup)' },
  { key: 'imposition_of_ashes', label: 'Imposition of Ashes' },
  { key: 'candlelighting', label: 'Candlelighting' },
  { key: 'pastoral_prayer', label: 'Pastoral prayer' },
  { key: 'lords_prayer', label: "Lord's prayer" },
  { key: 'offertory_prayer', label: 'Offertory prayer' },
  { key: 'doxology', label: 'Doxology' },
  { key: 'announcements', label: 'Announcements' },
  { key: 'closing_hymn', label: 'Closing hymn' },
  { key: 'benediction', label: 'Benediction' },
  { key: 'spacer', label: 'Blank line (spacing)' },
  { key: 'custom', label: 'Custom' },
]
const LABEL_BY_KEY = Object.fromEntries(ROW_TYPE_OPTIONS.map(t => [t.key, t.label]))

const SERVICE_TYPES = [
  'Regular Sunday', 'Communion Sunday', 'Advent', 'Christmas Eve', 'Ash Wednesday',
  'Maundy Thursday', 'Good Friday', 'Easter', 'Pentecost', 'Rally Day',
  'Lessons & Carols', 'Special Service',
]

let idCounter = 0
function rowId() { idCounter += 1; return `tpl_row_${idCounter}` }

export default function BulletinTemplateEditor({ builtInDefaults, onClose, onSaved }) {
  const [templates, setTemplates] = useState({}) // service_type -> row_types array from DB
  const [loading, setLoading] = useState(true)
  const [selectedType, setSelectedType] = useState('Regular Sunday')
  const [rows, setRows] = useState([]) // working copy for selected type: [{id, type}]
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [dragId, setDragId] = useState(null)
  const [overId, setOverId] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('bulletin_templates').select('service_type, row_types')
    const map = {}
    for (const t of (data || [])) map[t.service_type] = t.row_types
    setTemplates(map)
    setLoading(false)
    selectType('Regular Sunday', map)
  }

  function selectType(type, templatesOverride = templates) {
    setSelectedType(type)
    const source = templatesOverride[type] || builtInDefaults[type] || []
    setRows(source.map(t => ({ id: rowId(), type: t })))
    setSaveMsg('')
  }

  function addRow() {
    setRows(prev => [...prev, { id: rowId(), type: 'custom' }])
  }
  function removeRow(id) {
    setRows(prev => prev.filter(r => r.id !== id))
  }
  function changeType(id, type) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, type } : r))
  }
  function moveRow(id, dir) {
    setRows(prev => {
      const idx = prev.findIndex(r => r.id === id)
      const target = idx + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  // Drag-to-reorder — drag the handle to drop a row anywhere in the list,
  // instead of walking it there one arrow-click at a time.
  function handleDragStart(id) { setDragId(id) }
  function handleDragOver(e, id) {
    e.preventDefault()
    if (id !== overId) setOverId(id)
  }
  function handleDrop(id) {
    setRows(prev => {
      if (!dragId || dragId === id) return prev
      const from = prev.findIndex(r => r.id === dragId)
      const to = prev.findIndex(r => r.id === id)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setDragId(null)
    setOverId(null)
  }
  function handleDragEnd() { setDragId(null); setOverId(null) }

  async function handleSave() {
    setSaving(true)
    const rowTypes = rows.map(r => r.type)
    const { error } = await supabase.from('bulletin_templates').upsert({ service_type: selectedType, row_types: rowTypes }, { onConflict: 'service_type' })
    setSaving(false)
    if (error) { setSaveMsg(`Error: ${error.message}`); return }
    setTemplates(prev => ({ ...prev, [selectedType]: rowTypes }))
    setSaveMsg('✓ Saved — new services and "Reset to Default" will use this from now on.')
    if (onSaved) onSaved()
  }

  function handleResetToBuiltIn() {
    if (!confirm(`Reset "${selectedType}" back to the original built-in default? This discards your customizations for this type (until you edit it again).`)) return
    const source = builtInDefaults[selectedType] || []
    setRows(source.map(t => ({ id: rowId(), type: t })))
    setSaveMsg('')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}>
      <div style={{ background: 'white', borderRadius: '12px', width: '100%', maxWidth: '820px' }}>
        <div style={{ position: 'sticky', top: 0, background: 'white', borderBottom: '1px solid var(--gray-100)', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1, borderRadius: '12px 12px 0 0' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--burgundy)' }}>Bulletin Templates</h2>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>✕ Close</button>
        </div>

        <div style={{ padding: '24px' }}>
          <p style={{ fontSize: '13px', color: 'var(--gray-600)', marginBottom: '16px' }}>
            This is the starting row order new services get created with for each Service Type — not any specific bulletin. Editing here never changes a bulletin you've already built; it only affects new services and whenever you click "Reset to Default" / "Sync" on one.
          </p>

          {loading ? <div className="spinner" /> : (
            <div style={{ display: 'flex', gap: '18px' }}>
              <div style={{ width: '180px', flexShrink: 0 }}>
                {SERVICE_TYPES.map(type => (
                  <button
                    key={type}
                    onClick={() => selectType(type)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: '4px',
                      borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px',
                      background: selectedType === type ? 'var(--burgundy)' : 'var(--gray-50)',
                      color: selectedType === type ? 'white' : 'var(--gray-800)',
                      fontWeight: selectedType === type ? 700 : 500,
                    }}
                  >
                    {type}
                    {templates[type] && <span style={{ marginLeft: '6px', fontSize: '10px', opacity: 0.7 }}>●</span>}
                  </button>
                ))}
                <div style={{ fontSize: '11px', color: 'var(--gray-400)', marginTop: '10px' }}>● = customized</div>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '420px', overflowY: 'auto', marginBottom: '14px' }}>
                  {rows.map((row, idx) => (
                    <div key={row.id}
                      onDragOver={e => handleDragOver(e, row.id)}
                      onDrop={() => handleDrop(row.id)}
                      onDragEnd={handleDragEnd}
                      style={{
                        display: 'flex', gap: '8px', alignItems: 'center',
                        background: overId === row.id && dragId !== row.id ? 'var(--burgundy-light)' : 'var(--gray-50)',
                        padding: '8px 10px', borderRadius: '6px',
                        border: overId === row.id && dragId !== row.id ? '2px dashed var(--burgundy)' : '2px solid transparent',
                        opacity: dragId === row.id ? 0.4 : 1,
                      }}
                    >
                      <span
                        draggable
                        onDragStart={() => handleDragStart(row.id)}
                        title="Drag to reorder"
                        style={{ cursor: 'grab', fontSize: '15px', color: 'var(--gray-400)', flexShrink: 0, userSelect: 'none', touchAction: 'none' }}
                      >
                        ⠿
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--gray-400)', width: '20px', flexShrink: 0 }}>{idx + 1}</span>
                      <select value={row.type} onChange={e => changeType(row.id, e.target.value)} style={{ flex: 1, padding: '6px 8px', fontSize: '13px' }}>
                        {ROW_TYPE_OPTIONS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                      <button type="button" onClick={() => moveRow(row.id, -1)} disabled={idx === 0}
                        style={{ fontSize: '13px', background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? 'var(--gray-200)' : 'var(--gray-600)' }}>▲</button>
                      <button type="button" onClick={() => moveRow(row.id, 1)} disabled={idx === rows.length - 1}
                        style={{ fontSize: '13px', background: 'none', border: 'none', cursor: idx === rows.length - 1 ? 'default' : 'pointer', color: idx === rows.length - 1 ? 'var(--gray-200)' : 'var(--gray-600)' }}>▼</button>
                      <button type="button" onClick={() => removeRow(row.id)}
                        style={{ fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}>✕</button>
                    </div>
                  ))}
                  {rows.length === 0 && <div style={{ fontSize: '13px', color: 'var(--gray-400)', padding: '10px' }}>No rows — add one below.</div>}
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>+ Add Row</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={handleResetToBuiltIn}>↺ Reset to Built-in Default</button>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : `💾 Save "${selectedType}" Template`}
                  </button>
                  {saveMsg && <span style={{ fontSize: '12px', color: saveMsg.startsWith('Error') ? 'var(--danger)' : 'var(--gray-400)' }}>{saveMsg}</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
