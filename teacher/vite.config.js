import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// One build ID per build. Both the bundle and dist/version.txt get the same
// value so the runtime version check can tell whether a teacher is on a
// stale bundle.
const BUILD_ID = Date.now().toString()

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'write-version-file',
      // After the bundle is fully written, drop a version.txt next to index.html
      // containing the BUILD_ID. The PWA fetches this at runtime to detect updates.
      closeBundle() {
        const distDir = resolve(__dirname, 'dist')
        if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true })
        writeFileSync(resolve(distDir, 'version.txt'), BUILD_ID)
        console.log('[write-version-file] wrote dist/version.txt with BUILD_ID=' + BUILD_ID)
      },
    },
  ],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
})
