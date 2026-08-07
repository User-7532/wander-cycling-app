// Supabase Storage object keys only allow ASCII word characters plus a
// small punctuation whitelist (/ ! - . * ' ( ) space & $ @ = ; : + , ?) --
// anything else, including Japanese/non-ASCII characters, makes the whole
// key invalid and the upload fails outright with "Invalid key: ...". Every
// upload in this app built its storage path straight from the browser
// File object's name, so any non-ASCII filename (a very normal thing for
// this club, e.g. "26夏合宿のしおり.pdf") broke uploads everywhere.
//
// None of this app's upload flows display the original filename back to
// the user (attachments/receipts show a generic "見る" link, images show
// as a signed-URL preview, not by name) -- so it's safe to fold
// non-ASCII characters down rather than needing to preserve them.
export function safeStorageFilename(originalName) {
  const lastDot = originalName.lastIndexOf('.')
  const hasExt = lastDot > 0 && lastDot < originalName.length - 1
  const base = hasExt ? originalName.slice(0, lastDot) : originalName
  const ext = hasExt ? originalName.slice(lastDot) : ''

  const safeBase = base
    .replace(/[^\w!\-.*'() &$@=;:+,?]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 80)
  const safeExt = ext.replace(/[^\w.]/g, '')

  return `${Date.now()}-${safeBase || 'file'}${safeExt}`
}
