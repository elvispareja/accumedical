import type { Config } from 'tailwindcss'

/**
 * Los colores NO se declaran aquí como valores: se declaran como tokens CSS en
 * src/index.css y aquí solo se referencian. Así el dark mode es un cambio de
 * variables, no un duplicado de la paleta, y los módulos pueden aportar su color
 * de acento en runtime (viene de `modules.color_acento`, nunca hardcodeado).
 */
export default {
  darkMode: 'class',
  // Las vistas que admin toma del contrato de Concurrencia también se pintan aquí.
  content: ['./index.html', './src/**/*.{ts,tsx}', './apps/concurrencia/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        fondo: 'hsl(var(--fondo) / <alpha-value>)',
        tinta: 'hsl(var(--tinta) / <alpha-value>)',
        superficie: {
          DEFAULT: 'hsl(var(--superficie) / <alpha-value>)',
          hundida: 'hsl(var(--superficie-hundida) / <alpha-value>)',
        },
        tenue: {
          DEFAULT: 'hsl(var(--tenue) / <alpha-value>)',
          fg: 'hsl(var(--tenue-fg) / <alpha-value>)',
        },
        borde: 'hsl(var(--borde) / <alpha-value>)',
        anillo: 'hsl(var(--anillo) / <alpha-value>)',
        marca: {
          DEFAULT: 'hsl(var(--marca) / <alpha-value>)',
          fg: 'hsl(var(--marca-fg) / <alpha-value>)',
          suave: 'hsl(var(--marca-suave) / <alpha-value>)',
        },
        // El oro del arco del logo: acento secundario de la marca.
        oro: 'hsl(var(--oro) / <alpha-value>)',
        peligro: {
          DEFAULT: 'hsl(var(--peligro) / <alpha-value>)',
          fg: 'hsl(var(--peligro-fg) / <alpha-value>)',
          suave: 'hsl(var(--peligro-suave) / <alpha-value>)',
        },
        exito: 'hsl(var(--exito) / <alpha-value>)',
        aviso: 'hsl(var(--aviso) / <alpha-value>)',
        // Acentos por módulo. Se usan por nombre de token, nunca por hex suelto.
        modulo: {
          suscripcion: 'hsl(var(--modulo-suscripcion) / <alpha-value>)',
          calificacion: 'hsl(var(--modulo-calificacion) / <alpha-value>)',
          concurrencia: 'hsl(var(--modulo-concurrencia) / <alpha-value>)',
          'carta-credito': 'hsl(var(--modulo-carta-credito) / <alpha-value>)',
          'examen-asegurabilidad': 'hsl(var(--modulo-examen-asegurabilidad) / <alpha-value>)',
          'declaracion-salud': 'hsl(var(--modulo-declaracion-salud) / <alpha-value>)',
          'calificacion-riesgo': 'hsl(var(--modulo-calificacion-riesgo) / <alpha-value>)',
          'auditoria-alta': 'hsl(var(--modulo-auditoria-alta) / <alpha-value>)',
          'auditoria-credito-hospitalario':
            'hsl(var(--modulo-auditoria-credito-hospitalario) / <alpha-value>)',
          ambulatorio: 'hsl(var(--modulo-ambulatorio) / <alpha-value>)',
          'auditoria-vida': 'hsl(var(--modulo-auditoria-vida) / <alpha-value>)',
          reembolso: 'hsl(var(--modulo-reembolso) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['Archivo Variable', 'system-ui', 'sans-serif'],
        sans: ['Inter Variable', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono Variable', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        sm: 'calc(var(--radio) - 4px)',
        DEFAULT: 'calc(var(--radio) - 2px)',
        md: 'var(--radio)',
        lg: 'calc(var(--radio) + 4px)',
      },
      boxShadow: {
        sutil: 'var(--sombra-sutil)',
        elevada: 'var(--sombra-elevada)',
      },
      transitionTimingFunction: {
        // Easing natural del sistema: sin rebotes, tal como fija CLAUDE.md.
        natural: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config
