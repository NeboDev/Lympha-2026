# Lympha — Plan de implementación y producción

Oct 11, 2026 · @Jesus AQ

## Resumen

Lympha se construye en producción desde el primer día: antes de escribir lógica de negocio se despliega un esqueleto que recorre todo el camino, de un nodo simulado hasta una pantalla en un dominio real con TLS. A partir de ahí cada función llega a producción por el mismo pipeline, con pruebas, migraciones y monitoreo ya funcionando.

Este documento convierte el documento de arquitectura en decisiones ejecutables: versiones, estructura del código, entornos, infraestructura, pipeline, pruebas, observabilidad, seguridad, firmware y un plan por hitos. Los requisitos citados (RF, RNF) son los del documento de requisitos.

Principios:

1. **Esqueleto primero:** en la semana 1 hay un nodo simulado publicando por MQTT, una lectura guardándose en Postgres y un endpoint respondiendo en `https://api.<dominio>`.
2. **Todo cambio pasa por el pipeline:** nada se despliega a mano; la única excepción documentada es la recuperación ante desastres.
3. **Sin hardware para desarrollar:** un simulador de nodos reemplaza al ESP32 en desarrollo, pruebas y pruebas de carga.
4. **Infraestructura reproducible:** un servidor nuevo queda listo con un script y un archivo de Compose, no con pasos manuales.
5. **Lo mínimo que una persona puede operar:** servicios gestionados donde ahorran operación (identidad, errores, logs) y un solo servidor mientras alcance.

## Stack definitivo

Se fijan versiones mayores; las menores las actualiza el bot de dependencias cada semana, con el pipeline como red de seguridad.

| Capa | Elección | Versión | Nota |
| --- | --- | --- | --- |
| Runtime | Node.js | 24 LTS | Una sola versión en `.nvmrc`, imágenes y CI |
| Lenguaje | TypeScript | 5.x | `strict: true`, sin `any` implícito |
| Paquetes | pnpm workspaces | 10.x | Monorepo con un solo lockfile |
| HTTP | Fastify | 5.x | Con `fastify-type-provider-zod` para validar y generar OpenAPI |
| Validación | Zod | 3.x | Esquemas en `packages/contracts`, compartidos con la web |
| Acceso a datos | Drizzle ORM + drizzle-kit | actual | Migraciones en SQL revisables |
| Base de datos | PostgreSQL + TimescaleDB | 16 + 2.x | Imagen `timescale/timescaledb` con la versión fijada |
| Cola y caché | Valkey | 8.x | Compatible con BullMQ; licencia BSD (restricción de licencias) |
| Trabajos | BullMQ | 5.x | `Colas lecturas y mantenimiento; los avisos usan la bandeja de salida en Postgres` |
| MQTT (servidor) | Mosquitto + Dynamic Security | 2.1.x | Imagen oficial `eclipse-mosquitto` |
| MQTT (cliente) | mqtt.js | 5.x | `customHandleAcks` para enviar el `PUBACK` tras encolar |
| Identidad | Firebase Auth + `firebase-admin` | actual | Solo MVP (D8) |
| Logs | pino | 9.x | JSON a stdout |
| Frontend | React + Vite + TanStack Query + React Router | 19 / actual | PWA con `vite-plugin-pwa` |
| Pruebas | Vitest, Testcontainers, Playwright, k6 | actual | Ver estrategia de pruebas |
| Proxy y TLS | Caddy | 2.x | Certificados automáticos |
| Contenedores | Docker Engine + Compose | actual | Mismos archivos en todos los entornos |
| Firmware | ESP-IDF | 5.x | C, sin Arduino; repo aparte |

Cambio respecto al documento de arquitectura: **Valkey en lugar de Redis**. Es el fork con licencia BSD, compatible con el protocolo y con BullMQ, y evita depender de los cambios de licencia de Redis.

## Repositorio y convenciones

