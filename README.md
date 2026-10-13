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

# Postgres+Timescale, Valkey, Mosquitto (TLS en 8883), emulador de Firebase Auth, migraciones, semillas y los
# cuatro procesos. Equivale a: docker compose -f infra/compose/base.yml -f infra/compose/dev.yml up
pnpm dev            # agrega --build y --watch (recarga al guardar)

curl http://127.0.0.1:3000/health

# Identidad: el emulador de Auth (proyecto lympha-dev) emite tokens para la API local
TOKEN=$(pnpm -s dev:token ana@example.com --nombre Ana)
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/yo
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"nombre":"Mi casa","tipo":"hogar"}' http://127.0.0.1:3000/api/espacios

# Un nodo simulado (el de `db:seed`) publica por TLS una lectura por minuto
pnpm simulator --intervalo 5 --escenario acidificacion

# Una flota: la fábrica crea 100 nodos ya reclamados (solo local) y el simulador los conecta
pnpm factory lote --cantidad 100 --version-hw sim --dev
pnpm simulator --identidades tools/factory/lotes/<loteId>/identidades.json --nodos 100 --intervalo 10
```

Los valores de desarrollo están en `infra/compose/dev.env` (no son secretos). **Tus** secretos (token del bot de
Telegram `@lympha_dev_bot` y, si usas un túnel, `PUBLIC_API_URL` y `TELEGRAM_WEBHOOK_SECRET`) van en `.env`, que no se
versiona; los nombres están en `.env.example`. Sin `PUBLIC_API_URL`, Telegram usa long polling. `FIREBASE_USE_EMULATOR=true` (por defecto) usa el emulador de Auth; con `false` la API
verifica tokens del proyecto real `lympha-dev`.

### CA propia y nodos de prueba

La CA de desarrollo se genera sola en `infra/certs/` (`ca.crt` pública, `ca.key` privada e ignorada por git) y firma el
certificado de Mosquitto. Para que un nodo de prueba conecte por la IP de tu equipo:

```bash
CERT_SANS="IP:192.168.1.50" pnpm certs     # reemite solo el certificado del broker; la CA no cambia
```

El `ca.crt` es el que se graba en los nodos de prueba (H5): reemitir el certificado del broker no obliga a regrabarlos.

## Staging local en una VM (Multipass)

Ensaya el despliegue completo sin VPS: la VM se prepara con el mismo `infra/bootstrap/setup.sh` y se despliega con el
mismo `infra/deploy.sh`, por SSH. Requiere [Multipass](https://multipass.run), Docker, Git y ssh (en Windows, desde Git Bash).

```bash
infra/staging-local/vm.sh crear        # crea la VM, la prepara, genera sus secretos y despliega el commit actual
infra/staging-local/vm.sh desplegar    # después de cada commit: construye la imagen, la carga y corre deploy.sh
infra/staging-local/vm.sh ip           # API: https://<ip>/health (curl -k) · MQTT: mqtts://<ip>:8883 con infra/certs/ca.crt
infra/staging-local/vm.sh rollback | ssh | destruir
```

Se despliega lo **commiteado** (la imagen usa el árbol de trabajo). Está escrita pero aún no se ha ejecutado; ver
`docs/decisiones.md`, "Modo local".

## Comandos

| Comando | Qué hace |
| --- | --- |
| `pnpm lint` / `pnpm lint:fix` | Biome (formato y lint, incluye los límites entre módulos) |
| `pnpm typecheck` | `tsc --noEmit` en todo el monorepo |
| `pnpm test` | Pruebas unitarias (Vitest) |
| `pnpm test:int` | Integración con Testcontainers (necesita Docker) |
| `pnpm migrate` | Aplica las migraciones (`DATABASE_URL_MIGRATE`) |
| `pnpm db:seed` | Semillas de desarrollo: usuario, espacio, nodo y su cliente MQTT |
| `pnpm factory lote --cantidad N` | Fábrica: lote, identidades y clientes MQTT (`revocar-nodo`, `revocar-lote`; `--dev` reclama) |
| `pnpm dev:token correo` | ID token del emulador de Firebase Auth |
| `pnpm certs` | Crea o renueva la CA propia y el certificado de Mosquitto (`CERT_SANS`) |
| `bash infra/test/carga-local.sh --duracion 5m` | Carga con 100 nodos y reinicios forzados; informe en `infra/test/resultados/` |
| `pnpm simulator` | Nodo o flota simulada, con escenarios (`--escenario`, `--identidades`, `--nodos`) |
| `bash infra/test/deploy.test.sh` | Pruebas de `infra/deploy.sh` (rollback, orden, secretos) |

## Estructura

```
apps/server   un paquete, una imagen, cuatro procesos: api · ingest · worker · notifier
apps/web      PWA (vacía hasta H4)
packages/     contracts (Zod: MQTT y API) · wqi (H2)
tools/        simulator · factory (lotes generados; el CLI está en apps/server)
infra/        compose · caddy · mosquitto · postgres · valkey · bootstrap · secrets · deploy.sh
```

## Despliegue

Cada merge a `main` publica la imagen en GHCR y la despliega a staging; una etiqueta `vAAAA.MM.N` lo hace a
producción tras una aprobación. Todo pasa por `infra/deploy.sh` (migra, actualiza procesos uno a uno, prueba y
hace rollback si falla). Preparar un servidor: `infra/bootstrap/setup.sh`. Secretos: `infra/secrets/README.md`.
Aún no existe ningún servidor: los flujos de despliegue están escritos y probados con simulacros, no contra un
servidor real (ver "Staging local en una VM" para ensayarlos).
