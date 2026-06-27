import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.js'

// ── Brand ──────────────────────────────────────────────────────────────────
const WINE     = '#3D0026'
const BURGUNDY = '#7A0047'
const BLUSH    = '#F7E6F0'

// Inline logos (same base64 blobs used by the store PrintOrder page)
const UMCD_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAYAAACtWK6eAAB6eElEQVR42uy9Z5gcxdX+/avqMHlmc9KupFVOSEISQeSMyckEg8EkY3C2ccRBkiM4YBubYBtjG+NAMJicEQgQQUI5p5W0q81pcurp6urqrmqvfTbQgJSc/+cffwR7ZnfvzJ59pmenp6eur4'

const BBS_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAYAAAB5fY51AADM+UlEQVR42uy9d5yd1Xkv'

// ── Status colours (same as EventPlanner) ─────────────────────────────────
const STATUS_COLORS = {
  pending:      { bg: '#FEF3C7', color: '#92400E', label: 'Pending' },
  approved:     { bg: '#D1FAE5', color: '#065F46', label: 'Approved' },
  denied:       { bg: '#FEE2E2', color: '#991B1B', label: 'Denied' },
  tabled:       { bg: '#F3F4F6', color: '#6B7280', label: 'Tabled' },
  needs_review: { bg: '#DBEAFE', color: '#1E40AF', label: 'Needs Review' },
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Component ──────────────────────────────────────────────────────────────
export default function PrintEventPlan({ proposalId, onBack }) {
  const [proposal, setProposal] = useState(null)
  const [planning, setPlanning] = useState(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  useEffect(() => {
    async function load() {
      const [{ data: prop, error: pErr }, { data: plan }] = await Promise.all([
        supabase.from('event_proposals').select('*').eq('id', proposalId).single(),
        supabase.from('event_planning_details').select('*').eq('proposal_id', proposalId).single(),
      ])
      if (pErr || !prop) { setError('Event not found.'); setLoading(false); return }
      setProposal(prop)
      setPlanning(plan || {})
      setLoading(false)
    }
    load()
  }, [proposalId])

  if (loading) return <div style={{ padding: 40, fontFamily: 'Georgia, serif' }}>Loading…</div>
  if (error)   return (
    <div style={{ padding: 40, fontFamily: 'Georgia, serif' }}>
      {error} <button onClick={onBack} style={{ marginLeft: 12, cursor: 'pointer' }}>← Back</button>
    </div>
  )

  const status = STATUS_COLORS[proposal.status] || STATUS_COLORS.pending
  const dateRange = (() => {
    const s = fmtDate(proposal.event_date)
    const e = proposal.event_end_date && proposal.event_end_date !== proposal.event_date ? fmtDate(proposal.event_end_date) : null
    return e ? `${s} – ${e}` : s
  })()

  const supplies   = planning.supplies        || []
  const swag       = planning.swag            || []
  const volunteers = planning.volunteers      || []
  const setups     = planning.setup_sessions  || []
  const costItems  = proposal.cost_items_json || []

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .page-break { page-break-after: always; }
          body { margin: 0; }
        }
        body { font-family: Georgia, 'Times New Roman', serif; background: #f0f0f0; }
        * { box-sizing: border-box; }
        .sheet {
          width: 8.5in;
          min-height: 11in;
          background: white;
          margin: 0 auto 40px;
          padding: 0.6in 0.7in;
          box-shadow: 0 2px 20px rgba(0,0,0,0.15);
          position: relative;
        }
        table.plan-table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
        table.plan-table th {
          background: ${WINE}; color: white; padding: 7px 10px;
          text-align: left; font-size: 11px; font-family: Arial, sans-serif;
        }
        table.plan-table td { padding: 6px 10px; font-size: 12px; border-bottom: 1px solid #e8e0e4; vertical-align: top; }
        table.plan-table tr:last-child td { border-bottom: none; }
        .meta-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; font-family: Arial, sans-serif; margin-bottom: 2px; }
        .meta-val   { font-size: 13px; color: #222; }
        .section-title {
          font-family: Arial, sans-serif; font-size: 11px; font-weight: bold;
          text-transform: uppercase; letter-spacing: 0.1em; color: ${WINE};
          border-bottom: 1.5px solid ${BURGUNDY}; padding-bottom: 4px; margin: 20px 0 10px;
        }
        .prose { font-size: 13px; line-height: 1.65; color: #333; white-space: pre-wrap; }
        .badge {
          display: inline-block; font-size: 11px; font-weight: 700;
          padding: 3px 10px; border-radius: 12px;
          background: ${status.bg}; color: ${status.color};
        }
      `}</style>

      {/* ── Print Controls ───────────────────────────────────────────────── */}
      <div className="no-print" style={{ background: WINE, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ color: 'white', fontFamily: 'Arial, sans-serif', fontWeight: 600 }}>
          {proposal.event_name}
        </span>
        <button
          onClick={() => window.print()}
          style={{ marginLeft: 'auto', background: 'white', color: WINE, border: 'none', padding: '8px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', fontSize: 14 }}
        >
          🖨 Print
        </button>
        <button
          onClick={onBack}
          style={{ background: 'transparent', color: 'white', border: '1px solid rgba(255,255,255,0.4)', padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontFamily: 'Arial, sans-serif', fontSize: 13 }}
        >
          ← Back to Planner
        </button>
      </div>

      {/* ══════════════════════════════════════════
          PAGE 1 — Event Overview
      ══════════════════════════════════════════ */}
      <div className="sheet page-break">
        <Header />

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 11, color: '#888', letterSpacing: '0.15em', textTransform: 'uppercase' }}>Event Planning Sheet</div>
          <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'Arial, sans-serif' }}>Staff Copy</div>
        </div>

        {/* Event title bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, padding: '10px 14px', background: BLUSH, borderRadius: 6, border: `1.5px solid ${WINE}` }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: WINE, fontFamily: 'Georgia, serif' }}>{proposal.event_name}</div>
            <div style={{ fontSize: 13, color: BURGUNDY, marginTop: 3 }}>
              {dateRange}{proposal.location ? ` · ${proposal.location}` : ''}
            </div>
          </div>
          <span className="badge">Board: {status.label}</span>
        </div>

        {/* Proposal Summary grid */}
        <div className="section-title">Proposal Summary</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 10 }}>
          {[
            ['Organizer',           proposal.organizer],
            ['Time',                proposal.event_time],
            ['Expected Attendance', proposal.expected_attendance],
            ['Entry Fee',           proposal.entry_fee    ? `$${Number(proposal.entry_fee).toFixed(2)}`    : null],
            ['Donations Expected',  proposal.donations_expected ? `$${Number(proposal.donations_expected).toFixed(2)}` : null],
          ].filter(([, v]) => v).map(([label, val]) => (
            <div key={label}>
              <div className="meta-label">{label}</div>
              <div className="meta-val">{val}</div>
            </div>
          ))}
        </div>

        {proposal.description && (
          <>
            <div className="meta-label" style={{ marginTop: 8 }}>Description</div>
            <div className="prose" style={{ marginBottom: 10 }}>{proposal.description}</div>
          </>
        )}

        {proposal.support_needed && (
          <>
            <div className="meta-label" style={{ marginTop: 8 }}>Board Support Needed</div>
            <div className="prose" style={{ marginBottom: 10 }}>{proposal.support_needed}</div>
          </>
        )}

        {/* Cost items */}
        {costItems.length > 0 && (
          <>
            <div className="section-title">Projected Costs</div>
            <table className="plan-table">
              <thead><tr><th>Item</th><th>Amount</th></tr></thead>
              <tbody>
                {costItems.map((c, i) => (
                  <tr key={i}>
                    <td>{c.description}</td>
                    <td>{c.amount ? `$${Number(c.amount).toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Theme */}
        {planning.theme && (
          <>
            <div className="section-title">Event Theme</div>
            <div className="prose">{planning.theme}</div>
          </>
        )}

        {/* Congregation notes */}
        {planning.congregation_notes && (
          <>
            <div className="section-title">Congregation Communication</div>
            <div className="prose">{planning.congregation_notes}</div>
          </>
        )}

        <Footer />
      </div>

      {/* ══════════════════════════════════════════
          PAGE 2 — Logistics
      ══════════════════════════════════════════ */}
      <div className="sheet">
        <Header />

        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 11, color: '#888', letterSpacing: '0.15em', textTransform: 'uppercase' }}>Event Logistics</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: WINE, fontFamily: 'Georgia, serif', marginTop: 4 }}>{proposal.event_name}</div>
          <div style={{ fontSize: 12, color: '#888', fontFamily: 'Arial, sans-serif', marginTop: 2 }}>{dateRange}</div>
        </div>

        {/* Setup sessions */}
        {setups.length > 0 && (
          <>
            <div className="section-title">Setup Days &amp; Times</div>
            <table className="plan-table">
              <thead><tr><th>Date</th><th>Time</th><th>Task</th><th>Notes</th></tr></thead>
              <tbody>
                {setups.map((s, i) => (
                  <tr key={i}>
                    <td>{s.date ? fmtDate(s.date) : '—'}</td>
                    <td>{s.time || '—'}</td>
                    <td>{s.task}</td>
                    <td style={{ color: '#666' }}>{s.notes || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Supplies */}
        {supplies.length > 0 && (
          <>
            <div className="section-title">Supplies Needed</div>
            <table className="plan-table">
              <thead><tr><th>Item</th><th>Qty</th><th>Notes</th><th style={{ width: 80 }}>Acquired ✓</th></tr></thead>
              <tbody>
                {supplies.map((s, i) => (
                  <tr key={i}>
                    <td>{s.item}</td>
                    <td>{s.qty || '—'}</td>
                    <td style={{ color: '#666' }}>{s.notes || ''}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', width: 14, height: 14, border: '1.5px solid #555', borderRadius: 2 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Swag */}
        {swag.length > 0 && (
          <>
            <div className="section-title">Swag &amp; Merchandise</div>
            <table className="plan-table">
              <thead><tr><th>Item</th><th>Qty</th><th>Notes</th><th style={{ width: 80 }}>Ordered ✓</th></tr></thead>
              <tbody>
                {swag.map((s, i) => (
                  <tr key={i}>
                    <td>{s.item}</td>
                    <td>{s.qty || '—'}</td>
                    <td style={{ color: '#666' }}>{s.notes || ''}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', width: 14, height: 14, border: '1.5px solid #555', borderRadius: 2 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Volunteers */}
        {volunteers.length > 0 && (
          <>
            <div className="section-title">Volunteers Needed</div>
            <table className="plan-table">
              <thead><tr><th>Role</th><th># Needed</th><th>Notes</th><th style={{ width: 120 }}>Assigned</th></tr></thead>
              <tbody>
                {volunteers.map((v, i) => (
                  <tr key={i}>
                    <td>{v.role}</td>
                    <td>{v.count || '—'}</td>
                    <td style={{ color: '#666' }}>{v.notes || ''}</td>
                    <td>
                      <div style={{ borderBottom: '1px solid #bbb', height: 20 }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* Internal notes */}
        {planning.internal_notes && (
          <>
            <div className="section-title">Internal Planning Notes</div>
            <div className="prose" style={{ background: '#fffbf0', padding: '10px 14px', borderRadius: 6, border: '1px solid #e8e0c0' }}>
              {planning.internal_notes}
            </div>
          </>
        )}

        {/* Day-of checklist */}
        <div className="section-title">Day-of Checklist</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 32px', fontSize: 12, fontFamily: 'Arial, sans-serif', color: '#333' }}>
          {[
            'Setup complete', 'Signage in place', 'Supplies on-site',
            'Volunteers briefed', 'Sound/AV ready', 'Photography arranged',
            'Cleanup plan confirmed', 'Offering/donations collected',
          ].map(item => (
            <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #eee' }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '1.5px solid #555', borderRadius: 2, flexShrink: 0 }} />
              {item}
            </div>
          ))}
        </div>

        {/* Sign-offs */}
        <div className="section-title" style={{ marginTop: 24 }}>Sign-offs</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {['Event Lead', 'Board Rep'].map(role => (
            <div key={role}>
              <div className="meta-label">{role} Signature</div>
              <div style={{ borderBottom: '1px solid #333', height: 28, marginTop: 6 }} />
              <div className="meta-label" style={{ marginTop: 8 }}>Date</div>
              <div style={{ borderBottom: '1px solid #333', height: 20, marginTop: 4 }} />
            </div>
          ))}
        </div>

        <Footer />
      </div>
    </>
  )
}

// ── Shared sub-components ──────────────────────────────────────────────────
function Header() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 16, borderBottom: `2px solid ${WINE}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <img src={UMCD_LOGO} alt="UMCD" style={{ height: 90, objectFit: 'contain', flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: WINE, fontFamily: 'Georgia, serif', lineHeight: 1.1 }}>
            United Methodist Church<br />of Danielson
          </div>
          <div style={{ fontSize: 11, color: '#888', fontFamily: 'Arial, sans-serif', marginTop: 3 }}>
            umcdanielson.org · Danielson, CT · Est. 1902
          </div>
        </div>
      </div>
      <img src={BBS_LOGO} alt="Bumble Bee Studios" style={{ height: 130, objectFit: 'contain' }} />
    </div>
  )
}

function Footer() {
  return (
    <div style={{ position: 'absolute', bottom: '0.5in', left: '0.7in', right: '0.7in', borderTop: '1px solid #ddd', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 10, color: '#aaa', fontFamily: 'Arial, sans-serif' }}>UMCD Planning Hub · Provided by Bumble Bee Studios</span>
      <img src={BBS_LOGO} alt="Bumble Bee Studios" style={{ height: 40, objectFit: 'contain', opacity: 0.55 }} />
    </div>
  )
}
