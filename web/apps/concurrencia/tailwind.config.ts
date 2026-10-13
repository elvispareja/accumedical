import type { Config } from 'tailwindcss'

import base from '../../tailwind.config'

/**
 * El Tailwind de Concurrencia. Parte del de la plataforma (mismos tokens de
 * color, así se reconoce como Accumedical) y aquí puede extenderlo o cambiarlo
 * sin tocar admin: `theme.extend` propio, otras fuentes, otro radio…
 */
export default {
  ...base,
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // Los componentes compartidos que esta app pinta.
    '../../src/core/**/*.{ts,tsx}',
    '../../src/shared/**/*.{ts,tsx}',
    '../../src/lib/**/*.{ts,tsx}',
  ],
} satisfies Config
