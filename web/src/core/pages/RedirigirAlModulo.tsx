import { Navigate, generatePath, useParams } from 'react-router-dom'

/**
 * Lleva una dirección vieja de `/admin/auditorias/…` a la del módulo (D45),
 * conservando sus parámetros: `a="/concurrencia/supervision/:id"` con `:id` de
 * la ruta actual. Si el módulo es de otro subdominio, `GuardaDeDominio` hace el
 * salto; la sesión viaja con la cookie del dominio padre.
 */
export function RedirigirAlModulo({ a }: { a: string }) {
  const parametros = useParams()
  return <Navigate to={generatePath(a, parametros)} replace />
}
