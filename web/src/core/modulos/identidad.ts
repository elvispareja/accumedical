import {
  Activity,
  Ambulance,
  ClipboardCheck,
  CreditCard,
  FileCheck,
  FileSignature,
  HeartPulse,
  Receipt,
  Stethoscope,
  Pill,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

/**
 * Icono y color de cada módulo, en un solo sitio.
 *
 * El dato manda desde `modules.icono` y `modules.color_acento`, pero ni el icono
 * ni el color pueden construirse a partir de esa cadena: los iconos son
 * componentes que hay que importar, y Tailwind necesita ver la clase escrita
 * literal para generarla —`bg-modulo-${codigo}` no produce nada—. Por eso el
 * mapeo es explícito y por código de módulo, no por el token que llega.
 *
 * Añadir un módulo es una fila en `modules` y una entrada aquí. Uno que falte no
 * rompe nada: sale con el verde institucional y un icono neutro.
 */
export interface IdentidadModulo {
  Icono: LucideIcon
  /** Punto o barra sólida del acento. */
  punto: string
  /** Fondo tenue para tarjetas y estados marcados. */
  suave: string
  texto: string
  borde: string
}

const POR_CODIGO: Record<string, IdentidadModulo> = {
  suscripcion: {
    Icono: FileSignature,
    punto: 'bg-modulo-suscripcion',
    suave: 'bg-modulo-suscripcion/10',
    texto: 'text-modulo-suscripcion',
    borde: 'border-modulo-suscripcion/40',
  },
  calificacion: {
    Icono: ClipboardCheck,
    punto: 'bg-modulo-calificacion',
    suave: 'bg-modulo-calificacion/10',
    texto: 'text-modulo-calificacion',
    borde: 'border-modulo-calificacion/40',
  },
  concurrencia: {
    Icono: Activity,
    punto: 'bg-modulo-concurrencia',
    suave: 'bg-modulo-concurrencia/10',
    texto: 'text-modulo-concurrencia',
    borde: 'border-modulo-concurrencia/40',
  },
  // Carta de Vida conserva su code canónico carta_credito: mismos tokens.
  carta_credito: {
    Icono: CreditCard,
    punto: 'bg-modulo-carta-credito',
    suave: 'bg-modulo-carta-credito/10',
    texto: 'text-modulo-carta-credito',
    borde: 'border-modulo-carta-credito/40',
  },
  // Requisitos de Asegurabilidad conserva su code canónico: mismos tokens.
  examen_asegurabilidad: {
    Icono: Stethoscope,
    punto: 'bg-modulo-examen-asegurabilidad',
    suave: 'bg-modulo-examen-asegurabilidad/10',
    texto: 'text-modulo-examen-asegurabilidad',
    borde: 'border-modulo-examen-asegurabilidad/40',
  },
  declaracion_salud: {
    Icono: HeartPulse,
    punto: 'bg-modulo-declaracion-salud',
    suave: 'bg-modulo-declaracion-salud/10',
    texto: 'text-modulo-declaracion-salud',
    borde: 'border-modulo-declaracion-salud/40',
  },
  calificacion_riesgo: {
    Icono: ClipboardCheck,
    punto: 'bg-modulo-calificacion-riesgo',
    suave: 'bg-modulo-calificacion-riesgo/10',
    texto: 'text-modulo-calificacion-riesgo',
    borde: 'border-modulo-calificacion-riesgo/40',
  },
  auditoria_alta: {
    Icono: FileCheck,
    punto: 'bg-modulo-auditoria-alta',
    suave: 'bg-modulo-auditoria-alta/10',
    texto: 'text-modulo-auditoria-alta',
    borde: 'border-modulo-auditoria-alta/40',
  },
  auditoria_credito_hospitalario: {
    Icono: Receipt,
    punto: 'bg-modulo-auditoria-credito-hospitalario',
    suave: 'bg-modulo-auditoria-credito-hospitalario/10',
    texto: 'text-modulo-auditoria-credito-hospitalario',
    borde: 'border-modulo-auditoria-credito-hospitalario/40',
  },
  ambulatorio: {
    Icono: Ambulance,
    punto: 'bg-modulo-ambulatorio',
    suave: 'bg-modulo-ambulatorio/10',
    texto: 'text-modulo-ambulatorio',
    borde: 'border-modulo-ambulatorio/40',
  },
  auditoria_vida: {
    Icono: HeartPulse,
    punto: 'bg-modulo-auditoria-vida',
    suave: 'bg-modulo-auditoria-vida/10',
    texto: 'text-modulo-auditoria-vida',
    borde: 'border-modulo-auditoria-vida/40',
  },
  reembolso: {
    Icono: Wallet,
    punto: 'bg-modulo-reembolso',
    suave: 'bg-modulo-reembolso/10',
    texto: 'text-modulo-reembolso',
    borde: 'border-modulo-reembolso/40',
  },
  farmacia: {
    Icono: Pill,
    punto: 'bg-modulo-farmacia',
    suave: 'bg-modulo-farmacia/10',
    texto: 'text-modulo-farmacia',
    borde: 'border-modulo-farmacia/40',
  },
}

const NEUTRA: IdentidadModulo = {
  Icono: Activity,
  punto: 'bg-marca',
  suave: 'bg-marca-suave',
  texto: 'text-marca',
  borde: 'border-marca/40',
}

export function identidadDe(codigo: string): IdentidadModulo {
  return POR_CODIGO[codigo] ?? NEUTRA
}
