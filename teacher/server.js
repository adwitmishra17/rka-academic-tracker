// ============================================================
// teacher/server.js
// Express server for the teacher PWA. Same shape as admin/server.js
// but adds no-cache for version.txt + service worker — those three
// (index.html, version.txt, sw.js) are what drives the in-app
// update check that vite.config.js wires up via __BUILD_ID__.
// ============================================================

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;
const distDir = path.join(__dirname, 'dist');

// Files that must always be fresh — the PWA polls these to decide
// whether the teacher is on a stale bundle.
const NO_CACHE_FILES = new Set([
  'index.html',
  'version.txt',
  'sw.js',
  'service-worker.js',
  'manifest.webmanifest',
  'manifest.json',
]);

app.use(express.static(distDir, {
  maxAge: '1y',
  index: false,
  setHeaders: (res, filePath) => {
    if (NO_CACHE_FILES.has(path.basename(filePath))) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[teacher] listening on port ${PORT}`);
});
