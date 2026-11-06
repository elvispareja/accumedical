import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Merge, Search, Sparkles, Split } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { cn } from '@/lib/utils'
import {
  buscarAgrupadores,
  juntarAgrupadores,
  moverCodigos,
  renombrarAgrupador,
  sugerirAgrupacion,
  verAgrupador,
  type AgrupadorDetalle,
  type AgrupadorResumen,
  type SugerenciaAgrupador,
} from '@/shared/cie10/agrupadores'
import { Boton } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Modal } from '@/shared/components/ui/modal'
import { useToast } from '@/shared/components/ui/toast'

function mensajeDeError(error: unknown, porDefecto: string): string {
  const detalle = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return typeof detalle === 'string' ? detalle : porDefecto
}

function useDemorado(valor: string, ms = 300) {
  const [demorado, setDemorado] = useState(valor)
  useEffect(() => {
    const t = window.setTimeout(() => setDemorado(valor.trim()), ms)
    return () => window.clearTimeout(t)
  }, [valor, ms])
  return demorado
}

function Categorias({ categorias, max = 6 }: { categorias: string[]; max?: number }) {
  return (
    <span className="flex flex-wrap gap-1">
      {categorias.slice(0, max).map((c) => (
        <span key={c} className="rounded bg-tenue px-1.5 py-0.5 font-mono text-[0.6875rem] text-tenue-fg">
          {c}
        </span>
      ))}
      {categorias.length > max && (
        <span className="px-1 text-[0.6875rem] text-tenue-fg">+{categorias.length - max}</span>
      )}
    </span>
  )
}

function Estado({ g }: { g: AgrupadorResumen }) {
  if (!g.activo) {
    return (
      <span className="rounded-full bg-tenue px-2 py-0.5 text-[0.6875rem] font-medium text-tenue-fg">
        Inactivo · pasó a {g.fusionado_en}
      </span>
    )
  }
  if (g.ajustado) {
    return (
      <span className="rounded-full bg-marca-suave px-2 py-0.5 text-[0.6875rem] font-medium text-marca">Ajustado</span>
    )
  }
  return null
}

/**
 * **Agrupadores de eventos** (6/11/2026, decisión del usuario: «tener todo el
 * CIE-10 de nuestro lado y que se agrupen cosas para evitar que cada uno tenga
 * diferente evento»). Cada código CIE-10 pertenece a UN agrupador; la misma
 * enfermedad con otro código cae en el mismo evento y comparte su tope. Nacen
 * de las categorías; el administrador global los junta y los separa, y la IA
 * solo propone.
 */
