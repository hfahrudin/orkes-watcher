import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // The contract and changelog pages bundle markdown from the repo's docs/ (src/lib/docs.ts).
    fs: { allow: ['..'] },
  },
})
