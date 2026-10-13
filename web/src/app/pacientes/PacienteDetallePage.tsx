import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, RotateCw } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { identidadDe } from '@/core/modulos/identidad'
import {
  CasosDeConcurrencia,
  CuadroDeConcurrencia,
  obtenerPaciente,
} from '@concurrencia/integracion'
import { useTiposDocumento } from '@/shared/catalogos/hooks'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Tabs } from '@/shared/components/ui/tabs'
import type { PropsCasosAuditoria, PropsCuadroAuditoria } from '@/shared/components/bandeja'

/**
 * Las auditorías que aportan casos a la ficha del paciente. La misma idea que la
 * bandeja de entrada: cada módulo expone su cuadro y sus casos, y esta pantalla
 * —que vive en `app/`— los junta. Hoy solo Concurrencia.
 */
const MODULOS: {
  codigo: string
  nombre: string
  slug: string
  Cuadro: (props: PropsCuadroAuditoria) => JSX.Element
  Casos: (props: PropsCasosAuditoria) => JSX.Element
}[] = [
  {
    codigo: 'concurrencia',
    nombre: 'Auditoría de Concurrencia',
    slug: 'concurrencia',
    Cuadro: CuadroDeConcurrencia,
    Casos: CasosDeConcurrencia,
  },
]

