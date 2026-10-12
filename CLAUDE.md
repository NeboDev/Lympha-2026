# CLAUDE.md — Lympha (backend e infraestructura)

Memoria del proyecto entre sesiones. Mantenerlo actualizado al cerrar cada paso.

## Producto
Lympha es un producto IoT B2C de calidad del agua: un nodo ESP32-S3 mide pH, temperatura, conductividad, turbidez y TDS; el servidor calcula un WQI (semáforo de 4 niveles + "revisar sensor / sin datos") y avisa por Telegram. Segmentos: hogar, escuela, pyme, hotel. No certifica potabilidad (RNF-32: nunca decir "potable" o "seguro"). Español de México, nombres de tablas/módulos en español `snake_case`.

Documentos fuente (raíz del repo). Precedencia si se contradicen: **datos > plan de implementación > arquitectura > requisitos**.

## Alcance actual
Solo backend e infraestructura. `apps/web` queda como carpeta vacía con README; no se toca el firmware (repo aparte `lympha-firmware`).
**Hito en curso: H0 (Esqueleto).** No avanzar a H1 sin instrucción. Estado de los pasos: ver `docs/decisiones.md` y el historial de commits.

## Decisiones finales (anulan a cualquier documento)
- Valkey 8, no Redis.
- Mosquitto 2.1 con Dynamic Security (necesita sustitución `%u`/`%c` en ACL). Imagen: `eclipse-mosquitto:2.1.2-alpine` (verificar al subir).
- Identidad: Firebase Auth; solo se verifican tokens con `firebase-admin`. Sin sesiones ni contraseñas propias.
- Las series de tiempo (`ts.*`) no usan RLS: la API las lee solo por las vistas `app.v_*`.
- Los avisos salen de `app.notificaciones_salida` (outbox en Postgres, `FOR UPDATE SKIP LOCKED` + `LISTEN lympha_salida`), no de BullMQ.
- BullMQ solo para colas `lecturas` y `mantenimiento`.
- Node 24 LTS (el doc de arquitectura dice 22; manda el plan).

## Stack (versiones mayores fijas)
Node 24 · TypeScript 5.x `strict` · pnpm workspaces · Fastify 5 + `fastify-type-provider-zod` · Zod 3.x · Drizzle ORM + drizzle-kit · PostgreSQL 16 + TimescaleDB 2.x · Valkey 8 · BullMQ 5 · Mosquitto 2.1 · mqtt.js 5 (`customHandleAcks`) · firebase-admin · pino 9 · Biome · Vitest + Testcontainers · Caddy 2 · Docker Compose · SOPS + age para secretos.

## Estructura del repo
```
apps/server/{src/{modules,platform,main},migrations,test,Dockerfile}
apps/web/                 # vacío + README (fuera de alcance)
packages/{contracts,wqi}
tools/{factory,simulator}
infra/{compose,caddy,mosquitto,postgres,valkey,bootstrap,secrets}
.github/workflows/
docs/decisiones.md
```
`main/` tiene cuatro entrypoints: `api.ts`, `ingest.ts`, `worker.ts`, `notifier.ts`. **Una sola imagen, cuatro comandos.**

## Comandos
(Se completan a medida que existen; ver `package.json` raíz.)
- `pnpm install`
- `pnpm dev` → `docker compose -f infra/compose/base.yml -f infra/compose/dev.yml up`
- `pnpm test` (unitarias) · `pnpm test:int` (integración, Testcontainers)
- `pnpm lint` (Biome) · `pnpm typecheck` (`tsc --noEmit`)
- `pnpm migrate` (aplica migraciones con `DATABASE_URL_MIGRATE`)
- `pnpm --filter @lympha/simulator start -- --nodes 1`

## Reglas del código (no negociables)
- TypeScript estricto, sin `any` implícito.
- Un módulo solo importa la interfaz pública de otro (`modules/<x>/index.ts`); lo hace cumplir una regla de lint.
- Toda consulta de la API pasa por `conUsuario()` (fija `app.usuario_id` con `set_config(..., true)` en la transacción). Procesos internos: `conSistema()`. Nunca consultar fuera de ellos.
- Errores de dominio = clases tipadas traducidas por la capa HTTP; nunca exponer trazas.
- Configuración validada con Zod al arrancar; si falta una variable el proceso no inicia. Ningún secreto en código ni en imágenes.
- Validar con Zod todo cuerpo, parámetro y payload MQTT; rechazar lo desconocido.
- Migraciones SQL revisables en `apps/server/migrations`, en el orden del documento de datos (`0000_init` … `0008_aislamiento`, luego una por cambio). Expand/contract: nunca romper la versión anterior del código.
- Roles de BD: `lympha_owner` (solo migraciones), `lympha_app` (api, sujeto a RLS), `lympha_system` (ingest/worker/notifier, BYPASSRLS con permisos tabla por tabla), `lympha_backup`.
- Todo en UTC (`timestamptz`); `America/Mexico_City` solo al agregar por día y mostrar. IDs UUIDv7.
- Ingesta idempotente: `INSERT ... ON CONFLICT (nodo_id, ts) DO NOTHING`; `PUBACK` solo tras encolar.
- Sin datos personales en logs ni Sentry (ids, no correos).
- Commits Conventional Commits; trunk-based; cada paso termina con tests, lint y typecheck limpios.
- No agregar dependencias fuera del stack sin preguntar.

## Contrato MQTT
`lympha/v1/d/{deviceId}/{telemetry|attributes|status|config|cmd|cmd/ack}`; payload con `v`; `telemetry` = `{"v":1,"ts":<epoch s>,"seq":n,"ph","t","ec","turb","tds"}`; `status` es LWT retenido `online|offline`.

## Cuándo preguntar
Si un documento tiene contradicción o hueco que cambia el diseño: detenerse y preguntar. Si es menor: decidir, anotar en `docs/decisiones.md` y seguir.
