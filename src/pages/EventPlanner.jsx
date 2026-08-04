import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const STATUS_COLORS = {
  pending:      { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  approved:     { bg: '#D1FAE5', color: '#065F46', label: 'Approved' },
  denied:       { bg: '#FEE2E2', color: '#991B1B', label: 'Denied' },
  tabled:       { bg: '#F3F4F6', color: '#6B7280', label: 'Tabled' },
  needs_review: { bg: '#DBEAFE', color: '#1E40AF', label: 'Needs Review' },
}

const BLANK_PROPOSAL = {
  event_name: '', event_date: '', event_end_date: '', event_time: '',
  location: '', description: '', organizer: '', expected_attendance: '',
  entry_fee: '', donations_expected: '', costs: '', support_needed: '',
  meeting_id: '', missions_meeting_id: '',
}

const BLANK_PLANNING = {
  theme: '', supplies: [], swag: [], volunteers: [],
  setup_sessions: [], congregation_notes: '', internal_notes: '',
}

export default function EventPlanner({ onPrint }) {
  const [proposals, setProposals] = useState([])
  const [boardMeetings, setBoardMeetings] = useState([])
  const [missionsMeetings, setMissionsMeetings] = useState([])
  const [selected, setSelected] = useState(null)
  const [planning, setPlanning] = useState(null)
  const [loading, setLoading] = useState(true)
  const [planningLoading, setPlanningLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newForm, setNewForm] = useState(BLANK_PROPOSAL)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [sendingToKiosk, setSendingToKiosk] = useState(false)
  const [kioskMsg, setKioskMsg] = useState('')

  const [newSupply, setNewSupply] = useState({ item: '', qty: '', notes: '' })
  const [newSwag, setNewSwag] = useState({ item: '', qty: '', notes: '' })
  const [newVolunteer, setNewVolunteer] = useState({ role: '', count: '', notes: '' })
  const [newSetup, setNewSetup] = useState({ date: '', time: '', task: '', notes: '' })

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    const [{ data: props }, { data: bm }, { data: mm }] = await Promise.all([
      supabase.from('event_proposals').select('*').order('event_date', { ascending: true }),
      supabase.from('board_meetings').select('id, meeting_date').eq('meeting_type', 'one_board').order('meeting_date', { ascending: false }).limit(20),
      supabase.from('board_meetings').select('id, meeting_date').eq('meeting_type', 'missions').order('meeting_date', { ascending: false }).limit(20),
    ])
    setProposals(props || [])
    setBoardMeetings(bm || [])
    setMissionsMeetings(mm || [])
    setLoading(false)
  }

  async function selectProposal(proposal) {
    setSelected(proposal)
    setPlanningLoading(true)
    setSaveMsg('')
    const { data } = await supabase.from('event_planning_details').select('*').eq('proposal_id', proposal.id).single()
    setPlanning(data ? {
      theme: data.theme || '', supplies: data.supplies || [], swag: data.swag || [],
      volunteers: data.volunteers || [], setup_sessions: data.setup_sessions || [],
      congregation_notes: data.congregation_notes || '', internal_notes: data.internal_notes || '',
    } : { ...BLANK_PLANNING })
    setPlanningLoading(false)
  }

  async function sendToKiosk() {
    if (!selected) return
    setSendingToKiosk(true); setKioskMsg('')
    try {
      const res = await fetch('/api/send-to-kiosk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selected.event_name,
          description: selected.description || '',
          event_date: selected.event_date || null,
          event_time: selected.event_time || '',
          location: selected.location || '',
          existingKioskEventId: selected.kiosk_event_id || null,
          signupFields: selected.kiosk_signup_fields || [],
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to send to kiosk')

      // Persist the link so future sends update the same kiosk event instead
      // of creating a duplicate, and so the button correctly shows "Update"
      // next time this event is opened.
      if (json.kioskEventId && json.kioskEventId !== selected.kiosk_event_id) {
        await supabase.from('event_proposals').update({ kiosk_event_id: json.kioskEventId }).eq('id', selected.id)
        setSelected(s => ({ ...s, kiosk_event_id: json.kioskEventId }))
        setProposals(ps => ps.map(p => p.id === selected.id ? { ...p, kiosk_event_id: json.kioskEventId } : p))
      }
      setKioskMsg(json.created ? 'Sent to kiosk!' : 'Updated on kiosk!')
    } catch (err) {
      setKioskMsg('Error: ' + err.message)
    } finally {
      setSendingToKiosk(false)
      setTimeout(() => setKioskMsg(''), 4000)
    }
  }

  async function savePlanning() {
    if (!selected || !planning) return
    setSaving(true); setSaveMsg('')
    const { error } = await supabase.from('event_planning_details').upsert({
      proposal_id: selected.id, ...planning, updated_at: new Date().toISOString(),
    }, { onConflict: 'proposal_id' })
    setSaving(false)
    if (error) setSaveMsg('Error: ' + error.message)
    else { setSaveMsg('Saved!'); setTimeout(() => setSaveMsg(''), 3000) }
  }

  async function submitNewProposal() {
    if (!newForm.event_name.trim()) { setError('Event name is required.'); return }
    setSubmitting(true); setError('')

    const costItems = newForm.costs
      ? newForm.costs.split('\n').filter(Boolean).map(line => ({ description: line }))
      : []

    // Build insert — only include missions_meeting_id if it has a value
    // (column may not exist in all DB states)
    const insertData = {
      event_name:          newForm.event_name.trim(),
      event_date:          newForm.event_date || null,
      event_end_date:      newForm.event_end_date || null,
      event_time:          newForm.event_time || null,
      location:            newForm.location || null,
      description:         newForm.description || null,
      organizer:           newForm.organizer || null,
      expected_attendance: newForm.expected_attendance ? parseInt(newForm.expected_attendance) : null,
      entry_fee:           newForm.entry_fee ? parseFloat(newForm.entry_fee) : null,
      donations_expected:  newForm.donations_expected ? parseFloat(newForm.donations_expected) : null,
      cost_items_json:     costItems,
      support_needed:      newForm.support_needed || null,
      meeting_id:          newForm.meeting_id || null,
      status:              'pending',
    }
    if (newForm.missions_meeting_id) insertData.missions_meeting_id = newForm.missions_meeting_id

    const { data, error: err } = await supabase.from('event_proposals').insert(insertData).select().single()

    if (err) {
      setError('Could not submit: ' + err.message)
      setSubmitting(false)
      return
    }

    setShowNewForm(false)
    setNewForm(BLANK_PROPOSAL)
    setSubmitting(false)
    await loadAll()
    // Auto-open the new proposal for planning
    if (data) selectProposal(data)
  }

  function setPlan(k, v) { setPlanning(p => ({ ...p, [k]: v })) }

  function addSupply()    { if (!newSupply.item.trim()) return; setPlan('supplies', [...(planning.supplies||[]), {...newSupply}]); setNewSupply({ item:'', qty:'', notes:'' }) }
  function removeSupply(i){ setPlan('supplies', planning.supplies.filter((_,idx)=>idx!==i)) }
  function addSwag()      { if (!newSwag.item.trim()) return; setPlan('swag', [...(planning.swag||[]), {...newSwag}]); setNewSwag({ item:'', qty:'', notes:'' }) }
  function removeSwag(i)  { setPlan('swag', planning.swag.filter((_,idx)=>idx!==i)) }
  function addVolunteer() { if (!newVolunteer.role.trim()) return; setPlan('volunteers', [...(planning.volunteers||[]), {...newVolunteer}]); setNewVolunteer({ role:'', count:'', notes:'' }) }
  function removeVolunteer(i){ setPlan('volunteers', planning.volunteers.filter((_,idx)=>idx!==i)) }
  function addSetup()     { if (!newSetup.task.trim()) return; setPlan('setup_sessions', [...(planning.setup_sessions||[]), {...newSetup}]); setNewSetup({ date:'', time:'', task:'', notes:'' }) }
  function removeSetup(i) { setPlan('setup_sessions', planning.setup_sessions.filter((_,idx)=>idx!==i)) }

  const statusStyle = (status) => STATUS_COLORS[status] || STATUS_COLORS.pending
  const fmtDate = (d) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''

  async function deleteProposal(e, proposal) {
    e.stopPropagation()
    if (!confirm(`Permanently delete "${proposal.event_name}"? This removes it from the Board portal too.`)) return
    await supabase.from('event_planning_details').delete().eq('proposal_id', proposal.id)
    await supabase.from('event_proposals').delete().eq('id', proposal.id)
    if (selected?.id === proposal.id) { setSelected(null); setPlanning(null) }
    loadAll()
  }

  const today = new Date().toISOString().slice(0, 10)
  const activeProposals = proposals.filter(p => !p.event_date || p.event_date >= today)
  const completedProposals = proposals.filter(p => p.event_date && p.event_date < today)

  return (
    <div style={{ display:'grid', gridTemplateColumns:'300px 1fr', gap:0, height:'100%', minHeight:'calc(100vh - 60px)' }}>

      {/* LEFT: proposal list */}
      <div style={{ borderRight:'1px solid var(--border)', overflowY:'auto', background:'#fafafa' }}>
        <div style={{ padding:'16px 16px 12px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>Event Proposals</div>
            <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:2 }}>Select to plan</div>
          </div>
          <button className="btn btn-primary" style={{ fontSize:12, padding:'6px 10px' }}
            onClick={() => { setShowNewForm(s=>!s); setSelected(null); setPlanning(null); setError('') }}>
            {showNewForm ? 'Cancel' : '+ New'}
          </button>
        </div>
        {loading ? <div style={{ padding:20, color:'var(--gray-400)', fontSize:13 }}>Loading…</div> : (
          <div>
            {proposals.length === 0 && !showNewForm && (
              <div style={{ padding:20, color:'var(--gray-400)', fontSize:13 }}>No proposals yet. Create one above.</div>
            )}

            {/* Active / Upcoming */}
            {activeProposals.length > 0 && (
              <>
                <div style={{ padding:'8px 16px 4px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--gray-400)', borderBottom:'1px solid var(--border)' }}>
                  Upcoming · {activeProposals.length}
                </div>
                {activeProposals.map(p => <ProposalRow key={p.id} p={p} isSelected={selected?.id === p.id} onSelect={() => { selectProposal(p); setShowNewForm(false) }} onDelete={e => deleteProposal(e, p)} statusStyle={statusStyle} fmtDate={fmtDate} />)}
              </>
            )}

            {/* Completed / Past */}
            {completedProposals.length > 0 && (
              <>
                <div style={{ padding:'10px 16px 4px', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--gray-400)', borderBottom:'1px solid var(--border)', borderTop: activeProposals.length > 0 ? '2px solid var(--border)' : 'none', marginTop: activeProposals.length > 0 ? 8 : 0 }}>
                  Past Events · {completedProposals.length}
                </div>
                {completedProposals.map(p => <ProposalRow key={p.id} p={p} isSelected={selected?.id === p.id} onSelect={() => { selectProposal(p); setShowNewForm(false) }} onDelete={e => deleteProposal(e, p)} statusStyle={statusStyle} fmtDate={fmtDate} faded />)}
              </>
            )}
          </div>
        )}
      </div>

      {/* RIGHT: new form or planning workspace */}
      <div style={{ overflowY:'auto', padding:28 }}>

        {showNewForm && (
          <div>
            <h2 style={{ marginBottom:4 }}>New Event Proposal</h2>
            <p style={{ color:'var(--gray-500)', fontSize:13, marginBottom:16 }}>Submits to the Board portal automatically as "Pending".</p>

            {error && (
              <div style={{ background:'#FEE2E2', color:'#991B1B', padding:'10px 14px', borderRadius:6, marginBottom:16, fontSize:13, fontWeight:600 }}>
                ⚠ {error}
              </div>
            )}

            <Section title="Event Details">
              <Field label="Event Name *">
                <input className="form-input" value={newForm.event_name} onChange={e => setNewForm(f=>({...f,event_name:e.target.value}))} placeholder="e.g. Fall Harvest Festival" autoFocus />
              </Field>
              <Grid cols={2}>
                <Field label="Start Date"><input type="date" className="form-input" value={newForm.event_date} onChange={e => setNewForm(f=>({...f,event_date:e.target.value}))} /></Field>
                <Field label="End Date (multi-day)"><input type="date" className="form-input" value={newForm.event_end_date} min={newForm.event_date} onChange={e => setNewForm(f=>({...f,event_end_date:e.target.value}))} /></Field>
              </Grid>
              <Grid cols={2}>
                <Field label="Time"><input className="form-input" value={newForm.event_time} onChange={e => setNewForm(f=>({...f,event_time:e.target.value}))} placeholder="e.g. 2:00–5:00 PM" /></Field>
                <Field label="Location"><input className="form-input" value={newForm.location} onChange={e => setNewForm(f=>({...f,location:e.target.value}))} placeholder="e.g. Church Parking Lot" /></Field>
              </Grid>
              <Field label="Description / Purpose">
                <textarea className="form-textarea" rows={3} value={newForm.description} onChange={e => setNewForm(f=>({...f,description:e.target.value}))} placeholder="What is this event and what is its purpose?" />
              </Field>
              <Grid cols={2}>
                <Field label="Organizing Committee / Person"><input className="form-input" value={newForm.organizer} onChange={e => setNewForm(f=>({...f,organizer:e.target.value}))} /></Field>
                <Field label="Expected Attendance"><input type="number" className="form-input" value={newForm.expected_attendance} onChange={e => setNewForm(f=>({...f,expected_attendance:e.target.value}))} placeholder="e.g. 75" /></Field>
              </Grid>
            </Section>

            <Section title="Financials">
              <Grid cols={2}>
                <Field label="Entry Fee"><input className="form-input" value={newForm.entry_fee} onChange={e => setNewForm(f=>({...f,entry_fee:e.target.value}))} placeholder="Leave blank if free" /></Field>
                <Field label="Expected Donations / Fundraising"><input className="form-input" value={newForm.donations_expected} onChange={e => setNewForm(f=>({...f,donations_expected:e.target.value}))} placeholder="e.g. 200.00" /></Field>
              </Grid>
              <Field label="Cost Breakdown (one item per line)">
                <textarea className="form-textarea" rows={4} value={newForm.costs} onChange={e => setNewForm(f=>({...f,costs:e.target.value}))} placeholder={"Supplies: $50\nFood: $150\nDecor: $30"} />
              </Field>
            </Section>

            <Section title="Board Support">
              <Field label="Support Needed from Board">
                <textarea className="form-textarea" rows={3} value={newForm.support_needed} onChange={e => setNewForm(f=>({...f,support_needed:e.target.value}))} placeholder="Volunteers, budget approval, facilities use…" />
              </Field>
              <Grid cols={2}>
                <Field label="Bring to One Board Meeting">
                  <select className="form-select" value={newForm.meeting_id} onChange={e => setNewForm(f=>({...f,meeting_id:e.target.value}))}>
                    <option value="">None / Not yet scheduled</option>
                    {boardMeetings.map(m => <option key={m.id} value={m.id}>{fmtDate(m.meeting_date)} — One Board</option>)}
                  </select>
                </Field>
                <Field label="Bring to Missions Meeting">
                  <select className="form-select" value={newForm.missions_meeting_id} onChange={e => setNewForm(f=>({...f,missions_meeting_id:e.target.value}))}>
                    <option value="">None / Not yet scheduled</option>
                    {missionsMeetings.map(m => <option key={m.id} value={m.id}>{fmtDate(m.meeting_date)} — Missions</option>)}
                  </select>
                  <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:4 }}>Most events get approved here</div>
                </Field>
              </Grid>
            </Section>

            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-primary" onClick={submitNewProposal} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit Proposal to Board'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setShowNewForm(false); setError('') }}>Cancel</button>
            </div>
          </div>
        )}

        {selected && !showNewForm && (
          <div>
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:20, gap:16 }}>
              <div>
                <h2 style={{ marginBottom:4 }}>{selected.event_name}</h2>
                <div style={{ fontSize:13, color:'var(--gray-500)' }}>
                  {fmtDate(selected.event_date)}{selected.event_end_date && selected.event_end_date !== selected.event_date ? ` – ${fmtDate(selected.event_end_date)}` : ''}
                  {selected.location ? ` · ${selected.location}` : ''}
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
                {(() => { const s = statusStyle(selected.status); return (
                  <span style={{ fontSize:12, fontWeight:700, padding:'4px 12px', borderRadius:12, background:s.bg, color:s.color }}>Board: {s.label}</span>
                )})()}
                {onPrint && (
                  <button className="btn btn-secondary" style={{ padding:'8px 16px' }} onClick={() => onPrint(selected.id)}>
                    🖨 Print
                  </button>
                )}
                <button className="btn btn-secondary" style={{ padding:'8px 16px' }} onClick={sendToKiosk} disabled={sendingToKiosk}>
                  {sendingToKiosk ? 'Sending…' : selected.kiosk_event_id ? '🔄 Update on Kiosk' : '📤 Send to Kiosk'}
                </button>
                {kioskMsg && <span style={{ fontSize:12, color: kioskMsg.startsWith('Error') ? '#dc2626':'#059669', fontWeight:600 }}>{kioskMsg}</span>}
                <button className="btn btn-primary" style={{ padding:'8px 18px' }} onClick={savePlanning} disabled={saving||planningLoading}>
                  {saving ? 'Saving…' : 'Save Plan'}
                </button>
                {saveMsg && <span style={{ fontSize:12, color: saveMsg.startsWith('Error') ? '#dc2626':'#059669', fontWeight:600 }}>{saveMsg}</span>}
              </div>
            </div>

            <Section title="Proposal Summary" subtitle="From the board submission">
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                {[['Organizer',selected.organizer],['Expected Attendance',selected.expected_attendance],['Time',selected.event_time],
                  ['Entry Fee',selected.entry_fee?`$${selected.entry_fee}`:null],['Expected Donations',selected.donations_expected?`$${selected.donations_expected}`:null],
                ].filter(([,v])=>v).map(([label,val])=>(
                  <div key={label}>
                    <div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--gray-400)', fontWeight:600, marginBottom:2 }}>{label}</div>
                    <div style={{ fontSize:13 }}>{val}</div>
                  </div>
                ))}
              </div>
              {selected.description && <div style={{ marginTop:12 }}><div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--gray-400)', fontWeight:600, marginBottom:2 }}>Description</div><div style={{ fontSize:13, lineHeight:1.6 }}>{selected.description}</div></div>}
              {selected.support_needed && <div style={{ marginTop:12 }}><div style={{ fontSize:10, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--gray-400)', fontWeight:600, marginBottom:2 }}>Board Support Needed</div><div style={{ fontSize:13, lineHeight:1.6 }}>{selected.support_needed}</div></div>}
            </Section>

            {planningLoading ? <div style={{ color:'var(--gray-400)', fontSize:13 }}>Loading planning details…</div> : planning && (
              <>
                <Section title="Event Theme">
                  <Field label="Theme / Concept">
                    <input className="form-input" value={planning.theme} onChange={e => setPlan('theme',e.target.value)} placeholder="e.g. Harvest Festival, Community Pride…" />
                  </Field>
                </Section>

                <Section title="Setup Days & Times" subtitle="For builds that need extra prep (parade floats, large setups, etc.)">
                  {(planning.setup_sessions||[]).length > 0 && <PlanTable headers={['Date','Time','Task','Notes','']} rows={(planning.setup_sessions||[]).map((s,i)=>[s.date,s.time,s.task,s.notes,<Rm onClick={()=>removeSetup(i)}/>])} />}
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 2fr 2fr auto', gap:8, alignItems:'end' }}>
                    <Field label="Date"><input type="date" className="form-input" value={newSetup.date} onChange={e=>setNewSetup(s=>({...s,date:e.target.value}))} /></Field>
                    <Field label="Time"><input className="form-input" value={newSetup.time} onChange={e=>setNewSetup(s=>({...s,time:e.target.value}))} placeholder="9 AM" /></Field>
                    <Field label="Task"><input className="form-input" value={newSetup.task} onChange={e=>setNewSetup(s=>({...s,task:e.target.value}))} placeholder="Float build" /></Field>
                    <Field label="Notes"><input className="form-input" value={newSetup.notes} onChange={e=>setNewSetup(s=>({...s,notes:e.target.value}))} placeholder="Optional" /></Field>
                    <div style={{ paddingBottom:1 }}><button className="btn btn-secondary" onClick={addSetup}>+ Add</button></div>
                  </div>
                </Section>

                <Section title="Supplies Needed">
                  {(planning.supplies||[]).length > 0 && <PlanTable headers={['Item','Qty','Notes','']} rows={(planning.supplies||[]).map((s,i)=>[s.item,s.qty,s.notes,<Rm onClick={()=>removeSupply(i)}/>])} />}
                  <div style={{ display:'grid', gridTemplateColumns:'3fr 1fr 3fr auto', gap:8, alignItems:'end' }}>
                    <Field label="Item"><input className="form-input" value={newSupply.item} onChange={e=>setNewSupply(s=>({...s,item:e.target.value}))} placeholder="e.g. Tables" /></Field>
                    <Field label="Qty"><input className="form-input" value={newSupply.qty} onChange={e=>setNewSupply(s=>({...s,qty:e.target.value}))} placeholder="6" /></Field>
                    <Field label="Notes"><input className="form-input" value={newSupply.notes} onChange={e=>setNewSupply(s=>({...s,notes:e.target.value}))} placeholder="Optional" /></Field>
                    <div style={{ paddingBottom:1 }}><button className="btn btn-secondary" onClick={addSupply}>+ Add</button></div>
                  </div>
                </Section>

                <Section title="Swag & Merchandise">
                  {(planning.swag||[]).length > 0 && <PlanTable headers={['Item','Qty','Notes','']} rows={(planning.swag||[]).map((s,i)=>[s.item,s.qty,s.notes,<Rm onClick={()=>removeSwag(i)}/>])} />}
                  <div style={{ display:'grid', gridTemplateColumns:'3fr 1fr 3fr auto', gap:8, alignItems:'end' }}>
                    <Field label="Item"><input className="form-input" value={newSwag.item} onChange={e=>setNewSwag(s=>({...s,item:e.target.value}))} placeholder="e.g. T-shirts" /></Field>
                    <Field label="Qty"><input className="form-input" value={newSwag.qty} onChange={e=>setNewSwag(s=>({...s,qty:e.target.value}))} placeholder="50" /></Field>
                    <Field label="Notes"><input className="form-input" value={newSwag.notes} onChange={e=>setNewSwag(s=>({...s,notes:e.target.value}))} placeholder="Optional" /></Field>
                    <div style={{ paddingBottom:1 }}><button className="btn btn-secondary" onClick={addSwag}>+ Add</button></div>
                  </div>
                </Section>

                <Section title="Volunteers Needed">
                  {(planning.volunteers||[]).length > 0 && <PlanTable headers={['Role','# Needed','Notes','']} rows={(planning.volunteers||[]).map((v,i)=>[v.role,v.count,v.notes,<Rm onClick={()=>removeVolunteer(i)}/>])} />}
                  <div style={{ display:'grid', gridTemplateColumns:'3fr 1fr 3fr auto', gap:8, alignItems:'end' }}>
                    <Field label="Role"><input className="form-input" value={newVolunteer.role} onChange={e=>setNewVolunteer(v=>({...v,role:e.target.value}))} placeholder="e.g. Greeter" /></Field>
                    <Field label="Count"><input className="form-input" value={newVolunteer.count} onChange={e=>setNewVolunteer(v=>({...v,count:e.target.value}))} placeholder="4" /></Field>
                    <Field label="Notes"><input className="form-input" value={newVolunteer.notes} onChange={e=>setNewVolunteer(v=>({...v,notes:e.target.value}))} placeholder="Optional" /></Field>
                    <div style={{ paddingBottom:1 }}><button className="btn btn-secondary" onClick={addVolunteer}>+ Add</button></div>
                  </div>
                </Section>

                <Section title="Congregation Communication" subtitle="What to share in bulletins and announcements">
                  <Field label="What to Expect / Announcement Copy">
                    <textarea className="form-textarea" rows={5} value={planning.congregation_notes} onChange={e=>setPlan('congregation_notes',e.target.value)} placeholder="Join us for our annual Fall Harvest Festival!…" />
                  </Field>
                </Section>

                <Section title="Internal Planning Notes" subtitle="Staff only — not shared anywhere">
                  <Field label="Notes">
                    <textarea className="form-textarea" rows={4} value={planning.internal_notes} onChange={e=>setPlan('internal_notes',e.target.value)} placeholder="Vendor contacts, reminders, follow-ups…" />
                  </Field>
                </Section>

                <div style={{ display:'flex', gap:10, alignItems:'center', paddingBottom:40 }}>
                  <button className="btn btn-primary" style={{ padding:'10px 24px' }} onClick={savePlanning} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Plan'}
                  </button>
                  {saveMsg && <span style={{ fontSize:13, color:saveMsg.startsWith('Error')?'#dc2626':'#059669', fontWeight:600 }}>{saveMsg}</span>}
                </div>
              </>
            )}
          </div>
        )}

        {!selected && !showNewForm && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:300, color:'var(--gray-400)', textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📅</div>
            <div style={{ fontWeight:600, marginBottom:6 }}>Select an event to plan</div>
            <div style={{ fontSize:13 }}>Choose from the list on the left, or create a new proposal.</div>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom:28 }}>
      <div style={{ borderBottom:'2px solid var(--burgundy,#7A0047)', paddingBottom:6, marginBottom:14 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'var(--wine,#3D0026)' }}>{title}</div>
        {subtitle && <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}
