import { useEffect, useMemo, useRef, useState } from 'react'
import ExcelJS from 'exceljs'
import { supabase } from '../lib/supabase.js'

// Giving — Sunday plate counts, review/close, funds and reports.
// Counters (role 'counter') only see counts that are still open and can mark
// them "counted". Reviewers (admin, finance, 'giving') see everything, close
// counts (which locks them) and run reports. Giving amounts are private.

const money = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const today = () => new Date().toLocaleDateString('en-CA')
const yearStart = () => `${new Date().getFullYear()}-01-01`
const nice = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''
const STATUS = { open: 'Being counted', counted: 'Counted — waiting for review', closed: 'Closed' }
const SOURCE = { plate: 'Sunday plate', tithely: 'Tithely (online)', breeze: 'Breeze history', other: 'Other' }
const METHODS = { check: 'Check', cash: 'Cash', online: 'Online', card: 'Card', ach: 'Bank transfer', stock: 'Stock', other: 'Other' }

export default function Giving({ canReview }) {
  const [tab, setTab] = useState('count')
  const [funds, setFunds] = useState(null)
  const [err, setErr] = useState('')
  const [openBatch, setOpenBatch] = useState(null)

  async function loadFunds() {
    const { data, error } = await supabase.from('giving_funds').select('*').order('sort_order').order('name')
    if (error) return setErr(error.message)
    setFunds(data)
  }
  useEffect(() => { loadFunds() }, [])

  const tabs = canReview
    ? [['count', 'Sunday count'], ['counts', 'All counts'], ['reports', 'Reports'], ['funds', 'Funds']]
    : [['count', 'Sunday count']]

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Giving</div>
          <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 2 }}>
            {canReview ? 'Offerings, funds and giving reports — private' : 'Enter this Sunday’s offering'}
          </div>
        </div>
        {!openBatch && tabs.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {tabs.map(([k, l]) => (
              <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
        )}
      </div>
      <div className="page-body">
        {err && <div className="card" style={{ color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}
        {!funds ? (!err && <div className="spinner" />)
          : openBatch ? <CountView batchId={openBatch} funds={funds} canReview={canReview} onClose={() => setOpenBatch(null)} />
          : tab === 'count' ? <OpenCounts funds={funds} canReview={canReview} onOpen={setOpenBatch} />
          : tab === 'counts' ? <AllCounts onOpen={setOpenBatch} />
          : tab === 'reports' ? <Reports funds={funds} />
          : <Funds funds={funds} onChanged={loadFunds} />}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ open counts */

function OpenCounts({ funds, canReview, onOpen }) {
  const [batches, setBatches] = useState(null)
  const [date, setDate] = useState(today())
  const [slip, setSlip] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data, error } = await supabase.from('giving_batches').select('id, batch_date, slip_total, status, source')
      .eq('status', 'open').order('batch_date', { ascending: false })
    if (error) return setErr(error.message)
    setBatches(data)
  }
  useEffect(() => { load() }, [])

  async function start() {
    setErr('')
    if (!funds.some(f => f.is_active)) return setErr(canReview ? 'Add at least one fund on the Funds tab first.' : 'No funds are set up yet. Ask Betsy or Corissa.')
    setBusy(true)
    const { data, error } = await supabase.from('giving_batches')
      .insert({ batch_date: date, slip_total: slip === '' ? null : Number(slip), source: 'plate', status: 'open' })
      .select('id').single()
    setBusy(false)
    if (error) return setErr(error.message)
    onOpen(data.id)
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>Start a count</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ width: 170 }}><label className="form-label">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div style={{ width: 200 }}><label className="form-label">Deposit slip total</label>
            <input type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={slip} onChange={e => setSlip(e.target.value)} /></div>
          <button className="btn btn-primary" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start counting'}</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 8 }}>
          The slip total is what the deposit slip says. You can fill it in now or when you’re done; the count must match it before you can finish.
        </div>
        {err && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
      </div>

      {batches && batches.length > 0 && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Still being counted</div>
          {batches.map(b => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderTop: '1px solid var(--gray-200, #eee)', gap: 10, flexWrap: 'wrap' }}>
              <div>{nice(b.batch_date)}{b.slip_total != null && <span style={{ color: 'var(--gray-600)' }}> · slip {money(b.slip_total)}</span>}</div>
              <button className="btn btn-sm btn-secondary" onClick={() => onOpen(b.id)}>Continue</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- one count */

function CountView({ batchId, funds, canReview, onClose }) {
  const [batch, setBatch] = useState(null)
  const [gifts, setGifts] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [slipEdit, setSlipEdit] = useState(null)
  const activeFunds = funds.filter(f => f.is_active)
  const fundName = (id) => funds.find(f => f.id === id)?.name || '—'

  async function load() {
    const [b, g] = await Promise.all([
      supabase.from('giving_batches').select('*').eq('id', batchId).maybeSingle(),
      supabase.from('gifts').select('id, person_id, giver_label, amount, fund_id, method, check_number, note, created_at').eq('batch_id', batchId).order('created_at'),
    ])
    if (b.error || g.error) return setErr((b.error || g.error).message)
    if (!b.data) return setErr('This count is no longer open. It may have been finished or closed.')
    setBatch(b.data); setGifts(g.data)
  }
  useEffect(() => { load() }, [batchId])

  if (!batch) return err ? <div className="card"><div style={{ color: 'var(--danger)' }}>{err}</div><button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={onClose}>Back</button></div> : <div className="spinner" />

  const editable = batch.status === 'open' || (canReview && batch.status === 'counted')
  const total = gifts.reduce((s, g) => s + Number(g.amount), 0)
  const checks = gifts.filter(g => g.method === 'check').reduce((s, g) => s + Number(g.amount), 0)
  const cash = gifts.filter(g => g.method === 'cash').reduce((s, g) => s + Number(g.amount), 0)
  const other = total - checks - cash
  const slip = batch.slip_total == null ? null : Number(batch.slip_total)
  const diff = slip == null ? null : Math.round((total - slip) * 100) / 100
  const matches = diff === 0

  async function setStatus(status) {
    setBusy(true); setErr('')
    const { error } = await supabase.from('giving_batches').update({ status }).eq('id', batchId)
    setBusy(false)
    if (error) return setErr(error.message)
    if (status === 'counted' && !canReview) return onClose()
    load()
  }
  async function saveSlip() {
    const v = slipEdit === '' ? null : Number(slipEdit)
    const { error } = await supabase.from('giving_batches').update({ slip_total: v }).eq('id', batchId)
    if (error) return setErr(error.message)
    setSlipEdit(null); load()
  }
  async function saveField(field, value) {
    const { error } = await supabase.from('giving_batches').update({ [field]: value }).eq('id', batchId)
    if (error) return setErr(error.message)
    load()
  }
  async function remove(id) {
    const { error } = await supabase.from('gifts').delete().eq('id', id)
    if (error) return setErr(error.message)
    setGifts(gs => gs.filter(g => g.id !== id))
  }

  return (
    <div>
      <button className="btn btn-sm btn-secondary" style={{ marginBottom: 12 }} onClick={onClose}>← Back</button>

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{SOURCE[batch.source]} · {nice(batch.batch_date)}</div>
            <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 2 }}>{STATUS[batch.status]}</div>
            {canReview && batch.status !== 'closed' && (
              <div style={{ marginTop: 8 }}>
                <input type="date" value={batch.batch_date} style={{ width: 170 }} onChange={e => e.target.value && saveField('batch_date', e.target.value)} />
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', fontSize: 14, lineHeight: 1.7 }}>
            <div>Checks: <strong>{money(checks)}</strong></div>
            <div>Cash: <strong>{money(cash)}</strong></div>
            {other !== 0 && <div>Other: <strong>{money(other)}</strong></div>}
            <div style={{ fontSize: 16 }}>Total: <strong>{money(total)}</strong></div>
            <div>
              Deposit slip:{' '}
              {slipEdit !== null ? (
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <input type="number" step="0.01" value={slipEdit} onChange={e => setSlipEdit(e.target.value)} style={{ width: 110 }} autoFocus />
                  <button className="btn btn-sm btn-primary" onClick={saveSlip}>Save</button>
                </span>
              ) : (
                <>
                  <strong>{slip == null ? 'not entered' : money(slip)}</strong>
                  {editable && <a href="#" style={{ marginLeft: 6, fontSize: 13 }} onClick={e => { e.preventDefault(); setSlipEdit(slip ?? '') }}>change</a>}
                </>
              )}
            </div>
            {slip != null && (
              <div style={{ fontWeight: 700, color: matches ? 'var(--success, #2e7d32)' : 'var(--danger)' }}>
                {matches ? '✓ Matches the slip' : diff > 0 ? `Over the slip by ${money(diff)}` : `Short of the slip by ${money(-diff)}`}
              </div>
            )}
          </div>
        </div>
      </div>

      {editable && batch.status !== 'closed' && <GiftEntry batch={batch} funds={activeFunds} onAdded={(g) => setGifts(gs => [...gs, g])} />}

      <div className="card" style={{ marginBottom: 14, overflowX: 'auto' }}>
        {gifts.length === 0 ? <div style={{ color: 'var(--gray-600)' }}>No gifts entered yet.</div> : (
          <table className="data-table">
            <thead><tr><th>Giver</th><th>Fund</th><th>How</th><th>Check #</th><th style={{ textAlign: 'right' }}>Amount</th>{editable && <th />}</tr></thead>
            <tbody>
              {gifts.map(g => (
                <tr key={g.id}>
                  <td>{g.giver_label || (g.person_id ? '(person)' : 'Loose cash')}{g.note && <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{g.note}</div>}</td>
                  <td>{fundName(g.fund_id)}</td>
                  <td>{METHODS[g.method] || g.method}</td>
                  <td>{g.check_number}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(g.amount)}</td>
                  {editable && <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-secondary" onClick={() => remove(g.id)}>Remove</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {err && <div className="card" style={{ color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}

      <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {batch.status === 'open' && (
          <>
            <button className="btn btn-primary" disabled={busy || !matches || gifts.length === 0} onClick={() => setStatus('counted')}>Finish — mark as counted</button>
            {!matches && <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>{slip == null ? 'Enter the deposit slip total to finish.' : 'The total has to match the deposit slip before you can finish.'}</span>}
          </>
        )}
        {canReview && batch.status !== 'closed' && (
          <button className="btn btn-primary" disabled={busy || !matches || gifts.length === 0} onClick={() => setStatus('closed')}>Review done — close and lock</button>
        )}
        {canReview && batch.status === 'counted' && (
          <button className="btn btn-secondary" disabled={busy} onClick={() => setStatus('open')}>Send back to counters</button>
        )}
        {canReview && batch.status === 'closed' && (
          <button className="btn btn-secondary" disabled={busy} onClick={() => setStatus('counted')}>Reopen to fix a mistake</button>
        )}
        {batch.counted_at && <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>Counted {new Date(batch.counted_at).toLocaleString()}</span>}
        {batch.closed_at && <span style={{ fontSize: 13, color: 'var(--gray-600)' }}>· Closed {new Date(batch.closed_at).toLocaleString()}</span>}
      </div>
    </div>
  )
}

function GiftEntry({ batch, funds, onAdded }) {
  const blank = { person: null, loose: false, amount: '', fund_id: funds[0]?.id || '', method: 'check', check_number: '', note: '' }
  const [f, setF] = useState(blank)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState(null)
  const searchRef = useRef(null)
  const amountRef = useRef(null)

  useEffect(() => {
    if (f.person || f.loose || q.trim().length < 1) { setHits([]); return }
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('giving_people_lookup', { p_q: q })
      if (!error) setHits(data || [])
    }, 200)
    return () => clearTimeout(t)
  }, [q, f.person, f.loose])

  function pick(p) { setF(x => ({ ...x, person: p, loose: false })); setQ(''); setHits([]); setTimeout(() => amountRef.current?.focus(), 0) }
  function loose() { setF(x => ({ ...x, person: null, loose: true, method: 'cash', check_number: '' })); setQ(''); setTimeout(() => amountRef.current?.focus(), 0) }

  async function add(keepGiver) {
    setErr('')
    const amt = Math.round(Number(f.amount) * 100) / 100
    if (!f.person && !f.loose) return setErr('Pick who gave it, or choose "Loose cash".')
    if (!amt || amt <= 0) return setErr('Enter the amount.')
    if (!f.fund_id) return setErr('Pick a fund.')
    setBusy(true)
    const row = {
      batch_id: batch.id, gift_date: batch.batch_date, amount: amt, fund_id: f.fund_id, method: f.method,
      person_id: f.person?.id || null, giver_label: f.loose ? 'Loose cash' : f.person.name,
      check_number: f.method === 'check' ? (f.check_number.trim() || null) : null, note: f.note.trim() || null,
    }
    const { data, error } = await supabase.from('gifts').insert(row).select('id, person_id, giver_label, amount, fund_id, method, check_number, note, created_at').single()
    setBusy(false)
    if (error) return setErr(error.message)
    onAdded(data)
    setLast(data)
    if (keepGiver) { setF(x => ({ ...x, amount: '', note: '' })); setTimeout(() => amountRef.current?.focus(), 0) }
    else { setF({ ...blank, fund_id: f.fund_id }); setTimeout(() => searchRef.current?.focus(), 0) }
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Add a gift</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, alignItems: 'end' }}>
        <div style={{ gridColumn: 'span 2', position: 'relative' }}>
          <label className="form-label">Who gave it (name or envelope #)</label>
          {f.person || f.loose ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 38 }}>
              <strong>{f.loose ? 'Loose cash (no name)' : f.person.name}</strong>
              {f.person?.envelope_number && <span style={{ color: 'var(--gray-600)' }}>env. {f.person.envelope_number}</span>}
              <button className="btn btn-sm btn-secondary" onClick={() => { setF(x => ({ ...x, person: null, loose: false })); setTimeout(() => searchRef.current?.focus(), 0) }}>Change</button>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Start typing a name…" autoFocus
                  onKeyDown={e => { if (e.key === 'Enter' && hits[0]) pick(hits[0]) }} />
                <button className="btn btn-sm btn-secondary" style={{ whiteSpace: 'nowrap' }} onClick={loose}>Loose cash</button>
              </div>
              {hits.length > 0 && (
                <div style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, background: 'white', border: '1px solid var(--gray-200, #ddd)', borderRadius: 8, boxShadow: '0 4px 14px rgba(0,0,0,.12)', maxHeight: 280, overflowY: 'auto' }}>
                  {hits.map(h => (
                    <div key={h.id} onClick={() => pick(h)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f2f2f2' }}>
                      <strong>{h.name}</strong>
                      <span style={{ color: 'var(--gray-600)', fontSize: 13 }}>
                        {h.envelope_number && ` · env. ${h.envelope_number}`}{h.city && ` · ${h.city}`}{!h.is_active && ' · archived'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {q.trim().length >= 2 && hits.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 4 }}>No match. Check the spelling, try the last name only, or ask Betsy to add the person.</div>
              )}
            </>
          )}
        </div>
        <div><label className="form-label">Amount</label>
          <input ref={amountRef} type="number" inputMode="decimal" step="0.01" min="0" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') add(false) }} /></div>
        <div><label className="form-label">Fund</label>
          <select value={f.fund_id} onChange={e => setF({ ...f, fund_id: e.target.value })}>
            {funds.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select></div>
        <div><label className="form-label">How</label>
          <select value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>
            <option value="check">Check</option><option value="cash">Cash</option>
          </select></div>
        {f.method === 'check' && (
          <div><label className="form-label">Check #</label>
            <input value={f.check_number} onChange={e => setF({ ...f, check_number: e.target.value })} /></div>
        )}
        <div style={{ gridColumn: 'span 2' }}><label className="form-label">Note (optional)</label>
          <input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="e.g. in memory of…" /></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => add(false)}>Add gift</button>
        <button className="btn btn-secondary" disabled={busy} onClick={() => add(true)} title="Same check split across funds">Add, and split the same check to another fund</button>
      </div>
      {last && <div style={{ fontSize: 13, color: 'var(--success, #2e7d32)', marginTop: 8 }}>Added {money(last.amount)} from {last.giver_label}.</div>}
      {err && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
    </div>
  )
}

/* ------------------------------------------------------------- all counts */

function AllCounts({ onOpen }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    (async () => {
      let qy = supabase.from('giving_batches').select('id, batch_date, source, status, slip_total, gifts(amount)').order('batch_date', { ascending: false }).limit(200)
      if (status) qy = qy.eq('status', status)
      const { data, error } = await qy
      if (error) return setErr(error.message)
      setRows(data)
    })()
  }, [status])

  return (
    <div>
      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ width: 240 }}><label className="form-label">Show</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All counts</option>
            <option value="counted">Waiting for review</option>
            <option value="open">Being counted</option>
            <option value="closed">Closed</option>
          </select></div>
      </div>
      {err && <div className="card" style={{ color: 'var(--danger)' }}>{err}</div>}
      {!rows ? (!err && <div className="spinner" />) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          {rows.length === 0 ? <div style={{ color: 'var(--gray-600)' }}>Nothing here yet.</div> : (
            <table className="data-table">
              <thead><tr><th>Date</th><th>Source</th><th>Status</th><th style={{ textAlign: 'right' }}>Gifts</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Slip</th><th /></tr></thead>
              <tbody>{rows.map(b => {
                const total = (b.gifts || []).reduce((s, g) => s + Number(g.amount), 0)
                const off = b.slip_total != null && Math.round((total - Number(b.slip_total)) * 100) !== 0
                return (
                  <tr key={b.id}>
                    <td>{nice(b.batch_date)}</td><td>{SOURCE[b.source]}</td>
                    <td style={{ fontWeight: b.status === 'counted' ? 700 : 400 }}>{STATUS[b.status]}</td>
                    <td style={{ textAlign: 'right' }}>{(b.gifts || []).length}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(total)}</td>
                    <td style={{ textAlign: 'right', color: off ? 'var(--danger)' : 'inherit' }}>{b.slip_total == null ? '—' : money(b.slip_total)}</td>
                    <td style={{ textAlign: 'right' }}><button className="btn btn-sm btn-secondary" onClick={() => onOpen(b.id)}>Open</button></td>
                  </tr>
                )
              })}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- reports */

async function fetchGifts(from, to) {
  const all = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabase.from('gifts')
      .select('id, gift_date, amount, fund_id, method, check_number, person_id, giver_label, batch_id, people(first_name, last_name, preferred_name, family_id)')
      .gte('gift_date', from).lte('gift_date', to).order('gift_date').range(i, i + 999)
    if (error) throw error
    all.push(...data); if (data.length < 1000) break
  }
  return all
}

function Reports({ funds }) {
  const [from, setFrom] = useState(yearStart())
  const [to, setTo] = useState(today())
  const [gifts, setGifts] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const fundName = (id) => funds.find(f => f.id === id)?.name || '—'
  const giverName = (g) => g.people ? `${g.people.last_name}, ${g.people.preferred_name || g.people.first_name}` : (g.giver_label || 'Loose cash / anonymous')

  async function run() {
    setErr(''); setBusy(true)
    try { setGifts(await fetchGifts(from, to)) } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  useEffect(() => { run() }, [])

  const byFund = useMemo(() => {
    if (!gifts) return []
    const m = {}
    for (const g of gifts) { const k = g.fund_id; m[k] = m[k] || { fund: fundName(k), total: 0, n: 0 }; m[k].total += Number(g.amount); m[k].n++ }
    return Object.values(m).sort((a, b) => b.total - a.total)
  }, [gifts])
  const byGiver = useMemo(() => {
    if (!gifts) return []
    const m = {}
    for (const g of gifts) { const k = g.person_id || 'anon'; m[k] = m[k] || { name: giverName(g), total: 0, n: 0 }; m[k].total += Number(g.amount); m[k].n++ }
    return Object.values(m).sort((a, b) => a.name.localeCompare(b.name))
  }, [gifts])
  const total = byFund.reduce((s, r) => s + r.total, 0)

  async function download() {
    const wb = new ExcelJS.Workbook()
    const head = (ws) => { ws.getRow(1).font = { bold: true, name: 'Arial' }; ws.views = [{ state: 'frozen', ySplit: 1 }] }
    const s1 = wb.addWorksheet('By fund')
    s1.columns = [{ header: 'Fund', key: 'fund', width: 32 }, { header: 'Gifts', key: 'n', width: 10 }, { header: 'Total', key: 'total', width: 16, style: { numFmt: '$#,##0.00' } }]
    byFund.forEach(r => s1.addRow(r)); s1.addRow({ fund: 'Total', total }).font = { bold: true }; head(s1)
    const s2 = wb.addWorksheet('By giver')
    s2.columns = [{ header: 'Giver', key: 'name', width: 34 }, { header: 'Gifts', key: 'n', width: 10 }, { header: 'Total', key: 'total', width: 16, style: { numFmt: '$#,##0.00' } }]
    byGiver.forEach(r => s2.addRow(r)); head(s2)
    const s3 = wb.addWorksheet('Every gift')
    s3.columns = [{ header: 'Date', key: 'd', width: 12 }, { header: 'Giver', key: 'g', width: 32 }, { header: 'Fund', key: 'f', width: 26 }, { header: 'How', key: 'm', width: 12 }, { header: 'Check #', key: 'c', width: 10 }, { header: 'Amount', key: 'a', width: 14, style: { numFmt: '$#,##0.00' } }]
    gifts.forEach(g => s3.addRow({ d: g.gift_date, g: giverName(g), f: fundName(g.fund_id), m: METHODS[g.method] || g.method, c: g.check_number, a: Number(g.amount) })); head(s3)
    const buf = await wb.xlsx.writeBuffer()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    a.download = `UMCD giving ${from} to ${to}.xlsx`; a.click()
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ width: 170 }}><label className="form-label">From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div style={{ width: 170 }}><label className="form-label">To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
        <button className="btn btn-primary" disabled={busy} onClick={run}>{busy ? 'Loading…' : 'Show'}</button>
        {gifts && gifts.length > 0 && <button className="btn btn-secondary" onClick={download}>Download Excel</button>}
      </div>
      {err && <div className="card" style={{ color: 'var(--danger)' }}>{err}</div>}
      <SendToBoard funds={funds} />
      {gifts && (
        <>
          <MonthlyByFund gifts={gifts} funds={funds} from={from} to={to} />
          <div className="card" style={{ marginBottom: 14, overflowX: 'auto' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>By fund · {money(total)} from {byGiver.length} givers</div>
            {byFund.length === 0 ? <div style={{ color: 'var(--gray-600)' }}>No gifts in these dates.</div> : (
              <table className="data-table">
                <thead><tr><th>Fund</th><th style={{ textAlign: 'right' }}>Gifts</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>{byFund.map(r => <tr key={r.fund}><td>{r.fund}</td><td style={{ textAlign: 'right' }}>{r.n}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{money(r.total)}</td></tr>)}</tbody>
              </table>
            )}
          </div>
          {byGiver.length > 0 && (
            <div className="card" style={{ overflowX: 'auto' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>By giver</div>
              <table className="data-table">
                <thead><tr><th>Giver</th><th style={{ textAlign: 'right' }}>Gifts</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>{byGiver.map((r, i) => <tr key={i}><td>{r.name}</td><td style={{ textAlign: 'right' }}>{r.n}</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{money(r.total)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------- month-by-fund (printable) */

const monthKey = (d) => d.slice(0, 7)
const monthLabel = (k, long) => new Date(k + '-15T12:00:00').toLocaleDateString('en-US', long ? { month: 'long', year: 'numeric' } : { month: 'short' })
function monthsBetween(from, to) {
  const out = []; let [y, m] = from.slice(0, 7).split('-').map(Number); const [ty, tm] = to.slice(0, 7).split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } }
  return out
}

function MonthlyByFund({ gifts, funds, from, to }) {
  const months = monthsBetween(from, to)
  const fundName = (id) => funds.find(f => f.id === id)?.name || '—'
  const grid = {}
  for (const g of gifts) { const f = fundName(g.fund_id); grid[f] = grid[f] || {}; const k = monthKey(g.gift_date); grid[f][k] = (grid[f][k] || 0) + Number(g.amount) }
  const order = [...funds.map(f => f.name), ...Object.keys(grid)].filter((v, i, a) => a.indexOf(v) === i && grid[v])
  const colTotal = (k) => order.reduce((s, f) => s + (grid[f][k] || 0), 0)
  const rowTotal = (f) => months.reduce((s, k) => s + (grid[f][k] || 0), 0)
  const grand = order.reduce((s, f) => s + rowTotal(f), 0)
  const yearsDiffer = from.slice(0, 4) !== to.slice(0, 4)
  const head = (k) => yearsDiffer ? `${monthLabel(k)} ${k.slice(2, 4)}` : monthLabel(k)

  function print() {
    const esc = (s) => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    const td = (v, b) => `<td style="text-align:right;${b ? 'font-weight:700;' : ''}">${v ? money(v) : '—'}</td>`
    const html = `<!doctype html><html><head><title>Giving by fund</title><style>
      body{font-family:Arial,sans-serif;color:#222;margin:24px} h1{font-size:18px;color:#3D0026;margin:0 0 2px} .sub{font-size:12px;color:#666;margin-bottom:14px}
      table{border-collapse:collapse;width:100%;font-size:11px} th,td{border:1px solid #ccc;padding:5px 6px} th{background:#f4ecf0;color:#3D0026;text-align:right}
      th:first-child,td:first-child{text-align:left} tr.t td{font-weight:700;background:#faf6f8} @page{size:landscape;margin:12mm}</style></head><body>
      <h1>United Methodist Church of Danielson — Giving by Fund</h1>
      <div class="sub">${esc(monthLabel(months[0], true))} – ${esc(monthLabel(months[months.length - 1], true))} · printed ${new Date().toLocaleDateString()}</div>
      <table><thead><tr><th>Fund</th>${months.map(k => `<th>${esc(head(k))}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${order.map(f => `<tr><td>${esc(f)}</td>${months.map(k => td(grid[f][k])).join('')}${td(rowTotal(f), true)}</tr>`).join('')}
      <tr class="t"><td>Total</td>${months.map(k => td(colTotal(k), true)).join('')}${td(grand, true)}</tr></tbody></table>
      <script>window.onload=()=>{window.print()}</script></body></html>`
    const w = window.open('', '_blank')
    if (!w) return alert('Your browser blocked the print window. Allow pop-ups for this site and try again.')
    w.document.write(html); w.document.close()
  }

  return (
    <div className="card" style={{ marginBottom: 14, overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontWeight: 700 }}>Month by fund</div>
        <button className="btn btn-sm btn-secondary" onClick={print} disabled={!order.length}>Print</button>
      </div>
      {!order.length ? <div style={{ color: 'var(--gray-600)' }}>No gifts in these dates.</div> : (
        <table className="data-table">
          <thead><tr><th>Fund</th>{months.map(k => <th key={k} style={{ textAlign: 'right' }}>{head(k)}</th>)}<th style={{ textAlign: 'right' }}>Total</th></tr></thead>
          <tbody>
            {order.map(f => (
              <tr key={f}><td>{f}</td>{months.map(k => <td key={k} style={{ textAlign: 'right' }}>{grid[f][k] ? money(grid[f][k]) : '—'}</td>)}<td style={{ textAlign: 'right', fontWeight: 700 }}>{money(rowTotal(f))}</td></tr>
            ))}
            <tr><td style={{ fontWeight: 700 }}>Total</td>{months.map(k => <td key={k} style={{ textAlign: 'right', fontWeight: 700 }}>{money(colTotal(k))}</td>)}<td style={{ textAlign: 'right', fontWeight: 700 }}>{money(grand)}</td></tr>
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ------------------------------------------------- send to One Board report */

// Same shape One Board's "Incoming Giving" field uses: { givers, funds, methods, source }
const BOARD_METHOD = { check: 'Check', cash: 'Cash', online: 'Credit/Debit Online', card: 'Credit/Debit Online', ach: 'Direct Deposit', stock: 'Other', other: 'Other' }
const BOARD_METHOD_ORDER = ['Credit/Debit Online', 'Direct Deposit', 'Cash', 'Check', 'Other']

function lastMonthKey() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

function SendToBoard({ funds }) {
  const [month, setMonth] = useState(lastMonthKey())
  const [meetings, setMeetings] = useState([])
  const [meetingId, setMeetingId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(null)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('board_meetings').select('id, meeting_date, custom_title, meeting_type')
        .gte('meeting_date', today()).order('meeting_date').limit(6)
      setMeetings(data || []); if (data?.[0]) setMeetingId(data[0].id)
    })()
  }, [])

  async function send() {
    setErr(''); setDone(null); setBusy(true)
    try {
      const [y, m] = month.split('-').map(Number)
      const from = `${month}-01`, to = new Date(y, m, 0).toLocaleDateString('en-CA')
      const gifts = await fetchGifts(from, to)
      if (!gifts.length) throw new Error(`There are no gifts entered for ${monthLabel(month, true)} yet.`)
      const fundName = (id) => funds.find(f => f.id === id)?.name || 'Other'
      const tally = (keyOf) => {
        const t = {}
        for (const g of gifts) { const k = keyOf(g); t[k] = t[k] || { name: k, count: 0, amount: 0 }; t[k].count++; t[k].amount += Number(g.amount) }
        return Object.values(t).map(r => ({ ...r, amount: Math.round(r.amount * 100) / 100 }))
      }
      const fundRows = tally(g => fundName(g.fund_id)).sort((a, b) => funds.findIndex(f => f.name === a.name) - funds.findIndex(f => f.name === b.name))
      const methodRows = tally(g => BOARD_METHOD[g.method] || 'Other').sort((a, b) => BOARD_METHOD_ORDER.indexOf(a.name) - BOARD_METHOD_ORDER.indexOf(b.name))
      const named = new Set(gifts.filter(g => g.person_id).map(g => g.person_id)).size
      const giving = { givers: String(named), funds: fundRows, methods: methodRows, source: 'Planning Hub' }

      const { data: { user } } = await supabase.auth.getUser()
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      const label = monthLabel(month, true)
      const { data, error } = await supabase.from('board_reports').insert({
        report_type: 'incoming_finance', meeting_id: meetingId || null, submitted_by: user.id,
        submitter_name: prof?.full_name || user.email, period: label, subject: `${label.split(' ')[0]} giving`,
        content_json: { giving }, status: 'draft',
      }).select('id').single()
      if (error) throw error
      setDone({ id: data.id, label })
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const mtgLabel = (x) => `${nice(x.meeting_date)}${x.custom_title ? ' — ' + x.custom_title : ''}`

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Send a month to One Board</div>
      <div style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 10 }}>
        Makes the <strong>Incoming Finance</strong> report for the board meeting, already filled in: total givers, each fund and each method.
        No names or amounts per person go to the board. It’s saved as a draft so you can add notes before you submit it.
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ width: 180 }}><label className="form-label">Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} /></div>
        <div style={{ minWidth: 240 }}><label className="form-label">Board meeting</label>
          <select value={meetingId} onChange={e => setMeetingId(e.target.value)}>
            <option value="">No meeting yet</option>
            {meetings.map(x => <option key={x.id} value={x.id}>{mtgLabel(x)}</option>)}
          </select></div>
        <button className="btn btn-primary" disabled={busy} onClick={send}>{busy ? 'Making the report…' : 'Make the board report'}</button>
      </div>
      {err && <div style={{ color: 'var(--danger)', marginTop: 8 }}>{err}</div>}
      {done && (
        <div style={{ marginTop: 10, fontSize: 14 }}>
          ✓ {done.label} report is ready.{' '}
          <a href={`https://board.umcdanielson.org/reports/${done.id}`} target="_blank" rel="noreferrer">Open it in One Board</a> to add notes and press <strong>Submit</strong>.
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ funds */

function Funds({ funds, onChanged }) {
  const [name, setName] = useState('')
  const [err, setErr] = useState('')

  async function add() {
    setErr('')
    if (!name.trim()) return
    const { error } = await supabase.from('giving_funds').insert({ name: name.trim(), sort_order: (funds.length + 1) * 10 })
    if (error) return setErr(error.message.includes('duplicate') ? 'There is already a fund with that name.' : error.message)
    setName(''); onChanged()
  }
  async function update(id, patch) {
    setErr('')
    const { error } = await supabase.from('giving_funds').update(patch).eq('id', id)
    if (error) return setErr(error.message)
    onChanged()
  }
  async function move(i, dir) {
    const j = i + dir
    if (j < 0 || j >= funds.length) return
    await Promise.all([
      supabase.from('giving_funds').update({ sort_order: (j + 1) * 10 }).eq('id', funds[i].id),
      supabase.from('giving_funds').update({ sort_order: (i + 1) * 10 }).eq('id', funds[j].id),
    ])
    onChanged()
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}><label className="form-label">New fund</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Missions" onKeyDown={e => e.key === 'Enter' && add()} /></div>
        <button className="btn btn-primary" onClick={add}>Add fund</button>
      </div>
      {err && <div className="card" style={{ color: 'var(--danger)', marginBottom: 12 }}>{err}</div>}
      <div className="card" style={{ overflowX: 'auto' }}>
        {funds.length === 0 ? <div style={{ color: 'var(--gray-600)' }}>No funds yet. They’ll come over with the Breeze giving history, or add them here.</div> : (
          <table className="data-table">
            <thead><tr><th>Fund</th><th>On statements</th><th>Counters can pick it</th><th>Order</th></tr></thead>
            <tbody>{funds.map((x, i) => (
              <tr key={x.id} style={{ opacity: x.is_active ? 1 : 0.55 }}>
                <td><input defaultValue={x.name} onBlur={e => e.target.value.trim() && e.target.value.trim() !== x.name && update(x.id, { name: e.target.value.trim() })} /></td>
                <td><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', flex: 'none' }} checked={x.tax_deductible} onChange={e => update(x.id, { tax_deductible: e.target.checked })} /> Tax-deductible</label></td>
                <td><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" style={{ width: 'auto', flex: 'none' }} checked={x.is_active} onChange={e => update(x.id, { is_active: e.target.checked })} /> Active</label></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-sm btn-secondary" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>{' '}
                  <button className="btn btn-sm btn-secondary" disabled={i === funds.length - 1} onClick={() => move(i, 1)}>↓</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <div style={{ fontSize: 13, color: 'var(--gray-600)', marginTop: 10 }}>
          Funds are never deleted, so past gifts keep their fund. Untick “Active” to hide a fund from the counters.
        </div>
      </div>
    </div>
  )
}
