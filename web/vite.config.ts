import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Detrás de nginx el navegador entra por otro puerto que el que escucha Vite, así que
// el cliente HMR necesita saberlo o intenta ws://host:5173 y falla en silencio.
// Lo fija el compose (VITE_HMR_CLIENT_PORT=8080); corriendo `npm run dev` a pelo no
// se define y Vite usa su comportamiento normal.
const puertoHmrCliente = process.env.VITE_HMR_CLIENT_PORT
  ? Number(process.env.VITE_HMR_CLIENT_PORT)
  : undefined

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    // Vite >=5.4.12 rechaza Host desconocidos (mitigación de DNS rebinding). Sin esto,
    // entrar por un hostname que no sea localhost devuelve "Blocked request".
    allowedHosts: ['localhost'],
    // NTFS -> contenedor: los eventos inotify no cruzan el bind mount, sin polling no hay recarga.
    watch: { usePolling: true, interval: 300 },
    hmr: puertoHmrCliente ? { clientPort: puertoHmrCliente } : true,
    proxy: {
      // Solo aplica cuando se corre `npm run dev` fuera de Docker, sin nginx delante.
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