export function AgrupadoresCie10({ puedeAjustar }: { puedeAjustar: boolean }) {
  const [texto, setTexto] = useState('')
  const q = useDemorado(texto)
  const [soloAjustados, setSoloAjustados] = useState(false)
  const [inactivos, setInactivos] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)

  const lista = useInfiniteQuery({
    queryKey: ['cie10-agrupadores', q, soloAjustados, inactivos],
    queryFn: ({ pageParam }) =>
      buscarAgrupadores({
        q: q.length >= 2 ? q : undefined,
        solo_ajustados: soloAjustados || undefined,
        incluir_inactivos: inactivos || undefined,
        offset: pageParam || undefined,
      }),
    initialPageParam: 0,
    getNextPageParam: (ultima, todas) => {
      const vistos = todas.reduce((s, p) => s + p.items.length, 0)
      return vistos < ultima.total ? vistos : undefined
    },
  })
  const filas = lista.data?.pages.flatMap((p) => p.items) ?? []
  const total = lista.data?.pages[0]?.total

  return (
    <div>
      <div className="rounded-md border border-borde bg-superficie p-4 text-sm sm:p-5">
        <p className="font-display font-medium">Un evento es un agrupador</p>
        <p className="mt-1 max-w-3xl text-tenue-fg">
          El tope de un producto se aplica por evento, y un evento es la misma enfermedad del mismo asegurado. Cada
          código CIE-10 pertenece a un solo agrupador: una gripe codificada J06.9 y otra J11.1, si están en el mismo
          agrupador, son un solo evento y comparten su saldo. Nacen de las categorías de la CIE-10 (ya separan por
          enfermedad y por sitio: tobillo y rodilla son distintos) y AccuMedical los junta y los separa. La IA solo
          propone; una persona confirma.
        </p>
      </div>

      <div className="mt-4 rounded-md border border-borde bg-superficie p-4 sm:p-5">
        <label htmlFor="buscar-agrupador" className="font-display text-sm font-medium">
          Buscar un agrupador
        </label>
        <div className="relative mt-2">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
            aria-hidden="true"
          />
          <Input
            id="buscar-agrupador"
            type="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={80}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="J06.9, S93, AGR-00716… o «gripe», «tobillo»"
            className="h-11 pl-9 text-base"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <Checkbox
            id="agrupadores-ajustados"
            compacto
            checked={soloAjustados}
            onChange={setSoloAjustados}
            titulo="Solo los ajustados por AccuMedical"
          />
          <Checkbox
            id="agrupadores-inactivos"
            compacto
            checked={inactivos}
            onChange={setInactivos}
            titulo="Ver también los inactivos (los que se juntaron con otro)"
          />
        </div>
      </div>

      <section className="mt-6" aria-label="Agrupadores">
        {lista.isError ? (
          <p className="text-sm text-tenue-fg">
            {mensajeDeError(lista.error, 'No pudimos consultar los agrupadores.')}
          </p>
        ) : lista.isLoading ? (
          <div className="space-y-2" role="status" aria-label="Buscando">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-md bg-tenue" />
            ))}
          </div>
        ) : filas.length === 0 ? (
          <div className="rounded-md border border-dashed border-borde p-8 text-center">
            <p className="font-medium">Ningún agrupador coincide</p>
            <p className="mt-1 text-sm text-tenue-fg">Pruebe con un código CIE-10 o con menos palabras.</p>
          </div>
        ) : (
          <>
            <p className="mb-2 text-xs text-tenue-fg">
              {total?.toLocaleString('es-EC')} {total === 1 ? 'agrupador' : 'agrupadores'}
            </p>
            <ul className="divide-y divide-borde overflow-hidden rounded-md border border-borde bg-superficie">
              {filas.map((g) => (
                <li key={g.codigo}>
                  <button
                    type="button"
                    onClick={() => setAbierto(g.codigo)}
                    className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-tenue/60 focus-visible:bg-tenue/60 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="mr-2 font-mono text-xs text-tenue-fg">{g.codigo}</span>
                      <span className={cn('text-sm font-medium', !g.activo && 'text-tenue-fg')}>{g.nombre}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Categorias categorias={g.categorias} />
                      <span className="text-xs tabular text-tenue-fg">
                        {g.total_codigos} {g.total_codigos === 1 ? 'código' : 'códigos'}
                      </span>
                      <Estado g={g} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {lista.hasNextPage && (
              <div className="mt-4 flex justify-center">
                <Boton variante="contorno" onClick={() => lista.fetchNextPage()} cargando={lista.isFetchingNextPage}>
                  Ver más
                </Boton>
              </div>
            )}
          </>
        )}
      </section>

      {abierto && (
        <DetalleAgrupador
          codigo={abierto}
          puedeAjustar={puedeAjustar}
          onCerrar={() => setAbierto(null)}
          onIr={setAbierto}
        />
      )}
    </div>
  )
}

