import { Pencil, Plus, Search, Trash2, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import {
  FORMATOS,
  filtrarDocumento,
  filtrarTelefono,
  problemaConDocumento,
  problemaConTelefono,
} from '@/shared/identificacion'
import { Boton } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Modal } from '@/shared/components/ui/modal'
import { Select } from '@/shared/components/ui/select'
import {
  CamposNombre,
  NOMBRE_VACIO,
  desdeApi as nombreDesdeApi,
  faltaObligatorio,
  haciaApi as nombreHaciaApi,
  nombreCompleto,
  nombreConSimbolos,
  type NombrePersona,
} from '@/shared/personas/CamposNombre'

/** Un contacto del formulario. `_key` es solo para React y no se envía. */
export interface ContactoFormulario extends NombrePersona {
  _key: string
  id?: string
  email: string
  telefono: string
  tipo_documento_codigo: string
  numero_documento: string
  cargo: string
  /** Solo contactos de prestador: su sede; '' = la sede principal. */
  sede_id?: string
}

export interface ContactoSalida {
  id: string
  nombre_principal: string
  nombre_secundario: string | null
  apellido_paterno: string
  apellido_materno: string | null
  /** Ya compuesto por el servidor, para enseñarlo sin recomponer nada. */
  nombre_completo: string
  email: string
  telefono: string | null
  tipo_documento_codigo: string | null
  tipo_documento_nombre: string | null
  numero_documento: string | null
  cargo: string | null
  /** Solo contactos de prestador: su sede; null = la sede principal. */
  sede_id?: string | null
}

export function contactoVacio(): ContactoFormulario {
  return {
    _key: crypto.randomUUID(),
    ...NOMBRE_VACIO,
    email: '',
    telefono: '',
    tipo_documento_codigo: '',
    numero_documento: '',
    cargo: '',
  }
}

/** Convierte lo que devuelve la API al estado del formulario. */
export function desdeApi(contactos: ContactoSalida[]): ContactoFormulario[] {
  return contactos.map((c) => ({
    _key: c.id,
    id: c.id,
    ...nombreDesdeApi(c),
    email: c.email,
    telefono: c.telefono ?? '',
    tipo_documento_codigo: c.tipo_documento_codigo ?? '',
    numero_documento: c.numero_documento ?? '',
    cargo: c.cargo ?? '',
    ...(c.sede_id !== undefined ? { sede_id: c.sede_id ?? '' } : {}),
  }))
}

/** Limpia `_key` y manda los opcionales vacíos como null. */
export function haciaApi(contactos: ContactoFormulario[]) {
  return contactos.map(({ _key, sede_id, ...c }) => ({
    ...c,
    // Solo los contactos de prestador llevan sede: a la aseguradora no se le manda.
    ...(sede_id !== undefined ? { sede_id: sede_id || null } : {}),
    ...nombreHaciaApi(c),
    email: c.email.trim(),
    telefono: c.telefono.trim() || null,
    tipo_documento_codigo: c.tipo_documento_codigo || null,
    numero_documento: c.numero_documento.trim() || null,
    cargo: c.cargo.trim() || null,
  }))
}

/** Devuelve el primer problema encontrado, o null si la lista es válida. */
export function validar(contactos: ContactoFormulario[]): string | null {
  if (contactos.some((c) => faltaObligatorio(c) || !c.email.trim())) {
    return 'Cada contacto necesita nombre principal, apellido paterno y correo'
  }
  // Fichas viejas, de cuando el nombre admitía cualquier cosa: el servidor las
  // rechaza y sin esto el aviso no diría de quién se queja.
  const sucio = contactos.find((c) => nombreConSimbolos(c))
  if (sucio) {
    return `El nombre de «${nombreCompleto(sucio) || sucio.email}» tiene símbolos o números: corrígelo, solo se admiten letras`
  }
  if (
    contactos.some(
      (c) => Boolean(c.tipo_documento_codigo) !== Boolean(c.numero_documento.trim()),
    )
  ) {
    return 'El documento va completo o vacío: hacen falta el tipo y el número'
  }
  for (const c of contactos) {
    const documento = problemaConDocumento(c.tipo_documento_codigo, c.numero_documento)
    if (documento) return `${nombreCompleto(c) || c.email}: ${documento.toLocaleLowerCase()}`
    const telefono = problemaConTelefono(c.telefono)
    if (telefono) return `${nombreCompleto(c) || c.email}: ${telefono.toLocaleLowerCase()}`
  }
  return null
}

