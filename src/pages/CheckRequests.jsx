import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import ExcelJS from 'exceljs'

const BACKUP_BUCKET = 'check-request-backup'

const PAYMENT_METHOD_LABELS = {
  online: 'On line', check: 'Check', debit: 'Debit', bill_pay: 'Bill Pay', other: 'Other',
}

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
const UNPAID_STATUSES = ['submitted', 'under_review', 'approved']

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

function FundBadge({ fund }) {
  const isMissions = fund === 'missions'
  return (
    <span style={{
      background: isMissions ? '#e6f0f4' : '#f0ede8', color: isMissions ? '#2d6a8f' : '#666',
      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
    }}>
      {isMissions ? 'Missions' : 'General'}
    </span>
  )
}

export default function CheckRequests() {
  const [requests, setRequests] = useState([])
  const [filesByRequest, setFilesByRequest] = useState({}) // { [request_id]: [file, ...] }
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('active')
  const [fundFilter, setFundFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)       // group object being viewed/edited
  const [showNew, setShowNew] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())  // request ids checked for merging
  const [merging, setMerging] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState('')
  const [error, setError] = useState('')
  const [showLogDeposit, setShowLogDeposit] = useState(false)
  const [exportingRegister, setExportingRegister] = useState(null) // 'general' | 'missions' | null

  useEffect(() => { load() }, [])

  async function exportRegister(fund) {
    setExportingRegister(fund)
    setError('')
    try {
      const { data: paidRequests, error: reqErr } = await supabase
        .from('check_requests')
        .select('*')
        .eq('fund', fund)
        .eq('status', 'sent')
        .order('sent_date')
      if (reqErr) throw new Error(reqErr.message)

      let depositRows = []
      let transferRows = []
      if (fund === 'general') {
        const { data: deposits, error: depErr } = await supabase.from('general_fund_deposits').select('*').order('entry_date')
        if (depErr) throw new Error(depErr.message)
        depositRows = (deposits || []).map(d => ({
          date: d.entry_date, pmt: '', reqNum: '', vendor: 'DEPOSIT', purchase: '',
          amt: null, chargeTo: '', depAmt: Number(d.amount), notes: [d.source, d.notes].filter(Boolean).join(' — '),
        }))
      } else {
        const { data: ledger, error: ledErr } = await supabase.from('missions_ledger').select('*, budget_categories(name)').order('entry_date')
        if (ledErr) throw new Error(ledErr.message)
        depositRows = (ledger || []).filter(e => e.type === 'income').map(e => ({
          date: e.entry_date, pmt: '', reqNum: '', vendor: 'DEPOSIT', purchase: e.description,
          amt: null, chargeTo: '', depAmt: Number(e.amount), notes: e.source || '',
        }))
        transferRows = (ledger || []).filter(e => e.type === 'transfer_out').map(e => ({
          date: e.entry_date, pmt: '', reqNum: '', vendor: 'TRANSFER TO GENERAL FUND', purchase: e.description,
          amt: Number(e.amount), chargeTo: e.budget_categories?.name || '', depAmt: null, notes: '',
        }))
      }

      const checkRows = (paidRequests || []).map(r => ({
        date: r.sent_date || r.request_date,
        pmt: PAYMENT_METHOD_LABELS[r.payment_method] || (r.check_number ? 'Check' : ''),
        reqNum: r.request_number,
        vendor: r.payee_name,
        purchase: r.description,
        amt: Number(r.amount),
        chargeTo: r.category || '',
        depAmt: null,
        notes: r.check_number ? `ck#${r.check_number}` : '',
      }))

      const allRows = [...checkRows, ...transferRows, ...depositRows]
        .filter(r => r.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date))

      const wb = new ExcelJS.Workbook()
      const ws = wb.addWorksheet(fund === 'general' ? 'General Register' : 'Missions Register')
      ws.columns = [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Pmt', key: 'pmt', width: 10 },
        { header: 'Req #', key: 'reqNum', width: 8 },
        { header: 'Vendor', key: 'vendor', width: 24 },
        { header: 'Purchase', key: 'purchase', width: 30 },
        { header: 'Amt', key: 'amt', width: 12 },
        { header: 'Charge to', key: 'chargeTo', width: 18 },
        { header: 'Dep Amt', key: 'depAmt', width: 12 },
        { header: 'Notes', key: 'notes', width: 22 },
      ]
      ws.getRow(1).font = { bold: true }
      ws.getRow(1).eachCell(cell => { cell.border = { bottom: { style: 'thin' } } })

      allRows.forEach(r => {
        const row = ws.addRow({
          date: r.date ? new Date(r.date + 'T12:00:00') : null,
          pmt: r.pmt, reqNum: r.reqNum, vendor: r.vendor, purchase: r.purchase,
          amt: r.amt, chargeTo: r.chargeTo, depAmt: r.depAmt, notes: r.notes,
        })
        row.getCell('date').numFmt = 'm/d/yyyy'
        if (r.amt != null) row.getCell('amt').numFmt = '$#,##0.00'
        if (r.depAmt != null) row.getCell('depAmt').numFmt = '$#,##0.00'
      })

      const buf = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fund}-register-${new Date().toISOString().slice(0, 10)}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError('Export failed: ' + err.message)
    }
    setExportingRegister(null)
  }

  async function load() {
    setLoading(true)
    setError('')
    const { data, error: reqErr } = await supabase.from('check_requests').select('*').order('request_date', { ascending: false })
    if (reqErr) { setError(reqErr.message); setLoading(false); return }
    setRequests(data || [])

    const { data: files, error: fileErr } = await supabase.from('check_request_files').select('*').order('sort_order')
    if (fileErr) { setError(fileErr.message); setLoading(false); return }
    const byReq = {}
    ;(files || []).forEach(f => {
      byReq[f.check_request_id] = byReq[f.check_request_id] || []
      byReq[f.check_request_id].push(f)
    })
    setFilesByRequest(byReq)
    setLoading(false)
  }

  const categories = useMemo(() =>
    [...new Set(requests.map(r => r.category).filter(Boolean))].sort(),
  [requests])

  // Group requests by payment_group_id — a group is one payment, possibly covering
  // several submitted requests merged together.
  const groups = useMemo(() => {
    const byGroup = {}
    const standalone = []
    requests.forEach(r => {
      if (r.payment_group_id) {
        byGroup[r.payment_group_id] = byGroup[r.payment_group_id] || []
        byGroup[r.payment_group_id].push(r)
      } else {
        standalone.push({ groupId: null, members: [r] })
      }
    })
    const grouped = Object.entries(byGroup).map(([groupId, members]) => ({ groupId, members }))
    return [...grouped, ...standalone].sort((a, b) =>
      new Date(b.members[0].request_date) - new Date(a.members[0].request_date)
    )
  }, [requests])

  const filteredGroups = useMemo(() => {
    let list = groups
    if (statusFilter === 'active') list = list.filter(g => g.members.some(m => UNPAID_STATUSES.includes(m.status)))
    else if (statusFilter !== 'all') list = list.filter(g => g.members.every(m => m.status === statusFilter))
    if (fundFilter !== 'all') list = list.filter(g => g.members.some(m => m.fund === fundFilter))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(g => g.members.some(m =>
        m.request_number?.toLowerCase().includes(q) ||
        m.requester_name?.toLowerCase().includes(q) ||
        m.payee_name?.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q)
      ))
    }
    return list
  }, [groups, statusFilter, fundFilter, search])

  function upsertLocal(updatedRequests) {
    setRequests(prev => prev.map(r => {
      const match = updatedRequests.find(u => u.id === r.id)
      return match || r
    }))
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectGroup(group) {
    const ids = group.members.map(m => m.id)
    const allSelected = ids.every(id => selectedIds.has(id))
    setSelectedIds(prev => {
      const next = new Set(prev)
      ids.forEach(id => allSelected ? next.delete(id) : next.add(id))
      return next
    })
  }

  async function mergeSelected() {
    if (selectedIds.size < 2) return
    const selectedRequests = requests.filter(r => selectedIds.has(r.id))
    const funds = new Set(selectedRequests.map(r => r.fund))
    if (funds.size > 1) { setError('Can\u2019t merge General and Missions requests into one payment — they\u2019re tracked separately.'); return }
    setMerging(true)
    setError('')
    const groupId = crypto.randomUUID()
    const ids = [...selectedIds]
    const { data, error: mergeErr } = await supabase.from('check_requests').update({ payment_group_id: groupId }).in('id', ids).select()
    setMerging(false)
    if (mergeErr) { setError(mergeErr.message); return }
    upsertLocal(data)
    setSelectedIds(new Set())
  }

  async function unmergeRequest(requestId) {
    const { data, error: err } = await supabase.from('check_requests').update({ payment_group_id: null }).eq('id', requestId).select().single()
    if (err) { setError(err.message); return }
    upsertLocal([data])
    setSelected(null)
  }

  const [emailTo, setEmailTo] = useState(() => localStorage.getItem('checkRequestsPdfEmail') || 'financeemails@umcdanielson.org')
  const [showEmailPrompt, setShowEmailPrompt] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const [emailMsg, setEmailMsg] = useState('')

  function unpaidGroupsList() {
    return groups.filter(g => g.members.some(m => UNPAID_STATUSES.includes(m.status)))
  }

  async function downloadAllUnpaid() {
    const unpaidGroups = unpaidGroupsList()
    if (unpaidGroups.length === 0) { alert('Nothing unpaid to download.'); return }
    setDownloading(true)
    setError('')
    try {
      const bytes = await buildCombinedPdf(unpaidGroups, filesByRequest, setDownloadProgress)
      triggerPdfDownload(bytes, `unpaid-check-requests-${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch (err) {
      setError('Download failed: ' + err.message)
    }
    setDownloading(false)
    setDownloadProgress('')
  }

  async function emailAllUnpaid() {
    if (!emailTo.trim()) { setShowEmailPrompt(true); return }
    const unpaidGroups = unpaidGroupsList()
    if (unpaidGroups.length === 0) { alert('Nothing unpaid to email.'); return }
    localStorage.setItem('checkRequestsPdfEmail', emailTo.trim())
    setEmailing(true)
    setError('')
    setEmailMsg('')
    try {
      const bytes = await buildCombinedPdf(unpaidGroups, filesByRequest, setDownloadProgress)
      const filename = `unpaid-check-requests-${new Date().toISOString().slice(0, 10)}.pdf`
      const { data, error } = await supabase.functions.invoke('send-pdf-email', {
        body: {
          to: emailTo.trim(),
          subject: `Unpaid Check Requests — ${new Date().toLocaleDateString('en-US')}`,
          message: `Attached: ${unpaidGroups.length} unpaid check request${unpaidGroups.length === 1 ? '' : 's'}, with cover pages and receipts.`,
          filename,
          pdfBase64: bytesToBase64(bytes),
        },
      })
      if (error || !data?.sent) throw new Error(error?.message || 'Email failed to send')
      setEmailMsg(`✅ Sent to ${emailTo.trim()}`)
      setShowEmailPrompt(false)
    } catch (err) {
      setError('Email failed: ' + err.message)
    }
    setEmailing(false)
    setDownloadProgress('')
    setTimeout(() => setEmailMsg(''), 6000)
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Check Requests</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {emailMsg && <span style={{ fontSize: 13 }}>{emailMsg}</span>}
          <button className="btn btn-secondary" onClick={() => setShowEmailPrompt(true)} disabled={emailing}>
            {emailing ? (downloadProgress || 'Sending…') : '📧 Email PDF to OneDrive Inbox'}
          </button>
          <button className="btn btn-secondary" onClick={downloadAllUnpaid} disabled={downloading}>
            {downloading ? (downloadProgress || 'Building PDF…') : '📥 Download All Unpaid'}
          </button>
          <button className="btn btn-primary" onClick={() => setShowNew(true)}>+ New Request</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowLogDeposit(true)}>+ Log General Deposit</button>
        <button className="btn btn-secondary btn-sm" onClick={() => exportRegister('general')} disabled={exportingRegister === 'general'}>
          {exportingRegister === 'general' ? 'Exporting…' : '📊 Export General Register'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => exportRegister('missions')} disabled={exportingRegister === 'missions'}>
          {exportingRegister === 'missions' ? 'Exporting…' : '📊 Export Missions Register'}
        </button>
      </div>

      {showEmailPrompt && (
        <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="form-label" style={{ marginBottom: 0 }}>Send to:</label>
          <input
            className="form-input" type="email" value={emailTo} onChange={e => setEmailTo(e.target.value)}
            placeholder="the inbox your OneDrive rule watches"
            style={{ maxWidth: 320, padding: '7px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--gray-200)' }}
          />
          <button className="btn btn-primary btn-sm" onClick={emailAllUnpaid} disabled={emailing}>
            {emailing ? (downloadProgress || 'Sending…') : 'Send'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowEmailPrompt(false)}>Cancel</button>
          <p style={{ width: '100%', fontSize: 12, color: 'var(--gray-400)', margin: 0 }}>
            Remembered on this device for next time — change it any time.
          </p>
        </div>
      )}

      <div className="page-body">
        {error && <div className="alert alert-error">{error}</div>}

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
          <div style={{ display: 'flex', gap: 6 }}>
            {[['all', 'All Funds'], ['general', 'General'], ['missions', 'Missions']].map(([val, label]) => (
              <button key={val}
                className={`btn btn-sm ${fundFilter === val ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFundFilter(val)}>
                {label}
              </button>
            ))}
          </div>
          <input
            className="form-input" placeholder="Search request #, name, description…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ marginLeft: 'auto', minWidth: 240, padding: '7px 10px', fontSize: 13, borderRadius: 8, border: '1px solid var(--gray-200)' }}
          />
        </div>

        {selectedIds.size > 0 && (
          <div className="card" style={{ marginBottom: 16, background: '#f3e6ed', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedIds.size} selected</span>
            <button className="btn btn-primary btn-sm" onClick={mergeSelected} disabled={selectedIds.size < 2 || merging}>
              {merging ? 'Merging…' : `🔗 Merge into One Payment`}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setSelectedIds(new Set())}>Clear</button>
            {selectedIds.size === 1 && <span style={{ fontSize: 12, color: 'var(--gray-600)' }}>Select at least 2 to merge.</span>}
          </div>
        )}

        {loading ? (
          <div className="spinner" />
        ) : filteredGroups.length === 0 ? (
          <div className="empty-state"><div className="icon">🧾</div><p>No check requests here.</p></div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Request #</th>
                  <th>Fund</th>
                  <th>Date</th>
                  <th>Requester</th>
                  <th>Payee</th>
                  <th>Amount</th>
                  <th>Needed By</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredGroups.map(g => {
                  const isGroup = g.members.length > 1
                  const primary = g.members[0]
                  const total = g.members.reduce((s, m) => s + Number(m.amount), 0)
                  const allChecked = g.members.every(m => selectedIds.has(m.id))
                  const someChecked = g.members.some(m => selectedIds.has(m.id))
                  const statuses = [...new Set(g.members.map(m => m.status))]
                  const funds = [...new Set(g.members.map(m => m.fund))]
                  return (
                    <tr key={g.groupId || primary.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(g)}>
                      <td onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = someChecked && !allChecked }}
                          onChange={() => toggleSelectGroup(g)} />
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {isGroup ? `${g.members.length} requests` : primary.request_number}
                        {isGroup && <div style={{ fontSize: 11, color: 'var(--gray-400)', fontWeight: 400 }}>{g.members.map(m => m.request_number).join(', ')}</div>}
                      </td>
                      <td>
                        {funds.length === 1
                          ? <FundBadge fund={funds[0]} />
                          : <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Mixed</span>}
                      </td>
                      <td>{fmtDate(primary.request_date)}</td>
                      <td>{isGroup ? [...new Set(g.members.map(m => m.requester_name))].join(', ') : primary.requester_name}</td>
                      <td>{primary.payee_name}</td>
                      <td>{money(total)}</td>
                      <td>{fmtDate(g.members.reduce((min, m) => !min || m.needed_by_date < min ? m.needed_by_date : min, null))}</td>
                      <td>
                        {statuses.length === 1 ? <StatusBadge status={statuses[0]} /> : <span style={{ fontSize: 12, color: 'var(--gray-400)' }}>Mixed</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <DetailModal
          group={selected}
          categories={categories}
          filesByRequest={filesByRequest}
          onClose={() => setSelected(null)}
          onSaved={upsertLocal}
          onUnmerge={unmergeRequest}
        />
      )}

      {showNew && (
        <NewRequestModal
          onClose={() => setShowNew(false)}
          onCreated={(r) => { setRequests(prev => [r, ...prev]); setShowNew(false) }}
        />
      )}

      {showLogDeposit && (
        <LogDepositModal onClose={() => setShowLogDeposit(false)} onLogged={() => setShowLogDeposit(false)} />
      )}
    </div>
  )
}

// ── Detail / edit modal — handles both a single request and a merged group ──
function DetailModal({ group, categories, filesByRequest, onClose, onSaved, onUnmerge }) {
  const isGroup = group.members.length > 1
  const primary = group.members[0]
  const total = group.members.reduce((s, m) => s + Number(m.amount), 0)

  const [form, setForm] = useState({
    status: primary.status,
    category: primary.category || '',
    payment_method: primary.payment_method || '',
    finance_notes: primary.finance_notes || '',
    check_number: primary.check_number || '',
    sent_date: primary.sent_date || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fileLoading, setFileLoading] = useState(null)

  async function viewFile(file) {
    setFileLoading(file.id)
    const { data, error } = await supabase.storage.from(BACKUP_BUCKET).createSignedUrl(file.file_url, 300)
    setFileLoading(null)
    if (error) { setError('Could not load file: ' + error.message); return }
    window.open(data.signedUrl, '_blank')
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    const payload = {
      status: form.status,
      category: form.category.trim() || null,
      payment_method: form.payment_method || null,
      finance_notes: form.finance_notes.trim() || null,
      check_number: form.check_number.trim() || null,
      sent_date: form.status === 'sent' ? (form.sent_date || new Date().toISOString().slice(0, 10)) : (form.sent_date || null),
    }
    // Applies to every member of the group — one payment, one status/check number/sent date.
    const ids = group.members.map(m => m.id)
    const { data, error } = await supabase.from('check_requests').update(payload).in('id', ids).select()
    setSaving(false)
    if (error) { setError(error.message); return }
    onSaved(data)
    onClose()
  }

  return (
    <Modal onClose={onClose} title={isGroup ? `Merged Payment — ${money(total)}` : primary.request_number} wide>
      {error && <div className="alert alert-error">{error}</div>}

      {isGroup && (
        <div className="card" style={{ padding: 12, marginBottom: 16, background: '#f3e6ed' }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>This payment covers {group.members.length} requests, made payable to {primary.payee_name}:</div>
          {group.members.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <span>{m.request_number} — {m.description}</span>
              <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {money(m.amount)}
                <button className="btn btn-secondary btn-sm" onClick={() => onUnmerge(m.id)}>Remove from group</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid-2">
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', color: 'var(--burgundy)', fontSize: 15 }}>Request Details</h3>
          {group.members.map(m => (
            <div key={m.id} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: isGroup ? '1px dashed var(--gray-200)' : 'none' }}>
              {isGroup && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gray-600)', marginBottom: 4 }}>{m.request_number}</div>}
              <DetailRow label="Requester" value={`${m.requester_name}${m.requester_email ? ` · ${m.requester_email}` : ''}${m.requester_phone ? ` · ${m.requester_phone}` : ''}`} />
              <DetailRow label="Payable To" value={m.payee_name} />
              <DetailRow label="Fund" value={m.fund === 'missions' ? 'Missions' : 'General'} />
              <DetailRow label="Amount" value={money(m.amount)} />
              <DetailRow label="For" value={m.description} />
              <DetailRow label="Requester-noted account" value={m.account_code || '—'} />
              <DetailRow label="Request Date" value={fmtDate(m.request_date)} />
              <DetailRow label="Needed By" value={fmtDate(m.needed_by_date)} />
              <DetailRow label="Delivery" value={DELIVERY_LABELS[m.delivery_method] || m.delivery_method} />
              {m.delivery_method !== 'in_person' && (
                <DetailRow label="Mail To" value={`${m.mailing_name || ''}\n${m.mailing_address || ''}`} />
              )}
              <DetailRow label="Flags" value={[
                m.is_reimbursement ? 'Reimbursement' : null,
                m.is_vote_related ? `Vote-related${m.vote_reference ? ` — ${m.vote_reference}` : ''}` : null,
              ].filter(Boolean).join(' · ') || '—'} />
              <DetailRow label="Source" value={m.is_staff_entered ? 'Entered by staff' : 'Public submission'} />

              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gray-600)', marginBottom: 4 }}>
                  Backup ({(filesByRequest[m.id] || []).length})
                </div>
                {(filesByRequest[m.id] || []).length === 0 ? (
                  <span style={{ fontSize: 13, color: 'var(--gray-400)' }}>No files attached</span>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(filesByRequest[m.id] || []).map(f => (
                      <button key={f.id} className="btn btn-secondary btn-sm" onClick={() => viewFile(f)} disabled={fileLoading === f.id}>
                        📎 {f.file_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', color: 'var(--burgundy)', fontSize: 15 }}>Finance</h3>
          {isGroup && <p style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 12 }}>These apply to the whole payment — all {group.members.length} requests share one status, check number, and sent date.</p>}

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
            <label className="form-label">Payment Method</label>
            <select className="form-select" value={form.payment_method} onChange={e => setForm(f => ({ ...f, payment_method: e.target.value }))}>
              <option value="">Select…</option>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
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
            {saving ? 'Saving…' : isGroup ? `Save Changes (${group.members.length} requests)` : 'Save Changes'}
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
  payee_name: '', fund: 'general', amount: '', description: '', account_code: '', category: '',
  is_reimbursement: false, is_vote_related: false, vote_reference: '',
  delivery_method: 'in_person', mailing_name: '', mailing_address: '',
  needed_by_date: '', status: 'submitted',
}

function NewRequestModal({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_NEW)
  const [files, setFiles] = useState([])
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
      const payload = {
        requester_name: form.requester_name.trim(),
        requester_email: form.requester_email.trim() || null,
        requester_phone: form.requester_phone.trim() || null,
        payee_name: form.payee_name.trim(),
        fund: form.fund,
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
      }

      const { data, error: insErr } = await supabase.from('check_requests').insert(payload).select().single()
      if (insErr) throw new Error(insErr.message)

      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const ext = f.name.split('.').pop()
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: upErr } = await supabase.storage.from(BACKUP_BUCKET).upload(path, f)
        if (upErr) throw new Error(`Upload failed for ${f.name}: ` + upErr.message)
        await supabase.from('check_request_files').insert({ check_request_id: data.id, file_url: path, file_name: f.name, sort_order: i })
      }

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

      <div className="form-group"><label className="form-label">Fund *</label>
        <select className="form-select" value={form.fund} onChange={e => set('fund', e.target.value)}>
          <option value="general">General</option>
          <option value="missions">Missions</option>
        </select></div>

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
        <label className="form-label">Backup Documents (optional, multiple allowed)</label>
        <input type="file" accept="image/*,application/pdf" multiple onChange={e => setFiles(Array.from(e.target.files || []))} />
        {files.length > 0 && (
          <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 12, color: 'var(--gray-600)' }}>
            {files.map((f, i) => <li key={i}>{f.name}</li>)}
          </ul>
        )}
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

// ── Log a General Fund deposit ────────────────────────────────────────────
function LogDepositModal({ onClose, onLogged }) {
  const [amount, setAmount] = useState('')
  const [source, setSource] = useState('')
  const [notes, setNotes] = useState('')
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    if (!amount || Number(amount) <= 0) { setError('Please enter an amount.'); return }
    setSaving(true); setError('')
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('general_fund_deposits').insert({
      entry_date: entryDate, amount: Number(amount), source: source.trim() || null, notes: notes.trim() || null, created_by: user.id,
    })
    setSaving(false)
    if (error) { setError(error.message); return }
    onLogged()
  }

  return (
    <Modal title="Log General Fund Deposit" onClose={onClose}>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="form-group">
        <label className="form-label">Amount *</label>
        <input type="number" step="0.01" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Source</label>
        <input className="form-input" value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. From trustee acct, BofA" />
      </div>
      <div className="form-group">
        <label className="form-label">Notes</label>
        <input className="form-input" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">Date</label>
        <input type="date" className="form-input" value={entryDate} onChange={e => setEntryDate(e.target.value)} />
      </div>
      <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ width: '100%', justifyContent: 'center' }}>
        {saving ? 'Saving…' : 'Log Deposit'}
      </button>
    </Modal>
  )
}

// ── Combined PDF builder: cover page(s) + embedded receipts ──────────────
async function buildCombinedPdf(unpaidGroups, filesByRequest, onProgress) {
  const doc = await PDFDocument.create()
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const WINE = rgb(0.239, 0, 0.149)
  const GRAY = rgb(0.4, 0.4, 0.4)

  let i = 0
  for (const group of unpaidGroups) {
    i++
    onProgress?.(`Building request ${i} of ${unpaidGroups.length}…`)
    const members = group.members
    const primary = members[0]
    const total = members.reduce((s, m) => s + Number(m.amount), 0)

    // ---- Cover page ----
    const page = doc.addPage([612, 792])
    let y = 740

    page.drawText('United Methodist Church of Danielson', { x: 50, y, size: 11, font: bold, color: WINE })
    y -= 16
    page.drawText('Check Request', { x: 50, y, size: 20, font: bold, color: WINE })
    y -= 34

    const line = (label, value) => {
      page.drawText(label.toUpperCase(), { x: 50, y, size: 8, font: bold, color: GRAY })
      y -= 13
      page.drawText(String(value ?? '—'), { x: 50, y, size: 12, font: regular, color: rgb(0, 0, 0) })
      y -= 22
    }

    if (members.length > 1) {
      line('Request Numbers', members.map(m => m.request_number).join(', '))
    } else {
      line('Request Number', primary.request_number)
    }
    line('Payable To', primary.payee_name)
    line('Total Amount', money(total))
    line('Request Date', fmtDate(primary.request_date))
    line('Needed By', fmtDate(members.reduce((min, m) => !min || m.needed_by_date < min ? m.needed_by_date : min, null)))
    line('Delivery', DELIVERY_LABELS[primary.delivery_method] || primary.delivery_method)
    if (primary.delivery_method !== 'in_person') {
      line('Mail To', `${primary.mailing_name || ''}\n${primary.mailing_address || ''}`)
    }

    y -= 6
    page.drawText('LINE ITEMS', { x: 50, y, size: 8, font: bold, color: GRAY })
    y -= 16
    members.forEach(m => {
      page.drawText(`${m.request_number} — ${m.requester_name}`, { x: 50, y, size: 10, font: bold })
      page.drawText(money(m.amount), { x: 480, y, size: 10, font: bold })
      y -= 13
      const desc = (m.description || '').slice(0, 95)
      page.drawText(desc, { x: 50, y, size: 9, font: regular, color: GRAY })
      y -= 10
      if (m.category) {
        page.drawText(`Category: ${m.category}`, { x: 50, y, size: 8, font: regular, color: GRAY })
        y -= 10
      }
      y -= 8
    })

    // ---- Receipts for each member request ----
    for (const m of members) {
      const files = filesByRequest[m.id] || []
      for (const file of files) {
        try {
          const { data: signed, error: signErr } = await supabase.storage.from(BACKUP_BUCKET).createSignedUrl(file.file_url, 300)
          if (signErr) throw signErr
          const resp = await fetch(signed.signedUrl)
          const bytes = await resp.arrayBuffer()
          const lowerName = file.file_name.toLowerCase()

          if (lowerName.endsWith('.pdf')) {
            const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true })
            const copied = await doc.copyPages(srcDoc, srcDoc.getPageIndices())
            copied.forEach(p => doc.addPage(p))
          } else if (lowerName.endsWith('.png')) {
            const img = await doc.embedPng(bytes)
            addImagePage(doc, img, `${m.request_number} — ${file.file_name}`, bold)
          } else if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
            const img = await doc.embedJpg(bytes)
            addImagePage(doc, img, `${m.request_number} — ${file.file_name}`, bold)
          } else {
            const notePage = doc.addPage([612, 792])
            notePage.drawText(`${m.request_number}: "${file.file_name}" — this file format can't be embedded automatically.`, { x: 50, y: 700, size: 11, font: regular })
            notePage.drawText('View it directly in Planning Hub instead.', { x: 50, y: 680, size: 11, font: regular })
          }
        } catch (err) {
          const notePage = doc.addPage([612, 792])
          notePage.drawText(`${m.request_number}: couldn't load "${file.file_name}" (${err.message}).`, { x: 50, y: 700, size: 11, font: regular })
        }
      }
    }
  }

  onProgress?.('Finishing up…')
  return doc.save()
}

function triggerPdfDownload(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Convert PDF bytes to base64 for the email Edge Function, in chunks to avoid
// call-stack limits on large files.
function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function addImagePage(doc, img, caption, boldFont) {
  const page = doc.addPage([612, 792])
  const maxW = 550, maxH = 700
  const { width, height } = img
  const scale = Math.min(maxW / width, maxH / height, 1)
  const w = width * scale, h = height * scale
  page.drawText(caption, { x: 30, y: 770, size: 9, font: boldFont, color: rgb(0.4, 0.4, 0.4) })
  page.drawImage(img, { x: (612 - w) / 2, y: 30, width: w, height: h })
}
