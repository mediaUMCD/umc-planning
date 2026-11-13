import { useEffect, useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '../lib/supabase.js'

// People — the church's people records (imported from Breeze, Nov 2026).
// Search and filter, edit a person, their family and tags, archive with a
// reason and dates (never delete), restore, and see why people left by year.

const TYPE_LABELS = { member: 'Member', guest: 'Guest', visitor: 'Visitor', child: 'Child', staff: 'Staff', organization: 'Organization' }
const LEFT_LABELS = {
  transfer_umc: 'Moved to another UMC church', transfer_other: 'Moved to another church', death: 'Deceased',
  inactive: 'Deactivated', moved: 'Moved out of area', withdrawn: 'Withdrew', charge_conference: 'Removed by Charge Conference',
  other: 'Other', unknown: 'Reason not recorded',
}
const ADDR_LABELS = { ok: 'Address checked OK', moved: 'Moved (new address found)', moved_no_forwarding: 'Moved, no forwarding address', undeliverable: 'Address not deliverable', vacant: 'Address vacant / box closed' }
const COLS = 'address_status, previous_address, moved_on, address_checked_at, id, first_name, last_name, preferred_name, middle_name, maiden_name, suffix, email, phone, home_phone, street, city, state, zip, birthdate, gender, marital_status, person_type, family_id, family_role, is_active, is_directory_opt_out, membership_date, umc_status, archive_category, archive_reason, membership_removed_date, deceased_date, archived_at, notes, breeze_id, breeze_extra'

const display = (p) => `${p.last_name ? p.last_name + ', ' : ''}${p.preferred_name || p.first_name}`
const today = () => new Date().toISOString().slice(0, 10)

export default function People() {
  const [tab, setTab] = useState('people')
  const [people, setPeople] = useState(null)
  const [families, setFamilies] = useState([])
  const [tags, setTags] = useState([])
  const [links, setLinks] = useState([]) // person_tags
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // person object or {new:true}

  async function load() {
    setError('')
    const all = []
    for (let from = 0; ; from += 1000) { // read past the 1000-row page limit
      const { data, error } = await supabase.from('people').select(COLS).order('last_name').order('first_name').range(from, from + 999)
      if (error) return setError(error.message)
      all.push(...data); if (data.length < 1000) break
    }
    const [f, t, l] = await Promise.all([
      supabase.from('families').select('id, family_name, address, primary_phone').order('family_name'),
      supabase.from('tags').select('id, name, color').order('name'),
      supabase.from('person_tags').select('person_id, tag_id'),
    ])
    const err = f.error || t.error || l.error
    if (err) return setError(err.message)
    setPeople(all); setFamilies(f.data); setTags(t.data); setLinks(l.data)
  }
  useEffect(() => { load() }, [])

  function saved(p) {
    setPeople(ps => {
      const i = ps.findIndex(x => x.id === p.id)
      return i === -1 ? [...ps, p].sort((a, b) => display(a).localeCompare(display(b))) : ps.map(x => x.id === p.id ? p : x)
    })
    setEditing(p)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">People</div>
          <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 2 }}>Members, families and friends of UMCD</div>
        </div>
        {!editing && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn btn-sm ${tab === 'people' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('people')}>People</button>
            <button className={`btn btn-sm ${tab === 'left' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('left')}>Why people left</button>
            <button className={`btn btn-sm ${tab === 'dupes' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('dupes')}>Possible duplicates</button>
          </div>
        )}
      </div>
      <div className="page-body">
        {error && <div className="card" style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}
        {!people ? (!error && <div className="spinner" />)
          : editing ? (
            <PersonEditor person={editing} families={families} setFamilies={setFamilies} tags={tags} setTags={setTags}
              links={links} setLinks={setLinks} onSaved={saved} onClose={() => setEditing(null)} />
          ) : tab === 'people' ? (
            <PeopleList people={people} families={families} tags={tags} links={links} onOpen={setEditing}
              onBulkSaved={(rows) => setPeople(ps => { const m = Object.fromEntries(rows.map(r => [r.id, r])); return ps.map(p => m[p.id] || p) })}
              onAdd={() => setEditing({ isNew: true, first_name: '', last_name: '', person_type: 'visitor', is_active: true, is_directory_opt_out: true })} />
          ) : tab === 'dupes' ? (
            <Duplicates people={people} families={families} links={links} onChanged={load} onOpen={setEditing} />
          ) : <WhyLeft people={people} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ list */

function PeopleList({ people, families, tags, links, onOpen, onAdd, onBulkSaved }) {
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState(() => new Set())
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('active')
  const [type, setType] = useState('')
  const [tag, setTag] = useState('')
  const [quick, setQuick] = useState('')
  const [limit, setLimit] = useState(100)

  const famById = useMemo(() => Object.fromEntries(families.map(f => [f.id, f])), [families])
  const tagById = useMemo(() => Object.fromEntries(tags.map(t => [t.id, t])), [tags])
  const tagsOf = useMemo(() => {
    const m = {}; for (const l of links) (m[l.person_id] ||= []).push(l.tag_id); return m
  }, [links])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return people.filter(p => {
      if (status === 'active' && !p.is_active) return false
      if (status === 'archived' && p.is_active) return false
      if (!type && p.person_type === 'organization' && status !== 'all') return false
      if (type && p.person_type !== type) return false
      if (tag && !(tagsOf[p.id] || []).includes(tag)) return false
      if (quick === 'noaddress' && (p.street || p.person_type === 'child' || p.person_type === 'organization')) return false
      if (quick === 'noemail' && (p.email || p.person_type === 'organization')) return false
      if (quick === 'directory' && (p.is_directory_opt_out || !p.is_active)) return false
      if (quick === 'moved' && !['moved', 'moved_no_forwarding'].includes(p.address_status)) return false
      if (quick === 'badaddr' && !['undeliverable', 'vacant', 'moved_no_forwarding'].includes(p.address_status)) return false
      if (quick === 'rolls' && (p.is_active || !['Full Member', 'Constituent', 'Reinstated Member', 'Affiliate Member'].includes(p.umc_status) || p.person_type === 'organization')) return false
      if (needle) {
        const hay = `${p.first_name} ${p.preferred_name || ''} ${p.last_name} ${p.email || ''} ${famById[p.family_id]?.family_name || ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [people, q, status, type, tag, quick, tagsOf, famById])

  useEffect(() => { setLimit(100) }, [q, status, type, tag, quick])

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input placeholder="Search by name, email or family…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 240px', fontSize: 16 }} />
          <button className="btn btn-primary" onClick={onAdd}>+ Add person</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="active">Active</option><option value="archived">Archived</option><option value="all">Everyone</option>
          </select>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="">All kinds</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}s</option>)}
          </select>
          <select value={tag} onChange={e => setTag(e.target.value)}>
            <option value="">Any tag</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={quick} onChange={e => setQuick(e.target.value)}>
            <option value="">No extra filter</option>
            <option value="noaddress">No address</option>
            <option value="noemail">No email</option>
            <option value="directory">In the directory</option>
            <option value="moved">Moved (address check)</option>
            <option value="badaddr">Bad address (address check)</option>
            <option value="rolls">Archived but still on the rolls</option>
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 2px 8px' }}>
        <div style={{ fontSize: 13, color: 'var(--gray-600)', flex: 1 }}>{shown.length} {shown.length === 1 ? 'person' : 'people'}</div>
        {shown.length > 0 && <button className="btn btn-sm btn-secondary" onClick={() => downloadList(shown, famById)}>⬇ Download this list</button>}
        <button className={`btn btn-sm ${picking ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setPicking(v => !v); setPicked(new Set()) }}>{picking ? 'Done selecting' : 'Select several'}</button>
      </div>

      {picking && (
        <BulkPanel picked={people.filter(p => picked.has(p.id))} shown={shown}
          onPickAll={() => setPicked(new Set(shown.map(p => p.id)))} onClear={() => setPicked(new Set())}
          onSaved={(rows) => { onBulkSaved(rows); setPicked(new Set()) }} />
      )}

      <div style={{ display: 'grid', gap: 6 }}>
        {shown.slice(0, limit).map(p => (
          <button key={p.id} className="card"
            onClick={() => picking ? setPicked(s => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n }) : onOpen(p)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', textAlign: 'left', opacity: p.is_active ? 1 : 0.75,
              borderColor: picking && picked.has(p.id) ? 'var(--burgundy)' : undefined, background: picking && picked.has(p.id) ? 'var(--burgundy-light)' : undefined }}>
            {picking && <span style={{ width: 22, height: 22, borderRadius: 5, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: `2px solid ${picked.has(p.id) ? 'var(--burgundy)' : 'var(--gray-400)'}`, background: picked.has(p.id) ? 'var(--burgundy)' : 'transparent', color: 'white', fontWeight: 700 }}>{picked.has(p.id) ? '✓' : ''}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{display(p)}{p.suffix ? ` ${p.suffix}` : ''}</div>
              <div style={{ fontSize: 12, color: 'var(--gray-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[TYPE_LABELS[p.person_type], famById[p.family_id]?.family_name && `${famById[p.family_id].family_name} family`, p.city].filter(Boolean).join(' · ')}
              </div>
              {(tagsOf[p.id] || []).length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  {tagsOf[p.id].map(id => tagById[id] && <span key={id} style={{ fontSize: 11, background: 'var(--burgundy-light)', color: 'var(--burgundy)', borderRadius: 10, padding: '1px 8px' }}>{tagById[id].name}</span>)}
                </div>
              )}
            </div>
            {!p.is_active && <span style={{ fontSize: 11, color: 'var(--gray-600)', textAlign: 'right', flex: 'none', maxWidth: 140 }}>Archived<br />{LEFT_LABELS[p.archive_category] || ''}</span>}
          </button>
        ))}
      </div>
      {shown.length > limit && <button className="btn btn-secondary" style={{ marginTop: 10, width: '100%' }} onClick={() => setLimit(l => l + 200)}>Show more ({shown.length - limit} left)</button>}
    </div>
  )
}

// Update membership status for several people at once (e.g. after the
// Charge Conference removes people from the rolls). Each person's old UMC
// status is kept in their note, so nothing is lost.
function BulkPanel({ picked, shown, onPickAll, onClear, onSaved }) {
  const [f, setF] = useState({ category: '', removed: new Date().toISOString().slice(0, 10), note: '', clearUmc: true })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function apply() {
    if (!f.category) return setErr('Choose a membership status.')
    if (!picked.length) return setErr('Tap the people you want to update first.')
    if (!window.confirm(`Update ${picked.length} ${picked.length === 1 ? 'person' : 'people'} to "${LEFT_LABELS[f.category]}"?`)) return
    setBusy(true); setErr(''); setMsg('')
    const saved = []
    for (const p of picked) {
      const notes = [p.archive_reason, f.note, f.clearUmc && p.umc_status ? `Was ${p.umc_status}` : ''].filter(Boolean)
      const row = {
        is_active: false, is_directory_opt_out: true, archived_at: p.archived_at || new Date().toISOString(),
        archive_category: f.category, membership_removed_date: f.removed || null,
        archive_reason: [...new Set(notes)].join(' · ') || null, updated_at: new Date().toISOString(),
      }
      if (f.clearUmc) row.umc_status = null
      const { data, error } = await supabase.from('people').update(row).eq('id', p.id).select(COLS).single()
      if (error) { setBusy(false); setErr(`Stopped at ${p.first_name} ${p.last_name}: ${error.message}`); if (saved.length) onSaved(saved); return }
      saved.push(data)
    }
    setBusy(false); setMsg(`Updated ${saved.length} ${saved.length === 1 ? 'person' : 'people'}.`); onSaved(saved)
  }

  return (
    <div className="card" style={{ marginBottom: 12, borderColor: 'var(--burgundy)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontWeight: 600, flex: 1 }}>{picked.length} selected</div>
        <button className="btn btn-sm btn-secondary" onClick={onPickAll}>Select all {shown.length} shown</button>
        <button className="btn btn-sm btn-secondary" onClick={onClear}>Clear</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <div><label className="form-label">Membership status</label>
          <select value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>
            <option value="">Choose…</option>
            {Object.entries(LEFT_LABELS).filter(([k]) => k !== 'unknown').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <div><label className="form-label">Date removed from membership</label>
          <input type="date" value={f.removed} onChange={e => setF({ ...f, removed: e.target.value })} /></div>
        <div style={{ gridColumn: '1 / -1' }}><label className="form-label">Note (optional, added to each person)</label>
          <input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="e.g. Charge Conference, Nov 2026" /></div>
      </div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, fontSize: 14 }}>
        <input type="checkbox" style={{ width: 'auto', flex: 'none' }} checked={f.clearUmc} onChange={e => setF({ ...f, clearUmc: e.target.checked })} />
        Take them off the membership rolls (clears UMC status; the old status is saved in their note)
      </label>
      {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{err}</div>}
      {msg && <div style={{ color: 'var(--success)', fontSize: 13, fontWeight: 600, marginTop: 8 }}>✓ {msg}</div>}
      <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={apply}>{busy ? 'Updating…' : `Update ${picked.length} selected`}</button>
    </div>
  )
}

async function downloadList(rows, famById) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('People')
  ws.columns = [
    { header: 'Last name', width: 18 }, { header: 'First name', width: 16 }, { header: 'Kind', width: 12 }, { header: 'Active', width: 8 },
    { header: 'UMC status', width: 16 }, { header: 'Membership status', width: 30 }, { header: 'Removed from membership', width: 14 },
    { header: 'Street', width: 30 }, { header: 'City', width: 16 }, { header: 'State', width: 7 }, { header: 'ZIP', width: 10 },
    { header: 'Address check', width: 28 }, { header: 'Previous address', width: 40 }, { header: 'Moved', width: 10 },
    { header: 'Email', width: 28 }, { header: 'Phone', width: 15 }, { header: 'Family', width: 16 },
  ]
  rows.forEach(p => ws.addRow([p.last_name, p.preferred_name || p.first_name, TYPE_LABELS[p.person_type], p.is_active ? 'Yes' : 'No',
    p.umc_status || '', p.is_active ? '' : (LEFT_LABELS[p.archive_category] || 'Reason not recorded'), p.membership_removed_date || '',
    p.street || '', p.city || '', p.state || '', p.zip || '', ADDR_LABELS[p.address_status] || '', p.previous_address || '', p.moved_on ? p.moved_on.slice(0, 7) : '',
    p.email || '', p.phone || p.home_phone || '', famById[p.family_id]?.family_name || '']))
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D0026' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a'); a.href = url; a.download = `UMCD People ${new Date().toISOString().slice(0, 10)}.xlsx`; a.click(); URL.revokeObjectURL(url)
}

/* ---------------------------------------------------------------- editor */

function Field({ label, children, wide }) {
  return <div style={{ gridColumn: wide ? '1 / -1' : undefined }}><label className="form-label">{label}</label>{children}</div>
}

function PersonEditor({ person, families, setFamilies, tags, setTags, links, setLinks, onSaved, onClose }) {
  const [f, setF] = useState(person)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [arch, setArch] = useState(null) // archive form
  const [newTag, setNewTag] = useState('')
  const [newFamily, setNewFamily] = useState('')
  useEffect(() => { setF(person); setMsg(''); setErr(''); setArch(null) }, [person])

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : (e.target.value === '' ? null : e.target.value) })
  const mine = links.filter(l => l.person_id === f.id).map(l => l.tag_id)

  async function save(extra = {}) {
    if (!f.first_name?.trim()) return setErr('A first name is needed.')
    setSaving(true); setErr(''); setMsg('')
    const row = { ...f, ...extra }
    delete row.isNew; delete row.id; delete row.breeze_extra; delete row.breeze_id
    row.first_name = row.first_name.trim(); row.last_name = (row.last_name || '').trim()
    row.updated_at = new Date().toISOString()
    let data, error
    if (f.isNew) ({ data, error } = await supabase.from('people').insert([row]).select(COLS).single())
    else ({ data, error } = await supabase.from('people').update(row).eq('id', f.id).select(COLS).single())
    setSaving(false)
    if (error) return setErr(error.message)
    setMsg('Saved'); onSaved(data)
    return data
  }

  async function addFamily() {
    if (!newFamily.trim()) return
    const { data, error } = await supabase.from('families').insert([{ family_name: newFamily.trim() }]).select('id, family_name, address, primary_phone').single()
    if (error) return setErr(error.message)
    setFamilies(fs => [...fs, data].sort((a, b) => a.family_name.localeCompare(b.family_name)))
    setF({ ...f, family_id: data.id }); setNewFamily('')
  }

  async function toggleTag(tagId) {
    if (f.isNew) return setErr('Save the person first, then add tags.')
    if (mine.includes(tagId)) {
      const { error } = await supabase.from('person_tags').delete().eq('person_id', f.id).eq('tag_id', tagId)
      if (error) return setErr(error.message)
      setLinks(ls => ls.filter(l => !(l.person_id === f.id && l.tag_id === tagId)))
    } else {
      const { error } = await supabase.from('person_tags').insert([{ person_id: f.id, tag_id: tagId }])
      if (error) return setErr(error.message)
      setLinks(ls => [...ls, { person_id: f.id, tag_id: tagId }])
    }
  }

  async function createTag() {
    if (!newTag.trim()) return
    const { data, error } = await supabase.from('tags').insert([{ name: newTag.trim() }]).select().single()
    if (error) return setErr(error.message)
    setTags(ts => [...ts, data].sort((a, b) => a.name.localeCompare(b.name))); setNewTag('')
    await toggleTag(data.id)
  }

  async function archive() {
    if (!arch.category) return setErr('Choose why they are no longer active.')
    await save({
      is_active: false, is_directory_opt_out: true, archived_at: new Date().toISOString(),
      archive_category: arch.category, archive_reason: arch.note || null,
      membership_removed_date: arch.removed || null,
      deceased_date: arch.category === 'death' ? (arch.deceased || null) : f.deceased_date,
    })
    setArch(null)
  }

  async function restore() {
    await save({ is_active: true, archived_at: null, archive_category: null, archive_reason: null, membership_removed_date: null })
  }

  const fam = families.find(x => x.id === f.family_id)
  const extra = f.breeze_extra || {}

  return (
    <div>
      <button className="btn btn-sm btn-secondary" onClick={onClose} style={{ marginBottom: 12 }}>← All people</button>

      <div className="card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--burgundy)' }}>
            {f.isNew ? 'New person' : `${f.preferred_name || f.first_name} ${f.last_name}`}
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray-600)' }}>
            {f.is_active ? (TYPE_LABELS[f.person_type] || '') : `Archived · ${LEFT_LABELS[f.archive_category] || 'Reason not recorded'}`}
          </div>
        </div>
        {msg && <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: 13 }}>✓ {msg}</span>}
        <button className="btn btn-primary" disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : f.isNew ? 'Add person' : 'Save'}</button>
      </div>
      {err && <div className="card" style={{ color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Name</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <Field label="First name"><input value={f.first_name || ''} onChange={set('first_name')} /></Field>
          <Field label="Goes by"><input value={f.preferred_name || ''} onChange={set('preferred_name')} placeholder="Nickname" /></Field>
          <Field label="Middle name"><input value={f.middle_name || ''} onChange={set('middle_name')} /></Field>
          <Field label="Last name"><input value={f.last_name || ''} onChange={set('last_name')} /></Field>
          <Field label="Suffix"><input value={f.suffix || ''} onChange={set('suffix')} placeholder="Jr., Sr." /></Field>
          <Field label="Maiden name"><input value={f.maiden_name || ''} onChange={set('maiden_name')} /></Field>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Contact</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <Field label="Mobile phone"><input type="tel" value={f.phone || ''} onChange={set('phone')} /></Field>
          <Field label="Home phone"><input type="tel" value={f.home_phone || ''} onChange={set('home_phone')} /></Field>
          <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} /></Field>
          <Field label="Street" wide><input value={f.street || ''} onChange={set('street')} /></Field>
          <Field label="City"><input value={f.city || ''} onChange={set('city')} /></Field>
          <Field label="State"><input value={f.state || ''} onChange={set('state')} maxLength={2} /></Field>
          <Field label="ZIP"><input value={f.zip || ''} onChange={set('zip')} inputMode="numeric" /></Field>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 14 }}>
          <input type="checkbox" style={{ width: 'auto', flex: 'none' }} checked={!f.is_directory_opt_out} onChange={e => setF({ ...f, is_directory_opt_out: !e.target.checked })} />
          Show in the Church App directory (members and staff only)
        </label>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Church</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <Field label="Kind">
            <select value={f.person_type} onChange={set('person_type')}>{Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </Field>
          <Field label="UMC status">
            <select value={f.umc_status || ''} onChange={set('umc_status')}>
              <option value="">—</option><option>Full Member</option><option>Constituent</option><option>Conference Member</option><option>Affiliate Member</option>
            </select>
          </Field>
          <Field label="Membership date"><input type="date" value={f.membership_date || ''} onChange={set('membership_date')} /></Field>
          <Field label="Birthdate"><input type="date" value={f.birthdate || ''} onChange={set('birthdate')} /></Field>
          <Field label="Gender"><select value={f.gender || ''} onChange={set('gender')}><option value="">—</option><option>Female</option><option>Male</option></select></Field>
          <Field label="Marital status"><select value={f.marital_status || ''} onChange={set('marital_status')}><option value="">—</option><option>Single</option><option>Married</option><option>Widowed</option><option>Divorced</option></select></Field>
          <Field label="Notes" wide><textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Family</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <Field label="Family">
            <select value={f.family_id || ''} onChange={set('family_id')}>
              <option value="">— not in a family —</option>
              {families.map(x => <option key={x.id} value={x.id}>{x.family_name}{x.address ? ` · ${x.address.split(',')[0]}` : ''}</option>)}
            </select>
          </Field>
          <Field label="Role in family">
            <select value={f.family_role || ''} onChange={set('family_role')}>
              <option value="">—</option><option>Head of Household</option><option>Spouse</option><option>Adult</option><option>Child</option>
            </select>
          </Field>
          <Field label="Start a new family">
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={newFamily} onChange={e => setNewFamily(e.target.value)} placeholder="Family name" />
              <button className="btn btn-secondary btn-sm" onClick={addFamily}>Add</button>
            </div>
          </Field>
        </div>
        {f.address_status && f.address_status !== 'ok' && (
          <div style={{ fontSize: 13, marginTop: 10, padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: 'var(--warning-light)' }}>
            <strong>{ADDR_LABELS[f.address_status]}</strong>{f.moved_on ? ` · ${f.moved_on.slice(0, 7)}` : ''}{f.address_checked_at ? ` · checked ${f.address_checked_at}` : ''}
            {f.previous_address && <div>Previous address: {f.previous_address}</div>}
          </div>
        )}
        {fam?.address && <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 8 }}>Family address: {fam.address}</div>}
      </div>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Tags</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {tags.map(t => {
            const on = mine.includes(t.id)
            return <button key={t.id} onClick={() => toggleTag(t.id)} style={{ fontSize: 13, padding: '5px 12px', borderRadius: 14,
              border: `1.5px solid ${on ? 'var(--burgundy)' : 'var(--gray-200)'}`, background: on ? 'var(--burgundy)' : 'var(--white)', color: on ? 'white' : 'var(--gray-800)' }}>{on ? '✓ ' : ''}{t.name}</button>
          })}
        </div>
        <div style={{ display: 'flex', gap: 6, maxWidth: 360 }}>
          <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="New tag, e.g. Away for now" />
          <button className="btn btn-secondary btn-sm" onClick={createTag}>Add tag</button>
        </div>
      </div>

      {!f.isNew && (
        <div className="card" style={{ marginBottom: 14, borderColor: f.is_active ? 'var(--gray-200)' : 'var(--warning)' }}>
          {f.is_active ? (!arch ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, fontSize: 14, color: 'var(--gray-600)' }}>No longer coming? Archive them. Nothing is deleted, and you can restore them any time.</div>
              <button className="btn btn-secondary" onClick={() => setArch({ category: '', removed: today(), deceased: '', note: '' })}>Archive…</button>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Archive {f.first_name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Field label="Membership status">
                  <select value={arch.category} onChange={e => setArch({ ...arch, category: e.target.value })}>
                    <option value="">Choose…</option>
                    {Object.entries(LEFT_LABELS).filter(([k]) => k !== 'unknown').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Date removed from membership"><input type="date" value={arch.removed} onChange={e => setArch({ ...arch, removed: e.target.value })} /></Field>
                {arch.category === 'death' && <Field label="Date deceased"><input type="date" value={arch.deceased} onChange={e => setArch({ ...arch, deceased: e.target.value })} /></Field>}
                <Field label="Note (optional)" wide><input value={arch.note} onChange={e => setArch({ ...arch, note: e.target.value })} placeholder="e.g. Joined Putnam UMC" /></Field>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn-primary" onClick={archive} disabled={saving}>Archive</button>
                <button className="btn btn-secondary" onClick={() => setArch(null)}>Cancel</button>
              </div>
            </div>
          )) : (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Archived</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Field label="Membership status">
                  <select value={f.archive_category || 'unknown'} onChange={e => setF({ ...f, archive_category: e.target.value })}>
                    {Object.entries(LEFT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Date removed from membership"><input type="date" value={f.membership_removed_date || ''} onChange={set('membership_removed_date')} /></Field>
                {f.archive_category === 'death' && <Field label="Date deceased"><input type="date" value={f.deceased_date || ''} onChange={set('deceased_date')} /></Field>}
                <Field label="Note" wide><input value={f.archive_reason || ''} onChange={set('archive_reason')} /></Field>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={() => save()} disabled={saving}>Save changes</button>
                <button className="btn btn-secondary" onClick={restore} disabled={saving}>Restore as active</button>
              </div>
            </div>
          )}
        </div>
      )}

      {Object.keys(extra).length > 0 && (
        <details className="card" style={{ marginBottom: 14 }}>
          <summary style={{ fontWeight: 600, cursor: 'pointer' }}>More from Breeze ({Object.keys(extra).length})</summary>
          <table className="data-table" style={{ marginTop: 8 }}>
            <tbody>{Object.entries(extra).map(([k, v]) => <tr key={k}><td style={{ color: 'var(--gray-600)', width: '40%' }}>{k}</td><td>{v}</td></tr>)}</tbody>
          </table>
        </details>
      )}
    </div>
  )
}