Dos repositorios: `lympha` (servidor, web, herramientas e infraestructura) y `lympha-firmware` (ESP-IDF). Comparten solo el contrato MQTT, que se versiona en `lympha/packages/contracts` y se copia como JSON Schema al firmware.

```
lympha/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── modules/<modulo>/        # routes.ts, service.ts, repo.ts, schema.ts, *.test.ts
│   │   │   ├── platform/                # config, db, auth, mqtt, queues, sse, logger, errors
│   │   │   └── main/                    # api.ts, ingest.ts, worker.ts, notifier.ts
│   │   ├── migrations/                  # SQL generado y revisado (drizzle-kit)
│   │   ├── test/                        # integración y aislamiento (Testcontainers)
│   │   └── Dockerfile                   # una imagen, cuatro comandos
│   └── web/                             # PWA
├── packages/
│   ├── contracts/                       # Zod: API, MQTT, eventos SSE
│   └── wqi/                             # motor WQI puro + casos de referencia
├── tools/
│   ├── factory/                         # CLI de fábrica
│   └── simulator/                       # simulador de nodos
├── infra/
│   ├── compose/                         # base.yml, dev.yml, prod.yml
│   ├── caddy/  mosquitto/  postgres/
│   ├── bootstrap/                       # script de preparación de servidores
│   └── secrets/                         # archivos cifrados con SOPS
└── .github/workflows/
```

**Reglas del código:**

- Un módulo solo importa la interfaz pública de otro (`modules/<x>/index.ts`); una regla de lint lo hace cumplir.
- Ninguna consulta de la API se ejecuta fuera de `conUsuario()`, que fija el contexto RLS; los procesos internos usan `conSistema()`.
- Los errores de dominio son clases tipadas que la capa HTTP traduce a códigos; nunca se exponen trazas.
- La configuración se valida con Zod al arrancar; si falta una variable, el proceso no inicia.
- Biome para formato y lint, ejecutado en un hook de pre-commit y en CI.

**Flujo con Git:**

- Trunk-based: `main` siempre desplegable; ramas cortas de menos de 2 días.
- Cada cambio entra por pull request con el pipeline en verde, aunque el único revisor seas tú.
- Commits con Conventional Commits (`feat:`, `fix:`, `chore:`); de ahí se genera el changelog.
- Versiones con etiquetas `vAAAA.MM.N` (por ejemplo, `v2026.11.1`); una etiqueta es lo que se despliega a producción.

## Entornos, configuración y secretos

Tres entornos con los mismos archivos de Compose; solo cambian las variables y el tamaño del servidor.

| Entorno | Dónde | Se despliega | Datos | Proyecto Firebase y bot de Telegram |
| --- | --- | --- | --- | --- |
| `local` | Tu computadora, `docker compose -f base.yml -f dev.yml up` | Al guardar (recarga en caliente) | Semillas y simulador | `lympha-dev`, bot de pruebas |
| `staging` | VPS pequeño | Automático en cada merge a `main` | Simulador con 50 nodos permanentes y 1–2 nodos reales | `lympha-staging`, bot de staging |
| `production` | VPS principal | Al crear una etiqueta, con aprobación manual | Clientes reales | `lympha-prod`, bot oficial |

**Variables de configuración** (validadas con Zod al arrancar):

| Variable | Ejemplo | Secreta |
| --- | --- | --- |
| `NODE_ENV`, `APP_ENV` | `production`, `staging` | No |
| `PUBLIC_API_URL`, `PUBLIC_APP_URL` | `https://api.lympha.app` | No |
| `DATABASE_URL_APP` | rol `lympha_app` | Sí |
| `DATABASE_URL_SYSTEM` | rol `lympha_system` | Sí |
| `DATABASE_URL_MIGRATE` | rol `lympha_owner` (solo el job de migraciones) | Sí |
| `VALKEY_URL` | `redis://valkey:6379` | Sí |
| `MQTT_URL`, `MQTT_INGEST_USER`, `MQTT_INGEST_PASSWORD` | `mqtts://mqtt.lympha.app:8883` | Sí |
| `MQTT_ADMIN_USER`, `MQTT_ADMIN_PASSWORD` | cliente de administración de Dynamic Security | Sí |
| `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT` | JSON en base64 | Sí |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | — | Sí |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | respaldos y firmware | Sí |
| `SENTRY_DSN`, `LOG_LEVEL` | `info` | No |

