// supabase/functions/content-approval/index.ts
//
// Two actions in one function (matches the board-notify pattern):
//   action: 'request' — Corissa clicks "Send for Approval". Generates a
//     single-use token, marks that content type 'pending', and emails
//     Pastor Zach a link to review + approve.
//   action: 'approve' — Pastor Zach clicks the link and hits Approve.
//     Validates the token, marks 'approved', clears the token, and
//     emails whoever originally requested it (captured at request time).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PASTOR_EMAIL = 'pastor@umcdanielson.org'
const FROM_EMAIL = 'noreply@umcdanielson.org'
const APPROVE_BASE_URL = 'https://planning.umcdanielson.org/approve'

const CONTENT_LABELS = {
  sermon: 'Sunday Spark Sermon',
  music: 'Sunday Spark: The Set List',
}

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

function formatServiceDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { action, serviceId, contentType, requestedByEmail, token } = await req.json()

    if (!['sermon', 'music'].includes(contentType)) {
      throw new Error('Invalid contentType — must be "sermon" or "music"')
    }
    if (!serviceId) throw new Error('Missing serviceId')

    const statusField = `${contentType}_approval_status`
    const tokenField = `${contentType}_approval_token`
    const approvedAtField = `${contentType}_approved_at`
    const requestedByField = `${contentType}_requested_by_email`
    const label = CONTENT_LABELS[contentType]

    // ── Send approval request to Pastor Zach ──
    if (action === 'request') {
      const { data: svc, error: fetchErr } = await supabase
        .from('service_dates')
        .select('service_date, spark_title, podcast_summary, special_music_title, special_music_person, music_podcast_summary')
        .eq('id', serviceId)
        .single()
      if (fetchErr || !svc) throw new Error('Service not found')

      const newToken = crypto.randomUUID()
      const { error: updateErr } = await supabase
        .from('service_dates')
        .update({ [statusField]: 'pending', [tokenField]: newToken, [requestedByField]: requestedByEmail || null })
        .eq('id', serviceId)
      if (updateErr) throw updateErr

      const title = contentType === 'sermon' ? svc.spark_title : svc.special_music_title
      const blurb = contentType === 'sermon' ? svc.podcast_summary : svc.music_podcast_summary
      const dateStr = formatServiceDate(svc.service_date)
      const approveUrl = `${APPROVE_BASE_URL}?token=${newToken}&type=${contentType}&service=${serviceId}`

      await sendEmail(
        PASTOR_EMAIL,
        `Approval needed: ${label} — ${dateStr}`,
        `
          <div style="font-family: Georgia, serif; max-width: 520px;">
            <p>Hi Pastor Zach,</p>
            <p>The title and episode summary for <strong>${label}</strong> (${dateStr}) are ready for your review.</p>
            <p style="margin: 20px 0; padding: 16px; background: #F7E6F0; border-radius: 8px;">
              <strong>Title:</strong> ${title || '(none entered)'}<br><br>
              <strong>Summary:</strong><br>${(blurb || '(none entered)').replace(/\n/g, '<br>')}
            </p>
            <p><a href="${approveUrl}" style="display:inline-block;padding:12px 22px;background:#3D0026;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;">Review &amp; Approve</a></p>
            <p style="color:#888;font-size:13px;">This link is single-use and only works once.</p>
          </div>
        `
      )

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ── Pastor Zach approves ──
    if (action === 'approve') {
      if (!token) throw new Error('Missing token')

      const { data: svc, error: fetchErr } = await supabase
        .from('service_dates')
        .select(`id, service_date, spark_title, special_music_title, ${statusField}, ${tokenField}, ${requestedByField}`)
        .eq('id', serviceId)
        .single()
      if (fetchErr || !svc) throw new Error('This approval link is invalid.')
      if (svc[statusField] === 'approved') throw new Error('This has already been approved.')
      if (svc[tokenField] !== token) throw new Error('This approval link is invalid or has already been used.')

      const { error: updateErr } = await supabase
        .from('service_dates')
        .update({ [statusField]: 'approved', [approvedAtField]: new Date().toISOString(), [tokenField]: null })
        .eq('id', serviceId)
      if (updateErr) throw updateErr

      const notifyEmail = svc[requestedByField]
      if (notifyEmail) {
        const dateStr = formatServiceDate(svc.service_date)
        await sendEmail(
          notifyEmail,
          `✓ Approved: ${label} — ${dateStr}`,
          `
            <div style="font-family: Georgia, serif; max-width: 520px;">
              <p>Pastor Zach approved the <strong>${label}</strong> title and summary for <strong>${dateStr}</strong>.</p>
              <p>You're all set to publish it.</p>
            </div>
          `
        )
      }

      return new Response(JSON.stringify({
        success: true,
        title: contentType === 'sermon' ? svc.spark_title : svc.special_music_title,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    throw new Error('Unknown action — must be "request" or "approve"')
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
