import { ChevronLeft, ChevronRight, Search, SquarePen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { ConvenioDetalle } from '@/shared/convenios/ConvenioDetalle'
import { Boton } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { useToast } from '@/shared/components/ui/toast'

/** La lista pagina de 20 en 20; el buscador filtra sobre el total. */
const POR_PAGINA = 20

/**
 * La red que cubre un convenio. Dos casillas y no un valor con tres opciones:
 * «ambas» es marcar las dos, y así «los que cubren pública» no tiene que
 * acordarse de un tercer valor. La base exige que haya al menos una.
 */
export type Red = { privada: boolean; publica: boolean }

const RED_POR_DEFECTO: Red = { privada: true, publica: false }

/**
 * La contraparte de un convenio, ya traducida: **el panel no sabe si está
 * pintando prestadores o compañías**, solo fichas que se marcan.
 */
export interface SocioDeConvenio {
  /** El de la contraparte: `prestador_id` desde la aseguradora, y al revés. */
  id: string
  titulo: string
  subtitulo: string
  marcado: boolean
  convenioId: string | null
  listadoNombre: string | null
  redPrivada: boolean
  redPublica: boolean
}

export interface SocioMarcado {
  id: string
  redPrivada: boolean
  redPublica: boolean
}

/**
 * La red de convenios, **desde cualquiera de los dos lados**: se marcan las
 * contrapartes y se guarda la lista completa. Marcar crea el convenio
 * (`vigente`); desmarcar lo retira con borrado lógico. Junto a cada marcada se
 * elige la red que cubre —privada, pública o las dos—, que viaja en el mismo
 * guardado, y «Editar» abre el detalle del convenio ya guardado.
 *
 * Es UNA pieza para los dos lados porque es UNA tabla: la fila entre una
 * compañía y un prestador. Quien lo monta traduce lo suyo a `SocioDeConvenio` y
 * dice, en `identificadores`, cuál de los dos identificadores es el fijo.
 */
export function PanelDeRed({
  socios,
  cargando,
  error,
  guardando,
  onGuardar,
  onListadoSubido,
  identificadores,
  textos,
}: {
  socios: SocioDeConvenio[]
  cargando: boolean
  error: boolean
  guardando: boolean
  onGuardar: (marcados: SocioMarcado[]) => void
  /** Para refrescar la fila tras subir el listado, sin esperar un refetch. */
  onListadoSubido: (socioId: string, nombre: string) => void
  /** Quién es quién en este lado: el convenio siempre une a los dos. */
  identificadores: (socioId: string) => { aseguradoraId: string; prestadorId: string }
  textos: {
    /** Qué se busca: «nombre, código, tipo o ciudad». */
    buscar: string
    /** Cuando el catálogo entero está vacío. */
    sinNada: string
    /** Cuando la búsqueda no casa con nadie. */
    sinCoincidencias: string
    /** «en la red», para el contador. */
    contador: string
  }
}) {
  const toast = useToast()

  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  // La red de cada uno, marcado o no: se recuerda mientras dure la pantalla,
  // así desmarcar por error y volver a marcar no pierde lo elegido.
  const [redes, setRedes] = useState<Record<string, Red>>({})
  const [editandoId, setEditandoId] = useState<string | null>(null)

  // El estado local nace de lo guardado y de ahí en adelante manda el usuario.
  useEffect(() => {
    setMarcados(new Set(socios.filter((s) => s.marcado).map((s) => s.id)))
    setRedes(
      Object.fromEntries(socios.map((s) => [s.id, { privada: s.redPrivada, publica: s.redPublica }])),
    )
  }, [socios])

  const filtrados = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase()
    if (!termino) return socios
    return socios.filter((s) =>
      `${s.titulo} ${s.subtitulo}`.toLocaleLowerCase().includes(termino),
    )
  }, [socios, busqueda])

  // Cambiar la búsqueda vuelve a la primera página: la actual podría no existir.
  useEffect(() => setPagina(1), [busqueda])

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA))
  const paginaActual = Math.min(pagina, totalPaginas)
  const visibles = filtrados.slice((paginaActual - 1) * POR_PAGINA, paginaActual * POR_PAGINA)

  // «Editar» abre el detalle como página dentro de la pestaña: reemplaza la
  // lista y «Volver a la red» la devuelve. El socio se lee SIEMPRE de la lista
  // que llega, así el nombre del listado recién subido se refleja.
  const editando = editandoId ? (socios.find((s) => s.id === editandoId) ?? null) : null
  if (editando && editando.convenioId) {
    const red = redes[editando.id] ?? RED_POR_DEFECTO
    return (
      <ConvenioDetalle
        {...identificadores(editando.id)}
        convenioId={editando.convenioId}
        titulo={editando.titulo}
        subtitulo={editando.subtitulo}
        listadoNombre={editando.listadoNombre}
        red={red}
        onListadoSubido={(nombre) => onListadoSubido(editando.id, nombre)}
        onVolver={() => setEditandoId(null)}
      />
    )
  }

  function alternar(socioId: string, valor: boolean) {
    setMarcados((previos) => {
      const siguiente = new Set(previos)
      if (valor) siguiente.add(socioId)
      else siguiente.delete(socioId)
      return siguiente
    })
    // Marcar sin red elegida todavía: nace en privada, que es el caso normal.
    if (valor && !redes[socioId]) {
      setRedes((previas) => ({ ...previas, [socioId]: RED_POR_DEFECTO }))
    }
  }

  /**
   * Cambia una de las dos casillas de red. **Desmarcar la última se rechaza
   * aquí**: un convenio que no cubre ninguna red no es un convenio, y es mejor
   * decirlo al tocarlo que dejar guardar y fallar al final.
   */
  function alternarRed(socioId: string, cual: keyof Red, valor: boolean) {
    const actual = redes[socioId] ?? RED_POR_DEFECTO
    const siguiente = { ...actual, [cual]: valor }
    if (!siguiente.privada && !siguiente.publica) {
      return toast.error('El convenio cubre al menos una red: privada, pública o las dos')
    }
    setRedes((previas) => ({ ...previas, [socioId]: siguiente }))
  }

  function guardar() {
    onGuardar(
      [...marcados].map((id) => {
        const red = redes[id] ?? RED_POR_DEFECTO
        return { id, redPrivada: red.privada, redPublica: red.publica }
      }),
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
          aria-hidden="true"
        />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={textos.buscar}
          aria-label="Buscar"
          mayusculas={false}
          className="pl-9"
        />
      </div>

      {cargando ? (
        <div className="space-y-2" role="status" aria-label="Cargando la red">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-md bg-tenue" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-peligro">No pudimos cargar la red.</p>
      ) : visibles.length === 0 ? (
        <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
          {socios.length === 0 ? textos.sinNada : textos.sinCoincidencias}
        </p>
      ) : (
        <div className="space-y-2">
          {visibles.map((socio) => (
            <div key={socio.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Checkbox
                    id={`convenio-${socio.id}`}
                    checked={marcados.has(socio.id)}
                    onChange={(v) => alternar(socio.id, v)}
                    titulo={socio.titulo}
                    descripcion={socio.subtitulo}
                  />
                </div>
                {/* El detalle —listado de precios y valores FC— cuelga del
                    convenio guardado: recién marcado, primero se guarda la red. */}
                {(socio.convenioId || marcados.has(socio.id)) && (
                  <Boton
                    type="button"
                    variante="contorno"
                    tamano="sm"
                    disabled={!socio.convenioId}
                    title={socio.convenioId ? undefined : 'Guarda la red primero'}
                    onClick={() => setEditandoId(socio.id)}
                    aria-label={`Editar convenio con ${socio.titulo}`}
                  >
                    <SquarePen aria-hidden="true" />
                    Editar
                  </Boton>
                )}
              </div>
              {/* La red que cubre el convenio, al marcarlo: se elige aquí
                  mismo y viaja en el mismo «Guardar red». Marcar las dos es
                  «ambas»; desmarcar la última no se permite. */}
              {marcados.has(socio.id) && (
                <div className="ml-[1.75rem] flex flex-wrap items-center gap-x-5 gap-y-2">
                  <span className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
                    Red
                  </span>
                  {(
                    [
                      ['privada', 'Privada'],
                      ['publica', 'Pública'],
                    ] as const
                  ).map(([cual, etiqueta]) => (
                    <Checkbox
                      key={cual}
                      compacto
                      id={`red-${cual}-${socio.id}`}
                      checked={(redes[socio.id] ?? RED_POR_DEFECTO)[cual]}
                      onChange={(v) => alternarRed(socio.id, cual, v)}
                      titulo={etiqueta}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {totalPaginas > 1 && (
        <div className="flex items-center justify-end gap-2">
          <p className="tabular mr-2 text-xs text-tenue-fg" aria-live="polite">
            página {paginaActual} de {totalPaginas}
          </p>
          <Boton
            type="button"
            variante="contorno"
            tamano="sm"
            onClick={() => setPagina((p) => Math.max(1, p - 1))}
            disabled={paginaActual <= 1}
          >
            <ChevronLeft aria-hidden="true" />
            Anterior
          </Boton>
          <Boton
            type="button"
            variante="contorno"
            tamano="sm"
            onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
            disabled={paginaActual >= totalPaginas}
          >
            Siguiente
            <ChevronRight aria-hidden="true" />
          </Boton>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-tenue-fg" aria-live="polite">
          {marcados.size} de {socios.length} {textos.contador}
          {busqueda.trim() ? ` · ${filtrados.length} coinciden con la búsqueda` : ''}
        </p>
        <Boton type="button" onClick={guardar} cargando={guardando}>
          Guardar red
        </Boton>
      </div>
    </div>
  )
}