**Secretos:**

- Se guardan cifrados en el repositorio con SOPS y una llave age por entorno (`infra/secrets/staging.enc.env`, `production.enc.env`).
- La llave privada de producción vive solo en el servidor de producción y en tu gestor de contraseñas; CI recibe la de staging como secreto de GitHub.
- El despliegue descifra en el servidor y monta los secretos como archivo de entorno con permisos `600`; nunca entran a las imágenes.
- Rotación: contraseñas de base de datos y MQTT cada 6 meses o ante cualquier sospecha; el token de Telegram, solo ante sospecha.

## Infraestructura de producción

Dos servidores virtuales en el mismo proveedor y región, más almacenamiento de objetos. El proveedor queda pendiente (ver decisiones pendientes); la región debe estar en Norteamérica para mantener baja la latencia desde México. `lympha.app` es un nombre provisional hasta comprar el dominio.

**Servidores:**

| Servidor | Tamaño | Corre | Disco |
| --- | --- | --- | --- |
| `prod-1` | 4 vCPU, 8 GB | Caddy, `api`, `ingest`, `worker`, `notifier`, Postgres, Valkey, Mosquitto | Volumen de bloque aparte de 80 GB para Postgres y Mosquitto |
| `staging-1` | 2 vCPU, 4 GB | Lo mismo, más el simulador de 50 nodos | Disco del servidor |

**Dominios:**

| Nombre | Apunta a | Uso |
| --- | --- | --- |
| `lympha.app` | Hosting estático o `prod-1` | Sitio público y aviso de privacidad |
| `app.lympha.app` | `prod-1` (Caddy) | PWA |
| `api.lympha.app` | `prod-1` (Caddy) | API, SSE y webhook de Telegram |
| `mqtt.lympha.app` | `prod-1` (Mosquitto, 8883) | Nodos |
| `*.staging.lympha.app` | `staging-1` | Lo mismo para staging |

La PWA y la API usan subdominios distintos; CORS permite solo `app.lympha.app`. Los certificados de `mqtt.lympha.app` los obtiene Caddy y un script los copia a Mosquitto y le envía `SIGHUP` al renovarse.

**Red y firewall:**

| Puerto | Abierto a | Servicio |
| --- | --- | --- |
| 22 | Solo tu IP o una VPN (Tailscale) | SSH con llave, sin contraseña ni root |
| 80, 443 | Internet | Caddy (80 solo redirige a 443) |
| 8883 | Internet | Mosquitto con TLS |
| 5432, 6379, 1883 | Nadie (red interna de Docker) | Postgres, Valkey, MQTT sin TLS para procesos internos |

**Almacenamiento de objetos (compatible con S3):**

- `lympha-backups-prod`: respaldos cifrados de Postgres; versionado y bloqueo de borrado de 30 días.
- `lympha-firmware`: binarios OTA firmados, servidos por URL prefirmada.

**Preparación de un servidor nuevo** (`infra/bootstrap/setup.sh`, idempotente):

1. Crea el usuario `deploy` con llave SSH; deshabilita el acceso por contraseña y el login de root.
2. Activa el firewall con la tabla de puertos y las actualizaciones automáticas de seguridad.
3. Instala Docker Engine, Compose y SOPS.
4. Monta el volumen de datos en `/srv/lympha/data`.
5. Clona `infra/` en `/srv/lympha` y deja el servidor listo para que el pipeline despliegue.

Un servidor nuevo debe quedar operativo en menos de una hora, sin pasos fuera del script.

