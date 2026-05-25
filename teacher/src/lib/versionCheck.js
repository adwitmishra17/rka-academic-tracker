// =========================================================================
// versionCheck.js
//
// Detects when a newer build of the PWA is available on the server.
// Triggers a callback so the UI can prompt the user to refresh.
//
// How it works:
//   - Each build is stamped with a unique BUILD_ID (injected via vite.config)
//   - After every build, dist/version.txt is written with the same ID
//   - At runtime, we periodically fetch /version.txt with cache-busting
//   - If the file's value differs from our compiled-in BUILD_ID, the user is
//     on a stale bundle — tell them
//
// We do NOT force-reload silently — a teacher might be in the middle of
// typing a lesson. We show a banner and let them tap "Refresh" when ready.
// =========================================================================

let watcherStarted = false

export function startVersionWatcher(onUpdateAvailable) {
  if (watcherStarted) return
  watcherStarted = true

  // __BUILD_ID__ is injected by vite.config.js. If it isn't defined (e.g.
  // during dev), bail silently — version-checking only matters in prod.
  // eslint-disable-next-line no-undef
  const myVersion = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : null
  if (!myVersion) return

  async function check() {
    try {
      // Cache-bust the request — we never want a stale version.txt
      const r = await fetch('/version.txt?t=' + Date.now(), { cache: 'no-store' })
      if (!r.ok) return
      const serverVersion = (await r.text()).trim()
      if (serverVersion && serverVersion !== myVersion) {
        onUpdateAvailable(serverVersion)
      }
    } catch (e) {
      // Offline or fetch failure — silent. We'll check again later.
    }
  }

  // Check immediately, then every 5 minutes, and whenever the tab becomes
  // visible (catches users returning from another app/tab).
  check()
  setInterval(check, 5 * 60 * 1000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
}

// Hard-reload helper. Bypasses cache for the reload itself.
export function reloadForUpdate() {
  // The query param helps if any intermediate CDN is being stubborn —
  // we'll fetch a fresh index.html.
  window.location.replace(window.location.pathname + '?v=' + Date.now())
}
