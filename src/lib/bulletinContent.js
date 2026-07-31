// src/lib/bulletinContent.js
//
// Shared data-shaping logic for bulletin generation.
// Both the .docx generator (bulletinDocx.js) and the in-app HTML preview
// (BulletinGenerateModal.jsx) consume this so the two never drift apart.

// The Call to Worship / Offertory Prayer boxes are contentEditable, and
// browsers represent a new paragraph there as a <div>...</div> (or a <br>),
// not a literal "\n" character. Splitting the raw value on '\n' does nothing
// in that case — the whole multi-paragraph blob comes back as a single
// "line" with nested block tags inside it, which breaks both the docx
// output and produces invalid HTML nesting in the on-screen preview
// (a <div> inside a <p>), silently corrupting formatting on some lines.
// This walks the actual HTML structure instead, so each paragraph becomes
// its own clean line — keeping any <strong>/<em> tags inside intact.
export function splitRichTextLines(html) {
  if (!html) return []
  const container = document.createElement('div')
  container.innerHTML = html.replace(/<br\s*\/?>/gi, '</div><div>')

  const hasBlockChildren = Array.from(container.childNodes).some(
    n => n.nodeType === 1 && n.tagName === 'DIV'
  )
  if (!hasBlockChildren) {
    // Plain single-paragraph content (no paragraph breaks at all).
    const text = container.innerHTML.trim()
    return text ? [text] : []
  }

  const lines = []
  let buffer = ''
  for (const node of container.childNodes) {
    if (node.nodeType === 1 && node.tagName === 'DIV') {
      if (buffer.trim()) lines.push(buffer.trim())
      buffer = ''
      const inner = node.innerHTML.trim()
      if (inner) lines.push(inner)
    } else {
      // Text/inline content before the first <div> (contentEditable often
      // leaves the very first paragraph unwrapped) — it's a complete line on its own.
      buffer += (node.outerHTML || node.textContent || '')
    }
  }
  if (buffer.trim()) lines.push(buffer.trim())
  return lines
}

export const WELCOME_PARAGRAPH_1 =
  'Good morning and welcome to worship this morning at the United Methodist Church of Danielson ' +
  'where together - in-person and online - we are\n' +
  '\u201cLearning the three O\u2019s \u2013Open Hearts, Open Minds, Open Doors.\u201d'

export const WELCOME_PARAGRAPH_2 =
  'In this place, know that you are loved. No matter what you have done or left undone, said or left ' +
  'unsaid, no matter the shame you may carry, you are a child of God\n' +
  'and most welcome here.\n' +
  'May our worship together be a time of peace, hope, and love.'

export const OFFERING_TEXT =
  'As forgiven and reconciled people, let us offer ourselves and our gifts to God, thanking ' +
  'God for all those who give online, in-person, by mail, or set-up endowments.'

export const CHURCH_NAME = 'THE UNITED METHODIST CHURCH OF DANIELSON'

/**
 * Returns the hymn's title and "UMH #139"-style reference as separate parts
 * so renderers can tab-align them, e.g.:
 *   { title: "Praise to the Lord, the Almighty", ref: "UMH #139" }
 */
export function formatHymnParts(hymn) {
  if (!hymn || !hymn.number) return null
  return { title: hymn.title || '', ref: `${hymn.hymnal} #${hymn.number}` }
}

/**
 * Returns the scripture's reference and page portion as separate parts:
 *   { reference: "Genesis 18:1-15; 21:1-7", page: "p. 17-18,21-22" }
 */
export function formatScriptureParts(scripture) {
  if (!scripture || !scripture.reference) return null
  return {
    reference: scripture.reference,
    page: scripture.page_reference ? `p. ${scripture.page_reference}` : '',
  }
}

/** @deprecated kept for back-compat with the HTML preview's simpler rendering */
export function formatHymnLine(hymn) {
  const parts = formatHymnParts(hymn)
  if (!parts) return null
  return `${parts.title}   ${parts.ref}`
}

