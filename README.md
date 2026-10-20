# XTRIM API — demostración técnica

API Express 5 + TypeScript + PostgreSQL (`pg`). Incluye catálogo público, captación de leads, gestión comercial protegida e indicadores reales. Planes y precios ficticios; no es el sitio oficial.

## Instalación y configuración

Requiere Node.js 24, pnpm y PostgreSQL 14 o superior (compatible con Neon).

```sh
pnpm install
```

Configure en su entorno `DATABASE_URL`, `PORT` (4000 por defecto) y `FRONTEND_URL` (http://localhost:3000 por defecto). Se admite un `.env` local mediante dotenv; no versionarlo. Consulte `.env.example`. Para Neon use la URL provista por Neon con TLS (`sslmode=require`); no se desactiva la validación de certificados. La versión instalada de pg avisa que `sslmode=require` cambiará de semántica en una versión mayor; `sslmode=verify-full` hace explícita la verificación completa del certificado y hostname. No coloque la URL en el frontend.

## Migraciones y seed

Desde la raíz del repositorio, con `DATABASE_URL` configurada:

```sh
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`database/migrations/001_initial.sql` crea `plans` y `leads`. Cada ejecución aplica únicamente migraciones pendientes, registra SHA-256 en `schema_migrations` y rechaza archivos aplicados que hayan cambiado. Transacción y bloqueo asesor serializan ejecuciones. No hay borrado ni reset automático. Ante tablas preexistentes incompatibles, la ejecución falla y revierte: revise el esquema antes de continuar; no borre datos. Para evolucionar el esquema agregue otro archivo SQL numerado.

El seed puede repetirse: inserta tres planes y omite slugs existentes, preservando sus precios y cambios. Ejecute migraciones antes del seed. Los comandos usan tsx y los archivos SQL del repositorio, incluso si la API se ejecuta compilada.

## Endpoints y contrato

```sh
curl -i http://localhost:4000/api/v1/plans
curl -i http://localhost:4000/api/v1/plans/internet-esencial
curl -i http://localhost:4000/api/v1/plans/no-existe
```

Listado: `200 {"data":[...]}`. Detalle: `200 {"data":{...}}`. Ambos muestran únicamente planes activos, ordenados por precio y slug en el listado. Los campos son `id`, `name`, `slug`, `description`, `speed_mbps`, `monthly_price`, `is_active`, `created_at`, `updated_at`. El precio se serializa como cadena decimal (p. ej. `"24.90"`) en USD para preservar precisión; fechas ISO 8601 y UUID como identificador. El frontend debe respetar este contrato. Sin plan activo: 404 `PLAN_NOT_FOUND`; slug inválido: 400 `INVALID_SLUG`; errores internos: 500 `INTERNAL_ERROR`. Forma común: `{"error":{"code":"...","message":"..."}}`. Salud: `GET /api/v1/health` (liveness; no comprueba BD en cada solicitud).

Contrato OpenAPI: `docs/openapi.yaml`.

## Integridad de leads

`plan_id` es obligatorio y FK con eliminación restringida. Estados: `NEW`, `IN_PROGRESS`, `CLOSED`. Un lead abierto no puede tener resultado ni monto. Un cierre exige `WON` o `LOST`: ganado requiere monto USD no negativo; perdido no admite monto. Se permite cero para ofertas gratuitas. `sale_amount` guarda el valor mensual acordado históricamente; el KPI suma solo cierres ganados, no ingresos cobrados ni el precio actual del catálogo. Las fechas se mantienen mediante triggers. Teléfono normalizado ecuatoriano fijo/móvil, local o con prefijo +593. La API valida nombre, teléfono, las 24 provincias ecuatorianas, UUID, campos permitidos y coherencia del cierre. Normaliza espacios del nombre, formato del teléfono y tildes/mayúsculas de provincia. No verifica la titularidad ni la existencia real de una línea telefónica.

## Comprobaciones

```sh
pnpm typecheck
pnpm build
pnpm test
DATABASE_TESTS=1 pnpm test
pnpm start
```

Las pruebas PostgreSQL requieren migraciones aplicadas y usan transacciones revertidas para sus datos temporales. Preferir una base de pruebas; no ejecutarla concurrentemente en la misma base. Sin `DATABASE_TESTS=1` se omiten explícitamente las dos pruebas de integración. Las pruebas HTTP aisladas verifican errores y parametrización; no sustituyen la prueba persistente. No existe configuración de lint en esta etapa. El arranque verifica la conexión y SIGINT/SIGTERM cierran HTTP y pool. No se registran URLs, SQL ni datos personales en errores.

## Captación pública y CRM

No se requieren nuevas migraciones: se conservan las restricciones de `001_initial.sql`. El servidor real registra todos los módulos; las pruebas pueden construir la aplicación con repositorios aislados.

| Método | Ruta bajo `/api/v1` | Acceso / respuesta |
| --- | --- | --- |
| POST | `/leads` | Público; 201 con `data: {id, status, created_at}` |
| GET | `/leads` | Administrador; `data` y `pagination` |
| GET | `/leads/:id` | Administrador; detalle en `data` |
| PATCH | `/leads/:id` | Administrador; edición parcial de datos |
| PATCH | `/leads/:id/status` | Administrador; cambio de estado/cierre |
| DELETE | `/leads/:id` | Administrador; 204 sin cuerpo |
| GET | `/dashboard/metrics` | Administrador; métricas en `data` |

Ejemplo de captación con un UUID obtenido del catálogo (sustituya `PLAN_ID`):

```sh
curl -i http://localhost:4000/api/v1/leads \
  -H 'Content-Type: application/json' \
  --data '{"full_name":"Persona Demo","phone":"0991234567","province":"Pichincha","plan_id":"PLAN_ID"}'
```

Solo se aceptan esos cuatro campos; el servidor asigna `NEW`. No devuelve nombre, teléfono ni provincia en la confirmación pública. Nombre de 2–150 caracteres; teléfono fijo o móvil ecuatoriano local o +593; provincia válida; UUID y plan activo obligatorios. Campos adicionales, tipos inválidos y entradas incompletas devuelven 400 `VALIDATION_ERROR`. Un plan inexistente o inactivo devuelve 422 `PLAN_UNAVAILABLE` sin crear el lead. La selección del plan se bloquea durante la escritura para coordinar actualizaciones concurrentes del catálogo.

Listado: parámetros `page` (1 por defecto, máximo 1000000), `limit` (20 por defecto, máximo 100), `search` (subcadena literal del nombre o teléfono, hasta 100 caracteres), `status` y `province`. Orden descendente por fecha e id. Respuesta `pagination: {page, limit, total, total_pages}`; una página vacía conserva el total filtrado. Parámetros desconocidos o repetidos se rechazan. Las respuestas administrativas contienen datos personales y usan `Cache-Control: no-store`.

Edición: solo `full_name`, `phone`, `province`, `plan_id`, al menos uno; no admite null. Un cambio de plan exige que esté activo y no modifica el monto histórico. Los campos comerciales solo se cambian mediante `/status`:

```json
{"status":"CLOSED","outcome":"WON","sale_amount":"31.25"}
```

```json
{"status":"CLOSED","outcome":"LOST"}
```

```json
{"status":"IN_PROGRESS"}
```

Se permite cualquier transición entre los tres estados, incluyendo reapertura. Al reabrir se limpian `outcome` y `sale_amount`; enviarlos con valores no nulos se rechaza. Para cerrar o corregir un cierre debe enviarse el resultado completo. `sale_amount` es una cadena decimal de 0 a 99999999.99 con hasta dos decimales; cero es válido. No se aceptan números JSON, negativos, NaN, exponentes ni redondeo implícito. Cada cambio actualiza conjuntamente los tres campos. Ante ediciones concurrentes prevalece la última escritura confirmada; no hay versionado optimista ni historial en esta etapa.

El borrado es físico y definitivo: retira el lead de listas y métricas, incluyendo ventas ganadas. El frontend deberá solicitar confirmación al operador. UUID inválido: 400; lead inexistente: 404 `LEAD_NOT_FOUND`.

## Autenticación administrativa

Variable nueva `ADMIN_API_TOKEN`: token privado aleatorio de 32 a 512 caracteres sin espacios. Genérelo fuera del código (por ejemplo, `openssl rand -hex 32`) y configúrelo en el entorno del backend. No hay valor de demostración ni credencial predeterminada. No es necesario modificar `.env` para arrancar si se suministra mediante variables del proceso o del hosting.

Cada solicitud administrativa requiere `Authorization: Bearer <token>`. El servidor compara hashes SHA-256 de longitud fija mediante `timingSafeEqual`. Sin token, con formato inválido o token incorrecto responde 401 y `WWW-Authenticate: Bearer`. Si la configuración falta o es inválida, bloquea administración con 503 `ADMIN_UNAVAILABLE`; el catálogo y la captación continúan públicos. Reinicie el proceso para aplicar una rotación del token.

Ejemplo usando una variable privada ya configurada en la terminal:

```sh
curl -i http://localhost:4000/api/v1/leads?page=1 \
  -H "Authorization: Bearer ${ADMIN_API_TOKEN}"
curl -i http://localhost:4000/api/v1/dashboard/metrics \
  -H "Authorization: Bearer ${ADMIN_API_TOKEN}"
```

Este mecanismo identifica a un administrador compartido y es adecuado para la API de esta prueba técnica. Requiere HTTPS en producción. No incluye cuentas, sesiones, revocación individual ni auditoría. El futuro frontend deberá conservar el token en su servidor y actuar como intermediario autenticado para el CRM; no incluirlo en `NEXT_PUBLIC_*`, JavaScript distribuido, almacenamiento del navegador ni repositorio. CORS permite únicamente `FRONTEND_URL`; no reemplaza la autenticación.

## Protección de captación

Límite fijo de **10 intentos por IP cada 15 minutos**, incluyendo errores de JSON/validación. Al excederlo devuelve 429 `RATE_LIMITED` y `Retry-After` en segundos. Cuerpo máximo de 100 KB (413 `BODY_TOO_LARGE`); JSON inválido: 400 `INVALID_JSON`. Contadores locales, máximo 10000 IP activas y limpieza periódica al recibir solicitudes. Al alcanzar ese máximo, nuevas IP reciben 429 hasta que se liberen entradas.

Variable opcional nueva `TRUST_PROXY_HOPS`: entero entre 0 y 5, por defecto 0 (no confía en `X-Forwarded-For`). Configúrela solo conociendo la topología real del hosting: todas las rutas de acceso deben atravesar exactamente esos proxies y el servidor no debe admitir acceso directo. Una configuración incorrecta permite falsificar IP o agrupa clientes detrás de un proxy. No se activa confianza global automáticamente.

Limitaciones: los contadores se reinician al reiniciar la API y no se comparten entre réplicas; usuarios tras NAT comparten cuota. Es protección básica, sin CAPTCHA, verificación telefónica ni deduplicación. A mayor escala, evaluar límites compartidos o en el proxy según evidencia de abuso.

## Indicadores comerciales

`GET /api/v1/dashboard/metrics` devuelve `total_leads`, `leads_by_status` (siempre NEW, IN_PROGRESS y CLOSED), `won_sales`, `monthly_sales_usd` (cadena decimal) y `currency: "USD"`. Consulta todos los leads actuales en un único snapshot. Solo suma `sale_amount` de `CLOSED` + `WON`. Cierres perdidos y abiertos no aportan ventas; cambios de precio de planes no alteran el monto histórico. Reabrir, cambiar resultado o borrar un lead modifica las métricas actuales. El indicador representa **valor mensual vendido**, no dinero efectivamente cobrado ni un historial de ingresos.

Las pruebas cubren validaciones, normalización, autenticación en todas las rutas, configuración ausente, límites, JSON/tamaño y el recorrido HTTP contra PostgreSQL: crear → listar/filtrar/paginar → consultar → editar → cerrar ganado/perdido → reabrir → eliminar → verificar indicadores. Los datos temporales se revierten al finalizar.
