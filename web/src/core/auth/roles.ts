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

export function nombreDeRol(code: string | undefined | null): string {
  if (!code) return ''
  return NOMBRE_VISIBLE[code] ?? code
}
