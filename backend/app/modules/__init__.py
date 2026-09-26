"""
Paquete de módulos. Importarlo registra los modelos de cada módulo en la
metadata, igual que hace `app.shared`: sin eso, `alembic revision --autogenerate`
no vería las tablas `conc_*`, `susc_*`… y las daría por sobrantes.

Aquí solo se importan modelos, nunca routers: los routers los monta `app.main`.
"""

from app.modules.concurrencia import models as concurrencia_models  # noqa: F401
