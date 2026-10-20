# XTRIM API — demostración técnica

API Express 5 + TypeScript + PostgreSQL (`pg`). Esta etapa incluye catálogo público y esquema de leads; no incluye autenticación ni endpoints administrativos. Planes y precios ficticios; no es el sitio oficial.

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

`plan_id` es obligatorio y FK con eliminación restringida. Estados: `NEW`, `IN_PROGRESS`, `CLOSED`. Un lead abierto no puede tener resultado ni monto. Un cierre exige `WON` o `LOST`: ganado requiere monto USD no negativo; perdido no admite monto. Se permite cero para ofertas gratuitas. `sale_amount` guarda el valor mensual acordado históricamente; el futuro KPI sumará solo cierres ganados, no ingresos cobrados ni el precio actual del catálogo. Las fechas se mantienen mediante triggers. Teléfono normalizado ecuatoriano fijo/móvil, local o con prefijo +593. La validación completa de provincia y entradas HTTP corresponderá a la etapa de captación.

## Comprobaciones

```sh
pnpm typecheck
pnpm build
pnpm test
DATABASE_TESTS=1 pnpm test
pnpm start
```

La prueba PostgreSQL requiere migraciones aplicadas y usa una transacción revertida para sus datos temporales. Preferir una base de pruebas; no ejecutarla concurrentemente en la misma base. Sin `DATABASE_TESTS=1` se omite explícitamente. Las pruebas HTTP aisladas verifican errores y parametrización; no sustituyen la prueba persistente. No existe configuración de lint en esta etapa. El arranque verifica la conexión y SIGINT/SIGTERM cierran HTTP y pool. No se registran URLs, SQL ni datos personales en errores.
