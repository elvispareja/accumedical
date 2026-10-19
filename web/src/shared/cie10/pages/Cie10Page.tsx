import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Check, Copy, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import { Boton } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { useToast } from '@/shared/components/ui/toast'
import { buscarCie10, capitulosCie10, POR_PAGINA, type Cie10, type Cie10Capitulo } from '@/shared/cie10/api'

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

/** «365 días» → «1 año»; el MSP guarda las edades en días. */
function edad(dias: number): string {
  if (dias >= 365) {
    const anos = Math.round(dias / 365)
    return `${anos} ${anos === 1 ? 'año' : 'años'}`
  }
  return `${dias} ${dias === 1 ? 'día' : 'días'}`
}

/**
 * CIE-10 en admin.pymes.ec (19/10/2026): la portada del catálogo y su buscador.
 *
 * Se busca por CÓDIGO como lo escriba la gente («E11.9», «e119», «E11» trae la
 * categoría y sus subcategorías) o por PALABRAS («diabetes tipo 2», «neumon»:
 * todas tienen que aparecer, sin importar tildes ni mayúsculas). Sin búsqueda,
 * la portada muestra los 22 capítulos para recorrerlo. El catálogo es el de la
 * central —el mismo que usarán todas las apps—; aquí solo se consulta.
 */