/**
 * Los contactos en una TABLA (pedido del usuario, 26/10/2026), como la de
 * usuarios: buscador, filtro por sede (solo prestadores) y Editar / Quitar por
 * fila. Añadir y editar van en una ventana con el mismo formulario de siempre.
 * La comparten aseguradoras y prestadores porque el formulario es idéntico; lo
 * que no se comparte es la tabla donde se guardan, que es propia de cada dueño.
 * Lo que se cambia aquí se guarda con «Guardar cambios» de la ficha.
 */
export function ContactosPanel({
  contactos,
  tiposDocumento,
  cargandoTipos,
  onAnadir,
  onCambiar,
  onQuitar,
  descripcionVacio,
  sedes,
  etiquetaSedePrincipal,
}: {
  contactos: ContactoFormulario[]
  tiposDocumento: { codigo: string; nombre: string }[]
  cargandoTipos: boolean
  onAnadir: () => void
  onCambiar: (clave: string, campo: keyof ContactoFormulario, valor: string) => void
  onQuitar: (clave: string) => void
  descripcionVacio: string
  /**
   * Solo prestadores: sus sedes YA GUARDADAS. Con ellas cada contacto elige a
   * cuál pertenece (pedido del usuario, 26/10/2026); vacío = la sede principal.
   */
  sedes?: { id: string; nombre: string }[]
  /** Cómo se nombra la sede principal: «SEDE PRINCIPAL - PICHINCHA - QUITO». */
  etiquetaSedePrincipal?: string
}) {
  const principal = etiquetaSedePrincipal || 'SEDE PRINCIPAL'
  const [busqueda, setBusqueda] = useState('')
  const [filtroSede, setFiltroSede] = useState<string>(TODAS)
  // La ventana: qué contacto se edita, cómo estaba al abrirla (para «Cancelar»)
  // y si es uno recién añadido (cancelar lo quita).
  const [abierto, setAbierto] = useState<{ clave: string; antes: ContactoFormulario | null } | null>(null)
  const [esperandoNuevo, setEsperandoNuevo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cuantosAntes = useRef(contactos.length)

  // «Añadir» lo hace el dueño de la lista; en cuanto aparece, se abre su ventana.
  useEffect(() => {
    if (esperandoNuevo && contactos.length > cuantosAntes.current) {
      setAbierto({ clave: contactos[contactos.length - 1]!._key, antes: null })
      setEsperandoNuevo(false)
    }
    cuantosAntes.current = contactos.length
  }, [contactos, esperandoNuevo])

  const nombreDeSede = (id: string | undefined) =>
    !id ? principal : (sedes?.find((s) => s.id === id)?.nombre ?? '—')

  const visibles = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase()
    return contactos.filter((c) => {
      if (sedes && filtroSede !== TODAS && (c.sede_id ?? '') !== filtroSede) return false
      if (!termino) return true
      return [nombreCompleto(c), c.email, c.cargo, c.telefono]
        .join(' ')
        .toLocaleLowerCase()
        .includes(termino)
    })
  }, [contactos, busqueda, filtroSede, sedes])

  const contacto = abierto ? contactos.find((c) => c._key === abierto.clave) : undefined

  function cerrar(aplicar: boolean) {
    if (!abierto) return
    if (aplicar && contacto) {
      const problema = validar([contacto])
      if (problema) return setError(problema)
      const correo = contacto.email.trim().toLocaleLowerCase()
      if (contactos.some((c) => c._key !== contacto._key && c.email.trim().toLocaleLowerCase() === correo)) {
        return setError('Ese correo ya lo tiene otro contacto')
      }
    }
    if (!aplicar) {
      // Cancelar deja todo como estaba: el nuevo se va y el editado se restaura.
      if (abierto.antes === null) onQuitar(abierto.clave)
      else {
        for (const [campo, valor] of Object.entries(abierto.antes)) {
          if (campo !== '_key' && valor !== undefined) {
            onCambiar(abierto.clave, campo as keyof ContactoFormulario, String(valor))
          }
        }
      }
    }
    setError(null)
    setAbierto(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
            aria-hidden="true"
          />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, correo o cargo"
            aria-label="Buscar contacto"
            mayusculas={false}
            className="pl-9"
          />
        </div>
        {sedes && (
          <div className="w-60">
            <Select
              value={filtroSede}
              onChange={(e) => setFiltroSede(e.target.value)}
              aria-label="Filtrar por sede"
            >
              <option value={TODAS}>Todas las sedes</option>
              <option value="">{principal}</option>
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </Select>
          </div>
        )}
        <Boton
          type="button"
          tamano="sm"
          onClick={() => {
            setError(null)
            setEsperandoNuevo(true)
            onAnadir()
          }}
        >
          <Plus aria-hidden="true" />
          Añadir contacto
        </Boton>
      </div>

      {contactos.length === 0 ? (
        <div className="rounded-md border border-dashed border-borde px-6 py-10 text-center">
          <UserPlus className="mx-auto size-5 text-tenue-fg" aria-hidden="true" />
          <p className="mt-3 font-display text-sm font-medium">Sin contactos</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">{descripcionVacio}</p>
        </div>
      ) : visibles.length === 0 ? (
        <p className="rounded-md border border-dashed border-borde px-4 py-8 text-center text-sm text-tenue-fg">
          Ningún contacto coincide con la búsqueda.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-borde">
          <table className="w-full text-left text-sm">
            <thead className="bg-tenue/40 font-display text-[0.6875rem] uppercase tracking-[0.09em] text-tenue-fg">
              <tr>
                <th className="px-4 py-3 font-medium">Nombre</th>
                <th className="px-4 py-3 font-medium">Cargo</th>
                <th className="px-4 py-3 font-medium">Correo</th>
                <th className="px-4 py-3 font-medium">Teléfono</th>
                {sedes && <th className="px-4 py-3 font-medium">Sede</th>}
                <th className="px-4 py-3" aria-label="Acciones" />
              </tr>
            </thead>
            <tbody className="divide-y divide-borde">
              {visibles.map((c) => (
                <tr key={c._key} className="align-top">
                  <td className="px-4 py-3 font-medium">{nombreCompleto(c) || '—'}</td>
                  <td className="px-4 py-3 text-tenue-fg">{c.cargo || '—'}</td>
                  <td className="px-4 py-3 text-tenue-fg">{c.email || '—'}</td>
                  <td className="px-4 py-3 tabular text-tenue-fg">{c.telefono || '—'}</td>
                  {sedes && <td className="px-4 py-3">{nombreDeSede(c.sede_id)}</td>}
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Boton
                        type="button"
                        variante="contorno"
                        tamano="sm"
                        onClick={() => {
                          setError(null)
                          setAbierto({ clave: c._key, antes: { ...c } })
                        }}
                      >
                        <Pencil aria-hidden="true" />
                        Editar
                      </Boton>
                      <Boton
                        type="button"
                        variante="fantasma"
                        tamano="sm"
                        onClick={() => onQuitar(c._key)}
                        aria-label={`Quitar a ${nombreCompleto(c) || c.email || 'este contacto'}`}
                        className="hover:text-peligro"
                      >
                        <Trash2 aria-hidden="true" />
                      </Boton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        abierto={Boolean(abierto && contacto)}
        onCerrar={() => cerrar(false)}
        titulo={abierto?.antes === null ? 'Nuevo contacto' : `Editar ${contacto ? nombreCompleto(contacto) || 'contacto' : 'contacto'}`}
        descripcion="Se guarda al pulsar «Guardar cambios» en la ficha."
        ancho="max-w-3xl"
        pie={
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => cerrar(false)}>
              Cancelar
            </Boton>
            <Boton type="button" onClick={() => cerrar(true)}>
              {abierto?.antes === null ? 'Agregar contacto' : 'Aplicar cambios'}
            </Boton>
          </div>
        }
      >
        {contacto && (
          <div>
            {error && (
              <p className="mb-4 rounded-md border border-peligro/40 bg-peligro-suave/40 px-3 py-2 text-sm" role="alert">
                {error}
              </p>
            )}
          {sedes && (
            <div className="mb-4 space-y-2">
              <Label htmlFor={`sede-${contacto._key}`}>
                Sede <span className="text-peligro">*</span>
              </Label>
              <Select
                id={`sede-${contacto._key}`}
                value={contacto.sede_id ?? ''}
                onChange={(e) => onCambiar(contacto._key, 'sede_id', e.target.value)}
              >
                <option value="">{principal}</option>
                {sedes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <CamposNombre
            idPrefijo={`contacto-${contacto._key}`}
            valores={contacto}
            onCambiar={(campo, valor) => onCambiar(contacto._key, campo, valor)}
          />

          <div className="mt-4 space-y-2">
            <Label htmlFor={`email-${contacto._key}`}>
              Correo <span className="text-peligro">*</span>
            </Label>
            <Input
              id={`email-${contacto._key}`}
              type="email"
              mayusculas
              inputMode="email"
              // El correo del contacto es dato del expediente y va como el resto.
              // La columna es `citext`, así que entrar con minúsculas sigue
              // funcionando: quien inicie sesión no tiene que respetar el caso.
              spellCheck={false}
              value={contacto.email}
              onChange={(e) => onCambiar(contacto._key, 'email', e.target.value)}
              placeholder="NOMBRE@DOMINIO.EC"
            />
          </div>

          <p className="mt-5 font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg">
            Opcional
          </p>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={`telefono-${contacto._key}`}>Teléfono</Label>
              <Input
                id={`telefono-${contacto._key}`}
                inputMode="tel"
                value={contacto.telefono}
                onChange={(e) =>
                  onCambiar(contacto._key, 'telefono', filtrarTelefono(e.target.value))
                }
                placeholder="0999999999"
                maxLength={16}
              />
              <p className="text-xs text-tenue-fg">
                Solo números; el «+» del código de país es opcional.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`tipodoc-${contacto._key}`}>Tipo de documento</Label>
              <Select
                id={`tipodoc-${contacto._key}`}
                value={contacto.tipo_documento_codigo}
                onChange={(e) => onCambiar(contacto._key, 'tipo_documento_codigo', e.target.value)}
                disabled={cargandoTipos}
              >
                <option value="">Sin documento</option>
                {tiposDocumento.map((t) => (
                  <option key={t.codigo} value={t.codigo}>
                    {t.nombre}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`numdoc-${contacto._key}`}>Número</Label>
              <Input
                id={`numdoc-${contacto._key}`}
                value={contacto.numero_documento}
                onChange={(e) =>
                  onCambiar(
                    contacto._key,
                    'numero_documento',
                    filtrarDocumento(e.target.value, contacto.tipo_documento_codigo),
                  )
                }
                disabled={!contacto.tipo_documento_codigo}
                placeholder={contacto.tipo_documento_codigo ? '' : 'Elige primero el tipo'}
                className={FORMATOS[contacto.tipo_documento_codigo]?.soloDigitos ? 'tabular' : ''}
                maxLength={20}
              />
              {/* El dígito verificador se comprueba mientras se teclea; el
                  servidor lo vuelve a comprobar, que es quien manda. */}
              <p
                className={cn(
                  'text-xs',
                  problemaConDocumento(contacto.tipo_documento_codigo, contacto.numero_documento)
                    ? 'text-peligro'
                    : 'text-tenue-fg',
                )}
                aria-live="polite"
              >
                {problemaConDocumento(
                  contacto.tipo_documento_codigo,
                  contacto.numero_documento,
                ) ??
                  FORMATOS[contacto.tipo_documento_codigo]?.ayuda ??
                  ''}
              </p>
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <Label htmlFor={`cargo-${contacto._key}`}>Cargo</Label>
            <Input
              id={`cargo-${contacto._key}`}
              value={contacto.cargo}
              onChange={(e) => onCambiar(contacto._key, 'cargo', e.target.value)}
              placeholder="Gerente de siniestros"
              maxLength={100}
            />
          </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/** Valor del filtro de sede que no filtra. */
const TODAS = '__todas__'
