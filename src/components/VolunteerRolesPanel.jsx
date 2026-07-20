import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const STANDARD_ROLES = [
  { role_name: 'Liturgist', max_slots: 1 },
  { role_name: "Children's Story", max_slots: 1 },
  { role_name: 'Greeter', max_slots: 2 },
  { role_name: 'Fellowship Hour Host', max_slots: 1 },
  { role_name: 'Flowers', max_slots: 1 },
]

export default function VolunteerRolesPanel({ serviceId, serviceDate, serviceTime }) {
  const [volunteerEvent, setVolunteerEvent] = useState(null)
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [newRole, setNewRole] = useState({ role_name: '', max_slots: 1 })
  const [error, setError] = useState('')

  useEffect(() => { load() }, [serviceId])

  async function load() {
    setLoading(true)
    const { data: ve } = await supabase.from('volunteer_events').select('*').eq('service_date_id', serviceId).maybeSingle()
    setVolunteerEvent(ve)
    if (ve) {
      const { data: r } = await supabase.from('volunteer_roles').select('*, volunteer_signups(*)').eq('event_id', ve.id).order('role_name')
      setRoles(r || [])
    } else {
      setRoles([])
    }
    setLoading(false)
  }

  async function ensureEvent() {
    if (volunteerEvent) return volunteerEvent
    const dateLabel = new Date(serviceDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const { data, error } = await supabase.from('volunteer_events').insert({
      event_name: `Sunday Worship — ${dateLabel}`,
      event_date: serviceDate,
      event_time: serviceTime || null,
      service_date_id: serviceId,
    }).select().single()
    if (error) { setError(error.message); return null }
    setVolunteerEvent(data)
    return data
  }

  async function addStandardRoles() {
    setError('')
    const ve = await ensureEvent()
    if (!ve) return
    const existingNames = new Set(roles.map(r => r.role_name))
    const toAdd = STANDARD_ROLES.filter(r => !existingNames.has(r.role_name)).map(r => ({ ...r, event_id: ve.id }))
    if (toAdd.length === 0) return
    const { error } = await supabase.from('volunteer_roles').insert(toAdd)
    if (error) { setError(error.message); return }
    load()
  }

  async function addCustomRole() {
    if (!newRole.role_name.trim()) return
    setError('')
    const ve = await ensureEvent()
    if (!ve) return
    const { error } = await supabase.from('volunteer_roles').insert({
      event_id: ve.id, role_name: newRole.role_name.trim(), max_slots: Number(newRole.max_slots) || 1,
    })
    if (error) { setError(error.message); return }
    setNewRole({ role_name: '', max_slots: 1 })
    setAdding(false)
    load()
  }

  async function removeRole(roleId) {
    if (!confirm('Remove this role? Any existing signups for it will be deleted too.')) return
    await supabase.from('volunteer_roles').delete().eq('id', roleId)
    load()
  }

  if (loading) return null

  return (
    <div className="card">
      <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--burgundy)', marginBottom: 14, paddingBottom: 8, borderBottom: '1px solid var(--gray-100)' }}>
        🙋 Volunteer Signups
      </h2>

      {error && <div className="alert alert-error">{error}</div>}

      {roles.length === 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 14, color: 'var(--gray-400)', fontStyle: 'italic', marginBottom: 10 }}>
            No signups set up for this Sunday yet.
          </p>
          <button className="btn btn-secondary btn-sm" onClick={addStandardRoles}>
            + Add Standard Roles (Liturgist, Children's Story, Greeter, Fellowship Hour, Flowers)
          </button>
        </div>
      )}

      {roles.map(role => {
        const filled = role.volunteer_signups || []
        return (
          <div key={role.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--gray-100)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{role.role_name}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>{filled.length}/{role.max_slots} filled</div>
              </div>
              <button onClick={() => removeRole(role.id)} style={{ background: 'none', border: 'none', color: 'var(--gray-400)', cursor: 'pointer', fontSize: 13 }}>Remove</button>
            </div>
            {filled.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {filled.map(s => (
                  <span key={s.id} style={{ fontSize: 11, background: 'var(--gray-100)', padding: '2px 8px', borderRadius: 10 }}>{s.volunteer_name}</span>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {roles.length > 0 && !STANDARD_ROLES.every(sr => roles.some(r => r.role_name === sr.role_name)) && (
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={addStandardRoles}>
          + Add Missing Standard Roles
        </button>
      )}

      {adding ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label className="form-label">Role Name</label>
            <input className="form-input" value={newRole.role_name} onChange={e => setNewRole(r => ({ ...r, role_name: e.target.value }))} />
          </div>
          <div style={{ width: 70 }}>
            <label className="form-label">Slots</label>
            <input type="number" min="1" className="form-input" value={newRole.max_slots} onChange={e => setNewRole(r => ({ ...r, max_slots: e.target.value }))} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={addCustomRole}>Add</button>
          <button className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>+ Add Custom Role</button>
      )}
    </div>
  )
}
