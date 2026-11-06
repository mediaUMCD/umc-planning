// "Another Week in the World" now comes from the website's schedule
// (umcdanielson.org → Admin → 🗓️ Schedules, table schedule_items), so the
// schedule is kept in one place. The old hand-typed list in Bulletin
// Settings is only used as a fallback if the website list can't be loaded.
import { supabase } from './supabase.js'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export async function loadScheduleItems() {
  const { data, error } = await supabase
    .from('schedule_items')
    .select('kind, title, day_label, day_order, time_label, location, start_date, end_date, sort_order')
    .eq('is_visible', true)
    .order('day_order')
    .order('sort_order')
  if (error) {
    console.warn('Could not load website schedule, using Bulletin Settings list instead:', error.message)
    return null
  }
  return data || []
}

// "10:15 AM" → "10:15 a.m.", "2 – 3 PM" → "2 – 3 p.m." (bulletin style)
function bulletinTime(t) {
  return (t || '').trim()
    .replace(/\s*\bAM\b/gi, ' a.m.')
    .replace(/\s*\bPM\b/gi, ' p.m.')
    .replace(/:00(?= [ap]\.m\.)/g, '')
}

// True when the "When" text just repeats the day (e.g. "Sundays", "Every Sunday")
function isPlainDay(label, dayName) {
  const l = (label || '').trim().toLowerCase()
  const d = dayName.toLowerCase()
  return !l || l === d || l === d + 's' || l === 'every ' + d || l === d + ' mornings' || l === d + ' evenings'
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Turns website schedule items into the bulletin's [{ day, lines }] shape.
 * Seasonal items are included only if they run during the week that starts
 * on the service date.
 */
export function scheduleToBulletin(items, serviceDate) {
  if (!Array.isArray(items) || items.length === 0) return []
  const weekStart = serviceDate || new Date().toISOString().slice(0, 10)
  const weekEnd = addDays(weekStart, 6)

  const active = items.filter(i => {
    if (i.kind !== 'seasonal') return true
    if (i.start_date && i.start_date > weekEnd) return false
    if (i.end_date && i.end_date < weekStart) return false
    return true
  })

  const days = []
  for (let d = 0; d < 7; d++) {
    const dayName = DAY_NAMES[d]
    const lines = active
      .filter(i => (i.day_order ?? 0) === d)
      // regular items first, then this season's extras
      .sort((a, b) => ((a.kind === 'seasonal') - (b.kind === 'seasonal')) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map(i => {
        const time = bulletinTime(i.time_label)
        let line = time ? `${time} – ${i.title}` : i.title
        const place = (i.location || '').replace(/\s*\(([^)]*)\)/g, ', $1').trim()
        if (place && !i.title.toLowerCase().includes(place.toLowerCase())) line += ` (${place})`
        if (!isPlainDay(i.day_label, dayName)) line += ` – ${i.day_label}`
        return line
      })
    if (lines.length) days.push({ day: dayName, lines })
  }
  return days
}
