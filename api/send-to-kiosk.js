export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { title, description, event_date, event_time, location, existingKioskEventId, signupFields } = req.body || {}
  if (!title) return res.status(400).json({ error: 'Missing title' })

  try {
    const kioskRes = await fetch('https://kiosk.umcdanielson.org/api/import-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-import-secret': process.env.PLANNING_IMPORT_SECRET,
      },
      body: JSON.stringify({ title, description, event_date, event_time, location, existingKioskEventId, signupFields }),
    })

    const json = await kioskRes.json()
    if (!kioskRes.ok) throw new Error(json.error || `Kiosk responded ${kioskRes.status}`)

    return res.status(200).json(json)
  } catch (err) {
    console.error('send-to-kiosk error:', err)
    return res.status(500).json({ error: err.message || 'Unknown error' })
  }
}