function Field({ label, children }) {
  return (
    <div className="form-group" style={{ marginBottom:12 }}>
      <label className="form-label" style={{ fontSize:12, marginBottom:4, display:'block', fontWeight:600, color:'var(--gray-600)' }}>{label}</label>
      {children}
    </div>
  )
}
function Grid({ cols, children }) {
  return <div style={{ display:'grid', gridTemplateColumns:`repeat(${cols},1fr)`, gap:16 }}>{children}</div>
}
function PlanTable({ headers, rows }) {
  return (
    <table style={{ width:'100%', marginBottom:12, fontSize:13 }}>
      <thead><tr style={{ background:'var(--blush,#F7E6F0)' }}>
        {headers.map(h=><th key={h} style={{ padding:'6px 10px', textAlign:'left', fontSize:11, fontWeight:600, color:'var(--wine,#3D0026)' }}>{h}</th>)}
      </tr></thead>
      <tbody>{rows.map((row,i)=>(
        <tr key={i} style={{ borderBottom:'1px solid var(--border)' }}>
          {row.map((cell,j)=><td key={j} style={{ padding:'6px 10px', color: j===row.length-2 ? 'var(--gray-500)' : 'inherit' }}>{cell}</td>)}
        </tr>
      ))}</tbody>
    </table>
  )
}
function Rm({ onClick }) {
  return <button onClick={onClick} style={{ background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontWeight:700, padding:'0 4px' }}>×</button>
}