/* ------------------------------------------------------- why people left */

function WhyLeft({ people }) {
  const [year, setYear] = useState('all')
  const left = people.filter(p => !p.is_active && p.person_type !== 'organization')
  const yearOf = (p) => (p.deceased_date || p.membership_removed_date || '').slice(0, 4) || null
  const years = [...new Set(left.map(yearOf).filter(Boolean))].sort().reverse()
  const inYear = year === 'all' ? left : year === 'none' ? left.filter(p => !yearOf(p)) : left.filter(p => yearOf(p) === year)
  const counts = {}
  for (const p of inYear) counts[p.archive_category || 'unknown'] = (counts[p.archive_category || 'unknown'] || 0) + 1
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ width: 200 }}><label className="form-label">Year they left</label>
          <select value={year} onChange={e => setYear(e.target.value)}>
            <option value="all">All years</option>
            {years.map(y => <option key={y}>{y}</option>)}
            <option value="none">No date recorded</option>
          </select></div>
        <div style={{ fontSize: 13, color: 'var(--gray-600)', flex: 1 }}>{inYear.length} people · {people.filter(p => p.is_active && p.person_type !== 'organization').length} active now</div>
      </div>
      <div className="card" style={{ overflowX: 'auto' }}>
        {rows.length === 0 ? <div style={{ color: 'var(--gray-600)' }}>No one left in this period.</div> : (
          <table className="data-table">
            <thead><tr><th>Reason</th><th style={{ textAlign: 'right' }}>People</th><th style={{ textAlign: 'right' }}>Members</th></tr></thead>
            <tbody>{rows.map(([k, n]) => (
              <tr key={k}><td>{LEFT_LABELS[k] || k}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{n}</td>
                <td style={{ textAlign: 'right' }}>{inYear.filter(p => (p.archive_category || 'unknown') === k && (p.person_type === 'member' || p.umc_status)).length}</td></tr>))}</tbody>
          </table>
        )}
      </div>
      {counts.unknown > 0 && (
        <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 10 }}>
          "Reason not recorded" means Breeze archived them without a reason. Open a person on the People tab to fill it in.
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------ duplicates */

