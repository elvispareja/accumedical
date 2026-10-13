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

Las apps **Convenios** (`web/apps/convenios`, 5176) y **Contabilidad** (`web/apps/contabilidad`, 5177), D50, son las dos funciones transversales sacadas de admin.
- Montan las **mismas pantallas** de `@/shared` (aseguradoras, prestadores, red, tipos) dentro de `ProveedorApp` (`core/app/contexto.tsx`):
  - `raiz: ''`: sus enlaces no llevan `/admin`;
  - `alcance`: recorta la ficha como la función (Convenios: solo la red; Contabilidad: todo menos la red), también para el administrador.
- Puerta: `SoloFuncion` (función o administrador global). Armazón: `ArmazonApp` (compartido con Pacientes).
- **Cada app tiene su propio login, en su propia dirección** (D51): `concurrencia.pymes.ec/login`, `pacientes.pymes.ec/login`, `convenios.pymes.ec/login`, `contabilidad.pymes.ec/login`, `admin.pymes.ec/login`.
  - Es la misma `LoginPage` con `app="<Nombre>"`: el mismo `POST /api/v1/auth/login` (con su límite por IP en nginx) y la misma sesión compartida en `*.pymes.ec`.
  - Al entrar se queda en la app, en la página pedida o en su `/dashboard`.
  - `admin.pymes.ec/login?volver=` sigue admitido para enlaces viejos, validado con `dominios.volverSeguro` (solo apps de la plataforma).
- El login lleva a cada función a su app (`calcular_redireccion` → `/convenios/dashboard` o `/contabilidad/dashboard`).
- **El administrador conserva en admin todas las pantallas completas** (aseguradoras con todas sus pestañas, prestadores, Red convenio, parámetros): las limitaciones son solo de las apps de función. Si alguien con función entra a admin, solo ve el enlace a su app.

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

## Cabeceras de seguridad y CSP (nginx de la app)

- `infra/nginx/includes/cabeceras-comunes.conf` se aplica a todo:
  - `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`;
  - `Permissions-Policy`, que niega todas las capacidades del navegador porque la web no usa ninguna;
  - `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `X-Permitted-Cross-Domain-Policies`;
  - `server_tokens off`.
- `cabeceras-paginas-dev.conf` (páginas en el laboratorio, servidor de desarrollo de Vite): **CSP impuesta**.
  - `script-src 'self'` más los **hash** de los dos scripts en línea del `index.html`: el del tema y el preámbulo de React Refresh.
  - `style-src 'unsafe-inline'` solo porque Vite inyecta el CSS en desarrollo.
  - `frame-ancestors 'none'`.
- `cabeceras-api.conf` (`/api/`): las comunes más `frame-ancestors 'none'`. Oculta las mismas cabeceras del backend para que no salgan duplicadas.
- `security-headers.conf`: la de **producción** (build estático, sin `'unsafe-inline'`).
- **Si cambia el script del tema del `index.html` o la versión de Vite, cambian los hash y las apps quedan en blanco.** Recalcularlos con:
  ```
  curl -s https://admin.pymes.ec/ | python3 -c "import re,sys,hashlib,base64;s=sys.stdin.read();[print('sha256-'+base64.b64encode(hashlib.sha256(b.encode()).digest()).decode()) for a,b in re.findall(r'<script([^>]*)>(.*?)</script>',s,re.S) if 'src=' not in a]"
  ```
  y verificar en un navegador real con `python3 -I /srv/accumedical/scripts/probar-navegador.py`, fuera del repo, en el servidor.
- Toda `location` nueva en `dev.conf` que ponga su propio `add_header` debe incluir el archivo de cabeceras que le toca: en nginx, un `add_header` local anula los heredados.

## Sesión por app (D53)

- **Usuario normal:** al iniciar sesión recibe `__Host-session` / `__Host-csrf_token`, **sin Domain**. El navegador solo las manda al subdominio donde entró, así que cada app le pide usuario y contraseña.
- **Administrador global:** `__Secure-session` / `__Secure-csrf_token` con `Domain=pymes.ec`, y pasa entre apps sin volver a iniciar sesión.
- `core/security/cookies.py` (`leer_token`: manda la de la app; `poner_cookies_sesion(..., plataforma=)`).
- `get_current_user` **rechaza** una cookie compartida de quien no es administrador, aunque la falsifiquen.
- Salir borra las dos.
- El cliente busca `__Host-csrf_token` primero, que es el mismo orden que el servidor.
- Prueba: `python3 -I /srv/accumedical/scripts/probar-alcances-sesion.py` (en el servidor).

