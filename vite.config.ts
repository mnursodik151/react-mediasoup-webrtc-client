import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    https: {
      key: fs.readFileSync(path.resolve(__dirname, 'certs/server.key')),
      cert: fs.readFileSync(path.resolve(__dirname, 'certs/server.cert')),
    },
    host: true,
    port: 5173, // Optional: Specify a custom port (default is 5173)
    allowedHosts: ['localhost'],
    hmr: {
      // Use the public domain for WebSocket connections
      host: 'vsion.dev.saribautnet.co.id',
      // If using HTTPS for your site
      protocol: 'wss'
    }
  },
})