/** @deprecated kept for back-compat with the HTML preview's simpler rendering */
export function formatScriptureLine(scripture) {
  const parts = formatScriptureParts(scripture)
  if (!parts) return null
  return parts.page ? `${parts.reference}   ${parts.page}` : parts.reference
}

/**
 * Splits free-text into paragraphs on blank lines (for prayer text fields
 * that may have multiple paragraphs) — but Call to Worship / Offertory
 * Prayer are typically single blocks, so this mostly returns one paragraph.
 * Single newlines within a block are preserved as line breaks, not new
 * paragraphs (matches how the real bulletins wrap call-and-response lines).
 */
export function splitParagraphs(text) {
  if (!text) return []
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
}

/**
 * Assembles the ordered list of Page 1 (Order of Service) entries.
 * Each entry: { type: 'static' | 'field', label, value, lines, sublines }
 * `lines` is an array of strings for multi-line content (call to worship,
 * offertory prayer) so renderers can decide how to break them.
 */
/**
 * Legacy fixed structure — used only as a fallback for services saved before
 * the row-based Bulletin Order Builder existed (no bulletin_order saved).
 */
function buildOrderOfServiceLegacy(service, hymns, scriptures) {
  const openingHymn = hymns.find(h => !h.is_closing) || hymns[0]
  const closingHymn = [...hymns].reverse().find(h => h.is_closing) || (hymns.length > 1 ? hymns[hymns.length - 1] : null)

  const scriptureLesson = scriptures.find(s => !s.is_gospel)
  const gospelLesson = scriptures.find(s => s.is_gospel)

  const items = []

  items.push({ type: 'static-label', label: 'RINGING OF THE BELL' })

  items.push({
    type: 'block',
    label: 'CALL TO WORSHIP',
    lines: service.call_to_worship_text ? splitRichTextLines(service.call_to_worship_text) : [],
  })

  if (openingHymn && openingHymn.number) {
    const parts = formatHymnParts(openingHymn)
    items.push({ type: 'tabbed', label: 'HYMN', middle: parts.title, right: parts.ref })
  }

  items.push({
    type: 'inline',
    label: service.children_message_label || "CHILDREN'S MESSAGE",
    value: service.children_message_person || '',
  })

  if (scriptureLesson) {
    const parts = formatScriptureParts(scriptureLesson)
    items.push({ type: 'tabbed', label: 'SCRIPTURE LESSON', middle: parts.reference, right: parts.page })
  }

  if (service.special_music_person) {
    items.push({ type: 'inline', label: 'SPECIAL MUSIC', value: service.special_music_person })
  }

  if (gospelLesson) {
    const parts = formatScriptureParts(gospelLesson)
    items.push({ type: 'tabbed', label: 'GOSPEL LESSON', middle: parts.reference, right: parts.page })
  }

  items.push({
    type: 'inline',
    label: 'MESSAGE',
    value: [service.spark_title ? `\u201C${service.spark_title}\u201D` : '', service.spark_preacher].filter(Boolean).join('   '),
  })

  if (service.apostles_creed_ref) {
    items.push({ type: 'inline', label: 'APOSTLES CREED', value: service.apostles_creed_ref })
  }

  items.push({ type: 'inline', label: 'JOYS AND CONCERNS/PASTORAL PRAYER', value: service.pastoral_prayer_person || '' })

  items.push({
    type: 'inline',
    label: 'LORD\u2019S PRAYER - UMH #895',
    value: service.lords_prayer_leader || '',
  })

  items.push({ type: 'block', label: 'OFFERING', lines: [OFFERING_TEXT], inlineStaticLabel: true })

  if (service.doxology_ref) {
    items.push({ type: 'inline', label: 'DOXOLOGY', value: service.doxology_ref })
  }

  items.push({
    type: 'block',
    label: 'OFFERTORY PRAYER',
    lines: service.offertory_prayer_text ? splitRichTextLines(service.offertory_prayer_text) : [],
    inlineStaticLabel: true,
  })

  items.push({ type: 'inline', label: 'WEEKLY ANNOUNCEMENTS', value: service.announcements_reader || '' })

  if (closingHymn && closingHymn.number) {
    const parts = formatHymnParts(closingHymn)
    items.push({ type: 'tabbed', label: 'HYMN', middle: parts.title, right: parts.ref })
  }

  items.push({ type: 'static-label', label: 'BENEDICTION' })

  return items
}

