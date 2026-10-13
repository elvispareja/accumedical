/**
 * El CONTRATO de Concurrencia con admin: lo único de este módulo que la app de
 * administración puede importar (`@concurrencia/integracion`, nunca otra ruta).
 *
 * Son las vistas agregadas que admin pinta en SUS pantallas: la bandeja unificada
 * del coordinador (`/coordinacion/bandeja`) y la ficha del paciente
 * (`/admin/pacientes`). Usan solo componentes compartidos (`@/shared`), así que
 * se ven con el diseño de admin; las pantallas del módulo —con su propio
 * diseño— viven en esta app y se abren en `/concurrencia/…`.
 *
 * Cambiar algo aquí es cambiar un contrato: admin depende de ello.
 */
export { CasosDeConcurrencia, CuadroDeConcurrencia } from '@concurrencia/bandeja'
export { listarPacientes, obtenerPaciente } from '@concurrencia/api'
