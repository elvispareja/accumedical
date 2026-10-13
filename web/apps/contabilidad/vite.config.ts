import path from 'node:path'
import react from '@vitejs/plugin-react'
import autoprefixer from 'autoprefixer'
import tailwindcss from 'tailwindcss'
import { defineConfig } from 'vite'

/**
 * La app CONTABILIDAD (D50), separada de admin como Concurrencia; solo para
 * quien lleva esa función (y el administrador). Misma forma que la de Concurrencia (D46, D48): su
 * build, su CSS y su contenedor; en su subdominio vive en la raíz
 * (contabilidad.pymes.ec/dashboard), en local bajo /contabilidad/.
 *
 *   `@/…`          código COMPARTIDO de la plataforma (web/src).
 *   `@contabilidad/…` lo propio de esta app.
 */
const raiz = path.resolve(__dirname, '../..')
const puertoHmrCliente = process.env.VITE_HMR_CLIENT_PORT
  ? Number(process.env.VITE_HMR_CLIENT_PORT)
  : undefined

export default defineConfig({
  root: __dirname,
  // En su subdominio la app vive en la RAÍZ (`CONTABILIDAD_BASE=/`, D48):
  // contabilidad.pymes.ec/dashboard. En local, sin subdominios, bajo /contabilidad/.
  base: process.env.CONTABILIDAD_BASE ?? '/contabilidad/',
  // El favicon y los fondos comunes salen del mismo sitio que en admin.
  publicDir: path.join(raiz, 'public'),
  cacheDir: path.join(raiz, 'node_modules/.vite-contabilidad'),
  envDir: raiz,
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss({ config: path.join(__dirname, 'tailwind.config.ts') }), autoprefixer()],
    },
  },
  resolve: {
    alias: {
      '@contabilidad': path.join(__dirname, 'src'),
      '@': path.join(raiz, 'src'),
    },
  },
  server: {
    host: true,
    port: 5177,
    strictPort: true,
    allowedHosts: ['localhost'],
    // Sirve también el código compartido, que vive fuera de esta carpeta.
    fs: { allow: [raiz] },
    watch: { usePolling: true, interval: 300 },
    hmr: puertoHmrCliente ? { clientPort: puertoHmrCliente } : true,
  },
  build: { outDir: path.join(raiz, 'dist/contabilidad'), emptyOutDir: true },
})