/**
 * Maps one Bulletin Order Builder row into the same item shape the legacy
 * builder produces, so the docx generator and HTML preview don't need to
 * know the difference. Returns null for rows with nothing to show (e.g. an
 * empty custom row, or a hymn/scripture row with no matching source entry).
 */
function itemForRow(row, occurrence, service, hymns, scriptures) {
  switch (row.type) {
    case 'welcome':
      // Welcome text is fixed content rendered unconditionally elsewhere — this
      // row exists only as a visual anchor in the builder preview.
      return null
    case 'call_to_worship':
      return {
        type: 'block', label: 'CALL TO WORSHIP',
        lines: service.call_to_worship_text ? splitRichTextLines(service.call_to_worship_text) : [],
      }
    case 'hymn': {
      const nonClosing = hymns.filter(h => !h.is_closing)
      const h = nonClosing[occurrence]
      if (!h || !h.number) return null
      const parts = formatHymnParts(h)
      return { type: 'tabbed', label: 'HYMN', middle: row.contentOverride ?? parts.title, right: parts.ref }
    }
    case 'closing_hymn': {
      const closing = hymns.filter(h => h.is_closing)
      const h = closing[occurrence]
      if (!h || !h.number) return null
      const parts = formatHymnParts(h)
      return { type: 'tabbed', label: 'HYMN', middle: row.contentOverride ?? parts.title, right: parts.ref }
    }
    case 'scripture': {
      const s = scriptures[occurrence]
      if (!s || !s.reference) return null
      const parts = formatScriptureParts(s)
      return {
        type: 'tabbed',
        label: s.is_gospel ? 'GOSPEL LESSON' : 'SCRIPTURE LESSON',
        middle: row.contentOverride ?? parts.reference,
        right: parts.page,
      }
    }
    case 'childrens_message':
      return {
        type: 'inline',
        label: service.children_message_label || "CHILDREN'S MESSAGE",
        value: service.children_message_person || '',
      }
    case 'special_music':
      if (!service.special_music_title && !service.special_music_person) return null
      return {
        type: 'inline', label: 'SPECIAL MUSIC',
        value: [service.special_music_title, service.special_music_person].filter(Boolean).join('   '),
      }
    case 'sermon': {
      const title = row.contentOverride ?? service.spark_title
      return {
        type: 'inline', label: 'MESSAGE',
        value: [title ? `\u201C${title}\u201D` : '', service.spark_preacher].filter(Boolean).join('   '),
      }
    }
    case 'apostles_creed':
      if (!service.apostles_creed_ref) return null
      return { type: 'inline', label: 'APOSTLES CREED', value: service.apostles_creed_ref }
    case 'pastoral_prayer':
      return { type: 'inline', label: 'JOYS AND CONCERNS/PASTORAL PRAYER', value: service.pastoral_prayer_person || '' }
    case 'lords_prayer':
      return { type: 'inline', label: 'LORD\u2019S PRAYER - UMH #895', value: service.lords_prayer_leader || '' }
    case 'offertory_prayer':
      return {
        type: 'block', label: 'OFFERTORY PRAYER',
        lines: service.offertory_prayer_text ? splitRichTextLines(service.offertory_prayer_text) : [],
        inlineStaticLabel: true,
      }
    case 'doxology':
      if (!service.doxology_ref) return null
      return { type: 'inline', label: 'DOXOLOGY', value: service.doxology_ref }
    case 'announcements':
      return { type: 'inline', label: 'WEEKLY ANNOUNCEMENTS', value: service.announcements_reader || '' }
    case 'benediction':
      return { type: 'static-label', label: row.contentOverride ?? 'BENEDICTION' }
    case 'great_thanksgiving':
      return { type: 'static-label', label: row.contentOverride ?? 'GREAT THANKSGIVING' }
    case 'breaking_the_bread':
      return { type: 'static-label', label: row.contentOverride ?? 'BREAKING THE BREAD' }
    case 'imposition_of_ashes':
      return { type: 'static-label', label: row.contentOverride ?? 'IMPOSITION OF ASHES' }
    case 'candlelighting':
      return { type: 'static-label', label: row.contentOverride ?? 'CANDLELIGHTING' }
    case 'custom':
      if (!row.customLabel && !row.customContent && !row.customPage) return null
      return { type: 'tabbed', label: row.customLabel || '', middle: row.customContent || '', right: row.customPage || '' }
    default:
      return null
  }
}

