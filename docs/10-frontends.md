# 10 · Un frontend por aplicación (D45, D46)

**Regla:** cada aplicación tiene sus pantallas y su diseño. **Admin** (`admin.pymes.ec`) administra lo común (aseguradoras, prestadores, red, usuarios, parámetros) y **enlaza** a cada módulo; no copia sus pantallas. El administrador global entra a cada módulo **como coordinador de plataforma** (D45).

## Estructura

```
web/                         package.json + node_modules únicos
  src/                       app ADMIN + código compartido (alias @/…)
  apps/concurrencia/         app CONCURRENCIA (alias @concurrencia/…)
    index.html  vite.config.ts  tailwind.config.ts  tsconfig.json
    src/main.tsx  src/router.tsx  src/estilos.css  src/routes.tsx  pages/ …
    src/integracion.ts       ← contrato: lo único que admin importa
```

| | Admin | Concurrencia |
|---|---|---|
| Servida en | `admin.pymes.ec` (y en local, todo lo que no sea de un módulo con app propia) | **raíz de `concurrencia.pymes.ec`** (`CONCURRENCIA_BASE=/`): `/dashboard`, `/supervision/<id>`…; en local, bajo `/concurrencia/` (base por defecto) |
| Contenedor | `web` (5173) | `web-concurrencia` (5174), `npm run dev:concurrencia` |
| CSS | `src/index.css` + `tailwind.config.ts` | `src/estilos.css` (parte de la base y agrega lo suyo) + su `tailwind.config.ts` |
| Build | `npm run build` | `npm run build:concurrencia` → `dist/concurrencia` |
| Tipos | `npm run typecheck` | `npm run typecheck:concurrencia` |

La app **Pacientes** (`web/apps/pacientes`, D49) sigue la misma forma: `web-pacientes` (5175), `PACIENTES_BASE`, `npm run dev:pacientes` / `build:pacientes` / `typecheck:pacientes`, raíz de `pacientes.pymes.ec`. No es un módulo de `modules`: su puerta es «solo personal de Accumedical» y su armazón es propio (`Armazon.tsx`).

- nginx de la app (`infra/nginx/dev.conf`) elige el frontend con `map "$host$uri" $frontend`: todo `concurrencia.*` → `web-concurrencia`; en local, `localhost/concurrencia…` → `web-concurrencia`; el resto → `web`. **Al cambiar `dev.conf` hay que hacer `nginx -s reload`**: compose no recrea el contenedor si solo cambió el contenido del archivo.
- **Dirección lógica vs. real (D48).** En toda la plataforma un caso se nombra `/concurrencia/…`: avisos guardados, menús de admin, la redirección del login. `dominios.ts` la convierte en la real quitando el prefijo en su subdominio: `/concurrencia/supervision/7` → `https://concurrencia.pymes.ec/supervision/7`.
- Dentro de la app de Concurrencia las rutas son relativas a su raíz (`/dashboard`, `/nueva`, `/<id>`). El router usa `basename` = `BASE_URL` y tiene dos puertas:
  - `/concurrencia/*` quita el prefijo (avisos y enlaces viejos);
  - las rutas de admin (`/login`, `/admin/*`, `/coordinacion/*`…) y `*` → `IrAOtraApp`.
- `ModuloShell` y `NotificacionesDelModulo` reciben `slug` (y `raiz=""`) desde el router de la app, porque la dirección ya no lo dice.
- **Saltar entre apps** es una navegación completa del navegador:
  - con subdominios lo hace `GuardaDeDominio`;
  - en el mismo origen lo hace `IrAOtraApp` (el `*` del router de Concurrencia y `/concurrencia/*` en el de admin), con protección contra bucles.
  - La sesión viaja con la cookie.
- Desde el menú de admin, un módulo en otro subdominio se abre en pestaña nueva.

## Contrato `integracion.ts`

Admin muestra vistas agregadas de los módulos en **sus** pantallas: la bandeja unificada del coordinador y la ficha del paciente. Las toma **solo** de `@concurrencia/integracion`, que reexporta lo necesario (`CasosDeConcurrencia`, `CuadroDeConcurrencia`, `listarPacientes`, `obtenerPaciente`).
- Esas vistas usan componentes compartidos y se ven con el CSS de admin.
- Cambiar el contrato es cambiar una API: admin depende de ello.

## Crear la app de un módulo nuevo (p. ej. Calificación, slug `calificacion-riesgo`)

1. Copiar `web/apps/concurrencia/` sin `src/pages` ni `src/api.ts`, y cambiar la variable de `base` (`<APP>_BASE`, `/` en su subdominio), `port`, `cacheDir`, `outDir`, el alias y el `<title>`.
2. `src/router.tsx` como el de Concurrencia: `/` (`RequireSession` → `RequireModule slug` → `ModuloShell slug raiz=""`), `/<slug>/*` → quitar prefijo, rutas de admin y `*` → `IrAOtraApp`.
3. Scripts en `web/package.json` (`dev:<app>`, `build:<app>`, `typecheck:<app>`).
4. Servicio en `docker-compose.yml` (como `web-concurrencia`), dos líneas en el `map $frontend` de `infra/nginx/dev.conf` (su subdominio y su prefijo local), y en el servidor sus variables en `docker-compose.servidor.yml` (con `<APP>_BASE: "/"`). Después: `nginx -s reload`.
5. Si tendrá subdominio: agregarlo a `VITE_URLS_MODULOS` (en todas las apps), y crear la ruta del túnel y el `server_name` en el nginx de infraestructura.
6. Si admin debe mostrar algo del módulo, exponerlo en `src/integracion.ts` y agregar el alias en `web/vite.config.ts`, `web/tsconfig.json` y `web/tailwind.config.ts`.
7. Sus pantallas usan los componentes compartidos (`@/shared/components/ui/…`) y su diseño va en su `estilos.css` / `tailwind.config.ts`.