## Pipeline de CI/CD

GitHub Actions con tres flujos: cada pull request se valida, cada merge a `main` se despliega a staging y cada etiqueta se despliega a producción tras una aprobación manual.

&#91;embedded content: pipeline · 3 flujos, de PR a producción\]

**Pull request** (`ci.yml`, menos de 10 min):

- Biome y `tsc --noEmit` en todo el monorepo.
- Pruebas unitarias con Vitest, incluidos los casos de referencia del WQI.
- Integración con Testcontainers: Postgres + Timescale, Valkey y Mosquitto reales.
- Pruebas de aislamiento: falla si una ruta nueva no tiene su prueba de acceso cruzado.
- Build de la imagen del servidor y de la PWA, sin publicarlas.
- Revisión de vulnerabilidades de dependencias e imagen (Trivy); falla con severidad alta o crítica.

**Merge a `main`** (`deploy-staging.yml`):

1. Publica la imagen en GitHub Container Registry, etiquetada con el SHA del commit.
2. Se conecta a `staging-1` por SSH con el usuario `deploy` y ejecuta `deploy.sh <sha>`.
3. `deploy.sh` corre las migraciones como contenedor de una sola ejecución con el rol `lympha_owner`, actualiza los procesos y ejecuta las pruebas de humo.

**Etiqueta `vAAAA.MM.N`** (`deploy-prod.yml`):

1. Espera la aprobación manual en el entorno `production` de GitHub.
2. Hace un respaldo de Postgres a S3 antes de migrar.
3. Migra y actualiza los procesos uno por uno: `worker` y `notifier`, luego `ingest`, al final `api`.
4. Corre las pruebas de humo; si fallan, ejecuta el rollback automáticamente y avisa por Telegram al canal interno.

**Migraciones (expand/contract):** cada migración de producción es compatible con la versión anterior del código. Renombrar una columna toma tres despliegues: agregar la nueva y escribir en ambas, migrar los datos y leer de la nueva, y borrar la vieja. Así un rollback de la aplicación nunca requiere revertir la base de datos.

**Rollback:** cada despliegue registra el digest de la imagen anterior en `/srv/lympha/releases`. `deploy.sh rollback` vuelve a ese digest en menos de 2 minutos, sin tocar las migraciones.

**Pruebas de humo:**

- `GET /health` de `api` responde 200 con Postgres, Valkey y MQTT conectados.
- Un nodo de prueba publica una lectura, que aparece en la API en menos de 10 s.
- El webhook de Telegram responde.

**Interrupción durante el despliegue:** `ingest` se reinicia sin perder lecturas, porque su sesión MQTT es persistente y el broker guarda los mensajes QoS 1 mientras vuelve. `api` puede cortar unos segundos: la PWA reintenta y el stream SSE se reconecta solo.

## Pruebas y simulador de nodos

Las pruebas se concentran donde un error es más caro: el cálculo del WQI, el aislamiento entre espacios y la entrega de alertas.

| Nivel | Herramienta | Qué cubre | Cuándo corre |
| --- | --- | --- | --- |
| Unitarias | Vitest | Motor WQI con casos de referencia, histéresis, reglas de alarma, validación de payloads | Cada PR |
| Integración | Vitest + Testcontainers | Ingesta completa: MQTT → cola → worker → Postgres → outbox, con servicios reales | Cada PR |
| Aislamiento | Vitest + Testcontainers | Por cada ruta y canal SSE: otro usuario intenta leer, escribir y suscribirse y recibe 404 (RNF-01) | Cada PR |
| Contrato | Zod + JSON Schema | Payloads de firmware de las versiones soportadas contra el esquema actual (RNF-29) | Cada PR |
| End-to-end | Playwright | Registro, reclamo con el simulador, semáforo, vinculación de Telegram con un bot de prueba | Staging, en cada despliegue |
| Carga | k6 + simulador | 1,000 nodos a 1 lectura/min durante 1 h; latencias de RNF-14 y RNF-15 | Antes de cada hito y de cada etiqueta mayor |
| Recuperación | Script | Reinicio forzado de `ingest` y `worker` sin perder lecturas (RNF-11); restauración de respaldo (RNF-13) | Mensual en staging |

