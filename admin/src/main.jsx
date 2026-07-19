import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Stale-tab self-heal: after a deploy, lazy chunks (jspdf/xlsx in
// Crosslist etc.) from the old build 404 → served as index.html →
// "'text/html' is not a valid JavaScript MIME type". Reload once.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
