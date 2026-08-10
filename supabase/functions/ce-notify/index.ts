// supabase/functions/ce-notify/index.ts
//
// Called by two database triggers (not directly by the client), so it
// works no matter how the row was created — single add, bulk add, or
// the series builder:
//   trg_notify_ce_series  → AFTER INSERT ON ce_series
//   trg_notify_ce_session → AFTER INSERT ON ce_sessions (only fires the
//     HTTP call when category = 'special' or the class is a workshop)
//
// The trigger only sends { type, id } — this function looks the real
// row up itself with the service role key, so a spoofed call can't be
// used to send arbitrary email content.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Change this to whoever should get the "go advertise this" alert.
const NOTIFY_EMAIL = 'media@umcdanielson.org'
const FROM_EMAIL = 'noreply@umcdanielson.org'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

async function sendEmail(to: string, subject: string, html: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) throw new Error('RESEND_API_KEY is not configured for this project')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Resend error: ${text}`)
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

const CATEGORY_LABELS: Record<string, string> = {
  lesson: 'Lesson', craft: 'Craft', rehearsal: 'Rehearsal', party: 'Party',
  no_class: 'No Class', pageant: 'Pageant', special: 'Special',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { type, id } = await req.json()
    if (!id) throw new Error('Missing id')

    if (type === 'series') {
      const { data: series, error } = await supabase
        .from('ce_series')
        .select('*, ce_classes(name)')
        .eq('id', id)
        .single()
      if (error || !series) throw new Error('Series not found')

      const { data: sessions } = await supabase
        .from('ce_sessions')
        .select('session_date, topic')
        .eq('series_id', id)
        .order('session_date', { ascending: true })

      const dateRows = (sessions || [])
        .map(s => `<li>${formatDate(s.session_date)}${s.topic ? ` — <strong>${s.topic}</strong>` : ''}</li>`)
        .join('')

      await sendEmail(
        NOTIFY_EMAIL,
        `New series: ${series.name}`,
        `
          <div style="font-family: Georgia, serif; max-width: 520px;">
            <p>A new series was just added to <strong>${series.ce_classes?.name || 'Christian Education'}</strong>:</p>
            <h2 style="color:#3D0026;">${series.name}</h2>
            ${series.description ? `<p>${series.description.replace(/\n/g, '<br>')}</p>` : ''}
            <p style="margin: 16px 0; padding: 16px; background: #F7E6F0; border-radius: 8px;">
              <strong>Dates:</strong>
              <ul style="margin: 8px 0 0; padding-left: 20px;">${dateRows}</ul>
            </p>
            <p>Time to advertise this one! 📣</p>
          </div>
        `
      )
    } else if (type === 'session') {
      const { data: session, error } = await supabase
        .from('ce_sessions')
        .select('*, ce_classes(name, class_type)')
        .eq('id', id)
        .single()
      if (error || !session) throw new Error('Session not found')

      const isWorkshop = session.ce_classes?.class_type === 'workshop'
      const kind = isWorkshop ? 'Workshop' : (CATEGORY_LABELS[session.category] || 'Session')

      await sendEmail(
        NOTIFY_EMAIL,
        `New ${kind.toLowerCase()}${session.topic ? `: ${session.topic}` : ''}`,
        `
          <div style="font-family: Georgia, serif; max-width: 520px;">
            <p>A new <strong>${kind}</strong> was just added${session.topic ? `: <strong>${session.topic}</strong>` : ''}.</p>
            <p style="margin: 16px 0; padding: 16px; background: #F7E6F0; border-radius: 8px;">
              <strong>Class:</strong> ${session.ce_classes?.name || ''}<br>
              <strong>Date:</strong> ${formatDate(session.session_date)}
              ${session.curriculum_notes ? `<br><br>${session.curriculum_notes.replace(/\n/g, '<br>')}` : ''}
            </p>
            <p>Time to advertise this one! 📣</p>
          </div>
        `
      )
    } else {
      throw new Error('Unknown notification type')
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
