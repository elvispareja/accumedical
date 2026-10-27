import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'

import { listarSupervision, REFRESCO_MS, urlInformePdfSupervision } from '@concurrencia/api'
import { EstadoVisitaBadge, Ventana } from '@concurrencia/components/visitas'
import { CuadroAuditoria } from '@/shared/components/CuadroAuditoria'
import { TablaBandeja, type CasoDeBandeja } from '@/shared/components/TablaBandeja'
import type {
  FiltrosDeBandeja,
  PropsCasosAuditoria,
  PropsCuadroAuditoria,
} from '@/shared/components/bandeja'

const POR_PAGINA = 20

/**
 * La clave de la consulta. La comparten el cuadro y la tabla —una sola
 * petición—, y por eso **el número del cuadro sigue al filtro**: cuenta lo que
 * hay debajo, que es justo lo que está mirando quien filtró.
 */
const CLAVE = (pagina: number, filtros: FiltrosDeBandeja) =>
  ['supervision', { bandeja: true, pagina, ...filtros }] as const

/** Los filtros comunes, traducidos a lo que entiende Concurrencia. */
function consultaDe(pagina: number, filtros: FiltrosDeBandeja) {
  return {
    // Aquí busca por aseguradora, prestador o código; otra auditoría buscará
    // por lo suyo. La bandeja no tiene por qué saberlo.
    search: filtros.search,
    desde: filtros.desde,
    hasta: filtros.hasta,
    // Los casos de esa persona, identificada por su documento.
    paciente_tipo_documento: filtros.documento?.tipo,
    paciente_numero_documento: filtros.documento?.numero,
    // El final de un caso de Concurrencia se llama «culminada»: el auditor
    // mandó su informe. Quien pide «solo finalizados» no tiene por qué saberlo.
    estado: filtros.soloFinalizados ? 'culminada' : undefined,
    page: pagina,
    page_size: POR_PAGINA,
  }
}

/**
 * El cuadro de Concurrencia en la bandeja: su nombre, su acento y **cuántos
 * casos tiene**. El número solo lo sabe el módulo; el resto se lo pasa la
 * bandeja ya resuelto, así que el cuadro compartido no aprende nada de visitas.
 */
export function CuadroDeConcurrencia({ filtros, ...props }: PropsCuadroAuditoria) {
  const consulta = useQuery({
    queryKey: CLAVE(1, filtros),
    queryFn: () => listarSupervision(consultaDe(1, filtros)),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESCO_MS,
  })
  return (
    <CuadroAuditoria {...props} total={consulta.data?.total} cargando={consulta.isPending} />
  )
}

/**
 * Lo que Concurrencia pone en la bandeja de entrada del coordinador.
 *
 * El módulo traduce SUS casos a la forma común de la bandeja y no al revés: la
 * tabla compartida no sabe qué es una visita, y este archivo no sabe cómo se
 * pinta una tabla. Cuando entren las otras siete auditorías, cada una escribe su
 * propio adaptador como este y nada más se toca.
 *
 * Lo específico —derivar a un auditor, filtrar, reprogramar— NO está aquí: vive
 * en el panel del módulo y en la página del caso, que es a donde lleva la fila.
 */
export function CasosDeConcurrencia({ filtros }: PropsCasosAuditoria) {
  const [pagina, setPagina] = useState(1)

  // El caso se abre siempre en el módulo: el administrador global entra como
  // coordinador de plataforma (D45), con la misma ruta que él.
  const rutaDelCaso = (id: string) => `/concurrencia/supervision/${id}`

  // Al cambiar el filtro se vuelve a la primera página: la cuarta puede no
  // existir con lo que queda.
  useEffect(
    () => setPagina(1),
    [filtros.search, filtros.desde, filtros.hasta, filtros.documento?.numero, filtros.soloFinalizados],
  )

  const consulta = useQuery({
    queryKey: CLAVE(pagina, filtros),
    queryFn: () => listarSupervision(consultaDe(pagina, filtros)),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESCO_MS,
  })

  const datos = consulta.data
  const casos: CasoDeBandeja[] = (datos?.items ?? []).map((v) => ({
    id: v.id,
    codigo: v.codigo_interno,
    aseguradora: v.aseguradora_nombre,
    prestador: (
      <>
        <span className="block max-w-[14rem] truncate text-tinta">{v.prestador_nombre}</span>
        <span className="flex max-w-[14rem] items-center gap-1 text-xs">
          <MapPin className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {v.sede_nombre ?? 'SEDE PRINCIPAL'}
            {v.ciudad_nombre ? ` · ${v.ciudad_nombre}` : ''}
          </span>
        </span>
      </>
    ),
    // La ventana de la visita: desde y hasta (= plazo de llegada); sin hora aún, por fijar.
    cuando: (
      <Ventana desde={v.desde} hasta={v.llegada_limite} porFijar={v.estado === 'programada'} />
    ),
    estado: <EstadoVisitaBadge estado={v.estado} />,
    // Pidiendo los terminados, lo que se quiere de cada uno es su informe: la
    // fila abre el PDF firmado en vez de la pantalla del caso. **Solo si lo
    // tiene**: un caso puede haber terminado sin informe —los de antes de que
    // existieran—, y ofrecer ese PDF sería mandar a la gente a un 404.
    url:
      filtros.soloFinalizados && v.tiene_informe
        ? urlInformePdfSupervision(v.id)
        : rutaDelCaso(v.id),
    descarga: Boolean(filtros.soloFinalizados && v.tiene_informe),
  }))

  return (
    <TablaBandeja
      casos={casos}
      cargando={consulta.isPending}
      error={consulta.isError}
      onReintentar={() => consulta.refetch()}
      pagina={pagina}
      totalPaginas={datos ? Math.max(1, Math.ceil(datos.total / datos.page_size)) : 1}
      onPagina={setPagina}
      total={datos?.total}
      filtrada={Boolean(filtros.search || filtros.desde || filtros.hasta)}
    />
  )
}