**Casos de referencia del WQI:** un archivo `packages/wqi/fixtures/*.json` por perfil, con entradas y resultado esperado. Cualquier cambio de curva que altere un resultado debe subir la versión del algoritmo (RNF-24); la prueba lo exige.

**Simulador de nodos** (`tools/simulator`): es la herramienta que permite desarrollar todo el backend sin hardware.

- Crea N nodos vía el CLI de fábrica, con credenciales reales de Dynamic Security, y los conecta por MQTT con TLS.
- Publica lecturas siguiendo escenarios definidos en YAML: agua estable, subida de turbidez, deriva lenta de pH, desconexión de 30 min, reconexión con buffer.
- Respeta el contrato completo: `seq`, `ts`, Last Will, atributos y respuesta a comandos.
- Modos: `--nodes 5 --scenario turbidez` para desarrollo; `--nodes 1000 --rate 1/min` para carga.

```yaml
# tools/simulator/scenarios/turbidez.yml
duracion: 2h
base: { ph: 7.2, t: 22, ec: 450, turb: 0.6, tds: 290 }
eventos:
  - en: 20m
    rampa: { turb: 6.5 }
    durante: 10m
  - en: 60m
    rampa: { turb: 0.7 }
    durante: 15m
ruido: { ph: 0.03, t: 0.2, ec: 5, turb: 0.1, tds: 3 }
```

## Observabilidad y operación

El objetivo es que te enteres de un problema antes que el cliente, con servicios gestionados en su nivel gratuito para no operar otra pila de monitoreo en el mismo servidor.

| Señal | Herramienta | Qué se envía |
| --- | --- | --- |
| Errores | Sentry (servidor y PWA) | Excepciones con `espacio_id`, `nodo_id` y versión; sin datos personales |
| Logs | pino → Grafana Alloy → Grafana Cloud (Loki) | JSON con `req_id`, `espacio_id`, `nodo_id`, `proceso`; retención de 14 días |
| Métricas | `/metrics` (Prometheus) → Grafana Cloud | Ver tabla de métricas |
| Disponibilidad | Monitor externo cada 1 min | `https://api.<dominio>/health` y conexión TLS a `mqtt.<dominio>:8883` |
| Alertas internas | Grafana → bot de Telegram interno | Canal privado, separado del bot de clientes |

**Métricas clave:**

- `lympha_lecturas_recibidas_total` y `lympha_lecturas_rechazadas_total{motivo}`.
- `lympha_cola_espera_segundos{cola}` y `lympha_cola_pendientes{cola}`.
- `lympha_nodos_en_linea` y `lympha_nodos_sin_conexion`.
- `lympha_alarmas_abiertas{tipo}` y `lympha_outbox_pendientes`.
- `lympha_telegram_errores_total{codigo}`.
- Latencia HTTP por ruta (p50, p95) y uso de CPU, memoria y disco del servidor.

**Alertas internas:**

| Alerta | Condición | Severidad |
| --- | --- | --- |
| Ingesta caída | Lecturas recibidas bajan más de 50 % en 10 min (RNF-28) | Crítica |
| Cola atascada | Espera en `lecturas` mayor a 60 s durante 5 min | Crítica |
| Outbox atascada | Avisos pendientes de más de 2 min | Alta |
| API caída | `/health` falla 3 veces seguidas | Crítica |
| Disco | Volumen de datos por encima de 80 % | Alta |
| Respaldo | No hay respaldo exitoso en 26 h | Alta |
| Certificado | Vence en menos de 14 días | Media |

