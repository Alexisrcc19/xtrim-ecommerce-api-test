# XTRIM Ecommerce API

API REST para consultar planes de internet, registrar solicitudes de contratación y administrar oportunidades comerciales. Incluye indicadores de ventas y avisos de cambios en tiempo real.

Desarrollada con Node.js, Express 5, TypeScript y PostgreSQL mediante `pg`. Los planes y precios son ficticios: este proyecto es una demostración técnica y no corresponde al sitio oficial de XTRIM.

## Instalación

Requisitos: Node.js 24, pnpm y PostgreSQL 14 o superior. Compatible con Neon.

```sh
pnpm install
```

Configure las variables del entorno tomando como referencia [`.env.example`](.env.example):

| Variable | Descripción |
| --- | --- |
| `DATABASE_URL` | Conexión privada a PostgreSQL. Para Neon, use TLS con `sslmode=verify-full`. |
| `PORT` | Puerto de la API. Predeterminado: `4000`. |
| `FRONTEND_URL` | Origen permitido por CORS. Predeterminado: `http://localhost:3000`. |
| `ADMIN_API_TOKEN` | Token administrativo privado de 32 a 512 caracteres, sin espacios. |
| `TRUST_PROXY_HOPS` | Número de proxies de confianza, entre 0 y 5. Predeterminado: `0`. |

Las variables pueden configurarse en un archivo `.env` local o en el entorno del servidor. Las credenciales quedan exclusivamente en el backend y no se incluyen en Git ni en el código del navegador. El token puede generarse con `openssl rand -hex 32`.

`TRUST_PROXY_HOPS=0` ignora `X-Forwarded-For`. Otro valor requiere que todas las conexiones atraviesen ese número de proxies y que la API no permita acceso directo.

## Base de datos y ejecución

Desde la raíz del proyecto:

```sh
pnpm db:migrate
pnpm db:seed
pnpm dev
```

La API se inicia en `http://localhost:4000`. Para ejecutar la versión compilada:

```sh
pnpm build
pnpm start
```

Las migraciones de `database/migrations/` crean las tablas `plans` y `leads`, sus restricciones e índices. Cada archivo se registra con su checksum en `schema_migrations` y se aplica una sola vez. Las ejecuciones usan transacciones y un bloqueo para evitar aplicar migraciones simultáneamente.

El seed carga tres planes sin duplicar slugs ni sobrescribir planes existentes. Los scripts de base de datos necesitan los archivos SQL y las dependencias de desarrollo del repositorio.

La migración `002_unique_active_phone.sql` impide teléfonos duplicados entre leads abiertos. Si existen duplicados anteriores, la migración se revierte sin modificar esos registros; es necesario resolverlos antes de repetirla.

El arranque comprueba la conexión a PostgreSQL. Las señales SIGINT y SIGTERM cierran el servidor, las conexiones de eventos y el pool de base de datos.

## Endpoints

Todas las rutas usan el prefijo `/api/v1`.

| Método | Ruta | Acceso | Descripción |
| --- | --- | --- | --- |
| GET | `/health` | Público | Estado del proceso de la API. |
| GET | `/plans` | Público | Catálogo de planes activos. |
| GET | `/plans/:slug` | Público | Detalle de un plan activo. |
| POST | `/leads` | Público | Registro de una solicitud. |
| GET | `/leads` | Administrador | Listado con búsqueda, filtros y paginación. |
| GET | `/leads/events` | Administrador | Avisos de cambios mediante SSE. |
| GET | `/leads/:id` | Administrador | Detalle de una oportunidad. |
| PATCH | `/leads/:id` | Administrador | Edición de sus datos de contacto y plan. |
| PATCH | `/leads/:id/status` | Administrador | Cambio de estado y resultado comercial. |
| DELETE | `/leads/:id` | Administrador | Eliminación definitiva. |
| GET | `/dashboard/metrics` | Administrador | Indicadores comerciales. |

El contrato completo está en [OpenAPI](docs/openapi.yaml). Las respuestas usan `data`; el listado de leads incluye además `pagination`. Los importes en USD se devuelven como cadenas decimales y las fechas en formato ISO 8601. Los errores tienen la forma `{"error":{"code":"...","message":"..."}}`.

```sh
curl http://localhost:4000/api/v1/health
curl http://localhost:4000/api/v1/plans
curl http://localhost:4000/api/v1/plans/internet-esencial
```

`/health` indica que el proceso responde; no consulta la base de datos en cada solicitud.

## Solicitudes de contratación

El registro público requiere nombre, teléfono ecuatoriano, provincia e identificador de un plan activo. Ejemplo, sustituyendo `PLAN_ID` por un UUID del catálogo:

```sh
curl -i http://localhost:4000/api/v1/leads \
  -H 'Content-Type: application/json' \
  --data '{"full_name":"Persona Demo","phone":"0991234567","province":"Pichincha","plan_id":"PLAN_ID"}'
```

