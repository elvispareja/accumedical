import { Plus, Trash2, UserPlus } from 'lucide-react'

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
  }))
}

/** Limpia `_key` y manda los opcionales vacíos como null. */
export function haciaApi(contactos: ContactoFormulario[]) {
  return contactos.map(({ _key, ...c }) => ({
    ...c,
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
 * Lista editable de contactos. La comparten aseguradoras y prestadores porque el
 * formulario es idéntico; lo que no se comparte es la tabla donde se guardan,
 * que es propia de cada dueño.
 */
export function ContactosPanel({
  contactos,
  tiposDocumento,
  cargandoTipos,
  onAnadir,
  onCambiar,
  onQuitar,
  descripcionVacio,
}: {
  contactos: ContactoFormulario[]
  tiposDocumento: { codigo: string; nombre: string }[]
  cargandoTipos: boolean
  onAnadir: () => void
  onCambiar: (clave: string, campo: keyof ContactoFormulario, valor: string) => void
  onQuitar: (clave: string) => void
  descripcionVacio: string
}) {
  if (contactos.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-borde px-6 py-10 text-center">
        <UserPlus className="mx-auto size-5 text-tenue-fg" aria-hidden="true" />
        <p className="mt-3 font-display text-sm font-medium">Sin contactos</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-tenue-fg">{descripcionVacio}</p>
        <Boton type="button" tamano="sm" className="mt-4" onClick={onAnadir}>
          <Plus aria-hidden="true" />
          Añadir contacto
        </Boton>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {contactos.map((contacto, indice) => (
        <fieldset key={contacto._key} className="rounded-md border border-borde p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <legend className="font-display text-xs font-medium uppercase tracking-[0.09em] text-tenue-fg">
              Contacto {indice + 1}
            </legend>
            <Boton
              type="button"
              variante="fantasma"
              tamano="sm"
              onClick={() => onQuitar(contacto._key)}
              aria-label={`Quitar contacto ${indice + 1}`}
              className="hover:text-peligro"
            >
              <Trash2 aria-hidden="true" />
              Quitar
            </Boton>
          </div>

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
              inputMode="email"
              // El correo del contacto es dato del expediente y va como el resto.
              // La columna es `citext`, así que entrar con minúsculas sigue
              // funcionando: quien inicie sesión no tiene que respetar el caso.
              mayusculas
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
        </fieldset>
      ))}

      <Boton type="button" variante="contorno" tamano="sm" onClick={onAnadir}>
        <Plus aria-hidden="true" />
        Añadir contacto
      </Boton>
    </div>
  )
}
