import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase.js'
import { generateBulletinDocx } from '../lib/bulletinDocx.js'
import {
  WELCOME_PARAGRAPH_1, WELCOME_PARAGRAPH_2, OFFERING_TEXT, CHURCH_NAME,
  buildOrderOfService, buildPageTwo,
} from '../lib/bulletinContent.js'

function formatServiceDateLong(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Renders one Order-of-Service item the same way for the HTML preview. */
function OrderItem({ item, isLandscape }) {
  const style = { margin: '0 0 2px 0' }
  if (item.type === 'static-label') {
    return <p style={style}>{item.label}</p>
  }
  if (item.type === 'tabbed') {
    if (isLandscape) {
      // Matches the docx's single right-aligned tab: label + title run
      // together, reference is pushed flush right.
      return (
        <p style={{ ...style, display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <span>{item.label}{item.middle ? ` ${item.middle}` : ''}</span>
          <span style={{ whiteSpace: 'nowrap' }}>{item.right || ''}</span>
        </p>
      )
    }
    // Portrait: three columns, roughly matching the 2.5"/6" tab stops in a 9" column (~28%/67%).
    return (
      <p style={{ ...style, display: 'flex', gap: '4px' }}>
        <span style={{ width: '28%', flexShrink: 0 }}>{item.label}</span>
        <span style={{ width: '39%', flexShrink: 0 }}>{item.middle || ''}</span>
        <span>{item.right || ''}</span>
      </p>
    )
  }
  if (item.type === 'inline') {
    return <p style={style}>{item.label}{item.value ? `   ${item.value}` : ''}</p>
  }
  // block
  const lines = item.lines && item.lines.length ? item.lines : ['']
  if (item.inlineStaticLabel) {
    return (
      <>
        <p style={style}>{item.label} &ndash; <span dangerouslySetInnerHTML={{ __html: lines[0] }} /></p>
        {lines.slice(1).map((l, i) => <p key={i} style={style} dangerouslySetInnerHTML={{ __html: l }} />)}
      </>
    )
  }
  return (
    <>
      <p style={style}>{item.label}</p>
      {lines.map((l, i) => <p key={i} style={style} dangerouslySetInnerHTML={{ __html: l }} />)}
    </>
  )
}

function BulletinPreview({ service, hymns, scriptures, staticContent }) {
  const items = useMemo(() => buildOrderOfService(service, hymns, scriptures), [service, hymns, scriptures])
  const pageTwo = useMemo(() => buildPageTwo(service, staticContent), [service, staticContent])
  const isLandscape = service.bulletin_orientation !== 'portrait'

  const bodyStyle = {
    fontFamily: 'Georgia, serif',
    fontSize: '14px',
    lineHeight: 1.6,
    color: '#1a1a1a',
    columns: isLandscape ? 2 : 1,
    columnGap: '32px',
  }

  const smallStyle = { fontSize: '12px' }

  return (
    <div style={{ background: 'white', padding: '32px', border: '1px solid var(--gray-200)', borderRadius: '8px', maxWidth: isLandscape ? '100%' : '650px', margin: '0 auto' }}>
      <div style={bodyStyle}>
        <p style={{ margin: '0 0 8px 0' }}>{WELCOME_PARAGRAPH_1.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}</p>
        <p style={{ margin: '0 0 12px 0' }}>{WELCOME_PARAGRAPH_2.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}</p>
        {items.map((item, i) => <OrderItem key={i} item={item} isLandscape={isLandscape} />)}
      </div>

      <div style={{ ...bodyStyle, ...smallStyle, marginTop: '24px', borderTop: '1px solid var(--gray-100)', paddingTop: '16px' }}>
        <p style={{ margin: 0 }}>Today&rsquo;s Liturgist &ndash; {pageTwo.todaysLiturgist}</p>
        <p style={{ margin: '0 0 10px 0' }}>Next Week&rsquo;s Liturgist&ndash;{pageTwo.nextWeekLiturgist}</p>
        {pageTwo.offeringPrayerSource && <p style={{ margin: 0 }}>{pageTwo.offeringPrayerSource}</p>}
        {pageTwo.callToWorshipSource && <p style={{ margin: '0 0 10px 0' }}>{pageTwo.callToWorshipSource}</p>}

        <p style={{ margin: 0, fontWeight: 'bold' }}>WEEKLY ANNOUNCEMENTS:</p>
        {pageTwo.announcementsList.length === 0
          ? <p style={{ margin: '0 0 10px 0', color: 'var(--gray-400)', fontStyle: 'italic' }}>(none entered)</p>
          : pageTwo.announcementsList.map((l, i) => <p key={i} style={{ margin: 0 }}>{l}</p>)
        }

        <p style={{ margin: '10px 0 0 0', fontWeight: 'bold' }}>ANOTHER WEEK IN THE WORLD:</p>
        {pageTwo.weeklySchedule.map((day, i) => (
          <div key={i}>
            <p style={{ margin: 0 }}>{day.day}:   {day.lines?.[0]}</p>
            {day.lines?.slice(1).map((l, j) => <p key={j} style={{ margin: 0, paddingLeft: '20px' }}>{l}</p>)}
          </div>
        ))}

        <p style={{ margin: '10px 0 0 0', fontWeight: 'bold' }}>ZOOM Info:</p>
        {pageTwo.zoomInfo.map((z, i) => <p key={i} style={{ margin: '0 0 6px 0' }}>{z.label}: Meeting ID: {z.meeting_id}</p>)}

        {pageTwo.staffDirectory.map((s, i) => <p key={i} style={{ margin: 0 }}>{s.role}: {s.name}</p>)}
        <p style={{ margin: 0 }}>Church Office Hours: {pageTwo.churchOfficeHours}</p>
        <p style={{ margin: '0 0 10px 0' }}>Church Office: {pageTwo.churchOfficePhone}</p>
        <p style={{ margin: 0 }}>Pastor&rsquo;s Office Hours: {pageTwo.pastorOfficeHours}</p>
        <p style={{ margin: 0 }}>Pastor&rsquo;s Cell: {pageTwo.pastorCell}</p>
      </div>

      <div style={{ textAlign: 'center', marginTop: '32px', fontFamily: 'Georgia, serif' }}>
        {pageTwo.backCoverPhotoUrl && (
          <img
            src={pageTwo.backCoverPhotoUrl}
            alt="Church"
            style={{ width: '180px', height: '180px', borderRadius: '50%', objectFit: 'cover', marginBottom: '16px' }}
          />
        )}
        <div style={{ fontSize: '20px' }}>{CHURCH_NAME}</div>
        <div style={{ fontSize: '16px', marginTop: '4px' }}>{pageTwo.churchTagline}</div>
        {pageTwo.specialDesignation && <div style={{ fontSize: '16px', marginTop: '12px' }}>{pageTwo.specialDesignation}</div>}
        <div style={{ fontSize: '16px', marginTop: pageTwo.specialDesignation ? '0' : '12px' }}>
          {pageTwo.specialDesignation ? formatServiceDateLong(pageTwo.serviceDate) : `${formatServiceDateLong(pageTwo.serviceDate)}, ${pageTwo.serviceTime}`}
        </div>
        {pageTwo.specialDesignation && <div style={{ fontSize: '16px' }}>{pageTwo.serviceTime}</div>}
      </div>
    </div>
  )
}

export default function BulletinGenerateModal({ service, hymns, scriptures, onClose }) {
  const [staticContent, setStaticContent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data, error } = await supabase.from('bulletin_static_content').select('*').limit(1).single()
      if (error) setError('Could not load static bulletin content (weekly schedule, Zoom info, staff directory). Set this up on the Bulletin Settings page first.')
      setStaticContent(data || null)
      setLoading(false)
    }
    load()
  }, [])

  async function handleDownload() {
    setGenerating(true)
    setError(null)
    try {
      const blob = await generateBulletinDocx(service, hymns, scriptures, staticContent)
      const dateLabel = service.service_date || 'bulletin'
      downloadBlob(blob, `${dateLabel}_Bulletin.docx`)
    } catch (err) {
      console.error(err)
      setError('Something went wrong generating the document: ' + err.message)
    }
    setGenerating(false)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}
      onClick={onClose}
    >
      <div
        style={{ background: 'var(--gray-50)', borderRadius: '12px', maxWidth: '1100px', width: '100%', maxHeight: '95vh', overflowY: 'auto', boxShadow: 'var(--shadow-md)' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ position: 'sticky', top: 0, background: 'white', borderBottom: '1px solid var(--gray-100)', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1, borderRadius: '12px 12px 0 0' }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '18px', color: 'var(--burgundy)', fontWeight: 700 }}>Bulletin Preview</h2>
            <div style={{ fontSize: '12px', color: 'var(--gray-400)' }}>{service.bulletin_orientation === 'portrait' ? 'Portrait, single-column' : 'Landscape, 2-column'}</div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-primary" onClick={handleDownload} disabled={loading || generating}>
              {generating ? 'Generating…' : '⬇️ Download .docx'}
            </button>
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>

        <div style={{ padding: '24px' }}>
          {error && <div className="alert alert-error">{error}</div>}
          {loading ? (
            <div className="spinner" />
          ) : (
            <BulletinPreview service={service} hymns={hymns} scriptures={scriptures} staticContent={staticContent} />
          )}
        </div>
      </div>
    </div>
  )
}
