// ============================================================================
// admin/lib/studentPhoto.js — student photo (students.photo_key in R2) as a
// data URL for server-rendered cards (report cards, HPC).
//
// R2's bucket CORS allows uploads but not cross-origin GETs, so a presigned URL
// would not survive canvas/PDF export on the client; the r2-sign edge function's
// `download_data` op returns the bytes inline instead. Cached per process, capped
// so a full-branch publish does not pin every photo in memory forever.
// ============================================================================

const CACHE_MAX = 400
const cache = new Map() // photo_key → data URL | null

export async function photoDataUrl(key) {
  if (!key) return null
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v }
  let out = null
  try {
    const r = await fetch(`${process.env.SUPABASE_URL}/functions/v1/r2-sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ op: 'download_data', key }),
    })
    const j = await r.json().catch(() => null)
    if (r.ok && j?.data_url) out = j.data_url
    else console.warn('[photo] r2-sign download_data failed', key, r.status, j?.error || '')
  } catch (e) { console.warn('[photo] fetch failed', key, e.message) }
  cache.set(key, out)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return out
}

/** Fill `card.photoUrl` on computed report cards (limited concurrency). Mutates and returns `cards`. */
export async function attachPhotos(cards, concurrency = 6) {
  const queue = cards.filter((c) => c?.student?.photoKey && !c.photoUrl)
  let i = 0
  const worker = async () => { while (i < queue.length) { const c = queue[i++]; c.photoUrl = await photoDataUrl(c.student.photoKey) } }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  return cards
}
