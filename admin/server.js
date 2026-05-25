// ============================================================
// admin/server.js
// Express server that serves the built Vite admin app with SPA
// fallback. Hostinger's Node.js deploy runs:
//   npm install  →  npm run build  →  npm start
// `npm start` invokes this file, which serves dist/ on the port
// Hostinger assigns via process.env.PORT.
// ============================================================

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;
const distDir = path.join(__dirname, 'dist');

// Static assets — hashed filenames are safe to long-cache for a year.
// We override Cache-Control for index.html below so a new build is
// picked up by browsers on the next page load.
app.use(express.static(distDir, {
  maxAge: '1y',
  index: false,             // SPA fallback handles the root
  setHeaders: (res, filePath) => {
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  },
}));

// SPA fallback — any unmatched path returns index.html so React
// Router can resolve client-side routes (/students/:id, /tests, etc.).
app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[admin] listening on port ${PORT}`);
});
