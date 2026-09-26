/**
 * Identificación y teléfono, del lado del cliente.
 *
 * Espejo de `app/shared/identificacion.py`, que es quien manda: aquí se filtra
 * al teclear y se avisa en el acto —una cédula mal escrita se ve roja antes de
 * enviar el formulario—, pero el servidor vuelve a comprobarlo todo. El
 * algoritmo del dígito verificador ecuatoriano lleva décadas sin cambiar; si
 * cambiara, se cambia en los dos sitios.
 */

/** Cómo se teclea cada documento del catálogo `tipos_documento`. */
export const FORMATOS: Record<string, { soloDigitos: boolean; largo: number; ayuda: string }> = {
  cedula: { soloDigitos: true, largo: 10, ayuda: '10 dígitos' },
  ruc: { soloDigitos: true, largo: 13, ayuda: '13 dígitos, termina en 001' },
  pasaporte: { soloDigitos: false, largo: 15, ayuda: 'Letras y números, de 6 a 15' },
}

/** Filtra lo que se teclea en el número, según el tipo elegido. */
export function filtrarDocumento(valor: string, tipo: string): string {
  const formato = FORMATOS[tipo]
  if (!formato) return valor
  const limpio = formato.soloDigitos
    ? valor.replace(/[^0-9]/g, '')
    : valor.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return limpio.slice(0, formato.largo)
}

/** Teléfono: dígitos y, como mucho, un «+» al principio. */
export function filtrarTelefono(valor: string): string {
  const masMas = valor.trimStart().startsWith('+')
  const digitos = valor.replace(/[^0-9]/g, '').slice(0, 15)
  return (masMas ? '+' : '') + digitos
}

const PROVINCIAS_VALIDAS = new Set([...Array.from({ length: 24 }, (_, i) => i + 1), 30])

/** El verificador de la cédula (y del RUC de persona natural): módulo 10. */
function modulo10(base: string): number {
  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2]
  let suma = 0
  for (let i = 0; i < 9; i++) {
    const producto = Number(base[i]) * coeficientes[i]!
    suma += producto > 9 ? producto - 9 : producto
  }
  return (10 - (suma % 10)) % 10
}

/** El de las sociedades: módulo 11, con 11 y 10 colapsando a 0. */
function modulo11(base: string, coeficientes: number[]): number {
  const suma = coeficientes.reduce((acc, c, i) => acc + Number(base[i]) * c, 0)
  const residuo = suma % 11
  return residuo === 0 ? 0 : 11 - residuo
}

export function cedulaValida(numero: string): boolean {
  if (!/^[0-9]{10}$/.test(numero)) return false
  if (!PROVINCIAS_VALIDAS.has(Number(numero.slice(0, 2)))) return false
  // Del 6 en adelante ya no es una persona: es una sociedad, y eso es un RUC.
  if (Number(numero[2]) >= 6) return false
  return modulo10(numero) === Number(numero[9])
}

export function rucValido(numero: string): boolean {
  if (!/^[0-9]{13}$/.test(numero)) return false
  if (!PROVINCIAS_VALIDAS.has(Number(numero.slice(0, 2)))) return false

  const tercero = Number(numero[2])
  if (tercero < 6) {
    // Persona natural con RUC: es su cédula más el establecimiento.
    return cedulaValida(numero.slice(0, 10)) && numero.slice(10) !== '000'
  }
  if (tercero === 6) {
    // Sociedad pública: verifica en la novena posición y su establecimiento
    // ocupa cuatro dígitos, no tres.
    return (
      modulo11(numero, [3, 2, 7, 6, 5, 4, 3, 2]) === Number(numero[8]) &&
      numero.slice(9) !== '0000'
    )
  }
  if (tercero === 9) {
    return (
      modulo11(numero, [4, 3, 2, 7, 6, 5, 4, 3, 2]) === Number(numero[9]) &&
      numero.slice(10) !== '000'
    )
  }
  // 7 y 8 no los emite nadie.
  return false
}

/**
 * Qué le pasa a ese número para no ser ese documento, o `null` si está bien.
 * Un campo vacío no es un problema: lo obligatorio se comprueba aparte.
 */
export function problemaConDocumento(tipo: string, numero: string): string | null {
  const valor = numero.trim()
  if (!valor) return null
  if (tipo === 'cedula') {
    if (valor.length !== 10) return 'La cédula tiene 10 dígitos'
    return cedulaValida(valor) ? null : 'La cédula no es válida: revisa el número'
  }
  if (tipo === 'ruc') {
    if (valor.length !== 13) return 'El RUC tiene 13 dígitos'
    return rucValido(valor) ? null : 'El RUC no es válido: revisa el número'
  }
  if (tipo === 'pasaporte') {
    return /^[A-Z0-9]{6,15}$/.test(valor.toUpperCase())
      ? null
      : 'El pasaporte admite letras y números, de 6 a 15 caracteres'
  }
  return null
}

/** El teléfono, ya filtrado, ¿es utilizable? Vacío es válido: es opcional. */
export function problemaConTelefono(valor: string): string | null {
  const limpio = valor.trim()
  if (!limpio) return null
  return /^\+?[0-9]{7,15}$/.test(limpio)
    ? null
    : 'El teléfono necesita entre 7 y 15 dígitos (el «+» del código de país es opcional)'
}
