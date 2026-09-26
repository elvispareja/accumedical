import type { LucideIcon } from 'lucide-react'

/**
 * Lo que la bandeja le pasa a cada auditoría para acotar lo suyo. **Sin estado**
 * a propósito: cada auditoría tiene los suyos —una visita se «culmina», un
 * reembolso se «liquida»— y un desplegable común mezclaría vocabularios. Lo que
 * sí comparten todas es de quién viene el caso, a quién y cuándo, y eso es lo
 * que se filtra aquí; el estado se filtra dentro de cada una, donde tiene
 * nombre.
 *
 * Cada módulo lo traduce a SU consulta: la bandeja no sabe por qué columnas
 * busca ninguno.
 */
export interface FiltrosDeBandeja {
  /** Texto libre. Cada auditoría decide contra qué campos lo compara. */
  search?: string
  /** `YYYY-MM-DD`. Acotan por la fecha del caso, incluidos los dos extremos. */
  desde?: string
  hasta?: string
  /**
   * Los casos de UNA persona, por su identificación —lo que la identifica en
   * todas las auditorías—. Es lo que pide su ficha de cliente.
   */
  documento?: { tipo: string; numero: string }
  /**
   * Solo los casos **terminados**, con su informe ya emitido. Se pide así y no
   * por el nombre del estado a propósito: cada auditoría llama al suyo de otra
   * forma —en Concurrencia es «culminada»—, pero todas saben cuál es el final.
   */
  soloFinalizados?: boolean
}

/**
 * Lo que la bandeja de entrada le pasa al cuadro de cada auditoría. El módulo
 * solo añade su número de casos: el nombre, el icono, el acento y el destino los
 * resuelve la bandeja, que es quien los tiene.
 */
export interface PropsCuadroAuditoria {
  indice: number
  nombre: string
  icono: LucideIcon
  acento: { suave: string; texto: string; borde: string }
  /** La bandeja de esa auditoría, su propio módulo. */
  a: string
  /** Los mismos que la lista: el número del cuadro cuenta lo que hay debajo. */
  filtros: FiltrosDeBandeja
}

/** Lo que recibe la lista de casos de cada auditoría. */
export interface PropsCasosAuditoria {
  filtros: FiltrosDeBandeja
}