**Runbooks** (`infra/runbooks/*.md`), uno por alerta, con diagnóstico y acción en menos de una página. Los mínimos antes de producción:

1. La ingesta se detuvo.
2. La cola de lecturas está atascada.
3. Telegram no entrega mensajes.
4. Restaurar Postgres desde un respaldo.
5. Revocar un nodo o un lote comprometido.
6. Rotar un secreto.
7. Reconstruir el servidor desde cero.

## Seguridad desde el día uno

Cada punto se configura en el esqueleto inicial, no después: agregarlos con clientes reales cuesta más y deja huecos.

**Servidor**

- [ ] SSH solo con llave, sin root, accesible solo por Tailscale o desde una IP fija.
- [ ] Firewall con los puertos de la tabla de infraestructura; nada más abierto.
- [ ] Actualizaciones automáticas de seguridad del sistema operativo.
- [ ] Contenedores sin root, con sistema de archivos de solo lectura donde se pueda y límites de memoria.

**Aplicación**

- [ ] RLS con `FORCE` en todas las tablas con `espacio_id`, y prueba de aislamiento obligatoria por ruta.
- [ ] Tres roles de base de datos (`owner`, `app`, `system`) con permisos mínimos.
- [ ] Validación con Zod de todo cuerpo, parámetro y payload MQTT; se rechaza lo desconocido.
- [ ] Rate limit por IP y por usuario en la API; más estricto en el reclamo de nodos.
- [ ] CORS limitado a `app.<dominio>`; cabeceras de seguridad (HSTS, CSP, `X-Content-Type-Options`) desde Caddy.
- [ ] Webhook de Telegram con `secret_token` verificado en cada llamada.
- [ ] Verificación del token de Firebase con correo verificado y revocación en rutas sensibles.
- [ ] Ningún dato personal en logs ni en Sentry; se registran ids, no correos.

**Cadena de suministro**

- [ ] Renovate o Dependabot semanal con merge automático de parches si el pipeline pasa.
- [ ] Trivy sobre dependencias e imágenes en cada PR.
- [ ] Imágenes base fijadas por digest; acciones de GitHub fijadas por SHA.
- [ ] Escaneo de secretos (gitleaks) en el hook de pre-commit y en CI.

**Datos**

- [ ] Respaldos cifrados en reposo, con bloqueo de borrado de 30 días.
- [ ] Volumen de datos cifrado por el proveedor.
- [ ] Acceso de soporte a lecturas de un espacio solo con registro en `auditoria` (RF-47).

**Legal**

- [ ] Aviso de privacidad publicado antes del primer usuario externo, incluida la transferencia a Google (Firebase) y al proveedor del servidor.
- [ ] Términos de uso con el descargo de que Lympha no certifica agua potable (RNF-32).

## Firmware, fabricación y OTA

El firmware es genérico; lo que hace único a cada nodo (identidad, credenciales, claves) vive en una partición NVS que se graba en fábrica. Eso permite construir un solo binario por versión y actualizarlo por OTA sin tocar la identidad.

**Estructura de `lympha-firmware`:**

```
lympha-firmware/
├── main/                     # arranque, máquina de estados
├── components/
│   ├── sensors/              # pH, temperatura, conductividad, turbidez, TDS + compensación
│   ├── provisioning/         # AP, DNS, portal cautivo, prueba de red
│   ├── link/                 # MQTT con TLS, LWT, contrato v1
│   ├── buffer/               # cola circular en LittleFS (24 h)
│   ├── led/                  # estados y semáforo local
│   └── ota/                  # descarga, verificación, confirmación
├── portal/                   # HTML del portal, empaquetado en la imagen
├── partitions.csv
└── test/                     # pruebas en host (Unity) de parsing y buffer
```

**Tabla de particiones (flash de 8 MB):**

