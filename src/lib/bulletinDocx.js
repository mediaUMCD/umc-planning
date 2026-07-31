// src/lib/bulletinDocx.js
//
// Generates a .docx bulletin matching UMCD's exact existing Word format:
// Georgia font throughout, manual space-padded inline fields (not tab
// stops — matches the real source documents), single continuous section
// that flows from page 1 into page 2 via 2-column (landscape) or
// 1-column (portrait) layout.

import {
  Document, Packer, Paragraph, TextRun, AlignmentType, PageOrientation,
  ImageRun, TabStopType,
} from 'docx'
import {
  WELCOME_PARAGRAPH_1, WELCOME_PARAGRAPH_2, OFFERING_TEXT, CHURCH_NAME,
  buildOrderOfService, buildPageTwo,
} from './bulletinContent.js'

const FONT = 'Georgia'
const BODY_SIZE = 24   // 12pt — matches Page 1 order-of-service text in source docs
const SMALL_SIZE = 21  // 10.5pt — matches Page 2 citations/footer text in source docs

// Tab stops for title / description / page-reference rows (HYMN, SCRIPTURE
// LESSON, GOSPEL LESSON).
//
// Portrait is a 9"-wide single column, so a left tab at 2.5" (for the
// title/description) plus a left tab at 6" (for the page ref) fits
// comfortably as requested.
//
// Landscape columns are only 4.75" wide. Long hymn titles and scripture
// references (e.g. "Praise to the Lord, the Almighty", "Genesis 18:1-15;
// 21:1-7") can run close to 3" on their own — a fixed label+title tab stop
// at that width leaves no room and forces ugly wrapping. So landscape uses
// just ONE right-aligned tab at the column's right edge: label and title
// run together naturally (title starts right after the label, like the
// original source docs), and the page/hymnal reference is pushed flush
// right for a clean aligned look without truncating the title.
const TAB_STOPS_PORTRAIT = [
  { type: TabStopType.LEFT, position: 2.5 * 1440 },
  { type: TabStopType.LEFT, position: 6 * 1440 },
]
const TAB_STOPS_LANDSCAPE = [
  { type: TabStopType.RIGHT, position: 4.75 * 1440 },
]

function run(text, opts = {}) {
  return new TextRun({ text, font: FONT, size: BODY_SIZE, ...opts })
}

// Splits a line that may contain <strong>/<b> and <em>/<i> tags (from the
// Call to Worship / Offertory Prayer rich text boxes) into TextRuns with
// bold/italics set, instead of printing the raw tags as literal text.
function parseFormattedRuns(text, runOpts = {}) {
  if (!text) return [run('', runOpts)]
  const normalized = text
    .replace(/<b>/gi, '<strong>').replace(/<\/b>/gi, '</strong>')
    .replace(/<i>/gi, '<em>').replace(/<\/i>/gi, '</em>')
  const runs = []
  const pattern = /<strong>(.*?)<\/strong>|<em>(.*?)<\/em>|([^<]+)/gi
  let match
  while ((match = pattern.exec(normalized)) !== null) {
    if (match[1] !== undefined) runs.push(run(match[1], { ...runOpts, bold: true }))
    else if (match[2] !== undefined) runs.push(run(match[2], { ...runOpts, italics: true }))
    else if (match[3]) runs.push(run(match[3], runOpts))
  }
  return runs.length ? runs : [run('', runOpts)]
}

// Tighter spacing than the source docs' w:line="360" — less padding between
// lines per Corissa's request. 276 ≈ single-spaced-plus-a-touch (matches
// the Normal style's own default line spacing seen in the source files).
const LINE_SPACING = { after: 20, line: 276, lineRule: 'auto' }

function para(children, opts = {}) {
  return new Paragraph({
    children: Array.isArray(children) ? children : [children],
    spacing: LINE_SPACING,
    ...opts,
  })
}

// Welcome heading is always centered and larger than body text, regardless of layout.
const WELCOME_SIZE = 28 // 14pt
function welcomePara(text) {
  return new Paragraph({
    children: [run(text, { size: WELCOME_SIZE })],
    alignment: AlignmentType.CENTER,
    spacing: LINE_SPACING,
  })
}

