import { useEffect, useMemo, useState } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '../lib/supabase.js'

// Attendance — take attendance for any church calendar event (by name, by
// headcount, or both), review self check-ins, and pull the year report.
// Data: events (church calendar) → attendance_events (one per event)
//       → attendance_checkins (one per person, status approved/pending/declined).

const TYPE_BY_CATEGORY = {
  worship: 'sunday_service', education: 'sunday_school', meeting: 'meeting',
  other_meetings: 'meeting', fellowship: 'fellowship', missions: 'outreach', general: 'special_event',
}
const TYPE_LABELS = {
  sunday_service: 'Worship', online_service: 'Online worship', sunday_school: 'Sunday School',
  bible_study: 'Bible Study', workshop: 'Workshop', meeting: 'Meeting', fellowship: 'Fellowship',
  outreach: 'Outreach', special_event: 'Special event', other: 'Other',
}

const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const fmtDate = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const personName = (p) => p ? `${p.preferred_name || p.first_name} ${p.last_name}`.trim() : ''
const sortKey = (p) => `${p.last_name} ${p.first_name}`.toLowerCase()

export default function Attendance() {
  const [tab, setTab] = useState('take')
  const [openEvent, setOpenEvent] = useState(null) // { calendar event or attendance_event }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Attendance</div>
          <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 2 }}>Who came to each event, and the year report for the board</div>
        </div>
        {!openEvent && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn btn-sm ${tab === 'take' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('take')}>Take Attendance</button>
            <button className={`btn btn-sm ${tab === 'review' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('review')}>To Review</button>
            <button className={`btn btn-sm ${tab === 'report' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('report')}>Year Report</button>
          </div>
        )}
      </div>
      <div className="page-body">
        {openEvent
          ? <EventAttendance target={openEvent} onBack={() => setOpenEvent(null)} />
          : tab === 'take' ? <EventPicker onOpen={setOpenEvent} />
          : tab === 'review' ? <ReviewQueue />
          : <YearReport />}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- pick event */

