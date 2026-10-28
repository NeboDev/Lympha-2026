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

# Historias de agua con nivel esperado (H2): lista y reproduce una
pnpm simulator --historias
pnpm simulator --historia turbidez_sube --intervalo 1

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
| `pnpm admin alta correo` | Da de alta a un administrador de plataforma (`baja`, `listar`); la persona debe haber iniciado sesión una vez |
| `pnpm dev:token correo` | ID token del emulador de Firebase Auth |
| `pnpm certs` | Crea o renueva la CA propia y el certificado de Mosquitto (`CERT_SANS`) |
| `bash infra/test/carga-local.sh --duracion 5m` | Carga con 100 nodos y reinicios forzados; informe en `infra/test/resultados/` |
| `pnpm simulator` | Nodo o flota simulada, con escenarios (`--escenario`, `--identidades`, `--nodos`) |
| `bash infra/test/deploy.test.sh` | Pruebas de `infra/deploy.sh` (rollback, orden, secretos) |

## Estructura

```
apps/server   un paquete, una imagen, cuatro procesos: api · ingest · worker · notifier
apps/web      PWA (vacía hasta H4)
packages/     contracts (Zod: MQTT, API y eventos SSE) · wqi (motor WQI puro, H2) · calibracion (regresión y estabilidad, puro)
tools/        simulator · factory (lotes generados; el CLI está en apps/server)
infra/        compose · caddy · mosquitto · postgres · valkey · bootstrap · secrets · deploy.sh
```

## Autocalibración

Pestaña **Calibración** de la PWA (`/calibracion`): corrige cada sensor con una recta `valor = pendiente · crudo + desfase`
calculada con soluciones patrón. Decisiones y alternativas: [`docs/DECISIONES_AUTOCALIBRACION.md`](docs/DECISIONES_AUTOCALIBRACION.md).

**Flujo.** Elegir nodo y parámetro (pH, conductividad, TDS o turbidez; la temperatura no se calibra) → por cada solución
patrón, cambiar la sonda, confirmar el valor real del frasco y esperar a que la lectura se estabilice (las últimas 8 lecturas
con poca variación) → el asistente captura el promedio → se calcula la recta por mínimos cuadrados y se muestran pendiente,
desfase, R² y el antes/después de cada punto → confirmar o descartar. La calibración se aplica a las lecturas **nuevas**; el valor
sin calibrar se conserva siempre.

| Parámetro | Soluciones (mínimo 2 puntos) |
| --- | --- |
| pH | buffers 7.00 y 4.00; 10.00 opcional |
| Conductividad | agua destilada (0) y 1413 µS/cm |
| TDS | agua destilada (0) y 706 mg/L (1413 µS/cm × 0.5) |
| Turbidez | agua destilada (0) y un patrón conocido (100 NTU por omisión) |

**Dónde se aplica.** En el worker, antes de guardar y de evaluar el WQI; no hay que reflashear el nodo ni tocar el broker.
`ts.lecturas.ph` (etc.) guarda el valor calibrado y `ts.lecturas.crudo` (jsonb) el valor sin calibrar de lo que se corrigió.
Los coeficientes se cachean en el worker y se invalidan por Valkey (`invalidar:calibracion`) al cambiarlos.

**Permisos.** El propietario del espacio calibra, revierte y restablece; los miembros solo leen.

**Endpoints** (todos bajo Bearer de Firebase):

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `GET /api/calibraciones?nodo_id=&parametro=&limite=` | miembro | Historial (la más reciente primero) |
| `POST /api/calibraciones` | propietario | `{nodo_id, parametro, puntos:[{crudo, referencia}]}`; el servidor calcula la recta (422 si no hay recta válida) |
| `POST /api/calibraciones/restablecer` | propietario | Deja la identidad (pendiente 1, desfase 0) en un parámetro |
| `POST /api/calibraciones/:id/activar` | propietario | Vuelve a una calibración del historial |

**Eventos.** `event: calibracion` en `GET /api/espacios/:espacioId/eventos` (SSE) con `calibracion_id`, `nodo_id`, `parametro`,
`cambio` (`registrada`, `revertida`, `restablecida`), `pendiente` y `desfase`.

**Tabla.** `app.calibraciones_sensor` (migración `0014`): `nodo_id`, `espacio_id`, `parametro`, `pendiente`, `desfase`, `r2`,
`puntos` (jsonb `{crudo, referencia}`), `origen` (`guiada` | `identidad`), `activa` (una sola por nodo y parámetro, índice parcial
único), `creado_por`, `creado_en`. El plazo para marcar «calibración vencida» es `app.perfiles_uso.calibracion_vence_dias`
(90 por omisión; se cambia con un `UPDATE`). No hay variables de entorno nuevas.

**Lo que falta.** No se ha probado con un sensor y soluciones patrón reales ni el asistente en un navegador real.

## Despliegue

Cada merge a `main` publica la imagen en GHCR y la despliega a staging; una etiqueta `vAAAA.MM.N` lo hace a
producción tras una aprobación. Todo pasa por `infra/deploy.sh` (migra, actualiza procesos uno a uno, prueba y
hace rollback si falla). Preparar un servidor: `infra/bootstrap/setup.sh`. Secretos: `infra/secrets/README.md`.
Aún no existe ningún servidor: los flujos de despliegue están escritos y probados con simulacros, no contra un
servidor real (ver "Staging local en una VM" para ensayarlos).
