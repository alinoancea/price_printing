import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // In an Electron packaged app, absolute asset paths like "/assets/..." may not resolve.
  // Using a relative base makes Vite emit URLs that work with file:// / asar.
  base: './',
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist'
  }
})

