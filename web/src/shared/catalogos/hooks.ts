import { useQuery } from '@tanstack/react-query'

import {
  listarCiudades,
  listarCoberturas,
  listarModulos,
  listarProvincias,
  listarTiposDocumento,
  listarTiposPrestador,
} from '@/shared/catalogos/api'

export const CLAVES_CATALOGO = {
  provincias: ['catalogo', 'provincias'] as const,
  modulos: ['catalogo', 'modulos'] as const,
  coberturas: ['catalogo', 'coberturas'] as const,
  tiposDocumento: ['catalogo', 'tipos-documento'] as const,
  tiposPrestador: ['catalogo', 'tipos-prestador'] as const,
  ciudades: (provincia: string) => ['catalogo', 'ciudades', provincia] as const,
}

// Todos son catálogos de referencia: no cambian durante la sesión, así que se
// piden una vez y se comparten entre aseguradoras, prestadores y lo que venga.

// El catálogo de módulos es el único de aquí que exige administrador global (no se
// filtra qué módulos existen). Por eso admite apagarse: una pantalla que también
// abren otros roles no debe pedirlo para llevarse un 403 que no arregla nada.
export function useModulos(habilitado = true) {
  return useQuery({
    queryKey: CLAVES_CATALOGO.modulos,
    queryFn: listarModulos,
    enabled: habilitado,
    staleTime: Infinity,
  })
}

export function useCoberturas() {
  return useQuery({
    queryKey: CLAVES_CATALOGO.coberturas,
    queryFn: listarCoberturas,
    staleTime: Infinity,
  })
}

export function useTiposDocumento() {
  return useQuery({
    queryKey: CLAVES_CATALOGO.tiposDocumento,
    queryFn: listarTiposDocumento,
    staleTime: Infinity,
  })
}

export function useTiposPrestador() {
  return useQuery({
    queryKey: CLAVES_CATALOGO.tiposPrestador,
    queryFn: listarTiposPrestador,
    staleTime: Infinity,
  })
}

export function useProvincias() {
  return useQuery({
    queryKey: CLAVES_CATALOGO.provincias,
    queryFn: listarProvincias,
    staleTime: Infinity,
  })
}

export function useCiudades(provinciaCodigo: string | null) {
  return useQuery({
    queryKey: CLAVES_CATALOGO.ciudades(provinciaCodigo ?? ''),
    queryFn: () => listarCiudades(provinciaCodigo!),
    enabled: Boolean(provinciaCodigo),
    staleTime: Infinity,
  })
}
