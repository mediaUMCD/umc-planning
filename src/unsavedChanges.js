// Shared "unsaved changes" flag so the sidebar and sign-out can warn before
// leaving a page that has edits that haven't been saved yet.
let unsaved = false

export function setUnsavedChanges(value) {
  unsaved = !!value
}

// Returns true if it's OK to leave (nothing unsaved, or the user chose to discard).
export function confirmDiscardChanges() {
  if (!unsaved) return true
  const ok = window.confirm('You have changes that haven\u2019t been saved.\n\nLeave without saving?')
  if (ok) unsaved = false
  return ok
}
