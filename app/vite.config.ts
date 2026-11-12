import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // In dev, the API lives on the dashboard server, port 3000.
  server: {
    // The sandbox preview reaches the dev server through a generated host
    // name, so any host is accepted in development. The server, not Vite,
    // enforces the security boundary.
    allowedHosts: true,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  // Keep the Vite cache inside this app folder, not in node_modules,
  // so a shared node_modules folder is never written to.
  cacheDir: '.vite-cache',
})