/** Busca otro agrupador para elegirlo (destino o con cuál juntar). */
function ElegirAgrupador({
  excepto,
  elegido,
  onElegir,
  id,
}: {
  excepto: string
  elegido: AgrupadorResumen | null
  onElegir: (g: AgrupadorResumen | null) => void
  id: string
}) {
  const [texto, setTexto] = useState('')
  const q = useDemorado(texto)
  const resultados = useQuery({
    queryKey: ['cie10-agrupadores', 'elegir', q],
    queryFn: () => buscarAgrupadores({ q }),
    enabled: q.length >= 2 && !elegido,
  })
  if (elegido) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-borde bg-fondo px-3 py-2 text-sm">
        <span className="min-w-0">
          <span className="mr-2 font-mono text-xs text-tenue-fg">{elegido.codigo}</span>
          {elegido.nombre}
        </span>
        <Boton type="button" variante="fantasma" tamano="sm" onClick={() => onElegir(null)}>
          Cambiar
        </Boton>
      </div>
    )
  }
  const opciones = (resultados.data?.items ?? []).filter((g) => g.codigo !== excepto).slice(0, 8)
  return (
    <div className="space-y-2">
      <Input
        id={id}
        type="search"
        autoComplete="off"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Código CIE-10, AGR-… o palabras"
        maxLength={80}
      />
      {q.length >= 2 && (
        <ul className="max-h-56 divide-y divide-borde overflow-y-auto rounded-md border border-borde">
          {resultados.isLoading ? (
            <li className="px-3 py-2 text-sm text-tenue-fg">Buscando…</li>
          ) : opciones.length === 0 ? (
            <li className="px-3 py-2 text-sm text-tenue-fg">Ninguno coincide</li>
          ) : (
            opciones.map((g) => (
              <li key={g.codigo}>
                <button
                  type="button"
                  onClick={() => onElegir(g)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-tenue/60"
                >
                  <span className="font-mono text-xs text-tenue-fg">{g.codigo}</span>
                  <span className="min-w-0 flex-1">{g.nombre}</span>
                  <Categorias categorias={g.categorias} max={3} />
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

type Modo = null | 'renombrar' | 'separar' | 'juntar'

function DetalleAgrupador({
  codigo,
  puedeAjustar,
  onCerrar,
  onIr,
}: {
  codigo: string
  puedeAjustar: boolean
  onCerrar: () => void
  onIr: (codigo: string) => void
}) {
  const toast = useToast()
  const cliente = useQueryClient()
  const detalle = useQuery({
    queryKey: ['cie10-agrupador', codigo],
    queryFn: () => verAgrupador(codigo),
  })
  const g = detalle.data
  const [modo, setModo] = useState<Modo>(null)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [nombre, setNombre] = useState('')
  const [aNuevo, setANuevo] = useState(true)
  const [destino, setDestino] = useState<AgrupadorResumen | null>(null)
  const [motivo, setMotivo] = useState('')
  const [sugerencias, setSugerencias] = useState<SugerenciaAgrupador[] | null>(null)

  useEffect(() => {
    setModo(null)
    setMarcados(new Set())
    setDestino(null)
    setMotivo('')
    setSugerencias(null)
  }, [codigo])

  // Los códigos por categoría: marcar la categoría marca todos los suyos.
  const porCategoria = useMemo(() => {
    const grupos = new Map<string, AgrupadorDetalle['codigos']>()
    for (const c of g?.codigos ?? []) grupos.set(c.categoria, [...(grupos.get(c.categoria) ?? []), c])
    return [...grupos.entries()]
  }, [g])

  function listo(nuevo: AgrupadorDetalle, mensaje: string) {
    cliente.setQueryData(['cie10-agrupador', nuevo.codigo], nuevo)
    void cliente.invalidateQueries({ queryKey: ['cie10-agrupadores'] })
    void cliente.invalidateQueries({ queryKey: ['cie10-agrupador'] })
    toast.exito(mensaje)
    setModo(null)
    setMarcados(new Set())
    setDestino(null)
    setMotivo('')
  }
  const alFallar = (error: unknown) => toast.error(mensajeDeError(error, 'No se pudo guardar el cambio'))

  const renombrar = useMutation({
    mutationFn: () => renombrarAgrupador(codigo, nombre, motivo),
    onSuccess: (r) => listo(r, 'Nombre guardado'),
    onError: alFallar,
  })
  const mover = useMutation({
    mutationFn: () =>
      moverCodigos({
        codigos: [...marcados],
        ...(aNuevo ? { nombre_nuevo: nombre } : { destino: destino?.codigo }),
        motivo,
      }),
    onSuccess: (r) =>
      listo(r, `${marcados.size} ${marcados.size === 1 ? 'código pasó' : 'códigos pasaron'} a ${r.codigo}`),
    onError: alFallar,
  })
  const juntar = useMutation({
    mutationFn: (otros: string[]) => juntarAgrupadores(codigo, otros, motivo),
    onSuccess: (r, otros) => {
      setSugerencias((s) => s?.filter((x) => !otros.includes(x.codigo)) ?? null)
      listo(r, `Juntado: ${otros.join(', ')} pasó a ${r.codigo}`)
    },
    onError: alFallar,
  })
  const sugerir = useMutation({
    mutationFn: () => sugerirAgrupacion(codigo),
    onSuccess: (r) => setSugerencias(r),
    onError: (error) => toast.error(mensajeDeError(error, 'La IA no pudo responder ahora')),
  })

  function alternar(codigos: string[], marcar: boolean) {
    setMarcados((previo) => {
      const siguiente = new Set(previo)
      for (const c of codigos) {
        if (marcar) siguiente.add(c)
        else siguiente.delete(c)
      }
      return siguiente
    })
  }

  const ajustable = puedeAjustar && g?.activo
  const ocupado = renombrar.isPending || mover.isPending || juntar.isPending

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      ancho="max-w-3xl"
      titulo={g ? `${g.codigo} · ${g.nombre}` : codigo}
      descripcion={
        g
          ? g.origen === 'categoria'
            ? `Nació de la categoría ${g.categoria_base} de la CIE-10.`
            : 'Creado por AccuMedical.'
          : undefined
      }
    >
      {detalle.isLoading || !g ? (
        <p className="text-sm text-tenue-fg">
          {detalle.isError ? mensajeDeError(detalle.error, 'No pudimos abrir el agrupador.') : 'Cargando…'}
        </p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Categorias categorias={g.categorias} max={12} />
            <span className="text-xs tabular text-tenue-fg">
              {g.total_codigos} {g.total_codigos === 1 ? 'código' : 'códigos'}
            </span>
            <Estado g={g} />
          </div>

          {!g.activo && g.fusionado_en && (
            <p className="rounded-md border border-borde bg-tenue/50 px-3 py-2 text-sm">
              Sus códigos pasaron a{' '}
              <button type="button" className="font-medium text-marca underline" onClick={() => onIr(g.fusionado_en!)}>
                {g.fusionado_en}
              </button>
              . Se conserva para la historia; si se le devuelve un código, vuelve a estar activo.
            </p>
          )}

          {g.fusionados.length > 0 && (
            <div className="text-sm">
              <p className="font-medium">Se juntaron aquí</p>
              <ul className="mt-1 space-y-0.5 text-tenue-fg">
                {g.fusionados.map((f) => (
                  <li key={f.codigo}>
                    <button
                      type="button"
                      className="font-mono text-xs text-marca underline"
                      onClick={() => onIr(f.codigo)}
                    >
                      {f.codigo}
                    </button>{' '}
                    {f.nombre}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ajustable && (
            <div className="flex flex-wrap gap-2">
              <Boton
                type="button"
                variante={modo === 'juntar' ? 'solido' : 'contorno'}
                tamano="sm"
                onClick={() => setModo(modo === 'juntar' ? null : 'juntar')}
              >
                <Merge aria-hidden="true" />
                Juntar con otro
              </Boton>
              <Boton
                type="button"
                variante={modo === 'separar' ? 'solido' : 'contorno'}
                tamano="sm"
                onClick={() => {
                  setModo(modo === 'separar' ? null : 'separar')
                  setNombre('')
                }}
              >
                <Split aria-hidden="true" />
                Separar códigos
              </Boton>
              <Boton
                type="button"
                variante={modo === 'renombrar' ? 'solido' : 'contorno'}
                tamano="sm"
                onClick={() => {
                  setModo(modo === 'renombrar' ? null : 'renombrar')
                  setNombre(g.nombre)
                }}
              >
                Renombrar
              </Boton>
              <Boton
                type="button"
                variante="contorno"
                tamano="sm"
                cargando={sugerir.isPending}
                onClick={() => sugerir.mutate()}
              >
                <Sparkles aria-hidden="true" />
                Sugerir con IA
              </Boton>
            </div>
          )}

          {ajustable && modo === 'renombrar' && (
            <div className="space-y-3 rounded-md border border-borde p-4">
              <div className="space-y-2">
                <Label htmlFor="agrupador-nombre">Nombre</Label>
                <Input
                  id="agrupador-nombre"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value.toLocaleUpperCase())}
                  maxLength={250}
                />
              </div>
              <Motivo valor={motivo} onCambiar={setMotivo} />
              <Boton
                type="button"
                tamano="sm"
                cargando={renombrar.isPending}
                disabled={!nombre.trim() || ocupado}
                onClick={() => renombrar.mutate()}
              >
                Guardar nombre
              </Boton>
            </div>
          )}

          {ajustable && modo === 'juntar' && (
            <div className="space-y-3 rounded-md border border-borde p-4">
              <p className="text-sm text-tenue-fg">
                Todos los códigos del otro agrupador pasan a este: desde ahí son el mismo evento. El otro queda
                inactivo, sin borrarse.
              </p>
              <ElegirAgrupador id="agrupador-juntar" excepto={codigo} elegido={destino} onElegir={setDestino} />
              <Motivo valor={motivo} onCambiar={setMotivo} />
              <Boton
                type="button"
                tamano="sm"
                cargando={juntar.isPending}
                disabled={!destino || ocupado}
                onClick={() => destino && juntar.mutate([destino.codigo])}
              >
                Juntar {destino ? `${destino.codigo} aquí` : ''}
              </Boton>
            </div>
          )}

          {ajustable && modo === 'separar' && (
            <div className="space-y-3 rounded-md border border-borde p-4">
              <p className="text-sm text-tenue-fg">
                Marque abajo los códigos que son otra enfermedad. Pasan a un agrupador nuevo o a otro que ya exista:
                desde ahí abren un evento distinto.
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox
                  id="separar-nuevo"
                  compacto
                  checked={aNuevo}
                  onChange={() => setANuevo(true)}
                  titulo="A uno nuevo"
                />
                <Checkbox
                  id="separar-existente"
                  compacto
                  checked={!aNuevo}
                  onChange={() => setANuevo(false)}
                  titulo="A uno que ya existe"
                />
              </div>
              {aNuevo ? (
                <div className="space-y-2">
                  <Label htmlFor="agrupador-nuevo">Nombre del nuevo</Label>
                  <Input
                    id="agrupador-nuevo"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value.toLocaleUpperCase())}
                    placeholder="LARINGOFARINGITIS AGUDA"
                    maxLength={250}
                  />
                </div>
              ) : (
                <ElegirAgrupador id="agrupador-destino" excepto={codigo} elegido={destino} onElegir={setDestino} />
              )}
              <Motivo valor={motivo} onCambiar={setMotivo} />
              <Boton
                type="button"
                tamano="sm"
                cargando={mover.isPending}
                disabled={marcados.size === 0 || (aNuevo ? !nombre.trim() : !destino) || ocupado}
                onClick={() => mover.mutate()}
              >
                <ArrowRight aria-hidden="true" />
                Pasar {marcados.size} {marcados.size === 1 ? 'código' : 'códigos'}
              </Boton>
            </div>
          )}

          {sugerencias && (
            <div className="space-y-2 rounded-md border border-borde p-4">
              <p className="text-sm font-medium">La IA propone juntar con</p>
              {sugerencias.length === 0 ? (
                <p className="text-sm text-tenue-fg">Ningún otro agrupador le parece la misma enfermedad.</p>
              ) : (
                <ul className="divide-y divide-borde">
                  {sugerencias.map((s) => (
                    <li key={s.codigo} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1 text-sm">
                        <p>
                          <span className="mr-2 font-mono text-xs text-tenue-fg">{s.codigo}</span>
                          {s.nombre}
                        </p>
                        <p className="text-xs text-tenue-fg">{s.motivo}</p>
                      </div>
                      <Boton
                        type="button"
                        variante="contorno"
                        tamano="sm"
                        disabled={ocupado}
                        onClick={() => juntar.mutate([s.codigo])}
                      >
                        Juntar aquí
                      </Boton>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-tenue-fg">
                Es una propuesta: revise cada una. Se junta solo la que usted elija.
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">Sus códigos CIE-10</p>
            <ul className="max-h-80 divide-y divide-borde overflow-y-auto rounded-md border border-borde">
              {porCategoria.map(([categoria, codigos]) => {
                const todos = codigos.map((c) => c.codigo)
                const todosMarcados = todos.every((c) => marcados.has(c))
                return (
                  <li key={categoria} className="px-3 py-2">
                    {codigos.map((c) => (
                      <div key={c.codigo} className={cn('flex items-start gap-2 py-0.5', c.nivel > 3 && 'pl-6')}>
                        {ajustable && modo === 'separar' ? (
                          <Checkbox
                            id={`marcar-${c.codigo}`}
                            compacto
                            checked={c.nivel === 3 ? todosMarcados : marcados.has(c.codigo)}
                            onChange={(v) => alternar(c.nivel === 3 ? todos : [c.codigo], v)}
                            titulo={
                              <span className={cn('text-sm', c.nivel === 3 && 'font-medium')}>
                                <span className="mr-2 font-mono text-xs">{c.codigo}</span>
                                {c.descripcion}
                              </span>
                            }
                          />
                        ) : (
                          <p
                            className={cn(
                              'text-sm',
                              c.nivel === 3 && 'font-medium',
                              !c.activo && 'text-tenue-fg line-through',
                            )}
                          >
                            <span className="mr-2 font-mono text-xs text-tenue-fg">{c.codigo}</span>
                            {c.descripcion}
                          </p>
                        )}
                      </div>
                    ))}
                  </li>
                )
              })}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  )
}

function Motivo({ valor, onCambiar }: { valor: string; onCambiar: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="agrupador-motivo">Motivo (opcional)</Label>
      <Input
        id="agrupador-motivo"
        value={valor}
        onChange={(e) => onCambiar(e.target.value.toLocaleUpperCase())}
        placeholder="POR QUÉ ES (O NO ES) LA MISMA ENFERMEDAD"
        maxLength={500}
      />
    </div>
  )
}
