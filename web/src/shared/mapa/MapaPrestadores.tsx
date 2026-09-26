import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { MapaDeRed } from '@/shared/mapa/MapaDeRed'
import type { PuntoDeMapa } from '@/shared/mapa/tipos'
import { listarPuntosDelMapa, type PuntoMapa } from '@/shared/prestadores/api'

/**
 * Traduce un sitio de atención al punto que el mapa entiende. **Un prestador
 * con sedes aporta varios**, así que la clave lleva el nombre de la sede: sin
 * él, dos puntos del mismo hospital compartirían clave y solo se pintaría uno.
 */
function traducir(punto: PuntoMapa): PuntoDeMapa {
  return {
    clave: `${punto.prestador_id}-${punto.sede_nombre ?? ''}`,
    ficha: `/admin/prestadores/${punto.prestador_id}/editar`,
    titulo: punto.sede_nombre ? `${punto.nombre} · ${punto.sede_nombre}` : punto.nombre,
    subtitulo: [punto.codigo_interno, punto.tipo_nombre, punto.ciudad_nombre]
      .filter(Boolean)
      .join(' · '),
    direccion: punto.direccion,
    provincia_codigo: punto.provincia_codigo,
    provincia_nombre: punto.provincia_nombre,
    ciudad_codigo: punto.ciudad_codigo,
    ciudad_nombre: punto.ciudad_nombre,
    latitud: punto.latitud,
    longitud: punto.longitud,
  }
}

/**
 * Los prestadores sobre el mapa: **un punto por cada sitio donde se atiende**,
 * el del prestador y el de cada sede activa.
 *
 * Con `aseguradoraId` solo se pintan los que tienen convenio vivo con esa
 * compañía —así lo usa «Red convenio»—; sin él, el catálogo entero.
 */
export function MapaPrestadores({ aseguradoraId }: { aseguradoraId?: string }) {
  const consulta = useQuery({
    queryKey: ['prestadores-mapa', aseguradoraId ?? 'todos'],
    queryFn: () => listarPuntosDelMapa(aseguradoraId),
  })
  const puntos = useMemo(() => (consulta.data ?? []).map(traducir), [consulta.data])

  return (
    <MapaDeRed
      puntos={puntos}
      cargando={consulta.isPending}
      error={consulta.isError}
      onReintentar={() => consulta.refetch()}
      etiqueta="Prestadores"
      unidad={{ uno: 'prestador', varios: 'prestadores' }}
      vacio="Aquí no hay ningún prestador todavía."
    />
  )
}
