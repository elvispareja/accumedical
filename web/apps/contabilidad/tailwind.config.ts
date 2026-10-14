import type { Config } from 'tailwindcss'

import base from '../../tailwind.config'

/**
 * El Tailwind de Contabilidad. Parte del de la plataforma (mismos tokens de
 * color, así se reconoce como Accumedical) y aquí puede extenderlo o cambiarlo
 * sin tocar admin ni los módulos: `theme.extend` propio, otras fuentes, otro radio…
 */
export default {
  ...base,
  // `relative`: las rutas se leen desde ESTE archivo, no desde donde arranca
  // Vite (`web/`). Sin eso, `./src` era el código compartido y las clases que
  // solo usa esta app (p. ej. `grid-cols-[…]` propias) nunca se generaban.
  content: {
    relative: true,
    files: [
      './index.html',
      './src/**/*.{ts,tsx}',
      // Los componentes compartidos que esta app pinta.
      '../../src/core/**/*.{ts,tsx}',
      '../../src/shared/**/*.{ts,tsx}',
      '../../src/lib/**/*.{ts,tsx}',
    ],
  },
} satisfies Config