Una solicitud válida devuelve HTTP 201 con `id`, `status: "NEW"` y `created_at`. La confirmación pública no devuelve datos de contacto.

La API valida el nombre, el formato ecuatoriano de teléfono, las 24 provincias y el UUID del plan. Normaliza espacios, formato telefónico y nombre de provincia. Un plan inexistente o inactivo devuelve HTTP 422 (`PLAN_UNAVAILABLE`).

Un teléfono solo puede tener una solicitud en `NEW` o `IN_PROGRESS`. Los formatos local y `+593` se consideran equivalentes. Un duplicado devuelve HTTP 409 (`ACTIVE_PHONE_EXISTS`), también al editar una oportunidad. Una solicitud cerrada permite registrar otra con el mismo teléfono.

La captación admite 10 intentos por IP cada 15 minutos, incluidos los intentos inválidos. Al superar el límite responde HTTP 429 con `Retry-After`. El cuerpo máximo es de 100 KB; un tamaño superior devuelve 413 y un JSON malformado devuelve 400. Los contadores son locales a cada proceso, se reinician con la API y admiten hasta 10000 IP activas; al alcanzar esa capacidad, nuevas IP reciben 429 hasta liberar entradas.

## Administración comercial

Las solicitudes administrativas requieren `Authorization: Bearer <token>`. El token corresponde a `ADMIN_API_TOKEN` y se compara mediante hashes y comparación de tiempo constante. Las respuestas administrativas usan `Cache-Control: no-store`.

```sh
curl 'http://localhost:4000/api/v1/leads?page=1&limit=20' \
  -H "Authorization: Bearer ${ADMIN_API_TOKEN}"
```

Sin credenciales válidas, la API responde 401. Si el token del servidor no está configurado correctamente, las rutas administrativas responden 503; el catálogo y la captación permanecen disponibles. La autenticación utiliza un token compartido, sin cuentas ni sesiones individuales. En producción, las conexiones usan HTTPS y el token permanece en el servidor que integra el CRM.

El listado acepta `page`, `limit`, `search`, `status` y `province`. Los valores predeterminados son página 1 y 20 resultados; el máximo es 100 por página. La búsqueda coincide con partes del nombre o teléfono. El orden es descendente por fecha de creación e identificador.

La edición acepta `full_name`, `phone`, `province` y `plan_id`. Los estados son:

| Estado | Significado |
| --- | --- |
| `NEW` | Solicitud nueva. |
| `IN_PROGRESS` | Oportunidad en gestión. |
| `CLOSED` | Oportunidad cerrada, ganada o perdida. |

Ejemplos de cuerpo para `PATCH /leads/:id/status`:

```json
{"status":"IN_PROGRESS"}
```

```json
{"status":"CLOSED","outcome":"WON","sale_amount":"31.25"}
```

```json
{"status":"CLOSED","outcome":"LOST"}
```

Un cierre ganado requiere un monto mensual no negativo, como cadena decimal, hasta `99999999.99`. Un cierre perdido no admite monto. El flujo permitido es `NEW → IN_PROGRESS → CLOSED`. Un cierre es definitivo: no se puede reabrir ni cambiar su resultado o monto. Las transiciones inválidas, repetidas u obsoletas devuelven HTTP 409 (`INVALID_STATUS_TRANSITION`). Cambiar el plan no altera el monto histórico de una venta.

La eliminación es física y retira la oportunidad de los listados y métricas. Los cambios de estado comprueban el estado actual también al escribir, evitando que dos solicitudes avancen desde la misma versión. No hay historial de cambios.

## Indicadores de ventas

`GET /api/v1/dashboard/metrics` devuelve:

- `total_leads`: total de oportunidades.
- `leads_by_status`: cantidad en cada uno de los tres estados.
- `won_sales`: cantidad de oportunidades cerradas y ganadas.
- `monthly_sales_usd`: suma de sus montos mensuales históricos.
- `currency`: `USD`.

El indicador mide valor mensual vendido, no dinero cobrado. Los cierres perdidos y las oportunidades abiertas no aportan ventas. Eliminar una oportunidad modifica las métricas actuales; cambiar el precio del catálogo no modifica sus montos históricos.

## Avisos en tiempo real

`GET /api/v1/leads/events` abre un flujo SSE autenticado con el mismo token administrativo. Envía `ready` al conectar y `leads-changed` después de registrar, editar, cambiar de estado o eliminar un lead. Los eventos contienen una revisión opaca, sin datos personales. Cada 25 segundos se envía un comentario para mantener la conexión.

El flujo comunica cambios; los datos se consultan mediante los endpoints del CRM. No conserva historial ni garantiza la entrega de eventos. Admite hasta 100 suscriptores por proceso y cierra conexiones lentas para limitar el uso de memoria.