/**
 * Row-driven builder — used whenever the service has a saved Bulletin Order
 * Builder row list. Keeps the fixed "RINGING OF THE BELL" opener and the
 * fixed "OFFERING" blurb (never row-editable, same as before) unconditional,
 * inserting the Offering text right before whichever of Doxology/Offertory
 * Prayer appears first, matching the original fixed layout's placement.
 */
function buildOrderOfServiceFromRows(service, hymns, scriptures) {
  const items = []
  items.push({ type: 'static-label', label: 'RINGING OF THE BELL' })

  const rows = service.bulletin_order
  const hasDoxologyRow = rows.some(r => r.type === 'doxology')
  const counters = {}
  let offeringInserted = false

  for (const row of rows) {
    const occurrence = counters[row.type] || 0
    counters[row.type] = occurrence + 1

    if (!offeringInserted && (row.type === 'doxology' || (row.type === 'offertory_prayer' && !hasDoxologyRow))) {
      items.push({ type: 'block', label: 'OFFERING', lines: [OFFERING_TEXT], inlineStaticLabel: true })
      offeringInserted = true
    }

    const item = itemForRow(row, occurrence, service, hymns, scriptures)
    if (item) items.push(item)
  }

  return items
}

export function buildOrderOfService(service, hymns, scriptures) {
  if (Array.isArray(service.bulletin_order) && service.bulletin_order.length > 0) {
    return buildOrderOfServiceFromRows(service, hymns, scriptures)
  }
  return buildOrderOfServiceLegacy(service, hymns, scriptures)
}

/**
 * Assembles Page 2 (info + back cover) data — combines weekly-variable
 * service fields with the static admin-managed content.
 */
export function buildPageTwo(service, staticContent) {
  return {
    todaysLiturgist: service.liturgist || '',
    nextWeekLiturgist: service.next_week_liturgist || '',
    offeringPrayerSource: service.offering_prayer_source || '',
    callToWorshipSource: service.call_to_worship_source || '',
    announcementsList: (service.announcements_list || '').split('\n').map(l => l.trim()).filter(Boolean),
    weeklySchedule: staticContent?.weekly_schedule || [],
    zoomInfo: staticContent?.zoom_info || [],
    staffDirectory: staticContent?.staff_directory || [],
    churchOfficeHours: staticContent?.church_office_hours || '',
    churchOfficePhone: staticContent?.church_office_phone || '',
    pastorOfficeHours: staticContent?.pastor_office_hours || '',
    pastorCell: staticContent?.pastor_cell || '',
    churchTagline: staticContent?.church_tagline || 'Repentance, Renewal, Reform',
    backCoverPhotoUrl: service.back_cover_photo_url || staticContent?.default_back_cover_photo_url || '',
    specialDesignation: service.special_designation || '',
    serviceDate: service.service_date,
    serviceTime: service.service_time || '10:15 a.m.',
  }
}
