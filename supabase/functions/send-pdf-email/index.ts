// supabase/functions/send-pdf-email/index.ts
//
// Generic "email me this PDF" function. Built for the combined
// unpaid check-requests PDF (generated client-side with pdf-lib),
// but written generically in case other reports want the same
// "email a file attachment" behavior later.
//
// Deploy:
//   supabase functions deploy send-pdf-email --project-ref zdpstnmfcfbcmhtfayls
//
// Reuses RESEND_API_KEY (already set from board-notify / check-request-notify).

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM_ADDRESS = 'UMCD Planning Hub <noreply@umcdanielson.org>'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    const { to, subject, message, filename, pdfBase64 } = await req.json()

    if (!to || !filename || !pdfBase64) {
      return json({ error: 'to, filename, and pdfBase64 are required' }, 400)
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: Array.isArray(to) ? to : [to],
        subject: subject || filename,
        html: `<p style="font-family: Georgia, serif;">${message || 'Attached PDF is ready.'}</p>`,
        attachments: [
          { filename, content: pdfBase64 },
        ],
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      return json({ error: `Resend error: ${text}` }, 500)
    }

    return json({ sent: true })
  } catch (err) {
    return json({ error: err.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}
