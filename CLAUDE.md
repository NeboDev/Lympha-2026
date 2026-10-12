# CLAUDE.md — Lympha (backend e infraestructura)

Memoria del proyecto entre sesiones. Mantenerlo actualizado al cerrar cada paso.

## Producto
Lympha es un producto IoT B2C de calidad del agua: un nodo ESP32-S3 mide pH, temperatura, conductividad, turbidez y TDS; el servidor calcula un WQI (semáforo de 4 niveles + "revisar sensor / sin datos") y avisa por Telegram. Segmentos: hogar, escuela, pyme, hotel. No certifica potabilidad (RNF-32: nunca decir "potable" o "seguro"). Español de México; nombres de tablas, módulos y código de dominio en español `snake_case`/`camelCase`.

Documentos fuente (raíz del repo). Precedencia si se contradicen: **datos > plan de implementación > arquitectura > requisitos**.

## Alcance y estado
Solo backend e infraestructura. `apps/web` queda como carpeta vacía con README; no se toca el firmware (repo aparte `lympha-firmware`).

**H0 (Esqueleto): terminado** (criterio de salida cumplido en local; ver `docs/decisiones.md`, sección "Pendiente al cerrar H0"). **No avanzar a H1 sin instrucción.** Lo que H0 deja funcionando: Compose de desarrollo con Postgres+Timescale, Valkey 8, Mosquitto 2.1 con Dynamic Security y TLS, y los cuatro procesos; migraciones `0000`–`0009`; `conUsuario()`/`conSistema()`; flujo MQTT → cola → worker → `ts.lecturas`; simulador con TLS; CI y deploy a staging/producción escritos (sin servidor todavía).

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
tools/{simulator,factory} # factory: pendiente (H1)
infra/{compose,caddy,mosquitto,postgres,valkey,bootstrap,secrets,test}  + deploy.sh, smoke.sh
.github/workflows/{ci,deploy-staging,deploy-prod}.yml
docs/decisiones.md
```
`main/` tiene cuatro entrypoints (`api`, `ingest`, `worker`, `notifier`); **una sola imagen, cuatro comandos** (`node src/main/<proceso>.ts`). `cli/` tiene los jobs: `migrate`, `mqtt-bootstrap`, `seed`.

## Comandos
- `pnpm install` · `pnpm dev` (Compose de desarrollo con `--build --watch`) · `pnpm simulator`
- `pnpm test` (unitarias) · `pnpm test:int` (integración, Testcontainers, necesita Docker) · `pnpm test:infra` (deploy.sh y prod.yml)
- `pnpm lint` / `pnpm lint:fix` (Biome) · `pnpm typecheck`
- `pnpm migrate` · `pnpm db:seed`
- Desde el host contra el stack de desarrollo: `MQTT_URL=mqtt://127.0.0.1:1883 node --env-file=infra/compose/dev.env apps/server/src/cli/<job>.ts`

## Reglas del código (no negociables)
- TypeScript estricto, sin `any` implícito.
- Un módulo solo importa la interfaz pública de otro (`modules/<x>/index.ts`); `main/`, `cli/` y `platform/` solo `modules/<x>/index.ts`. Lo hace cumplir Biome (`noRestrictedImports`).
- Toda consulta de la API pasa por `conUsuario()` (fija `app.usuario_id` con `set_config(..., true)` en la transacción). Procesos internos: `conSistema()`. Las series de tiempo se leen solo por `app.v_*`.
- Toda ruta nueva se declara en `apps/server/test/rutas-cubiertas.ts` (pública o con su prueba de acceso cruzado → 404); si no, falla `src/main/rutas.test.ts`.
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
`lympha/v1/d/{deviceId}/{telemetry|attributes|status|config|cmd|cmd/ack}`; payload con `v`; `telemetry` = `{"v":1,"ts":<epoch s>,"seq":n,"ph","t","ec","turb","tds"}`; `status` es LWT retenido `online|offline`. Usuario = client id = `deviceId` (Dynamic Security lo exige); `lympha-ingest` fijo a su client id; `lympha-control` sin client id fijo (`-api`, `-worker`).

## Cuándo preguntar
Si un documento tiene contradicción o hueco que cambia el diseño: detenerse y preguntar. Si es menor: decidir, anotar en `docs/decisiones.md` y seguir.
