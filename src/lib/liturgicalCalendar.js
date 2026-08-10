// Shared liturgical calendar logic — single source of truth used by both
// Service Planner and Christian Education, so "what season/color is this
// Sunday" is computed identically everywhere in the app.

export const SEASONS = [
  { name: '1st Sunday of Advent', color: 'Purple' },
  { name: '2nd Sunday of Advent', color: 'Purple' },
  { name: '3rd Sunday of Advent', color: 'Purple' },
  { name: '4th Sunday of Advent', color: 'Purple' },
  { name: 'Christmas', color: 'White' },
  { name: 'Baptism of the Lord', color: 'White' },
  { name: '1st Sunday after Epiphany', color: 'White' },
  { name: '2nd Sunday after Epiphany', color: 'Green' },
  { name: '3rd Sunday after Epiphany', color: 'Green' },
  { name: '4th Sunday after Epiphany', color: 'Green' },
  { name: '5th Sunday after Epiphany', color: 'Green' },
  { name: '6th Sunday after Epiphany', color: 'Green' },
  { name: '7th Sunday after Epiphany', color: 'Green' },
  { name: '8th Sunday after Epiphany', color: 'Green' },
  { name: 'Transfiguration Sunday', color: 'White' },
  { name: 'Ash Wednesday', color: 'Grey' },
  { name: '1st Sunday of Lent', color: 'Purple' },
  { name: '2nd Sunday of Lent', color: 'Purple' },
  { name: '3rd Sunday of Lent', color: 'Purple' },
  { name: '4th Sunday of Lent', color: 'Purple' },
  { name: '5th Sunday of Lent', color: 'Purple' },
  { name: 'Palm/Passion Sunday', color: 'Green' },
  { name: 'Maundy Thursday', color: 'Purple' },
  { name: 'Good Friday', color: 'Purple' },
  { name: 'Easter Sunday', color: 'White' },
  { name: '2nd Sunday of Easter', color: 'White' },
  { name: '3rd Sunday of Easter', color: 'White' },
  { name: '4th Sunday of Easter', color: 'White' },
  { name: '5th Sunday of Easter', color: 'White' },
  { name: '6th Sunday of Easter', color: 'White' },
  { name: 'Ascension Sunday', color: 'White' },
  { name: '7th Sunday of Easter', color: 'White' },
  { name: 'Pentecost', color: 'Red' },
  { name: 'Trinity Sunday', color: 'White' },
  { name: 'Season after Pentecost', color: 'Green' },
  { name: 'Rally Day', color: 'Green' },
  { name: 'All Saints Day', color: 'White' },
  { name: 'Thanksgiving', color: 'Green' },
  { name: 'Christ the King Sunday', color: 'White' },
]

export function getSeasonColor(season) {
  const found = SEASONS.find(s => s.name === season)
  return found ? found.color : ''
}

export function getSeasonStyle(color) {
  const map = {
    'Purple': { bg: '#f3e5f5', color: '#6B2D8B' },
    'White': { bg: '#fff8e7', color: '#b8860b' },
    'Green': { bg: '#e8f5ee', color: '#2d7a4f' },
    'Red': { bg: '#fdecea', color: '#c0392b' },
    'Grey': { bg: '#f0f0f0', color: '#666' },
  }
  return map[color] || { bg: '#f0ede8', color: '#5c5850' }
}

export function getSeasonFromDate(dateStr) {
  if (!dateStr) return { season: '', color: '' }
  const d = new Date(dateStr + 'T12:00:00')
  const year = d.getFullYear()

  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100
    const d2 = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d2 - g + 15) % 30
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31)
    const day = ((h + l - 7 * m + 114) % 31) + 1
    return new Date(y, month - 1, day)
  }

  const e = easter(year)
  const addDays = (dt, n) => new Date(dt.getTime() + n * 86400000)
  const sameDay = (a, b) => a.toDateString() === b.toDateString()

  const ashWed = addDays(e, -46)
  const palmSunday = addDays(e, -7)
  const maundyThursday = addDays(e, -3)
  const goodFriday = addDays(e, -2)
  const pentecost = addDays(e, 49)
  const trinity = addDays(pentecost, 7)
  const christmas = new Date(year, 11, 25)
  const christmasDow = christmas.getDay()
  const advent1 = addDays(christmas, -(christmasDow === 0 ? 28 : christmasDow + 21))

  if (sameDay(d, goodFriday)) return { season: 'Good Friday', color: 'Purple' }
  if (sameDay(d, maundyThursday)) return { season: 'Maundy Thursday', color: 'Purple' }
  if (sameDay(d, palmSunday)) return { season: 'Palm/Passion Sunday', color: 'Green' }
  if (sameDay(d, e)) return { season: 'Easter Sunday', color: 'White' }
  if (sameDay(d, pentecost)) return { season: 'Pentecost', color: 'Red' }
  if (sameDay(d, trinity)) return { season: 'Trinity Sunday', color: 'White' }
  if (sameDay(d, ashWed)) return { season: 'Ash Wednesday', color: 'Grey' }

  if (d >= advent1 && d < new Date(year, 11, 26)) {
    const week = Math.floor((d - advent1) / 86400000 / 7) + 1
    return { season: `${['1st','2nd','3rd','4th'][week-1]} Sunday of Advent`, color: 'Purple' }
  }
  if (d >= new Date(year, 11, 26) || d <= new Date(year, 0, 5)) return { season: 'Christmas', color: 'White' }

  const epiphany = new Date(year, 0, 6)
  const transfiguration = addDays(ashWed, -3)
  if (d >= epiphany && d <= transfiguration) {
    if (sameDay(d, transfiguration)) return { season: 'Transfiguration Sunday', color: 'White' }
    const week = Math.floor((d - epiphany) / 86400000 / 7)
    if (week === 0) return { season: 'Baptism of the Lord', color: 'White' }
    return { season: `${['1st','2nd','3rd','4th','5th','6th','7th','8th'][week]} Sunday after Epiphany`, color: week === 0 ? 'White' : 'Green' }
  }

  if (d > ashWed && d < palmSunday) {
    const week = Math.floor((d - ashWed) / 86400000 / 7) + 1
    return { season: `${['1st','2nd','3rd','4th','5th'][week-1]} Sunday of Lent`, color: 'Purple' }
  }

  if (d > e && d < pentecost) {
    const week = Math.floor((d - e) / 86400000 / 7)
    return { season: `${['2nd','3rd','4th','5th','6th','7th'][week-1]} Sunday of Easter`, color: 'White' }
  }

  if (d > pentecost) {
    const christKing = addDays(advent1, -7)
    if (sameDay(d, christKing)) return { season: 'Christ the King Sunday', color: 'White' }
    if (d.getMonth() === 8 && d.getDate() <= 7) return { season: 'Rally Day', color: 'Green' }
    if (d.getMonth() === 10 && d.getDate() <= 7) return { season: 'All Saints Day', color: 'White' }
    return { season: 'Season after Pentecost', color: 'Green' }
  }

  return { season: '', color: '' }
}
