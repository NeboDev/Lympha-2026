# CLAUDE.md — Lympha (backend e infraestructura)

Memoria del proyecto entre sesiones. Mantenerlo actualizado al cerrar cada paso.

## Producto
Lympha es un producto IoT B2C de calidad del agua: un nodo ESP32-S3 mide pH, temperatura, conductividad, turbidez y TDS; el servidor calcula un WQI (semáforo de 4 niveles + "revisar sensor / sin datos") y avisa por Telegram. Segmentos: hogar, escuela, pyme, hotel. No certifica potabilidad (RNF-32: nunca decir "potable" o "seguro"). Español de México; nombres de tablas, módulos y código de dominio en español `snake_case`/`camelCase`.

Documentos fuente (raíz del repo). Precedencia si se contradicen: **datos > plan de implementación > arquitectura > requisitos**.

## Alcance y estado
Solo backend e infraestructura. `apps/web` queda como carpeta vacía con README; no se toca el firmware (repo aparte `lympha-firmware`).

**H0 y H1: terminados en local** (ver `docs/decisiones.md`: "Modo local", "H1" y "Pendiente al cerrar H1"). **No avanzar a H2 sin instrucción.** H1 dejó: identidad con Firebase (emulador en local), API de espacios/membresías/invitaciones/nodos/lecturas, migración `0010`, `ingest` con `status`/`attributes`/huecos, `/metrics` en `ingest` y `worker`, CLI de fábrica sin grabado (`pnpm factory`) y simulador de flotas con escenarios JSON. Verificado: 100 nodos, reinicios forzados, 0 lecturas perdidas.

## Modo de trabajo actual: sin VPS (hasta el inicio de H5)
- Todo se desarrolla y prueba en local (Compose de desarrollo). Los criterios de salida que dicen "en staging" se cumplen en el Compose local o en la VM de Multipass (`infra/staging-local/vm.sh`), que se usa para ensayar el despliegue al cierre de cada hito.
- `deploy-staging.yml`, `deploy-prod.yml`, `deploy.sh`, `setup.sh` y `cert-sync.sh` están **escritos pero no probados contra un servidor real**; no afirmar lo contrario. `vm.sh` tampoco se ha ejecutado aún. Se prueban contra un VPS al inicio de H5.
- Telegram: con `APP_ENV=local` y sin `PUBLIC_API_URL` usa long polling; el webhook solo se activa con `PUBLIC_API_URL` (https) definido. Bot de desarrollo `@lympha_dev_bot`.
- Firebase: proyecto `lympha-dev`; en local se usa el emulador de Auth (`FIREBASE_AUTH_EMULATOR_HOST`, prohibido fuera de `APP_ENV=local`). Token de prueba: `pnpm dev:token correo`.
- Mosquitto local usa una CA propia (`infra/certs/ca.crt` + `ca.key`, ignoradas por git; `pnpm certs`), reutilizable para los nodos de prueba de H5.
- Secretos: nunca leer ni pedir valores. Las variables se documentan por nombre en `.env.example` y el usuario llena `.env` (no versionado). Antes de cada paso, listar los archivos que se van a crear o modificar.

## Decisiones finales (anulan a cualquier documento)
- Valkey 8, no Redis.
- Mosquitto 2.1 con Dynamic Security (necesita sustitución `%u`/`%c` en ACL). Imagen: `eclipse-mosquitto:2.1.2-alpine`.
- Identidad: Firebase Auth; solo se verifican tokens con `firebase-admin`. Sin sesiones ni contraseñas propias.
- Las series de tiempo (`ts.*`) no usan RLS: la API las lee solo por las vistas `app.v_*`.
- Los avisos salen de `app.notificaciones_salida` (outbox en Postgres, `FOR UPDATE SKIP LOCKED` + `LISTEN lympha_salida`), no de BullMQ.
- BullMQ solo para colas `lecturas` y `mantenimiento`.
- Node 24 LTS (el doc de arquitectura dice 22; manda el plan). pnpm 11.21 (el plan dice 10.x).
- `ingest` valida y encola (PUBACK solo tras encolar); el `worker` hace el `INSERT` (el doc de datos lo asignaba a `ingest`). El worker agrupa hasta 500 lecturas/200 ms con la API manual de BullMQ, concurrencia 1, orden `(nodo_id, ts)`. La agrupación no puede estar en `ingest`: mqtt.js procesa los PUBLISH de uno en uno con `customHandleAcks`.
- MQTT 5 + sesión persistente exige `sessionExpiryInterval` además de `clean: false`.

## Stack (versiones mayores fijas)
Node 24 · TypeScript 5.9 `strict` · pnpm workspaces · Fastify 5 + `fastify-type-provider-zod` 4 · Zod 3.25 · Drizzle ORM (ejecutor de SQL explícito) · PostgreSQL 16 + TimescaleDB 2.26 · Valkey 8 · BullMQ 5 · Mosquitto 2.1 · mqtt.js 5 · pino 9 · Biome 2 · Vitest 5 + Testcontainers · Caddy 2 · Docker Compose · SOPS + age. Sin paso de build: Node 24 ejecuta TypeScript (imports con extensión `.ts`, sin `enum` ni parámetros-propiedad).

