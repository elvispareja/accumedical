from __future__ import annotations

# Permisos propios de este módulo. Los códigos se comparan por string contra
# permissions.code, así que esta lista y la semilla de la migración deben coincidir.
VER_DASHBOARD = "dashboard:ver"
LEER_VISITA = "visitas:leer"
CREAR_VISITA = "visitas:crear"
EDITAR_VISITA = "visitas:editar"

TODOS = (VER_DASHBOARD, LEER_VISITA, CREAR_VISITA, EDITAR_VISITA)