function blankLine() {
  return new Paragraph({ children: [], spacing: LINE_SPACING })
}

/**
 * Builds a tab-aligned row.
 * Portrait (2 tab stops): LABEL [tab] middle text [tab] right text.
 * Landscape (1 right-aligned tab stop): LABEL middle text [tab] right text
 *   — label and middle run together with a single space since the column
 *   is too narrow for a fixed label/title boundary; right text (page or
 *   hymnal ref) is pushed flush right.
 */
function tabbedPara(label, middle, right, tabStops) {
  const text = tabStops.length === 1
    ? `${label}${middle ? ' ' + middle : ''}\t${right || ''}`
    : `${label}\t${middle || ''}\t${right || ''}`
  return new Paragraph({
    tabStops,
    spacing: LINE_SPACING,
    children: [run(text)],
  })
}

/** Multi-line text -> array of Paragraphs, one per line (preserves line breaks like the source docs). */
function linesToParagraphs(lines, runOpts = {}) {
  if (!lines || lines.length === 0) return [para(run('', runOpts))]
  return lines.map(line => para(parseFormattedRuns(line, runOpts)))
}

function buildOrderOfServiceParagraphs(service, hymns, scriptures) {
  const items = buildOrderOfService(service, hymns, scriptures)
  const paragraphs = []
  const isLandscape = service.bulletin_orientation !== 'portrait'
  const tabStops = isLandscape ? TAB_STOPS_LANDSCAPE : TAB_STOPS_PORTRAIT

  // Welcome block — always centered, larger than body text
  for (const line of WELCOME_PARAGRAPH_1.split('\n')) paragraphs.push(welcomePara(line))
  paragraphs.push(blankLine())
  for (const line of WELCOME_PARAGRAPH_2.split('\n')) paragraphs.push(welcomePara(line))
  paragraphs.push(blankLine())

  for (const item of items) {
    if (item.type === 'static-label') {
      paragraphs.push(para(run(item.label)))
    } else if (item.type === 'tabbed') {
      paragraphs.push(tabbedPara(item.label, item.middle, item.right, tabStops))
    } else if (item.type === 'inline') {
      const text = item.value ? `${item.label}   ${item.value}` : item.label
      paragraphs.push(para(run(text)))
    } else if (item.type === 'block') {
      const lines = item.lines && item.lines.length ? item.lines : ['']
      if (item.inlineStaticLabel) {
        // e.g. "OFFERING \u2013 As forgiven..." / "OFFERTORY PRAYER \u2013 Listening God..."
        paragraphs.push(para(run(`${item.label} \u2013 ${lines[0]}`)))
        for (const extra of lines.slice(1)) paragraphs.push(para(run(extra)))
      } else {
        paragraphs.push(para(run(item.label)))
        for (const line of lines) paragraphs.push(para(run(line)))
      }
    }
  }

  return paragraphs
}

async function fetchImageBuffer(url) {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const arrayBuffer = await res.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  } catch {
    return null
  }
}