function ProposalRow({ p, isSelected, onSelect, onDelete, statusStyle, fmtDate, faded }) {
  const s = statusStyle(p.status)
  return (
    <div style={{ position: 'relative', borderBottom: '1px solid var(--border)', opacity: faded ? 0.65 : 1 }}>
      <button onClick={onSelect} style={{
        width: '100%', padding: '11px 40px 11px 16px', textAlign: 'left',
        background: isSelected ? 'var(--blush,#F7E6F0)' : 'transparent',
        border: 'none',
        borderLeft: isSelected ? '3px solid var(--wine,#3D0026)' : '3px solid transparent',
        cursor: 'pointer',
      }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, color: 'var(--gray-800)' }}>{p.event_name}</div>
        <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 5 }}>
          {fmtDate(p.event_date)}{p.event_end_date && p.event_end_date !== p.event_date ? ` – ${fmtDate(p.event_end_date)}` : ''}
          {p.location ? ` · ${p.location}` : ''}
        </div>
        <span style={{ display: 'inline-block', fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: s.bg, color: s.color }}>{s.label}</span>
      </button>
      <button onClick={onDelete} title="Delete" style={{
        position: 'absolute', top: '50%', right: 10, transform: 'translateY(-50%)',
        background: 'none', border: 'none', color: '#dc262680', cursor: 'pointer',
        fontSize: 16, padding: '4px 6px', borderRadius: 4, lineHeight: 1,
      }}
        onMouseEnter={e => e.currentTarget.style.color = '#dc2626'}
        onMouseLeave={e => e.currentTarget.style.color = '#dc262680'}
      >✕</button>
    </div>
  )
}