export function Cie10Page() {
  const [texto, setTexto] = useState('')
  const [q, setQ] = useState('')
  const [capitulo, setCapitulo] = useState<Cie10Capitulo | null>(null)
  const [agrupadores, setAgrupadores] = useState(false)
  const [retirados, setRetirados] = useState(false)

  // Espera a que se deje de teclear: una consulta por pulsación es ruido.
  useEffect(() => {
    const t = window.setTimeout(() => setQ(texto.trim()), 300)
    return () => window.clearTimeout(t)
  }, [texto])

  const capitulos = useQuery({ queryKey: ['cie10', 'capitulos'], queryFn: capitulosCie10, staleTime: Infinity })
  const buscando = q.length >= 2 || capitulo !== null
  const resultados = useInfiniteQuery({
    queryKey: ['cie10', 'buscar', q, capitulo?.capitulo ?? '', agrupadores, retirados],
    queryFn: ({ pageParam }) =>
      buscarCie10({
        q: q.length >= 2 ? q : undefined,
        capitulo: capitulo?.capitulo,
        incluir_agrupadores: agrupadores,
        incluir_inactivos: retirados,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (ultima, todas) => (ultima.length === POR_PAGINA ? todas.length * POR_PAGINA : undefined),
    enabled: buscando,
  })
  const filas = resultados.data?.pages.flat() ?? []
  const total = capitulos.data?.reduce((s, c) => s + c.seleccionables, 0)

  return (
    <div className="w-full">
      <header>
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Catálogos
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">CIE-10</h1>
        <p className="mt-1 max-w-3xl text-sm text-tenue-fg">
          Clasificación Internacional de Enfermedades, 10.ª revisión: texto oficial de la OPS (2018) con las
          extensiones y restricciones del MSP de Ecuador.
          {total ? ` ${total.toLocaleString('es-EC')} códigos para diagnóstico.` : ''}
        </p>
      </header>

      <div className="mt-6 rounded-md border border-borde bg-superficie p-4 sm:p-5">
        <label htmlFor="buscar-cie10" className="font-display text-sm font-medium">
          Buscar por código o descripción
        </label>
        <div className="relative mt-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
            aria-hidden="true"
          />
          <Input
            id="buscar-cie10"
            type="search"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="E11.9, e119, I21… o «diabetes tipo 2», «neumonía»"
            className="h-11 pl-9 text-base"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Checkbox
            id="cie10-agrupadores"
            compacto
            checked={agrupadores}
            onChange={setAgrupadores}
            titulo="Ver también las categorías que agrupan (p. ej. E11)"
          />
          <Checkbox
            id="cie10-retirados"
            compacto
            checked={retirados}
            onChange={setRetirados}
            titulo="Incluir códigos retirados por la OMS"
          />
        </div>
        {capitulo && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-tenue-fg">En el capítulo</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-marca-suave px-3 py-1 font-medium text-marca">
              {capitulo.capitulo} · {capitulo.titulo}
              <button
                type="button"
                onClick={() => setCapitulo(null)}
                className="grid size-4 place-items-center rounded-full hover:bg-marca/10"
                aria-label="Quitar el filtro de capítulo"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          </div>
        )}
      </div>

      {!buscando ? (
        <Portada capitulos={capitulos.data} cargando={capitulos.isLoading} alElegir={setCapitulo} />
      ) : (
        <section className="mt-6" aria-label="Resultados">
          {resultados.isError ? (
            <p className="text-sm text-tenue-fg">{mensajeDeError(resultados.error, 'No pudimos consultar la CIE-10.')}</p>
          ) : resultados.isLoading ? (
            <div className="space-y-2" role="status" aria-label="Buscando">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-md bg-tenue" />
              ))}
            </div>
          ) : filas.length === 0 ? (
            <div className="rounded-md border border-dashed border-borde p-8 text-center">
              <p className="font-medium">Ningún código coincide</p>
              <p className="mt-1 text-sm text-tenue-fg">
                Pruebe con menos palabras o con el inicio de una («neumon» encuentra «neumonía»).
              </p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-tenue-fg">
                {filas.length}
                {resultados.hasNextPage ? '+' : ''} {filas.length === 1 ? 'resultado' : 'resultados'}
              </p>
              <ul className="divide-y divide-borde overflow-hidden rounded-md border border-borde bg-superficie">
                {filas.map((c) => (
                  <FilaCie10 key={c.codigo} c={c} />
                ))}
              </ul>
              {resultados.hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <Boton
                    variante="contorno"
                    onClick={() => resultados.fetchNextPage()}
                    cargando={resultados.isFetchingNextPage}
                  >
                    Ver más
                  </Boton>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}

/** La portada: los capítulos de la CIE-10 para recorrerla sin buscar. */
function Portada({
  capitulos,
  cargando,
  alElegir,
}: {
  capitulos: Cie10Capitulo[] | undefined
  cargando: boolean
  alElegir: (c: Cie10Capitulo) => void
}) {
  return (
    <section className="mt-8" aria-label="Capítulos de la CIE-10">
      <h2 className="font-display text-base font-semibold">Capítulos</h2>
      <p className="mt-0.5 text-sm text-tenue-fg">Elija uno para ver sus códigos, o escriba arriba.</p>
      {cargando ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-md bg-tenue" />
          ))}
        </div>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(capitulos ?? []).map((c) => (
            <li key={c.capitulo}>
              <button
                type="button"
                onClick={() => alElegir(c)}
                className="group flex h-full w-full items-start gap-3 rounded-md border border-borde bg-superficie p-4 text-left transition-colors duration-150 ease-natural hover:border-marca/40 hover:bg-marca-suave/40"
              >
                <span className="grid h-9 min-w-9 shrink-0 place-items-center rounded-md bg-marca-suave px-1.5 font-display text-sm font-semibold text-marca">
                  {c.capitulo}
                </span>
                <span className="min-w-0">
                  <span className="block font-display text-sm font-medium leading-snug">{c.titulo}</span>
                  <span className="mt-1 block font-mono text-xs text-tenue-fg">
                    {c.desde}–{c.hasta} · {c.seleccionables.toLocaleString('es-EC')} códigos
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Un código: el código para copiar, su descripción y lo que conviene saber de él. */
function FilaCie10({ c }: { c: Cie10 }) {
  const toast = useToast()
  const [copiado, setCopiado] = useState(false)

  function copiar() {
    navigator.clipboard
      ?.writeText(c.codigo)
      .then(() => {
        setCopiado(true)
        window.setTimeout(() => setCopiado(false), 1500)
      })
      .catch(() => toast.error('No se pudo copiar el código'))
  }

  const etiquetas: { texto: string; tono: 'neutro' | 'aviso' | 'peligro' }[] = []
  if (!c.seleccionable) etiquetas.push({ texto: 'Agrupa: no se usa en un diagnóstico', tono: 'neutro' })
  if (!c.activo) etiquetas.push({ texto: 'Retirado por la OMS', tono: 'peligro' })
  if (c.sexo) etiquetas.push({ texto: c.sexo === 'F' ? 'Solo mujeres' : 'Solo hombres', tono: 'aviso' })
  if (c.edad_min_dias != null || c.edad_max_dias != null) {
    const desde = c.edad_min_dias != null ? `desde ${edad(c.edad_min_dias)}` : ''
    const hasta = c.edad_max_dias != null ? `hasta ${edad(c.edad_max_dias)}` : ''
    etiquetas.push({ texto: `Edad ${[desde, hasta].filter(Boolean).join(' ')}`, tono: 'aviso' })
  }
  if (c.simbolo === '†') etiquetas.push({ texto: '† Etiología', tono: 'neutro' })
  if (c.simbolo === '*') etiquetas.push({ texto: '* Manifestación', tono: 'neutro' })
  if (c.origen.startsWith('MSP Ecuador (extensión')) etiquetas.push({ texto: 'Extensión MSP Ecuador', tono: 'neutro' })

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <button
        type="button"
        onClick={copiar}
        title="Copiar el código"
        aria-label={`Copiar el código ${c.codigo}`}
        className="group inline-flex shrink-0 items-center gap-1.5 rounded bg-tenue px-2 py-1 font-mono text-sm font-semibold transition-colors duration-150 hover:bg-marca-suave hover:text-marca"
      >
        {c.codigo}
        {copiado ? (
          <Check className="size-3.5 text-marca" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5 opacity-40 group-hover:opacity-100" aria-hidden="true" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', !c.activo && 'text-tenue-fg line-through')}>{c.descripcion}</p>
        <p className="mt-0.5 truncate text-xs text-tenue-fg">
          {c.capitulo ? `Cap. ${c.capitulo} · ${c.capitulo_titulo ?? ''}` : ''}
          {c.grupo ? ` · ${c.grupo}${c.grupo_titulo ? ` ${c.grupo_titulo}` : ''}` : ''}
        </p>
        {etiquetas.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {etiquetas.map((e) => (
              <span
                key={e.texto}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[0.6875rem] font-medium',
                  e.tono === 'peligro' && 'bg-peligro-suave text-peligro',
                  e.tono === 'aviso' && 'bg-modulo-carta-credito/10 text-modulo-carta-credito',
                  e.tono === 'neutro' && 'bg-tenue text-tenue-fg',
                )}
              >
                {e.texto}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}