function buildPageTwoParagraphs(pageTwo) {
  const paragraphs = []
  const s = { size: SMALL_SIZE }

  paragraphs.push(para(run(`Today\u2019s Liturgist \u2013 ${pageTwo.todaysLiturgist || ''}`, s)))
  paragraphs.push(para(run(`Next Week\u2019s Liturgist\u2013 ${pageTwo.nextWeekLiturgist || ''}`, s)))
  paragraphs.push(blankLine())

  if (pageTwo.offeringPrayerSource) {
    paragraphs.push(para(run(pageTwo.offeringPrayerSource, s)))
  }
  if (pageTwo.callToWorshipSource) {
    paragraphs.push(para(run(pageTwo.callToWorshipSource, s)))
  }
  paragraphs.push(blankLine())

  paragraphs.push(para(run('WEEKLY ANNOUNCEMENTS:', s)))
  if (pageTwo.announcementsList.length === 0) {
    paragraphs.push(para(run('\u2014', s)))
  } else {
    for (const line of pageTwo.announcementsList) paragraphs.push(para(run(line, s)))
  }
  paragraphs.push(blankLine())

  paragraphs.push(para(run('ANOTHER WEEK IN THE WORLD:', s)))
  for (const day of pageTwo.weeklySchedule) {
    const dayLines = day.lines || []
    if (dayLines.length === 0) continue
    paragraphs.push(para(run(`${day.day}:   ${dayLines[0]}`, s)))
    for (const extra of dayLines.slice(1)) {
      paragraphs.push(para(run(`        ${extra}`, s)))
    }
  }
  paragraphs.push(blankLine())

  paragraphs.push(para(run('ZOOM Info:', s)))
  for (const z of pageTwo.zoomInfo) {
    paragraphs.push(para(run(`${z.label}: Meeting ID: ${z.meeting_id}`, s)))
    paragraphs.push(blankLine())
  }

  for (const staffMember of pageTwo.staffDirectory) {
    paragraphs.push(para(run(`${staffMember.role}: ${staffMember.name}`, s)))
  }
  paragraphs.push(para(run(`Church Office Hours: ${pageTwo.churchOfficeHours}`, s)))
  paragraphs.push(para(run(`Church Office: ${pageTwo.churchOfficePhone}`, s)))
  paragraphs.push(blankLine())

  paragraphs.push(para(run(`Pastor\u2019s Office Hours: ${pageTwo.pastorOfficeHours}`, s)))
  paragraphs.push(para(run(`Pastor\u2019s Cell: ${pageTwo.pastorCell}`, s)))

  return paragraphs
}

function formatServiceDateLong(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

async function buildBackCoverParagraphs(pageTwo) {
  const paragraphs = []
  const nameSize = { size: 36 } // 18pt
  const taglineSize = { size: 28 } // 14pt

  paragraphs.push(blankLine())
  paragraphs.push(blankLine())
  paragraphs.push(para(run(CHURCH_NAME, nameSize), { alignment: AlignmentType.CENTER }))
  paragraphs.push(para(run(pageTwo.churchTagline, taglineSize), { alignment: AlignmentType.CENTER }))
  paragraphs.push(blankLine())

  const imgBuffer = await fetchImageBuffer(pageTwo.backCoverPhotoUrl)
  if (imgBuffer) {
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          data: imgBuffer,
          transformation: { width: 280, height: 280 },
          type: 'png',
        }),
      ],
    }))
    paragraphs.push(blankLine())
  }

  const dateLine = pageTwo.specialDesignation
    ? `${pageTwo.specialDesignation}\n${formatServiceDateLong(pageTwo.serviceDate)}\n${pageTwo.serviceTime}`
    : `${formatServiceDateLong(pageTwo.serviceDate)}, ${pageTwo.serviceTime}`

  for (const line of dateLine.split('\n')) {
    paragraphs.push(para(run(line, taglineSize), { alignment: AlignmentType.CENTER }))
  }

  return paragraphs
}

/**
 * Builds and returns a Blob for the generated .docx bulletin.
 * @param {object} service - the service form data (snake_case fields matching DB columns)
 * @param {array} hymns - service_hymns rows: { hymnal, number, title, is_closing }
 * @param {array} scriptures - service_scriptures rows: { reference, page_reference, is_gospel }
 * @param {object} staticContent - the single bulletin_static_content row
 */
export async function generateBulletinDocx(service, hymns, scriptures, staticContent) {
  const orientation = service.bulletin_orientation === 'portrait' ? 'portrait' : 'landscape'
  const pageTwo = buildPageTwo(service, staticContent)

  const orderOfServiceParas = buildOrderOfServiceParagraphs(service, hymns, scriptures)
  const pageTwoInfoParas = buildPageTwoParagraphs(pageTwo)
  const backCoverParas = await buildBackCoverParagraphs(pageTwo)

  const body = [
    ...orderOfServiceParas,
    blankLine(),
    blankLine(),
    ...pageTwoInfoParas,
    ...backCoverParas,
  ]

  const isLandscape = orientation === 'landscape'

  const sectionProperties = isLandscape
    ? {
        page: {
          size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
        column: { count: 2, space: 720 },
      }
    : {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
        column: { count: 1, space: 720 },
      }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: FONT, size: BODY_SIZE } },
      },
    },
    sections: [
      {
        properties: sectionProperties,
        children: body,
      },
    ],
  })

  return Packer.toBlob(doc)
}
