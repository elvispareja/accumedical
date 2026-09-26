proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
# SOBRESCRIBE, no $proxy_add_x_forwarded_for (append). Con el patrón de añadir, un
# cliente que manda su propio X-Forwarded-For elige la IP que ve la aplicación: el
# límite por IP se evapora y el AuditLog queda envenenado con direcciones falsas.
proxy_set_header X-Forwarded-For   $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_redirect off;
# El informe con IA (notas + fotos) puede tardar 2-3 minutos: el default de
# 60 s cortaba la respuesta con un 504 mientras la API seguía trabajando.
proxy_read_timeout 300s;
proxy_send_timeout 300s;
