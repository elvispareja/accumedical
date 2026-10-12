"""
Núcleo compartido de la plataforma.

Importar este paquete registra TODOS los modelos en `Base.metadata`. De eso depende
que `alembic autogenerate` vea el esquema completo y que SQLAlchemy pueda resolver
las referencias por nombre entre modelos de paquetes distintos.

Aquí solo se importan modelos, nunca routers: los routers los monta `app.main`
explícitamente, para que Alembic no arrastre media aplicación al migrar.
"""

from app.shared.aseguradoras import models as aseguradoras_models  # noqa: F401
from app.shared.audit import models as audit_models  # noqa: F401
from app.shared.auth import models as auth_models  # noqa: F401
from app.shared.catalogos import models as catalogos_models  # noqa: F401
from app.shared.central import models as central_models  # noqa: F401
from app.shared.notificaciones import models as notificaciones_models  # noqa: F401
from app.shared.prestadores import models as prestadores_models  # noqa: F401
from app.shared.users import models as users_models  # noqa: F401
