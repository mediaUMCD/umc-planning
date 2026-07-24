// Check Requests has moved to One Board (board.umcdanielson.org).
// This page is kept in place (rather than deleted) so old bookmarks and
// finance-only logins land somewhere useful instead of a blank/broken page.

const BOARD_URL = 'https://board.umcdanielson.org/check-requests'

export default function CheckRequests() {
  return (
    <div className="page-body">
      <div className="card" style={{ maxWidth: 560, margin: '60px auto', padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🧾</div>
        <h2 style={{ margin: '0 0 10px', color: 'var(--burgundy)' }}>Check Requests has moved</h2>
        <p style={{ color: 'var(--gray-600)', marginBottom: 20 }}>
          Submitting, reviewing, and paying check requests now happens in One Board — including the register export and PDF/email tools.
        </p>
        <a className="btn btn-primary" href={BOARD_URL}>Go to Check Requests in One Board →</a>
        <p style={{ fontSize: 12, color: 'var(--gray-400)', marginTop: 20 }}>
          Public submissions still come in through the website's "Submit a Request" page — nothing changes there.
        </p>
      </div>
    </div>
  )
}