## Estructura del repo
```
apps/server/{src/{modules,platform,main,cli},migrations,test,Dockerfile}
apps/web/                 # vacío + README (fuera de alcance)
packages/{contracts,wqi}  # wqi: pendiente (H2)
tools/{simulator,factory} # factory: solo guarda los lotes generados; el CLI vive en apps/server/src/cli/fabrica.ts
infra/{compose,caddy,mosquitto,postgres,valkey,firebase,bootstrap,staging-local,secrets,test}  + deploy.sh, smoke.sh
.github/workflows/{ci,deploy-staging,deploy-prod}.yml
docs/decisiones.md
```
`main/` tiene cuatro entrypoints (`api`, `ingest`, `worker`, `notifier`); **una sola imagen, cuatro comandos** (`node src/main/<proceso>.ts`). `cli/` tiene los jobs: `migrate`, `mqtt-bootstrap`, `seed`, `fabrica`, `dev-token`.

## Comandos
- `pnpm install` · `pnpm dev` (Compose de desarrollo con `--build --watch`) · `pnpm simulator`
- `pnpm test` (unitarias) · `pnpm test:int` (integración, Testcontainers, necesita Docker) · `pnpm test:infra` (deploy.sh y prod.yml)
- `pnpm lint` / `pnpm lint:fix` (Biome) · `pnpm typecheck`
- `pnpm migrate` · `pnpm db:seed` · `pnpm factory lote --cantidad N [--dev]` · `pnpm dev:token correo` · `pnpm certs` (`CERT_SANS=IP:...`)
- `infra/staging-local/vm.sh crear|desplegar|rollback|ssh|destruir` (VM de Multipass)
- Desde el host contra el stack de desarrollo: `node --env-file=infra/compose/dev.env --env-file=infra/compose/host.env apps/server/src/cli/<job>.ts` (`host.env` cambia los nombres internos por 127.0.0.1)

## Reglas del código (no negociables)
- TypeScript estricto, sin `any` implícito.
- Un módulo solo importa la interfaz pública de otro (`modules/<x>/index.ts`); `main/`, `cli/` y `platform/` solo `modules/<x>/index.ts`. Lo hace cumplir Biome (`noRestrictedImports`).
- Toda consulta de la API pasa por `conUsuario()` (fija `app.usuario_id` con `set_config(..., true)` en la transacción). Procesos internos: `conSistema()`. Las series de tiempo se leen solo por `app.v_*`.
- Toda ruta nueva se declara en `apps/server/test/rutas-cubiertas.ts` (pública o con una prueba de acceso cruzado de `test/api.test.ts` que exista de verdad: 404 al ajeno, 403 al miembro sin rol); si no, falla `src/main/rutas.test.ts`. Rutas de usuario bajo `/api`; sin `/dev` ni `/metrics` en la API.
- Errores de dominio = clases tipadas traducidas por la capa HTTP; nunca exponer trazas.
- Configuración validada con Zod al arrancar (`platform/config.ts`); si falta una variable el proceso no inicia. Ningún secreto en código ni en imágenes.
- Validar con Zod todo cuerpo, parámetro y payload MQTT; rechazar lo desconocido (`.strict()`).
- Migraciones SQL revisables en `apps/server/migrations` (`NNNN_nombre.sql`, una transacción por archivo). Expand/contract: nunca romper la versión anterior del código.
- Roles de BD: `lympha_owner` (migraciones, semillas y funciones SECURITY DEFINER), `lympha_app` (api, RLS), `lympha_system` (ingest/worker/notifier, BYPASSRLS con permisos tabla por tabla), `lympha_backup`. Extensiones, roles y contraseñas: `infra/postgres/init-roles.sh` (idempotente).
- Todo en UTC (`timestamptz`); `America/Mexico_City` solo al agregar por día y mostrar. IDs UUIDv7.
- Ingesta idempotente: `ON CONFLICT (nodo_id, ts) DO NOTHING`; `PUBACK` solo tras encolar. Los jobs de BullMQ no llevan `jobId` (BullMQ rechaza `:`).
- Sin datos personales en logs ni Sentry (ids, no correos). pino con `redact`.
- Commits Conventional Commits; trunk-based; cada paso termina con tests, lint y typecheck limpios.
- No agregar dependencias fuera del stack sin preguntar.
- Archivos largos con heredoc en Bash fallan en este entorno: usar la herramienta Write.

## Contrato MQTT
`lympha/v1/d/{deviceId}/{telemetry|attributes|status|config|cmd|cmd/ack}`; payload con `v`; `telemetry` = `{"v":1,"ts":<epoch s>,"seq":n,"ph","t","ec","turb","tds"}`; `status` es LWT retenido `online|offline`; `ingest` atiende `telemetry`, `status` y `attributes`. Usuario = client id = `deviceId` (Dynamic Security lo exige); `lympha-ingest` fijo a su client id; `lympha-control` sin client id fijo (`-api`, `-worker`).

## Cuándo preguntar
Si un documento tiene contradicción o hueco que cambia el diseño: detenerse y preguntar. Si es menor: decidir, anotar en `docs/decisiones.md` y seguir.
