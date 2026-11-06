import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'

import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { filtrosVademecum } from '@/shared/vademecum/api'

export interface ValoresFiltro {
  texto: string
  forma: string
  via: string
  nivel: string
}

export const FILTRO_VACIO: ValoresFiltro = { texto: '', forma: '', via: '', nivel: '' }

/** Buscador y filtros del vademécum; los valores salen de la propia central. */
export function FiltrosVademecum({
  prefijo,
  valor,
  onCambiar,
}: {
  prefijo: string
  valor: ValoresFiltro
  onCambiar: (v: ValoresFiltro) => void
}) {
  const filtros = useQuery({ queryKey: ['vademecum', 'filtros'], queryFn: filtrosVademecum, staleTime: Infinity })
  const poner = (campo: keyof ValoresFiltro, v: string) => onCambiar({ ...valor, [campo]: v })
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue-fg"
          aria-hidden="true"
        />
        <Input
          id={`${prefijo}-buscar`}
          type="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={80}
          mayusculas={false}
          value={valor.texto}
          onChange={(e) => poner('texto', e.target.value)}
          placeholder="Paracetamol, «amoxicilina clavulánico», N02BE01 o VAD-00012"
          aria-label="Buscar medicamento"
          className="pl-9"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          id={`${prefijo}-forma`}
          value={valor.forma}
          onChange={(e) => poner('forma', e.target.value)}
          aria-label="Forma farmacéutica"
        >
          <option value="">Todas las formas</option>
          {(filtros.data?.formas ?? []).map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.valor} ({f.cantidad})
            </option>
          ))}
        </Select>
        <Select
          id={`${prefijo}-via`}
          value={valor.via}
          onChange={(e) => poner('via', e.target.value)}
          aria-label="Vía de administración"
        >
          <option value="">Todas las vías</option>
          {(filtros.data?.vias ?? []).map((f) => (
            <option key={f.valor} value={f.valor}>
              {f.valor} ({f.cantidad})
            </option>
          ))}
        </Select>
        <Select
          id={`${prefijo}-nivel`}
          value={valor.nivel}
          onChange={(e) => poner('nivel', e.target.value)}
          aria-label="Nivel de prescripción"
        >
          <option value="">Todos los niveles de prescripción</option>
          {(filtros.data?.niveles_prescripcion ?? []).map((f) => (
            <option key={f.valor} value={f.valor}>
              Nivel {f.valor} ({f.cantidad})
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}