Las notificaciones se comparten dentro de una instancia de la API. Las escrituras directas en SQL no generan avisos. Los proxies que sirven este endpoint necesitan streaming sin buffering y un timeout de lectura superior a 25 segundos.

## Pruebas

```sh
pnpm typecheck
pnpm build
pnpm test
```

El backend no tiene script `lint`. Para incluir las pruebas de integración se requiere una base PostgreSQL aislada y migrada. Nunca se debe utilizar la base de producción; las transacciones de prueba no sustituyen el aislamiento. Se configura `DATABASE_URL` exclusivamente con la conexión de pruebas antes de ejecutar migraciones y pruebas:

```sh
DATABASE_TESTS=1 pnpm test
```

Las pruebas cubren catálogo, captación, validaciones, autenticación, gestión comercial, restricciones de teléfonos, eventos y métricas. Las pruebas de integración usan transacciones que revierten sus registros temporales. Sin `DATABASE_TESTS=1`, las pruebas que requieren PostgreSQL se omiten.

## Postman

Descargue [la colección Postman v2.1 en JSON](docs/postman/xtrim-ecommerce-api.postman_collection.json) desde GitHub con **Download raw file**. El archivo está listo para importar mediante **Import → Files** en Postman. Después de importarlo, configure sus variables:

| Variable | Uso |
| --- | --- |
| `baseUrl` | URL de la API con `/api/v1`, sin barra final. Predeterminado: `http://localhost:4000/api/v1`. |
| `adminToken` | Token administrativo, configurado solo en un entorno privado o valor local de Postman. |
| `planId` | Identificador capturado desde el listado de planes. |
| `leadId` | Identificador capturado al crear una solicitud. |
| `planSlug` | Slug capturado para consultar el detalle del plan. |
| `runOptional` | `false` por defecto; habilita las acciones opcionales al cambiarlo a `true`. |

Ejecute las peticiones numeradas `00` a `08` en orden: salud, catálogo, detalle, captación, consulta del CRM, gestión, cierre ganado y métricas. Los scripts comprueban los códigos HTTP y capturan los identificadores automáticamente. Las variables de entorno o globales con los mismos nombres pueden ocultar los identificadores de la colección.

Las acciones opcionales incluyen filtros, edición, intentos rechazados de modificar o reabrir un cierre y eliminación definitiva. Se omiten mediante `pm.execution.skipRequest()` cuando `runOptional=false`. Al habilitarlas, el resultado final de las métricas refleja esos cambios.

Las peticiones de Postman crean datos persistentes. El teléfono de ejemplo debe estar libre de solicitudes abiertas para registrar otro lead; un conflicto devuelve 409. Los intentos de captación consumen el límite por IP, incluso si fallan. Los casos de autenticación ausente esperan 401 y requieren que el servidor tenga su token configurado. Los casos de identificadores inexistentes suponen que los valores de prueba no están presentes en la base de datos. La colección se comparte con el token vacío.


## Entrega y documentación

- [Repositorio backend](https://github.com/Alexisrcc19/xtrim-ecommerce-api-test).
- [Repositorio frontend](https://github.com/Alexisrcc19/xtrim-ecommerce-web-test).
- [Sitio en Vercel](https://xtrim-ecommerce-web-test.vercel.app).
- [CRM](https://xtrim-ecommerce-web-test.vercel.app/admin/login): usuario `admin`; contraseña entregada por un canal privado.
- [API en Render: health check](https://xtrim-ecommerce-api-test.onrender.com/api/v1/health).
- [Caso práctico: diagnóstico y escalabilidad](docs/caso-practico.md).
- [Contrato OpenAPI](docs/openapi.yaml) y [colección Postman](docs/postman/xtrim-ecommerce-api.postman_collection.json).

## Arquitectura y despliegue

El navegador utiliza Next.js en Vercel y la API Express en Render. El CRM pasa por el servidor de Next.js para validar su sesión y añadir el token administrativo privado. Express aplica las reglas comerciales y consulta PostgreSQL en Neon mediante `pg`; Next.js no implementa persistencia.

En Render se vincula este repositorio, con comando de build `pnpm install --frozen-lockfile && pnpm build` y arranque `pnpm start`. Se configuran `DATABASE_URL` de Neon, `ADMIN_API_TOKEN`, `FRONTEND_URL=https://xtrim-ecommerce-web-test.vercel.app` y el puerto asignado por el servicio. `TRUST_PROXY_HOPS` debe corresponder a la topología real del proxy. Las migraciones se aplican de forma controlada con `pnpm db:migrate`; el seed de demostración se ejecuta con `pnpm db:seed` cuando corresponda, nunca como parte de las pruebas de producción.

El health check de Render usa `/api/v1/health`: comprueba el proceso, sin certificar lecturas o escrituras de PostgreSQL. La disponibilidad del catálogo se verifica por separado con `GET /api/v1/plans`. Los secretos se configuran en los servicios de alojamiento y no se incluyen en el repositorio.
