import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { listarPuntosDeAseguradoras, type PuntoMapaAseguradora } from '@/shared/aseguradoras/api'
import { MapaDeRed } from '@/shared/mapa/MapaDeRed'
import type { PuntoDeMapa } from '@/shared/mapa/tipos'

/**
 * Traduce una compañía al punto que el mapa entiende. Aquí la clave es su id a
 * secas: una aseguradora tiene UN domicilio, no sedes que desdoblar.
 */
function traducir(punto: PuntoMapaAseguradora): PuntoDeMapa {
  return {
    clave: punto.id,
    ficha: `/admin/aseguradoras/${punto.id}/editar`,
    // Se lee por su razón social, que es como se lista en toda la plataforma.
    titulo: punto.razon_social,
    subtitulo: [punto.codigo_interno, punto.nombre_comercial, punto.ciudad_nombre]
      .filter(Boolean)
      .join(' · '),
    direccion: punto.direccion_fiscal,
    provincia_codigo: punto.provincia_codigo,
    provincia_nombre: punto.provincia_nombre,
    ciudad_codigo: punto.ciudad_codigo,
    ciudad_nombre: punto.ciudad_nombre,
    latitud: punto.latitud,
    longitud: punto.longitud,
  }
}

/**
 * Las aseguradoras sobre el mapa, una por domicilio. La ficha propia de
 * Accumedical queda fuera, igual que en el listado: no es una compañía más.
 */
export function MapaAseguradoras() {
  const consulta = useQuery({
    queryKey: ['aseguradoras-mapa'],
    queryFn: listarPuntosDeAseguradoras,
  })
  const puntos = useMemo(() => (consulta.data ?? []).map(traducir), [consulta.data])

  return (
    <MapaDeRed
      puntos={puntos}
      cargando={consulta.isPending}
      error={consulta.isError}
      onReintentar={() => consulta.refetch()}
      etiqueta="Aseguradoras"
      unidad={{ uno: 'aseguradora', varios: 'aseguradoras' }}
      vacio="Aquí no hay ninguna aseguradora todavía."
    />
  )
}
