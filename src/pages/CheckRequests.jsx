import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'

const BACKUP_BUCKET = 'check-request-backup'

const STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  sent: 'Sent',
  denied: 'Denied',
}
const STATUS_COLORS = {
  submitted: { bg: '#fef3e2', fg: '#9a6b00' },
  under_review: { bg: '#e8eef7', fg: '#2d5a9e' },
  approved: { bg: '#e6f4ea', fg: '#2d7a4f' },
  sent: { bg: '#eee', fg: '#555' },
  denied: { bg: '#fdecea', fg: '#c0392b' },
}
const DELIVERY_LABELS = {
  in_person: 'In person',
  mail_to_requester: 'Mail to requester',
  mail_other: 'Mail to someone else',
}

const money = (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.submitted
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600 }}>
      {STATUS_LABELS[status] || status}
    </span>
  )
}

export default function CheckRequests() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('active') // active = everything but sent/denied
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)   // request object being viewed/edited
  const [showNew, setShowNew] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('check_requests').select('*').order('request_date', { ascending: false })
    setRequests(data || [])
    setLoading(false)
  }

  const categories = useMemo(() =>
    [...new Set(requests.map(r => r.category).filter(Boolean))].sort(),
  [requests])

  const filtered = useMemo(() => {
    let list = requests
    if (statusFilter === 'active') list = list.filter(r => !['sent', 'denied'].includes(r.status))
    else if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(r =>
        r.request_number?.toLowerCase().includes(q) ||
        r.requester_name?.toLowerCase().includes(q) ||
        r.payee_name?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
      )
    }
    return list
  }, [requests, statusFilter, search])

  function upsertLocal(updated) {
    setRequests(prev => prev.map(r => r.id === updated.id ? updated : r))
    setSelected(updated)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Check Requests</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New Request</button>
      </div>

      <div className="page-body">
        <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {['active', 'submitted', 'under_review', 'approved', 'sent', 'denied', 'all'].map(s => (
              <button key={s}
                className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setStatusFilter(s)}>
                {s === 'active' ? 'Active' : s === 'all' ? 'All' : STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <input
            className="form-input" placeholder="Search request #, name, description…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ marginLeft: 'auto', minWidth: 240, padding: '7px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--gray-200)' }}
          />
        </div>

        {loading ? (
          <div className="spinner" />
        ) : filtered.length === 0 ? (
          <div className="empty-state"><div className="icon">🧾</div><p>No check requests here.</p></div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Request #</th>
                  <th>Date</th>
                  <th>Requester</th>
                  <th>Payee</th>
                  <th>Amount</th>
                  <th>Needed By</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(r)}>
                    <td style={{ fontWeight: 600 }}>{r.request_number}</td>
                    <td>{fmtDate(r.request_date)}</td>
                    <td>{r.requester_name}</td>
                    <td>{r.payee_name}</td>
                    <td>{money(r.amount)}</td>
                    <td>{fmtDate(r.needed_by_date)}</td>
                    <td><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <DetailModal
          request={selected}
          categories={categories}
          onClose={() => setSelected(null)}
          onSaved={upsertLocal}
        />
      )}

      {showNew && (
        <NewRequestModal
          onClose={() => setShowNew(false)}
          onCreated={(r) => { setRequests(prev => [r, ...prev]); setShowNew(false) }}
        />
      )}
    </div>
  )
}

// ── Detail / edit modal ──────────────────────────────────────────────────
function DetailModal({ request, categories, onClose, onSaved }) {
  const [form, setForm] = useState({
    status: request.status,
    category: request.category || '',
    finance_notes: request.finance_notes || '',
    check_number: request.check_number || '',
    sent_date: request.sent_date || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fileUrl, setFileUrl] = useState(null)
  const [fileLoading, setFileLoading] = useState(false)

  async function viewBackup() {
    if (!request.backup_file_url) return
    setFileLoading(true)
    const { data, error } = await supabase.storage.from(BACKUP_BUCKET).createSignedUrl(request.backup_file_url, 300)
    setFileLoading(false)
    if (error) { setError('Could not load backup file: ' + error.message); return }
    setFileUrl(data.signedUrl)
    window.open(data.signedUrl, '_blank')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const payload = {
      status: form.status,
      category: form.category.trim() || null,
      finance_notes: form.finance_notes.trim() || null,
      check_number: form.check_number.trim() || null,
      sent_date: form.status === 'sent' ? (form.sent_date || new Date().toISOString().slice(0, 10)) : (form.sent_date || null),
    }
    const { data, error } = await supabase.from('check_requests').update(payload).eq('id', request.id).select().single()
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved(data)
    onClose()
  }

  return (
    <Modal onClose={onClose} title={request.request_number} wide>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="grid-2">
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', color: 'var(--burgundy)', fontSize: 15 }}>Request Details</h3>
          <DetailRow label="Requester" value={`${request.requester_name}${request.requester_email ? ` · ${request.requester_email}` : ''}${request.requester_phone ? ` · ${request.requester_phone}` : ''}`} />
          <DetailRow label="Payable To" value={request.payee_name} />
          <DetailRow label="Amount" value={money(request.amount)} />
          <DetailRow label="For" value={request.description} />
          <DetailRow label="Requester-noted account" value={request.account_code || '—'} />
          <DetailRow label="Request Date" value={fmtDate(request.request_date)} />
          <DetailRow label="Needed By" value={fmtDate(request.needed_by_date)} />
          <DetailRow label="Delivery" value={DELIVERY_LABELS[request.delivery_method] || request.delivery_method} />
          {request.delivery_method !== 'in_person' && (
            <DetailRow label="Mail To" value={`${request.mailing_name || ''}\n${request.mailing_address || ''}`} />
          )}
          <DetailRow label="Flags" value={[
            request.is_reimbursement ? 'Reimbursement' : null,
            request.is_vote_related ? `Vote-related${request.vote_reference ? ` — ${request.vote_reference}` : ''}` : null,
          ].filter(Boolean).join(' · ') || '—'} />
          <DetailRow label="Source" value={request.is_staff_entered ? 'Entered by staff' : 'Public submission'} />

          <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={viewBackup} disabled={fileLoading || !request.backup_file_url}>
            {fileLoading ? 'Loading…' : '📎 View Backup Document'}
          </button>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', color: 'var(--burgundy)', fontSize: 15 }}>Finance</h3>

          <div className="form-group">
            <label className="form-label">Status</label>
            <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Category (QuickBooks)</label>
            <input className="form-input" list="qb-categories" value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              placeholder="e.g. Trustees - Building Maintenance" />
            <datalist id="qb-categories">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>

          <div className="form-group">
            <label className="form-label">Check Number</label>
            <input className="form-input" value={form.check_number} onChange={e => setForm(f => ({ ...f, check_number: e.target.value }))} />
          </div>

          <div className="form-group">
            <label className="form-label">Sent Date</label>
            <input type="date" className="form-input" value={form.sent_date} onChange={e => setForm(f => ({ ...f, sent_date: e.target.value }))} />
          </div>

          <div className="form-group">
            <label className="form-label">Finance Notes</label>
            <textarea className="form-input" rows={3} value={form.finance_notes} onChange={e => setForm(f => ({ ...f, finance_notes: e.target.value }))} />
          </div>

          <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ width: '100%', justifyContent: 'center' }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function DetailRow({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gray-600)' }}>{label}</div>
      <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  )
}

// ── Staff manual-entry modal ─────────────────────────────────────────────
const EMPTY_NEW = {
  requester_name: '', requester_email: '', requester_phone: '',
  payee_name: '', amount: '', description: '', account_code: '', category: '',
  is_reimbursement: false, is_vote_related: false, vote_reference: '',
  delivery_method: 'in_person', mailing_name: '', mailing_address: '',
  needed_by_date: '', status: 'submitted',
}

function NewRequestModal({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_NEW)
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  async function handleCreate() {
    if (!form.requester_name.trim() || !form.payee_name.trim() || !form.amount || !form.description.trim() || !form.needed_by_date) {
      setError('Please fill in requester, payee, amount, description, and needed-by date.')
      return
    }
    setSaving(true)
    setError('')
    try {
      let backup_file_url = null, backup_file_name = null
      if (file) {
        const ext = file.name.split('.').pop()
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: upErr } = await supabase.storage.from(BACKUP_BUCKET).upload(path, file)
        if (upErr) throw new Error('File upload failed: ' + upErr.message)
        backup_file_url = path
        backup_file_name = file.name
      }

      const payload = {
        requester_name: form.requester_name.trim(),
        requester_email: form.requester_email.trim() || null,
        requester_phone: form.requester_phone.trim() || null,
        payee_name: form.payee_name.trim(),
        amount: Number(form.amount),
        description: form.description.trim(),
        account_code: form.account_code.trim() || null,
        category: form.category.trim() || null,
        is_reimbursement: form.is_reimbursement,
        is_vote_related: form.is_vote_related,
        vote_reference: form.is_vote_related ? form.vote_reference.trim() : null,
        delivery_method: form.delivery_method,
        mailing_name: form.delivery_method === 'mail_other' ? form.mailing_name.trim() : (form.delivery_method === 'mail_to_requester' ? form.requester_name.trim() : null),
        mailing_address: form.delivery_method !== 'in_person' ? form.mailing_address.trim() : null,
        needed_by_date: form.needed_by_date,
        status: form.status,
        is_staff_entered: true,
        backup_file_url, backup_file_name,
      }

      const { data, error: insErr } = await supabase.from('check_requests').insert(payload).select().single()
      if (insErr) throw new Error(insErr.message)
      onCreated(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} title="New Check Request (Staff Entry)" wide>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="grid-2">
        <div className="form-group"><label className="form-label">Requester Name *</label>
          <input className="form-input" value={form.requester_name} onChange={e => set('requester_name', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Requester Email</label>
          <input className="form-input" value={form.requester_email} onChange={e => set('requester_email', e.target.value)} /></div>
      </div>

      <div className="form-group"><label className="form-label">Payable To *</label>
        <input className="form-input" value={form.payee_name} onChange={e => set('payee_name', e.target.value)} /></div>

      <div className="grid-2">
        <div className="form-group"><label className="form-label">Amount *</label>
          <input type="number" step="0.01" className="form-input" value={form.amount} onChange={e => set('amount', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Needed By *</label>
          <input type="date" className="form-input" value={form.needed_by_date} onChange={e => set('needed_by_date', e.target.value)} /></div>
      </div>

      <div className="form-group"><label className="form-label">Description *</label>
        <textarea className="form-input" rows={3} value={form.description} onChange={e => set('description', e.target.value)} /></div>

      <div className="grid-2">
        <div className="form-group"><label className="form-label">Account Code</label>
          <input className="form-input" value={form.account_code} onChange={e => set('account_code', e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Category</label>
          <input className="form-input" value={form.category} onChange={e => set('category', e.target.value)} /></div>
      </div>

      <div className="form-group">
        <label className="checkbox-label"><input type="checkbox" checked={form.is_reimbursement} onChange={e => set('is_reimbursement', e.target.checked)} /> Reimbursement</label>
      </div>
      <div className="form-group">
        <label className="checkbox-label"><input type="checkbox" checked={form.is_vote_related} onChange={e => set('is_vote_related', e.target.checked)} /> Vote-related</label>
      </div>
      {form.is_vote_related && (
        <div className="form-group"><label className="form-label">Vote Reference</label>
          <input className="form-input" value={form.vote_reference} onChange={e => set('vote_reference', e.target.value)} /></div>
      )}

      <div className="form-group">
        <label className="form-label">Delivery</label>
        <select className="form-select" value={form.delivery_method} onChange={e => set('delivery_method', e.target.value)}>
          <option value="in_person">In person</option>
          <option value="mail_to_requester">Mail to requester</option>
          <option value="mail_other">Mail to someone else</option>
        </select>
      </div>
      {form.delivery_method === 'mail_other' && (
        <div className="form-group"><label className="form-label">Mail To (name)</label>
          <input className="form-input" value={form.mailing_name} onChange={e => set('mailing_name', e.target.value)} /></div>
      )}
      {form.delivery_method !== 'in_person' && (
        <div className="form-group"><label className="form-label">Mailing Address</label>
          <textarea className="form-input" rows={2} value={form.mailing_address} onChange={e => set('mailing_address', e.target.value)} /></div>
      )}

      <div className="form-group">
        <label className="form-label">Status</label>
        <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label">Backup Document (optional)</label>
        <input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} />
      </div>

      <button className="btn btn-primary" onClick={handleCreate} disabled={saving} style={{ width: '100%', justifyContent: 'center' }}>
        {saving ? 'Creating…' : 'Create Request'}
      </button>
    </Modal>
  )
}

// ── Shared modal shell ────────────────────────────────────────────────────
function Modal({ title, children, onClose, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 16px' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 14, padding: 24, width: '100%', maxWidth: wide ? 760 : 480 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, color: 'var(--burgundy)', fontFamily: 'var(--font-display)', fontSize: 20 }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--gray-400)' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
