/**
 * El CONTRATO de Concurrencia con admin: lo único de este módulo que la app de
 * administración puede importar (`@concurrencia/integracion`, nunca otra ruta).
 *
 * Son las vistas agregadas que admin pinta en SUS pantallas: la bandeja unificada
 * del coordinador (`/coordinacion/bandeja`). Los pacientes ya no salen de aquí:
 * viven en la central y en su app, pacientes.pymes.ec (D49). Usan solo componentes compartidos (`@/shared`), así que
 * se ven con el diseño de admin; las pantallas del módulo —con su propio
 * diseño— viven en esta app y se abren en `/concurrencia/…`.
 *
 * Cambiar algo aquí es cambiar un contrato: admin depende de ello.
 */
export { CasosDeConcurrencia, CuadroDeConcurrencia } from '@concurrencia/bandeja'
