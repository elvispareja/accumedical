import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { listarPacientes, type PacienteFila } from '@pacientes/api'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'

export function nombreCompleto(p: Pick<PacienteFila, 'nombre_principal' | 'nombre_secundario' | 'apellido_paterno' | 'apellido_materno'>) {
  return [p.apellido_paterno, p.apellido_materno, p.nombre_principal, p.nombre_secundario]
    .filter(Boolean)
    .join(' ')
}

export function fecha(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * El registro de pacientes de Accumedical (D49): una persona por documento,
 * venga de la auditoría que venga. Vive en la central; aquí se consulta.
 */
export function ListaPage() {
  const navegar = useNavigate()
  const [busqueda, setBusqueda] = useState('')
  const [aplicada, setAplicada] = useState('')
  const [pagina, setPagina] = useState(1)

  // Se busca al dejar de escribir, no en cada tecla.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setAplicada(busqueda)
      setPagina(1)
    }, 350)
    return () => window.clearTimeout(id)
  }, [busqueda])

  const consulta = useQuery({
    queryKey: ['pacientes', { aplicada, pagina }],
    queryFn: () => listarPacientes(aplicada, pagina),
    placeholderData: keepPreviousData,
  })
  const datos = consulta.data
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.page_size)) : 1

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
        Registro de Accumedical
      </p>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">Pacientes</h1>
      <p className="mt-1 text-sm text-tenue-fg">
        Una ficha por persona, con lo que ha pasado en todas las auditorías. Se crea sola al
        registrar un caso en cualquier app.
      </p>

      <div className="relative mt-6 max-w-xl">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
          aria-hidden="true"
        />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por número de documento o por nombres y apellidos"
          aria-label="Buscar pacientes"
          mayusculas={false}
          className="pl-9"
        />
      </div>

      {consulta.isError ? (
        <div className="mt-6 rounded-md border border-borde bg-superficie px-4 py-8 text-center text-sm text-tenue-fg">
          No pudimos cargar el registro de pacientes.
          <div className="mt-3">
            <Boton variante="contorno" tamano="sm" onClick={() => consulta.refetch()}>
              Reintentar
            </Boton>
          </div>
        </div>
      ) : datos && datos.items.length === 0 ? (
        <div className="mt-6 rounded-md border border-dashed border-borde px-4 py-10 text-center">
          <Users className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
          <p className="mt-2 text-sm text-tenue-fg">
            {aplicada ? 'Nadie coincide con esa búsqueda.' : 'Todavía no hay pacientes registrados.'}
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-md border border-borde bg-superficie">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-borde text-left text-[0.6875rem] uppercase tracking-[0.08em] text-tenue-fg">
              <tr>
                <th className="px-4 py-3 font-semibold">Paciente</th>
                <th className="px-4 py-3 font-semibold">Documento</th>
                <th className="px-4 py-3 font-semibold">Historial</th>
                <th className="px-4 py-3 font-semibold">Último movimiento</th>
              </tr>
            </thead>
            <tbody>
              {(datos?.items ?? []).map((p) => (
                <tr
                  key={p.id}
                  onClick={() => navegar(`/${p.id}`)}
                  className="cursor-pointer border-b border-borde last:border-0 hover:bg-tenue"
                >
                  <td className="px-4 py-3 font-medium">
                    <button type="button" className="text-left hover:underline" onClick={() => navegar(`/${p.id}`)}>
                      {nombreCompleto(p)}
                    </button>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-tenue-fg">
                    {p.tipo_documento_codigo} · {p.numero_documento}
                  </td>
                  <td className="px-4 py-3">{p.eventos === 1 ? '1 movimiento' : `${p.eventos} movimientos`}</td>
                  <td className="px-4 py-3 text-tenue-fg">{fecha(p.ultimo_evento)}</td>
                </tr>
              ))}
              {consulta.isPending &&
                Array.from({ length: 4 }, (_, i) => (
                  <tr key={i} className="border-b border-borde last:border-0">
                    <td colSpan={4} className="px-4 py-3">
                      <div className="h-4 w-2/3 animate-pulse rounded bg-tenue" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {datos && datos.total > datos.page_size && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm text-tenue-fg">
          <span>
            Página {pagina} de {paginas} · {datos.total} pacientes
          </span>
          <Boton variante="contorno" tamano="icono" aria-label="Página anterior" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
            <ChevronLeft aria-hidden="true" />
          </Boton>
          <Boton variante="contorno" tamano="icono" aria-label="Página siguiente" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>
            <ChevronRight aria-hidden="true" />
          </Boton>
        </div>
      )}
    </div>
  )
}
