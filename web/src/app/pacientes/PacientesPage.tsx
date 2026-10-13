import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight, RotateCw, Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { listarPacientes } from '@concurrencia/integracion'
import { useTiposDocumento } from '@/shared/catalogos/hooks'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1]
const POR_PAGINA = 20

/** Cuándo fue la última vez. Día y mes bastan: aquí no se opera, se consulta. */
function cuando(iso: string): string {
  return new Date(iso).toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Pacientes Accumedical: **las personas que la plataforma ha registrado**, una
 * por documento, de la A a la Z.
 *
 * No hay tabla de pacientes: la lista se COMPONE de lo que cada módulo ya
 * registró al abrir sus casos. Hoy solo existe Concurrencia, así que hoy es su
 * lista; cuando entren las demás auditorías, cada una expondrá la suya —como
 * hace con la bandeja— y esta pantalla las juntará por documento, que es lo que
 * identifica a una persona.
 *
 * Por eso vive en `app/` y no en `core/` ni en `shared/`: para juntar lo de
 * varios módulos hay que importar de cada uno, y ni el núcleo ni lo compartido
 * pueden depender de un módulo (regla dura de arquitectura). `app/` sí.
 */
export function PacientesPage() {
  const sinMovimiento = useReducedMotion()
  const navegar = useNavigate()
  const [busqueda, setBusqueda] = useState('')
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  const [pagina, setPagina] = useState(1)

  useEffect(() => {
    const id = window.setTimeout(() => {
      setBusquedaAplicada(busqueda)
      setPagina(1)
    }, 300)
    return () => window.clearTimeout(id)
  }, [busqueda])

  const consulta = useQuery({
    queryKey: ['pacientes', { busquedaAplicada, pagina }],
    queryFn: () =>
      listarPacientes({ search: busquedaAplicada, page: pagina, page_size: POR_PAGINA }),
    placeholderData: keepPreviousData,
  })
  // Para leer «cedula» como «Cédula»: el catálogo manda, no un diccionario aquí.
  const tipos = useTiposDocumento()
  const nombreDelTipo = (codigo: string) =>
    tipos.data?.find((t) => t.codigo === codigo)?.nombre ?? codigo

  const datos = consulta.data
  const items = datos?.items ?? []
  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.page_size)) : 1

  return (
    <div className="w-full">
      <header>
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Administración
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
          Pacientes Accumedical
        </h1>
        <p className="mt-1 text-sm text-tenue-fg">
          Las personas registradas en los casos de la plataforma, una por identificación —la misma
          puede entrar por varias aseguradoras—. Hoy las aporta Auditoría de Concurrencia; cada
          auditoría nueva sumará las suyas.
        </p>
      </header>

      <div className="mt-7 max-w-xl">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
            aria-hidden="true"
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o número de identificación"
            aria-label="Buscar pacientes"
            mayusculas={false}
            className="pl-9"
          />
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-md border border-borde bg-superficie">
        {consulta.isPending ? (
          <div className="divide-y divide-borde" role="status" aria-label="Cargando los pacientes">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <div className="h-3 w-1/3 animate-pulse rounded bg-tenue" />
                <div className="h-3 w-1/5 animate-pulse rounded bg-tenue" />
                <div className="ml-auto h-3 w-24 animate-pulse rounded bg-tenue" />
              </div>
            ))}
          </div>
        ) : consulta.isError ? (
          <div className="px-6 py-14 text-center">
            <p className="font-display text-sm font-medium">No pudimos cargar los pacientes</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
              Puede ser un corte momentáneo de conexión con el servidor.
            </p>
            <Boton
              variante="contorno"
              tamano="sm"
              className="mt-4"
              onClick={() => consulta.refetch()}
            >
              <RotateCw aria-hidden="true" />
              Reintentar
            </Boton>
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-16 text-center">
            {busquedaAplicada ? (
              <Search className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
            ) : (
              <Users className="mx-auto size-6 text-tenue-fg" aria-hidden="true" />
            )}
            <p className="mt-3 font-display text-sm font-medium">
              {busquedaAplicada ? 'Nadie coincide con la búsqueda' : 'Todavía no hay pacientes'}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
              {busquedaAplicada
                ? 'Prueba con otro nombre o con el número de identificación.'
                : 'Aparecerán aquí en cuanto una auditoría registre su primer caso.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <thead>
                <tr className="border-b border-borde bg-superficie-hundida text-left">
                  <Th>Paciente</Th>
                  <Th>Identificación</Th>
                  <Th>Casos</Th>
                  <Th>Último caso</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((paciente, indice) => (
                  <motion.tr
                    key={`${paciente.tipo_documento_codigo}-${paciente.numero_documento}`}
                    initial={sinMovimiento ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: {
                        duration: 0.22,
                        delay: sinMovimiento ? 0 : Math.min(indice, 8) * 0.03,
                        ease: EASE,
                      },
                    }}
                    onClick={() =>
                      navegar(
                        `/admin/pacientes/${paciente.tipo_documento_codigo}/${paciente.numero_documento}`,
                      )
                    }
                    // La fila entera abre su ficha, como en la bandeja: el
                    // objetivo es grande y no hay que apuntar a un icono.
                    className="cursor-pointer border-b border-borde last:border-b-0 hover:bg-tenue/50"
                  >
                    <td className="px-4 py-3">
                      {/* El nombre ya compuesto por el servidor; debajo, sus
                          cuatro partes tal como se capturaron, que es como se
                          enseña una persona en toda la plataforma. */}
                      <Link
                        to={`/admin/pacientes/${paciente.tipo_documento_codigo}/${paciente.numero_documento}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium hover:text-marca focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca"
                      >
                        {paciente.nombre_completo}
                      </Link>
                      <p className="mt-0.5 text-xs text-tenue-fg">
                        {[paciente.apellido_paterno, paciente.apellido_materno]
                          .filter(Boolean)
                          .join(' ')}
                        {' · '}
                        {[paciente.nombre_principal, paciente.nombre_secundario]
                          .filter(Boolean)
                          .join(' ')}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-tenue-fg">
                      <span className="block text-tinta">
                        {nombreDelTipo(paciente.tipo_documento_codigo)}
                      </span>
                      <span className="tabular block text-xs">{paciente.numero_documento}</span>
                    </td>
                    <td className="tabular px-4 py-3 text-tenue-fg">{paciente.casos}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-tenue-fg">
                      {cuando(paciente.ultimo_caso)}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {datos && datos.total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-tenue-fg">
            {datos.total} {datos.total === 1 ? 'paciente' : 'pacientes'} · página {datos.page} de{' '}
            {totalPaginas}
          </p>
          <div className="flex gap-2">
            <Boton
              variante="contorno"
              tamano="sm"
              disabled={pagina <= 1}
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft aria-hidden="true" />
              Anterior
            </Boton>
            <Boton
              variante="contorno"
              tamano="sm"
              disabled={pagina >= totalPaginas}
              onClick={() => setPagina((p) => p + 1)}
            >
              Siguiente
              <ChevronRight aria-hidden="true" />
            </Boton>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
      {children}
    </th>
  )
}
