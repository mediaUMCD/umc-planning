// Pure calendar count of Sundays elapsed in the year, through the given date (inclusive).
// The 1st Sunday of the year = 1, the 2nd = 2, etc.
// For non-Sunday dates (e.g. Ash Wednesday), returns the count of Sundays that have
// already occurred that year as of that date — useful for keeping special-service
// dates in the same numbering context as the podcast episode count.
export function getSundayNumber(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr + 'T12:00:00')
  const year = d.getFullYear()
  const jan1 = new Date(year, 0, 1)
  const jan1Dow = jan1.getDay() // 0 = Sunday
  const daysToFirstSunday = (7 - jan1Dow) % 7
  const firstSunday = new Date(year, 0, 1 + daysToFirstSunday)
  if (d < firstSunday) return 0
  const diffDays = Math.round((d - firstSunday) / 86400000)
  return Math.floor(diffDays / 7) + 1
}
