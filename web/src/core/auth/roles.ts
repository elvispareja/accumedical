/**
 * El nombre VISIBLE de cada rol de módulo, en un solo sitio.
 *
 * El `code` que devuelve el backend está congelado —`supervisor` sigue siendo
 * `supervisor` desde `f5a8d3c6b924`, igual que los módulos conservan el suyo tras
 * renombrarse—, porque cambiar una etiqueta no puede cambiar lo que autoriza. Lo
 * que cambia es cómo se llama de cara a la persona: **Coordinador**.
 *
 * Pintar `modulo.rol` en crudo es el error que esto evita: enseñaba «Supervisor»
 * en la pantalla de un coordinador.
 */
const NOMBRE_VISIBLE: Record<string, string> = {
  supervisor: 'Coordinador',
  auditor: 'Auditor',
  operador: 'Operador',
}

/**
 * Del lado de la ASEGURADORA (19/10/2026, pedido del cliente): su coordinador
 * se llama «Supervisor» y su operador «Ejecutivo». Mismos códigos, mismo
 * alcance; solo cambia el nombre. El coordinador de Accumedical sigue igual.
 */
const NOMBRE_EN_ASEGURADORA: Record<string, string> = {
  supervisor: 'Supervisor',
  coordinador: 'Supervisor',
  operador: 'Ejecutivo',
}

export function nombreDeRol(code: string | undefined | null, deAseguradora = false): string {
  if (!code) return ''
  if (deAseguradora && NOMBRE_EN_ASEGURADORA[code]) return NOMBRE_EN_ASEGURADORA[code]
  return NOMBRE_VISIBLE[code] ?? code
}
