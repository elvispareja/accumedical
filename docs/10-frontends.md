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
| Servida en | `/` (todo lo que no sea de un módulo con app propia) | `/concurrencia/…` (Vite `base`) |
| Contenedor | `web` (5173) | `web-concurrencia` (5174), `npm run dev:concurrencia` |
| CSS | `src/index.css` + `tailwind.config.ts` | `src/estilos.css` (parte de la base y agrega lo suyo) + su `tailwind.config.ts` |
| Build | `npm run build` | `npm run build:concurrencia` → `dist/concurrencia` |
| Tipos | `npm run typecheck` | `npm run typecheck:concurrencia` |

- nginx de la app (`infra/nginx/dev.conf`) envía `/concurrencia/` a `web-concurrencia`, y `/concurrencia` sin barra redirige. **Al cambiar `dev.conf` hay que hacer `nginx -s reload`**: compose no recrea el contenedor si solo cambió el contenido del archivo.
- Las direcciones no cambiaron: `/concurrencia/…` en `concurrencia.pymes.ec`. Funciona igual sin subdominios (desarrollo local).
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

1. Copiar `web/apps/concurrencia/` sin `src/pages` ni `src/api.ts`, y cambiar `base`, `port`, `cacheDir`, `outDir`, el alias y el `<title>`.
2. `src/router.tsx` con la ruta `/<slug>` (`RequireSession` → `RequireModule` → `ModuloShell`) y el `*` → `IrAOtraApp`.
3. Scripts en `web/package.json` (`dev:<app>`, `build:<app>`, `typecheck:<app>`).
4. Servicio en `docker-compose.yml` (como `web-concurrencia`), un `location /<slug>/` en `infra/nginx/dev.conf` y, en el servidor, sus variables en `docker-compose.servidor.yml`.
5. Si tendrá subdominio: agregarlo a `VITE_URLS_MODULOS` (en todas las apps), y crear la ruta del túnel y el `server_name` en el nginx de infraestructura.
6. Si admin debe mostrar algo del módulo, exponerlo en `src/integracion.ts` y agregar el alias en `web/vite.config.ts`, `web/tsconfig.json` y `web/tailwind.config.ts`.
7. Sus pantallas usan los componentes compartidos (`@/shared/components/ui/…`) y su diseño va en su `estilos.css` / `tailwind.config.ts`.