function Duplicates({ people, families, links, onChanged, onOpen }) {
  const [pairs, setPairs] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [confirm, setConfirm] = useState(null) // { key, keepId, dropId }
  const [done, setDone] = useState(0)
  const byId = useMemo(() => Object.fromEntries(people.map(p => [p.id, p])), [people])
  const famName = (id) => families.find(f => f.id === id)?.family_name

  async function find() {
    setErr('')
    const { data, error } = await supabase.rpc('find_duplicate_people')
    if (error) return setErr(error.message)
    setPairs(data)
  }
  useEffect(() => { find() }, [people])

  async function merge(keepId, dropId) {
    setBusy(keepId + dropId); setErr('')
    const { error } = await supabase.rpc('merge_duplicate_people', { p_primary_id: keepId, p_duplicate_id: dropId })
    setBusy(''); setConfirm(null)
    if (error) return setErr(error.message)
    setDone(n => n + 1)
    await onChanged()
  }
  async function notSame(a, b) {
    setBusy(a + b); setErr('')
    const [x, y] = a < b ? [a, b] : [b, a]
    const { error } = await supabase.from('people_not_duplicates').insert({ a: x, b: y })
    setBusy('')
    if (error) return setErr(error.message)
    setPairs(ps => ps.filter(p => !(p.a_id === a && p.b_id === b)))
  }

  if (!pairs) return err ? <div className="card" style={{ color: 'var(--danger)' }}>{err}</div> : <div className="spinner" />

  const rows = (p) => [
    ['Status', p.is_active ? 'Active' : `Archived${p.archive_category ? ' — ' + (LEFT_LABELS[p.archive_category] || p.archive_category) : ''}`],
    ['Type', TYPE_LABELS[p.person_type] || p.person_type],
    ['Membership', [p.umc_status, p.membership_date && `since ${p.membership_date}`].filter(Boolean).join(' ')],
    ['Birthday', p.birthdate],
    ['Email', p.email],
    ['Phone', p.phone || p.home_phone],
    ['Address', [p.street, p.city, p.state, p.zip].filter(Boolean).join(', ')],
    ['Family', famName(p.family_id)],
    ['Tags', links.filter(l => l.person_id === p.id).length || ''],
    ['Breeze ID', p.breeze_id],
  ]

  return (
    <div>
      <div className="card" style={{ marginBottom: 14, fontSize: 14, lineHeight: 1.5 }}>
        <strong>{pairs.length} possible {pairs.length === 1 ? 'duplicate' : 'duplicates'}</strong>
        {done > 0 && <span style={{ color: 'var(--success, #2e7d32)' }}> · {done} merged this visit</span>}
        <div style={{ color: 'var(--gray-600)', fontSize: 13, marginTop: 4 }}>
          Pick the record to keep. The other one is folded into it: its tags, attendance, classes and follow-up history move over,
          and any blank details on the kept record (address, email, birthday, membership) are filled in from it. Nothing the kept record
          already has is overwritten. Merging can't be undone, so if two people just share a name, choose "Not the same person".
        </div>
      </div>
      {err && <div className="card" style={{ color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}
      {pairs.length === 0 && <div className="card" style={{ color: 'var(--gray-600)' }}>No possible duplicates left. 🎉</div>}
      {pairs.map(pr => {
        const a = byId[pr.a_id], b = byId[pr.b_id]
        if (!a || !b) return null
        const key = pr.a_id + pr.b_id
        const ra = rows(a), rb = rows(b)
        return (
          <div key={key} className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--wine, #7A0047)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>{pr.reason}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              {[[a, ra, b], [b, rb, a]].map(([p, r, other], side) => (
                <div key={p.id} style={{ border: '1px solid var(--gray-200, #ddd)', borderRadius: 8, padding: 12 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
                    <a href="#" onClick={e => { e.preventDefault(); onOpen(p) }} style={{ color: 'inherit' }}>
                      {[p.first_name, p.middle_name, p.last_name, p.suffix].filter(Boolean).join(' ')}
                    </a>
                    {p.preferred_name && <span style={{ fontWeight: 400, color: 'var(--gray-600)' }}> ({p.preferred_name})</span>}
                  </div>
                  <table style={{ fontSize: 13, width: '100%' }}><tbody>
                    {r.map(([label, v], i) => {
                      const ov = (side === 0 ? rb : ra)[i][1]
                      const differs = v && ov && String(v) !== String(ov)
                      return (
                        <tr key={label}>
                          <td style={{ color: 'var(--gray-600)', paddingRight: 8, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}</td>
                          <td style={{ fontWeight: differs ? 600 : 400, color: v ? 'inherit' : 'var(--gray-400, #aaa)' }}>{v || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody></table>
                  {confirm?.key === key && confirm.keepId === p.id ? (
                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => merge(p.id, other.id)}>
                        {busy === p.id + other.id ? 'Merging…' : 'Yes, merge into this one'}
                      </button>
                      <button className="btn btn-sm btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button className="btn btn-sm btn-secondary" style={{ marginTop: 10 }} disabled={!!busy}
                      onClick={() => setConfirm({ key, keepId: p.id })}>Keep this one</button>
                  )}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, textAlign: 'right' }}>
              <button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={() => notSame(pr.a_id, pr.b_id)}>Not the same person</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