| Partición | Tipo | Contenido |
| --- | --- | --- |
| `nvs` | data | Configuración que cambia: red WiFi, calibración |
| `nvs_keys` | data | Llaves de cifrado de NVS |
| `identity` | data (NVS, solo lectura en operación) | `device_id`, usuario y contraseña MQTT, clave del AP, URL del broker, certificado CA |
| `otadata` | data | Qué partición arranca |
| `ota_0`, `ota_1` | app | Dos copias del firmware para OTA con rollback |
| `storage` | data (LittleFS) | Buffer de lecturas sin conexión |

**Fabricación de un lote** (`pnpm factory lote --cantidad 20`):

1. Por cada nodo genera `deviceId` (UUIDv7), contraseña MQTT, clave del AP y código de reclamo.
2. Registra el lote y los nodos en Postgres (estado Fabricado, solo el hash del código) y crea cada cliente en Dynamic Security con su rol y ACL.
3. Genera la imagen de la partición `identity` con `nvs_partition_gen`, cifrada.
4. Graba firmware e identidad con `esptool`; en producción, activa secure boot v2 y flash encryption en modo release.
5. Corre un autodiagnóstico: lectura de los cinco sensores, escaneo WiFi y conexión al broker de staging.
6. Imprime la etiqueta con los dos QR y el texto.

El manifiesto del lote que se guarda no incluye contraseñas ni códigos en claro: esos solo existen en el nodo y en su etiqueta.

**Llave de firma:** secure boot v2 exige firmar cada imagen. Para el MVP la firma se hace a mano en tu equipo, con la llave guardada cifrada en dos lugares separados. Si se pierde, los nodos ya vendidos no pueden recibir actualizaciones.

**Actualización OTA (RF-16, RNF-30):**

1. El binario firmado se sube a `lympha-firmware` en S3 y se registra la versión en la consola interna.
2. El servidor publica en `cmd` `{"op":"ota","url":<URL prefirmada>,"sha256":"...","version":"1.1.0"}`.
3. El nodo descarga por HTTPS, verifica hash y firma, escribe en la partición libre y reinicia.
4. El nuevo firmware tiene 5 min para conectarse al broker y confirmarse; si no, el bootloader vuelve a la versión anterior.
5. Despliegue gradual: 5 % de la flota, luego 25 % y 100 %, avanzando solo si los nodos actualizados siguen en línea y publicando.

**CI del firmware:** GitHub Actions con la imagen oficial de ESP-IDF compila cada PR y corre las pruebas en host; la firma y la publicación quedan fuera de CI.

## Plan de construcción

Siete hitos en unas 16 semanas de trabajo de una persona. Cada hito termina desplegado en producción detrás de su criterio de salida, aunque todavía no haya clientes. Las semanas son una estimación inicial; el orden es lo que importa.

&#91;embedded content: calendario · 7 hitos en 16 semanas\]

| Hito | Entregables | Criterio de salida |
| --- | --- | --- |
| H0 Esqueleto (S1–2) | Repos, CI, Compose, staging y producción con dominio y TLS, proyectos de Firebase, migración inicial, `/health`, Sentry y logs, simulador mínimo | Un merge llega solo a staging y una etiqueta llega a producción; una lectura simulada es visible por la API |
| H1 Ingesta y datos (S3–4) | Modelo de datos completo, RLS y roles, espacios y membresías, verificación de Firebase, Dynamic Security, CLI de fábrica sin grabado, `ingest` con `PUBACK` tras encolar, hypertable y agregados, LWT | Pruebas de aislamiento en verde; reinicio forzado sin pérdida de lecturas; 100 nodos simulados estables |
| H2 Calidad y estado (S5–6) | Paquete `wqi` con perfil cisterna, ventanas e histéresis, evaluaciones, frases de causa y acción, confianza básica del sensor, SSE | Cada escenario del simulador produce el nivel esperado sin parpadeo |
| H3 Alarmas y Telegram (S7–8) | Ciclo de vida de alarmas, outbox, `notifier`, vinculación por deep link, alarma de desconexión, recordatorios | Aviso en menos de 60 s (p95); cero duplicados con reintentos forzados |
| H4 PWA (S9–11) | Acceso con Firebase, espacios, reclamo, inicio con semáforo, detalle, historial de 7 y 30 días, alertas, ajustes de Telegram | End-to-end en verde; 3 personas completan el flujo sin ayuda |
| H5 Firmware y alta (S12–14) | Sensores, portal cautivo, contrato MQTT, buffer, LED, OTA con rollback, fábrica completa con grabado y etiqueta | 5 nodos reales 7 días seguidos en staging; 5 personas instalan en menos de 5 min |
| H6 Beta cerrada (S15–16) | Prueba de carga con 1,000 nodos, restauración de respaldo, runbooks, aviso de privacidad y términos, 10 nodos con clientes beta | Checklist de salida a producción completa |