function EventPicker({ onOpen }) {
  const [from, setFrom] = useState(iso(addDays(new Date(), -21)))
  const [to, setTo] = useState(iso(addDays(new Date(), 7)))
  const [events, setEvents] = useState([])
  const [att, setAtt] = useState({}) // calendar_event_id → attendance_event (+count)
  const [extra, setExtra] = useState([]) // attendance_events not tied to the calendar
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  async function load() {
    setLoading(true); setError('')
    const [{ data: ev, error: e1 }, { data: ae, error: e2 }] = await Promise.all([
      supabase.from('events').select('id, event_name, event_date, event_time, category, location')
        .gte('event_date', from).lte('event_date', to).or('status.is.null,status.neq.rejected')
        .order('event_date', { ascending: false }).order('event_time', { ascending: true }),
      supabase.from('attendance_events').select('id, event_name, event_date, event_type, calendar_event_id, headcount, guest_count, source_app, attendance_checkins(count)')
        .gte('event_date', from).lte('event_date', to).order('event_date', { ascending: false }),
    ])
    if (e1 || e2) setError((e1 || e2).message)
    const byCal = {}; const others = []
    for (const a of ae || []) (a.calendar_event_id ? (byCal[a.calendar_event_id] = a) : others.push(a))
    setEvents(ev || []); setAtt(byCal); setExtra(others); setLoading(false)
  }
  useEffect(() => { load() }, [from, to])

  const rows = [
    ...events.map(e => ({ key: e.id, kind: 'calendar', date: e.event_date, name: e.event_name, time: e.event_time, type: TYPE_BY_CATEGORY[e.category] || 'other', att: att[e.id], event: e })),
    ...extra.map(a => ({ key: a.id, kind: 'extra', date: a.event_date, name: a.event_name, type: a.event_type, att: a })),
  ].sort((a, b) => b.date.localeCompare(a.date) || (a.time || '').localeCompare(b.time || ''))

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ flex: '1 1 140px' }}><label className="form-label">From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div style={{ flex: '1 1 140px' }}><label className="form-label">To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <button className="btn btn-secondary" onClick={() => setShowAdd(s => !s)}>+ Event not on the calendar</button>
      </div>

      {showAdd && <AddOtherEvent onCreated={(a) => { setShowAdd(false); onOpen({ kind: 'extra', att: a }) }} />}
      {error && <div className="card" style={{ color: 'var(--danger)', marginBottom: 12 }}>Couldn't load events: {error}</div>}
      {loading ? <div className="spinner" /> : rows.length === 0 ? (
        <div className="card" style={{ color: 'var(--gray-600)' }}>No events between these dates.</div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map(r => {
            const named = r.att?.attendance_checkins?.[0]?.count || 0
            const total = r.att ? totalOf(r.att, named) : null
            return (
              <button key={r.key} className="card" onClick={() => onOpen(r)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', padding: '12px 16px', cursor: 'pointer' }}>
                <div style={{ width: 54, textAlign: 'center', flex: 'none' }}>
                  <div style={{ fontSize: 11, color: 'var(--gray-600)', textTransform: 'uppercase' }}>{new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--burgundy)', lineHeight: 1 }}>{new Date(r.date + 'T12:00:00').getDate()}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{[r.time, TYPE_LABELS[r.type]].filter(Boolean).join(' · ')}</div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  {total === null
                    ? <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>Not taken</span>
                    : <><div style={{ fontSize: 20, fontWeight: 700, color: 'var(--success)' }}>{total}</div><div style={{ fontSize: 11, color: 'var(--gray-600)' }}>attended</div></>}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function totalOf(a, named) {
  if (a.guest_count != null) return named + a.guest_count
  return Math.max(a.headcount || 0, named)
}

function AddOtherEvent({ onCreated }) {
  const [f, setF] = useState({ event_name: '', event_date: iso(new Date()), event_type: 'special_event' })
  const [err, setErr] = useState('')
  async function save() {
    if (!f.event_name.trim()) return setErr('Give the event a name.')
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.from('attendance_events')
      .insert([{ ...f, event_name: f.event_name.trim(), source_app: 'planning_attendance', created_by: user?.id }]).select().single()
    if (error) return setErr(error.message)
    onCreated(data)
  }
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 600, marginBottom: 10 }}>Event not on the church calendar</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div><label className="form-label">Name</label><input value={f.event_name} onChange={e => setF({ ...f, event_name: e.target.value })} placeholder="e.g. Trunk or Treat" /></div>
        <div><label className="form-label">Date</label><input type="date" value={f.event_date} onChange={e => setF({ ...f, event_date: e.target.value })} /></div>
        <div><label className="form-label">Kind</label>
          <select value={f.event_type} onChange={e => setF({ ...f, event_type: e.target.value })}>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
      </div>
      {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{err}</div>}
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>Create and take attendance</button>
    </div>
  )
}

/* ------------------------------------------------------------- one event */

function EventAttendance({ target, onBack }) {
  const [ae, setAe] = useState(null)
  const [people, setPeople] = useState([])
  const [checkins, setCheckins] = useState([])
  const [guests, setGuests] = useState(0)
  const [guestsDirty, setGuestsDirty] = useState(false)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [signups, setSignups] = useState(null)
  const [newPerson, setNewPerson] = useState(null)

  // Make sure there's an attendance record for this event, then load it.
  useEffect(() => { (async () => {
    setError('')
    let rec = target.att
    if (!rec && target.kind === 'calendar') {
      const e = target.event
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.from('attendance_events').upsert([{
        calendar_event_id: e.id, event_name: e.event_name, event_date: e.event_date,
        event_type: TYPE_BY_CATEGORY[e.category] || 'other', source_app: 'planning_attendance', created_by: user?.id,
      }], { onConflict: 'calendar_event_id' }).select().single()
      if (error) return setError(error.message)
      rec = data
    }
    const [{ data: full, error: e1 }, { data: ppl, error: e2 }, { data: ci, error: e3 }] = await Promise.all([
      supabase.from('attendance_events').select('*').eq('id', rec.id).single(),
      supabase.from('people').select('id, first_name, last_name, preferred_name, email, person_type, family_id, is_active').eq('is_active', true),
      supabase.from('attendance_checkins').select('*').eq('attendance_event_id', rec.id),
    ])
    if (e1 || e2 || e3) return setError((e1 || e2 || e3).message)
    setAe(full); setPeople((ppl || []).sort((a, b) => sortKey(a).localeCompare(sortKey(b)))); setCheckins(ci || [])
    const named = (ci || []).filter(c => c.status === 'approved').length
    setGuests(full.guest_count ?? Math.max(0, (full.headcount || 0) - named))
  })() }, [target])

  const approved = checkins.filter(c => c.status === 'approved')
  const pending = checkins.filter(c => c.status === 'pending')
  const byPerson = useMemo(() => Object.fromEntries(checkins.filter(c => c.person_id).map(c => [c.person_id, c])), [checkins])
  const pById = useMemo(() => Object.fromEntries(people.map(p => [p.id, p])), [people])
  const total = approved.length + (Number(guests) || 0)

  async function syncHeadcount(nextCheckins, nextGuests = guests) {
    const named = nextCheckins.filter(c => c.status === 'approved').length
    const g = Number(nextGuests) || 0
    const { error } = await supabase.from('attendance_events').update({ guest_count: g, headcount: named + g }).eq('id', ae.id)
    if (error) setError(error.message)
  }

  async function toggle(p) {
    setBusy(p.id); setError('')
    const existing = byPerson[p.id]
    let next
    if (existing && existing.status === 'approved') {
      const { error } = await supabase.from('attendance_checkins').delete().eq('id', existing.id)
      if (error) { setBusy(''); return setError(error.message) }
      next = checkins.filter(c => c.id !== existing.id)
    } else if (existing) {
      const { data, error } = await supabase.from('attendance_checkins').update({ status: 'approved' }).eq('id', existing.id).select().single()
      if (error) { setBusy(''); return setError(error.message) }
      next = checkins.map(c => c.id === data.id ? data : c)
    } else {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.from('attendance_checkins').insert([{
        attendance_event_id: ae.id, person_id: p.id, mode: ae.event_type === 'online_service' ? 'online' : 'in_person',
        source: 'leader', status: 'approved', checked_in_by: user?.email || null,
      }]).select().single()
      if (error) { setBusy(''); return setError(error.message) }
      next = [...checkins, data]
    }
    setCheckins(next); await syncHeadcount(next); setBusy('')
  }

  async function saveGuests() {
    setGuestsDirty(false); await syncHeadcount(checkins, guests)
  }

  async function loadSignups() {
    if (!ae.calendar_event_id) return setSignups([])
    const { data, error } = await supabase.from('volunteer_signups')
      .select('id, volunteer_name, volunteer_email, quantity, status, volunteer_roles!inner(role_name, role_type, event_id)')
      .eq('volunteer_roles.event_id', ae.calendar_event_id).neq('status', 'canceled')
    if (error) return setError(error.message)
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '')
    setSignups((data || []).map(s => {
      const byEmail = s.volunteer_email && people.find(p => p.email && p.email.toLowerCase() === s.volunteer_email.toLowerCase())
      const byName = people.find(p => norm(`${p.first_name}${p.last_name}`) === norm(s.volunteer_name) || norm(`${p.preferred_name}${p.last_name}`) === norm(s.volunteer_name))
      return { ...s, match: byEmail || byName || null }
    }))
  }

  async function addPerson() {
    const f = newPerson
    if (!f.first_name.trim() || !f.last_name.trim()) return setError('First and last name are both needed.')
    const { data, error } = await supabase.from('people').insert([{
      first_name: f.first_name.trim(), last_name: f.last_name.trim(), email: f.email.trim() || null, person_type: 'visitor',
    }]).select('id, first_name, last_name, preferred_name, email, person_type, family_id, is_active').single()
    if (error) return setError(error.message)
    setPeople(ps => [...ps, data].sort((a, b) => sortKey(a).localeCompare(sortKey(b))))
    setNewPerson(null); await toggle(data)
  }

  if (error && !ae) return <div className="card" style={{ color: 'var(--danger)' }}>Couldn't open this event: {error} <button className="btn btn-sm btn-secondary" onClick={onBack}>Back</button></div>
  if (!ae) return <div className="spinner" />

  const needle = q.trim().toLowerCase()
  const shown = needle
    ? people.filter(p => `${p.first_name} ${p.preferred_name || ''} ${p.last_name}`.toLowerCase().includes(needle))
    : people

  return (
    <div>
      <button className="btn btn-sm btn-secondary" onClick={onBack} style={{ marginBottom: 12 }}>← All events</button>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, color: 'var(--burgundy)', fontWeight: 700 }}>{ae.event_name}</div>
          <div style={{ fontSize: 13, color: 'var(--gray-600)' }}>{fmtDate(ae.event_date)} · {TYPE_LABELS[ae.event_type] || ae.event_type}</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: 'var(--burgundy)', lineHeight: 1 }}>{total}</div>
          <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>attended</div>
          <div style={{ fontSize: 11, color: 'var(--gray-400)' }}>{approved.length} by name + {Number(guests) || 0} counted</div>
        </div>
      </div>

      {error && <div className="card" style={{ color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <label className="form-label">Counted, not by name (guests, children, or a headcount-only event)</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 360 }}>
          <button className="btn btn-secondary btn-lg" onClick={() => { setGuests(g => Math.max(0, (Number(g) || 0) - 1)); setGuestsDirty(true) }}>−</button>
          <input type="number" min="0" inputMode="numeric" value={guests} style={{ textAlign: 'center', fontSize: 20, fontWeight: 700 }}
            onChange={e => { setGuests(e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value, 10) || 0)); setGuestsDirty(true) }} />
          <button className="btn btn-secondary btn-lg" onClick={() => { setGuests(g => (Number(g) || 0) + 1); setGuestsDirty(true) }}>+</button>
          <button className="btn btn-primary" disabled={!guestsDirty} onClick={saveGuests} style={{ opacity: guestsDirty ? 1 : 0.5 }}>Save</button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--warning)', background: 'var(--warning-light)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Checked themselves in — waiting for review ({pending.length})</div>
          {pending.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <span style={{ flex: 1 }}>{personName(pById[c.person_id]) || c.guest_name}</span>
              <button className="btn btn-sm btn-primary" onClick={() => pById[c.person_id] && toggle(pById[c.person_id])}>Approve</button>
              <button className="btn btn-sm btn-danger" onClick={async () => {
                const { error } = await supabase.from('attendance_checkins').update({ status: 'declined' }).eq('id', c.id)
                if (error) return setError(error.message)
                setCheckins(cs => cs.map(x => x.id === c.id ? { ...x, status: 'declined' } : x))
              }}>Decline</button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input placeholder="Type a name to find someone…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: '1 1 220px', fontSize: 16 }} />
          {ae.calendar_event_id && <button className="btn btn-secondary" onClick={loadSignups}>From sign-ups</button>}
          <button className="btn btn-secondary" onClick={() => setNewPerson({ first_name: '', last_name: '', email: '' })}>+ New person</button>
        </div>

        {newPerson && (
          <div style={{ background: 'var(--gray-50)', padding: 12, borderRadius: 'var(--radius-sm)', marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <input placeholder="First name" value={newPerson.first_name} onChange={e => setNewPerson({ ...newPerson, first_name: e.target.value })} />
              <input placeholder="Last name" value={newPerson.last_name} onChange={e => setNewPerson({ ...newPerson, last_name: e.target.value })} />
              <input placeholder="Email (optional)" value={newPerson.email} onChange={e => setNewPerson({ ...newPerson, email: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={addPerson}>Add and check in</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setNewPerson(null)}>Cancel</button>
            </div>
          </div>
        )}

        {signups && (
          <div style={{ background: 'var(--burgundy-light)', padding: 12, borderRadius: 'var(--radius-sm)', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Signed up for this event ({signups.length})</div>
            {signups.length === 0 && <div style={{ fontSize: 13, color: 'var(--gray-600)' }}>No sign-ups for this event.</div>}
            {signups.map(s => {
              const here = s.match && byPerson[s.match.id]?.status === 'approved'
              return (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 14 }}>
                  <span style={{ flex: 1 }}>{s.volunteer_name}<span style={{ color: 'var(--gray-600)', fontSize: 12 }}> · {s.volunteer_roles.role_name}{s.quantity > 1 ? ` ×${s.quantity}` : ''}</span></span>
                  {s.match
                    ? <button className={`btn btn-sm ${here ? 'btn-secondary' : 'btn-primary'}`} onClick={() => toggle(s.match)} disabled={busy === s.match.id}>{here ? '✓ Here' : 'Mark here'}</button>
                    : <button className="btn btn-sm btn-secondary" onClick={() => {
                        const [first, ...rest] = (s.volunteer_name || '').trim().split(/\s+/)
                        setNewPerson({ first_name: first || '', last_name: rest.join(' '), email: s.volunteer_email || '' })
                      }}>Add as new person</button>}
                </div>
              )
            })}
            <button className="btn btn-sm btn-secondary" style={{ marginTop: 6 }} onClick={() => setSignups(null)}>Hide</button>
          </div>
        )}

        {people.length === 0 && <div style={{ color: 'var(--gray-600)', fontSize: 14 }}>No people yet. Add someone with <b>+ New person</b>, or use the counted box above.</div>}

        <div style={{ display: 'grid', gap: 6 }}>
          {shown.map(p => {
            const here = byPerson[p.id]?.status === 'approved'
            return (
              <button key={p.id} onClick={() => toggle(p)} disabled={busy === p.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontSize: 16,
                  border: `1.5px solid ${here ? 'var(--success)' : 'var(--gray-200)'}`, background: here ? 'var(--success-light)' : 'var(--white)' }}>
                <span style={{ width: 24, height: 24, borderRadius: 6, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: `2px solid ${here ? 'var(--success)' : 'var(--gray-400)'}`, background: here ? 'var(--success)' : 'transparent', color: 'white', fontWeight: 700 }}>{here ? '✓' : ''}</span>
                <span style={{ flex: 1 }}>{p.last_name}, {p.preferred_name || p.first_name}</span>
                {p.person_type !== 'member' && <span style={{ fontSize: 11, color: 'var(--gray-600)' }}>{p.person_type}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ review queue */

function ReviewQueue() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  async function load() {
    const { data, error } = await supabase.from('attendance_checkins')
      .select('id, guest_name, checked_in_at, attendance_event_id, attendance_events(id, event_name, event_date, guest_count, headcount), people(first_name, last_name, preferred_name)')
      .eq('status', 'pending').order('checked_in_at', { ascending: false })
    if (error) setError(error.message)
    setRows(data || [])
  }
  useEffect(() => { load() }, [])
  async function decide(row, status) {
    const { error } = await supabase.from('attendance_checkins').update({ status }).eq('id', row.id)
    if (error) return setError(error.message)
    if (status === 'approved') {
      const ev = row.attendance_events
      const { count } = await supabase.from('attendance_checkins').select('id', { count: 'exact', head: true })
        .eq('attendance_event_id', ev.id).eq('status', 'approved')
      const g = ev.guest_count ?? 0
      await supabase.from('attendance_events').update({ guest_count: g, headcount: (count || 0) + g }).eq('id', ev.id)
    }
    setRows(rs => rs.filter(r => r.id !== row.id))
  }
  if (!rows) return <div className="spinner" />
  return (
    <div className="card">
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Self check-ins waiting for review</div>
      <div style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 12 }}>When people check themselves in from the Church App, they show here until someone approves them.</div>
      {error && <div style={{ color: 'var(--danger)', marginBottom: 8 }}>{error}</div>}
      {rows.length === 0 ? <div style={{ color: 'var(--gray-600)' }}>Nothing to review.</div> : (
        <table className="data-table">
          <thead><tr><th>Person</th><th>Event</th><th>Checked in</th><th></th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td>{personName(r.people) || r.guest_name}</td>
              <td>{r.attendance_events?.event_name}<div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{r.attendance_events && fmtDate(r.attendance_events.event_date)}</div></td>
              <td style={{ fontSize: 12 }}>{new Date(r.checked_in_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-sm btn-primary" onClick={() => decide(r, 'approved')}>Approve</button>{' '}
                <button className="btn btn-sm btn-danger" onClick={() => decide(r, 'declined')}>Decline</button>
              </td>
            </tr>))}</tbody>
        </table>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- year report */

function YearReport() {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [view, setView] = useState('people')

  useEffect(() => { (async () => {
    setData(null); setError('')
    const from = `${year}-01-01`, to = `${year}-12-31`
    const [{ data: evs, error: e1 }, { data: cis, error: e2 }] = await Promise.all([
      supabase.from('attendance_events').select('id, event_name, event_date, event_type, headcount, guest_count').gte('event_date', from).lte('event_date', to).order('event_date'),
      supabase.from('attendance_report').select('attendance_event_id, event_date, event_type, person_id, first_name, last_name, preferred_name').gte('event_date', from).lte('event_date', to),
    ])
    if (e1 || e2) return setError((e1 || e2).message)
    const namedByEvent = {}
    const byPerson = {}
    for (const c of cis || []) {
      namedByEvent[c.attendance_event_id] = (namedByEvent[c.attendance_event_id] || 0) + 1
      if (!c.person_id) continue
      const p = byPerson[c.person_id] ||= { name: `${c.last_name}, ${c.preferred_name || c.first_name}`, total: 0, types: {}, last: c.event_date }
      p.total++; p.types[c.event_type] = (p.types[c.event_type] || 0) + 1
      if (c.event_date > p.last) p.last = c.event_date
    }
    const events = (evs || []).map(e => {
      const named = namedByEvent[e.id] || 0
      return { ...e, named, total: totalOf(e, named) }
    })
    const people = Object.values(byPerson).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    setData({ events, people })
  })() }, [year])

  async function download() {
    const wb = new ExcelJS.Workbook()
    const head = (ws) => { ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3D0026' } } }
    const types = Object.keys(TYPE_LABELS).filter(t => data.people.some(p => p.types[t]))
    const ws1 = wb.addWorksheet('By person')
    ws1.columns = [{ header: 'Name', width: 28 }, { header: 'Times attended', width: 15 }, ...types.map(t => ({ header: TYPE_LABELS[t], width: 14 })), { header: 'Last attended', width: 14 }]
    data.people.forEach(p => ws1.addRow([p.name, p.total, ...types.map(t => p.types[t] || 0), p.last]))
    head(ws1)
    const ws2 = wb.addWorksheet('By event')
    ws2.columns = [{ header: 'Date', width: 12 }, { header: 'Event', width: 36 }, { header: 'Kind', width: 16 }, { header: 'By name', width: 10 }, { header: 'Counted', width: 10 }, { header: 'Total', width: 10 }]
    data.events.forEach(e => ws2.addRow([e.event_date, e.event_name, TYPE_LABELS[e.event_type] || e.event_type, e.named, e.total - e.named, e.total]))
    head(ws2)
    const buf = await wb.xlsx.writeBuffer()
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a'); a.href = url; a.download = `UMCD Attendance ${year}.xlsx`; a.click(); URL.revokeObjectURL(url)
  }

  const summary = data && {
    events: data.events.length,
    total: data.events.reduce((s, e) => s + e.total, 0),
    people: data.people.length,
    avgWorship: (() => { const w = data.events.filter(e => e.event_type === 'sunday_service'); return w.length ? Math.round(w.reduce((s, e) => s + e.total, 0) / w.length) : 0 })(),
  }

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ width: 120 }}><label className="form-label">Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))}>
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y}>{y}</option>)}
          </select></div>
        <button className={`btn ${view === 'people' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('people')}>By person</button>
        <button className={`btn ${view === 'events' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('events')}>By event</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary" disabled={!data} onClick={download}>⬇ Download Excel</button>
      </div>
      {error && <div className="card" style={{ color: 'var(--danger)' }}>{error}</div>}
      {!data && !error ? <div className="spinner" /> : data && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
          {[['Events', summary.events], ['Total attendance', summary.total], ['People by name', summary.people], ['Average Sunday worship', summary.avgWorship]].map(([l, v]) => (
            <div key={l} className="card" style={{ textAlign: 'center', padding: 14 }}>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--burgundy)' }}>{v}</div>
              <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{l}</div>
            </div>))}
        </div>
        <div className="card" style={{ overflowX: 'auto' }}>
          {view === 'people' ? (
            data.people.length === 0 ? <div style={{ color: 'var(--gray-600)' }}>No one checked in by name this year yet.</div> :
            <table className="data-table">
              <thead><tr><th>Name</th><th style={{ textAlign: 'right' }}>Times</th><th>Last attended</th></tr></thead>
              <tbody>{data.people.map(p => (
                <tr key={p.name + p.last}><td>{p.name}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{p.total}</td><td>{fmtDate(p.last)}</td></tr>))}</tbody>
            </table>
          ) : (
            data.events.length === 0 ? <div style={{ color: 'var(--gray-600)' }}>No attendance taken this year yet.</div> :
            <table className="data-table">
              <thead><tr><th>Date</th><th>Event</th><th style={{ textAlign: 'right' }}>By name</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
              <tbody>{data.events.map(e => (
                <tr key={e.id}><td style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.event_date)}</td><td>{e.event_name}</td>
                  <td style={{ textAlign: 'right' }}>{e.named}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{e.total}</td></tr>))}</tbody>
            </table>
          )}
        </div>
      </>)}
    </div>
  )
}
