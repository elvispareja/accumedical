import path from 'node:path'
import react from '@vitejs/plugin-react'
import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'
import { defineConfig } from 'vite'

/**
 * La app de CONCURRENCIA, con su propio frontend (D46): su build, su CSS y su
 * contenedor. En su subdominio se sirve en la raíz (nginx de la app le da todo
 * `concurrencia.*`); en local, bajo `/concurrencia/`. El resto es de admin.
 *
 *   `@/…`             código COMPARTIDO de la plataforma (web/src: sesión,
 *                     cliente de la API, armazón, componentes base).
 *   `@concurrencia/…` lo propio de este módulo.
 *
 * Las dependencias de npm son las de `web/` (un solo node_modules).
 */
const raiz = path.resolve(__dirname, '../..')
const puertoHmrCliente = process.env.VITE_HMR_CLIENT_PORT
  ? Number(process.env.VITE_HMR_CLIENT_PORT)
  : undefined

export default defineConfig({
  root: __dirname,
  // En su subdominio la app vive en la RAÍZ (`CONCURRENCIA_BASE=/`, D48):
  // concurrencia.pymes.ec/dashboard. En local, sin subdominios, bajo /concurrencia/.
  base: process.env.CONCURRENCIA_BASE ?? '/concurrencia/',
  // El favicon y los fondos comunes salen del mismo sitio que en admin.
  publicDir: path.join(raiz, 'public'),
  cacheDir: path.join(raiz, 'node_modules/.vite-concurrencia'),
  envDir: raiz,
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss({ config: path.join(__dirname, 'tailwind.config.ts') }), autoprefixer()],
    },
  },
  resolve: {
    alias: {
      '@concurrencia': path.join(__dirname, 'src'),
      '@': path.join(raiz, 'src'),
    },
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    allowedHosts: ['localhost'],
    // Sirve también el código compartido, que vive fuera de esta carpeta.
    fs: { allow: [raiz] },
    watch: { usePolling: true, interval: 300 },
    hmr: puertoHmrCliente ? { clientPort: puertoHmrCliente } : true,
  },
  build: { outDir: path.join(raiz, 'dist/concurrencia'), emptyOutDir: true },
})
