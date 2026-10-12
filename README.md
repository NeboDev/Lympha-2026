# Lympha

Backend e infraestructura de Lympha, un producto IoT de calidad del agua. Las decisiones de diseño están en
los cuatro documentos de la raíz (requisitos, arquitectura, datos, plan de implementación); las decisiones
tomadas durante la construcción, en [`docs/decisiones.md`](docs/decisiones.md); la guía para quien trabaje en
el código (y para Claude Code), en [`CLAUDE.md`](CLAUDE.md).

## Requisitos

Node 24 (`.nvmrc`), pnpm (se instala con `corepack enable`) y Docker con Compose.

## Probarlo en local

```bash
pnpm install

# Postgres+Timescale, Valkey, Mosquitto (TLS en 8883), migraciones, semillas y los cuatro procesos.
# Equivale a: docker compose -f infra/compose/base.yml -f infra/compose/dev.yml up
pnpm dev            # agrega --build y --watch (recarga al guardar)

# En otra terminal: un nodo simulado conecta por TLS y publica una lectura por minuto
pnpm simulator                      # --intervalo 5 para ver lecturas más seguido, --lecturas 3 para terminar solo

curl http://127.0.0.1:3000/health
curl -H "x-dev-usuario-id: 0192f3a7-0000-7000-8000-0000000d0001" \
  "http://127.0.0.1:3000/dev/nodos/0192f3a7-5d1c-7a2b-8c3d-000000000001/lecturas?limite=5"
```

`/dev/*` solo existe con `APP_ENV=local` (hasta que llegue la verificación de Firebase, H1). Los valores de
desarrollo están en `infra/compose/dev.env` (no son secretos). La CA de desarrollo para TLS se genera sola en
`infra/certs/ca.crt`.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm lint` / `pnpm lint:fix` | Biome (formato y lint, incluye los límites entre módulos) |
| `pnpm typecheck` | `tsc --noEmit` en todo el monorepo |
| `pnpm test` | Pruebas unitarias (Vitest) |
| `pnpm test:int` | Integración con Testcontainers (necesita Docker) |
| `pnpm migrate` | Aplica las migraciones (`DATABASE_URL_MIGRATE`) |
| `pnpm db:seed` | Semillas de desarrollo: usuario, espacio, nodo y su cliente MQTT |
| `pnpm simulator` | Nodo simulado contra el entorno de desarrollo |
| `bash infra/test/deploy.test.sh` | Pruebas de `infra/deploy.sh` (rollback, orden, secretos) |

## Estructura

```
apps/server   un paquete, una imagen, cuatro procesos: api · ingest · worker · notifier
apps/web      PWA (vacía hasta H4)
packages/     contracts (Zod: MQTT y API) · wqi (H2)
tools/        simulator · factory (H1)
infra/        compose · caddy · mosquitto · postgres · valkey · bootstrap · secrets · deploy.sh
```

## Despliegue

Cada merge a `main` publica la imagen en GHCR y la despliega a staging; una etiqueta `vAAAA.MM.N` lo hace a
producción tras una aprobación. Todo pasa por `infra/deploy.sh` (migra, actualiza procesos uno a uno, prueba y
hace rollback si falla). Preparar un servidor: `infra/bootstrap/setup.sh`. Secretos: `infra/secrets/README.md`.
Aún no existe ningún servidor: los flujos de despliegue están escritos y probados con simulacros, no contra un
servidor real.