**Primera semana:**

- [ ] Crear los repositorios y proteger `main` (PR obligatorio, pipeline en verde).
- [ ] Comprar el dominio, crear los dos servidores y correr el script de preparación.
- [ ] Crear los proyectos de Firebase (dev, staging, prod) y un bot de Telegram por entorno.
- [ ] Montar el monorepo: pnpm, TypeScript estricto, Biome, Vitest.
- [ ] Escribir el Compose de desarrollo con Postgres + Timescale, Valkey y Mosquitto con Dynamic Security.
- [ ] Levantar `api` con `/health` e `ingest` suscrito a `lympha/v1/d/+/telemetry`.
- [ ] Escribir el simulador mínimo: un nodo, una lectura por minuto.
- [ ] Escribir `ci.yml` y `deploy-staging.yml`; conectar Sentry y el envío de logs.

## Salida a producción y decisiones pendientes

Ningún cliente externo entra hasta que esta lista esté completa; la beta cerrada (H6) existe para cerrarla con usuarios reales pero pocos.

**Checklist de salida a producción:**

- [ ] Todos los requisitos Must implementados y con prueba.
- [ ] Prueba de carga con 1,000 nodos simulados cumpliendo RNF-14, RNF-15 y RNF-17.
- [ ] Restauración completa desde respaldo en staging, cronometrada en menos de 4 h (RNF-13).
- [ ] Reinicio forzado de cada proceso sin perder lecturas (RNF-11).
- [ ] Alertas internas probadas: cada una se disparó al menos una vez a propósito.
- [ ] Los 7 runbooks escritos y uno ensayado de principio a fin.
- [ ] Checklist de seguridad completa; escaneo de vulnerabilidades sin hallazgos altos.
- [ ] OTA probada en 5 nodos reales, incluido un rollback provocado.
- [ ] Llave de firma del firmware respaldada en dos lugares.
- [ ] Aviso de privacidad y términos publicados; textos revisados contra RNF-32.
- [ ] Instalación probada con 5 personas sin experiencia (RNF-18).
- [ ] Consulta de propiedad intelectual con la BUAP resuelta.

**Decisiones pendientes antes de H0:**

| Decisión | Opciones | Qué la define |
| --- | --- | --- |
| Proveedor de servidores | Hetzner, DigitalOcean, AWS Lightsail u otro con región en Norteamérica | Latencia desde México, almacenamiento S3 compatible incluido, precio |
| Dominio | `lympha.app` u otro disponible | Disponibilidad y marca |
| Logs y métricas | Grafana Cloud (gestionado) o Prometheus y Loki propios | Límites del nivel gratuito frente a la memoria del servidor |
| Monitor externo | Cualquier servicio con chequeo HTTP y TCP cada minuto | Precio y alertas por Telegram |
| Hardware del sensor de pH y turbidez | Sondas actuales del nodo de Kanan u otras | Exactitud de RNF-23 y costo por nodo |

**Cambios que este plan introduce en el documento de arquitectura:** Valkey reemplaza a Redis por licencia, y el pipeline agrega la regla expand/contract para las migraciones.
