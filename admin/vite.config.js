import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, the Vite server (port 5173) proxies /api/* to the local Express
// server (port 3000). Run them in two terminals:
//   Terminal 1:  npm run dev      (Vite, port 5173)
//   Terminal 2:  node server.js   (Express + API, port 3000)
// In production, server.js serves both the built SPA and /api/* on one port.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