/** Fecha corta: aquí se consulta un historial, no se opera con él. */
function cuando(iso: string): string {
  return new Date(iso).toLocaleDateString('es-EC', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * La ficha de un paciente, en dos pestañas: **Datos generales** —quién es, tal
 * como quedó registrado— y **Módulos** —por dónde ha pasado y con qué casos—.
 *
 * La persona se identifica por su documento, no por un id: es lo que la
 * identifica en todas las auditorías, y lo que permitirá juntar sus casos
 * cuando haya más de una. Todo es de solo lectura: **no hay ficha de paciente
 * que editar**, porque estos datos los escribe cada caso al registrarse.
 */
export function PacienteDetallePage() {
  const { tipo = '', numero = '' } = useParams<{ tipo: string; numero: string }>()
  const [pestana, setPestana] = useState('generales')

  const consulta = useQuery({
    queryKey: ['paciente', tipo, numero],
    queryFn: () => obtenerPaciente(tipo, numero),
    retry: false,
  })
  const tipos = useTiposDocumento()
  const nombreDelTipo = (codigo: string) =>
    tipos.data?.find((t) => t.codigo === codigo)?.nombre ?? codigo

  const paciente = consulta.data
  // En la ficha del paciente solo interesan los casos TERMINADOS: son los que
  // tienen informe, y su fila lleva al PDF. Lo pendiente se sigue en el panel
  // de cada auditoría, que es donde se trabaja.
  const filtros = { documento: { tipo, numero }, soloFinalizados: true }

  return (
    <div className="w-full">
      <Link
        to="/admin/pacientes"
        className="inline-flex items-center gap-1.5 rounded text-sm text-tenue-fg transition-colors duration-150 hover:text-tinta"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Pacientes Accumedical
      </Link>

      <header className="mt-3">
        <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-tenue-fg">
          Paciente
        </p>
        <h1 className="mt-1.5 font-display text-2xl font-semibold tracking-tight">
          {consulta.isPending ? 'Cargando…' : (paciente?.nombre_completo ?? 'Paciente')}
        </h1>
        {paciente && (
          <p className="mt-1 text-sm text-tenue-fg">
            {nombreDelTipo(paciente.tipo_documento_codigo)} {paciente.numero_documento} ·{' '}
            {paciente.casos} {paciente.casos === 1 ? 'caso' : 'casos'} en la plataforma
          </p>
        )}
      </header>

      {consulta.isError ? (
        <div className="mt-7 rounded-md border border-borde bg-superficie px-6 py-16 text-center">
          <p className="font-display text-sm font-medium">No encontramos a esa persona</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">
            Puede que la identificación esté mal escrita, o que todavía no tenga ningún caso.
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
      ) : (
        <Tabs
          className="mt-6"
          activa={pestana}
          onCambiar={setPestana}
          pestanas={[
            { id: 'generales', etiqueta: 'Datos generales' },
            { id: 'modulos', etiqueta: 'Módulos' },
          ]}
        >
          {pestana === 'generales' ? (
            <section className="mt-6" aria-label="Datos generales">
              {/* Las mismas casillas con las que se capturó, deshabilitadas: un
                  expediente se enseña como se escribió (docs/07, §2). No se
                  editan aquí porque los escribe cada caso, no esta pantalla. */}
              <div className="rounded-md border border-borde bg-superficie p-5">
                <p className="font-display text-sm font-medium">Identificación</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="pac-tipo">Tipo de identificación</Label>
                    <Input
                      id="pac-tipo"
                      value={paciente ? nombreDelTipo(paciente.tipo_documento_codigo) : ''}
                      disabled
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pac-numero">Número de identificación</Label>
                    <Input id="pac-numero" value={paciente?.numero_documento ?? ''} disabled />
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-md border border-borde bg-superficie p-5">
                <p className="font-display text-sm font-medium">Nombre</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="pac-n1">Nombre principal</Label>
                    <Input id="pac-n1" value={paciente?.nombre_principal ?? ''} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pac-n2">Nombre secundario</Label>
                    <Input id="pac-n2" value={paciente?.nombre_secundario ?? ''} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pac-a1">Apellido paterno</Label>
                    <Input id="pac-a1" value={paciente?.apellido_paterno ?? ''} disabled />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pac-a2">Apellido materno</Label>
                    <Input id="pac-a2" value={paciente?.apellido_materno ?? ''} disabled />
                  </div>
                </div>
                <p className="mt-3 text-xs text-tenue-fg">
                  Tal como quedó registrado en su caso más reciente.
                </p>
              </div>

              <div className="mt-4 rounded-md border border-borde bg-superficie p-5">
                <p className="font-display text-sm font-medium">En la plataforma</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
                  <Dato etiqueta="Casos" valor={paciente ? String(paciente.casos) : '—'} />
                  <Dato
                    etiqueta="Primer caso"
                    valor={paciente ? cuando(paciente.primer_caso) : '—'}
                  />
                  <Dato
                    etiqueta="Último caso"
                    valor={paciente ? cuando(paciente.ultimo_caso) : '—'}
                  />
                </div>
              </div>
            </section>
          ) : (
            <section className="mt-6" aria-label="Módulos">
              {/* Un cuadro por auditoría, con sus casos TERMINADOS de esta
                  persona debajo. Las mismas piezas de la bandeja del
                  coordinador: el módulo pone el número y sus casos traducidos,
                  y esta pantalla los junta. Pulsar uno abre su informe. */}
              <p className="mb-3 text-sm text-tenue-fg">
                Los casos terminados de esta persona. Pulsa uno para abrir su informe en PDF.
              </p>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {MODULOS.map((modulo, indice) => {
                  const identidad = identidadDe(modulo.codigo)
                  return (
                    <modulo.Cuadro
                      key={modulo.codigo}
                      indice={indice}
                      nombre={modulo.nombre}
                      icono={identidad.Icono}
                      acento={{
                        suave: identidad.suave,
                        texto: identidad.texto,
                        borde: identidad.borde,
                      }}
                      a={`/${modulo.slug}`}
                      filtros={filtros}
                    />
                  )
                })}
              </div>

              {MODULOS.map((modulo) => (
                <div key={modulo.codigo} className="mt-5">
                  <modulo.Casos filtros={filtros} />
                </div>
              ))}
            </section>
          )}
        </Tabs>
      )}
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="font-display text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-tenue-fg">
        {etiqueta}
      </p>
      <p className="tabular mt-1 text-sm">{valor}</p>
    </div>
  )
}
