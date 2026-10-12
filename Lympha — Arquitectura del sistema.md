# Lympha — Arquitectura del sistema

Oct 10, 2026 · @Jesus AQ

## Resumen

Lympha se construye como un **monolito modular en TypeScript con cuatro procesos**, sobre **PostgreSQL con TimescaleDB** como única base de datos, **Redis** para colas y estado volátil, y **Mosquitto con Dynamic Security** como broker MQTT. Esta arquitectura cubre los 24 requisitos Must del documento de requisitos de Lympha y escala a 10,000 nodos sin cambios estructurales.

Decisiones principales:

1. **Un repositorio, cuatro procesos:** `api`, `ingest`, `worker` y `notifier` comparten código y se despliegan por separado. No hay microservicios.
2. **Una sola base de datos:** telemetría, índices, alarmas y usuarios viven en Postgres, así el aislamiento por inquilino (RLS) se aplica en un solo lugar.
3. **El nodo tiene identidad propia desde fábrica:** credencial MQTT única y código de reclamo en un QR. El cliente solo reclama.
4. **Las alarmas tienen ciclo de vida:** se abren, escalan y se cierran; Telegram se notifica en cada transición, nunca por lectura.
5. **El motor WQI es una librería pura y versionada:** sin E/S, con pruebas de referencia, y cada resultado guarda la versión que lo calculó.
6. **WiFi por punto de acceso del nodo:** la configuración se hace desde el navegador del teléfono, sin app nativa.

La identidad completa (registro, verificación de correo, inicio de sesión, Google, recuperación de contraseña y renovación de tokens) se delega a **Firebase Authentication** durante el MVP. Lympha no guarda contraseñas ni maneja sesiones: solo verifica el token de Firebase en cada petición, y toda la UI de acceso es propia.

## Drivers de arquitectura

Ocho requisitos determinan la forma del sistema; el resto se atiende dentro de los módulos sin afectar la estructura.

| Requisito | Qué exige | Cómo lo atiende la arquitectura |
| --- | --- | --- |
| RNF-01 Aislamiento | Cero fugas entre espacios | RLS en Postgres con contexto por transacción; tiempo real por canales autorizados al suscribirse |
| RNF-11 Sin pérdida de lecturas | Ninguna lectura se pierde al caer un proceso | QoS 1 con sesión persistente en el broker; el `PUBACK` se envía solo después de encolar; escritura idempotente |
| RNF-12 Operación sin internet | 24 h de buffer en el nodo | Cola circular en flash del ESP32; reenvío con su hora original al reconectar |
| RF-21 / RF-30 Estado estable y sin alertas repetidas | Sin parpadeo ni spam | Ventana móvil con histéresis en el worker; alarma única activa por nodo y tipo |
| RF-29 Aviso de desconexión | Detectar nodos caídos | Last Will de MQTT más un trabajo diferido que se cancela si el nodo vuelve |
| RNF-24 WQI determinista | Mismo dato, mismo resultado | Librería pura `@lympha/wqi` con versión guardada en cada evaluación |
| RF-10 / RNF-03 Identidad del nodo | Alta en minutos y credencial revocable | Registro de fábrica, credencial única en el broker y reclamo por QR |
| RNF-17 Capacidad | 1,000 nodos, ruta a 10,000 | Ingesta por lotes a una hypertable; los procesos escalan horizontalmente con suscripciones compartidas |

## Vista de contenedores

&#91;embedded content: contenedores · 2 entradas, 4 procesos, 3 almacenes\]

Los nodos solo entran por el broker y las personas solo por Caddy; los cuatro procesos comparten código y todos escriben en el mismo Postgres, donde RLS aísla a cada espacio. Telegram recibe los avisos desde `notifier` y entrega los mensajes del bot a `api` por webhook.

## Flujo de una lectura

&#91;embedded content: secuencia de una lectura · 8 participantes, 11 pasos\]

El `PUBACK` sale solo cuando la lectura ya está en la cola, así una caída de `ingest` no la pierde: el broker la reentrega. La lectura se guarda con `ON CONFLICT DO NOTHING` sobre `(nodo_id, ts)`, de modo que los reintentos no duplican. La alarma y su aviso se escriben en la misma transacción, y solo cuando el nivel cambia de forma sostenida; `notifier` envía después lo que encuentra en la bandeja de salida y lo marca como enviado. El estado publicado en Redis llega a la app por SSE.

## Módulos de dominio y repositorio

El código se organiza por dominio, no por capa técnica: cada módulo es dueño de sus tablas y solo expone funciones a los demás, nunca acceso directo a sus datos.

| Módulo | Responsabilidad | Requisitos |
| --- | --- | --- |
| `identidad` | Verificar el token de Firebase Auth, crear el perfil local en la primera petición y borrar los datos y la cuenta cuando el usuario la elimina | RF-01 a RF-05 |
| `espacios` | Espacios, membresías, roles, invitaciones | RF-06 a RF-09 |
| `dispositivos` | Registro de fábrica, reclamo, perfiles de uso, estado de conexión, atributos, comandos al nodo, OTA | RF-10 a RF-16, RF-45 a RF-48 |
| `telemetria` | Ingesta, almacenamiento, agregados por hora y día, último valor | RF-24, RF-35, RF-36 |
| `calidad` | Ventanas, WQI, nivel del semáforo, frase de causa y acción, confianza del sensor | RF-17 a RF-23, RF-39 |
| `alarmas` | Reglas por perfil, ciclo de vida, atención, historial | RF-28 a RF-32 |
| `notificaciones` | Vinculación de Telegram, preferencias, horario silencioso, envío por canal | RF-26, RF-27, RF-31, RF-33, RF-34 |
| `calibracion` | Sesiones guiadas, eficiencia de pendiente, recomendaciones de reemplazo | RF-40 a RF-42 |
| `eventos` | Eventos del usuario (cambio de filtro) y comparación antes/después | RF-37 |
| `mapa` | Consentimiento, ubicación reducida, agregados por zona | RF-43, RF-44 |

Estructura del repositorio (monorepo con pnpm workspaces):

```
lympha/
├── apps/
│   ├── server/            # un solo paquete, cuatro entrypoints
│   │   └── src/
│   │       ├── modules/   # identidad, espacios, dispositivos, telemetria, calidad, ...
│   │       ├── platform/  # db (contexto RLS), redis, mqtt, colas, sse, logger, config
│   │       └── main/      # api.ts · ingest.ts · worker.ts · notifier.ts
│   └── web/               # PWA (React + Vite)
├── packages/
│   ├── wqi/               # motor WQI puro, versionado, con pruebas de referencia
│   └── contracts/         # esquemas Zod: payloads MQTT y API, compartidos con la web
├── tools/
│   └── factory/           # CLI de registro de lotes, credenciales y QR
└── infra/                 # docker-compose, Caddy, Mosquitto, migraciones
```

El firmware vive en un repositorio aparte porque tiene otro ciclo de vida, otra toolchain y otro calendario de versiones; comparte con el servidor solo el contrato MQTT versionado.

## Modelo de datos

Todo lo que pertenece a un cliente cuelga de `espacio_id`, y esa columna es la que usa RLS. Los nodos sin reclamar (`espacio_id` nulo) no generan datos visibles para nadie.

| Entidad | Almacén | Clave de inquilino | Notas |
| --- | --- | --- | --- |
| `usuarios` | Postgres | — | Perfil local ligado al uid de Firebase (auth\_uid único), creado en la primera petición autenticada; sin contraseñas ni sesiones locales |
| `espacios`, `membresias`, `invitaciones` | Postgres | `espacio_id` | Rol por membresía: propietario o miembro |
| `lotes`, `nodos` | Postgres | `espacio_id` (nulo si no está reclamado) | Hash del código de reclamo, perfil, versión de firmware |
| `perfiles_uso` | Postgres | global | Curvas, pesos y reglas de alarma en JSONB, con versión |
| `lecturas` | Postgres (hypertable) | `espacio_id` | Clave única `(nodo_id, ts)` para ingesta idempotente |
| `evaluaciones` | Postgres (hypertable) | `espacio_id` | WQI, nivel, parámetro limitante, confianza y versión del algoritmo |
| `lecturas_hora`, `lecturas_dia` | Postgres (agregados continuos) | `espacio_id` | Promedio, mínimo, máximo y nivel predominante |
| `estado_nodo` | Postgres + caché en Redis | `espacio_id` | Conexión, última lectura, nivel actual; Redis sirve la pantalla de inicio |
| `alarmas` | Postgres | `espacio_id` | Índice único parcial: una alarma activa por `(nodo_id, tipo)` |
| `notificaciones_salida` | Postgres | `espacio_id` | Bandeja de salida (outbox) escrita en la misma transacción que la alarma |
| `vinculos_telegram`, `preferencias_notificacion` | Postgres | por usuario | `chat_id`, horario silencioso, nodos y niveles |
| `calibraciones`, `eventos_usuario` | Postgres | `espacio_id` | Pendiente, offset y eficiencia; eventos como cambio de filtro |
| `auditoria` | Postgres | `espacio_id` | Acciones sensibles, retención de 12 meses |

Retención: las lecturas crudas se conservan 30 días, comprimidas a partir del día 2; los agregados por hora 12 meses; los agregados por día, sin límite.

Volumen esperado con 1,000 nodos a una lectura por minuto: 1.44 millones de filas al día y unos 43 millones en la ventana de 30 días, una carga holgada para una instancia de Postgres con Timescale.

## Contrato nodo–servidor y ciclo de vida

El nodo solo puede publicar y suscribirse bajo su propio prefijo `lympha/v1/d/{deviceId}/#`; el ACL del broker lo garantiza. Cada payload lleva el campo `v` con la versión del esquema, y el servidor acepta las dos versiones anteriores (RNF-29).

```
lympha/v1/d/{deviceId}/telemetry    nodo → servidor   QoS 1   {"v":1,"ts":1760150400,"seq":1832,"ph":7.12,"t":22.4,"ec":480,"turb":0.8,"tds":310}
lympha/v1/d/{deviceId}/attributes   nodo → servidor   QoS 1   {"v":1,"fw":"1.0.3","rssi":-61,"buffered":0,"cal":{"ph_slope":0.97,"ph_offset":-0.04}}
lympha/v1/d/{deviceId}/status       Last Will         QoS 1   "online" | "offline"   (retenido)
lympha/v1/d/{deviceId}/config       servidor → nodo   QoS 1   intervalo, parámetros de calibración, umbrales del LED   (retenido)
lympha/v1/d/{deviceId}/cmd          servidor → nodo   QoS 1   {"id":"...","op":"calibrate"|"reboot"|"ota","args":{...}}
lympha/v1/d/{deviceId}/cmd/ack      nodo → servidor   QoS 1   {"id":"...","ok":true,"detail":"..."}
```

Reglas del contrato:

- `ts` es la hora del nodo sincronizada por NTP; `seq` es un contador monótono que permite detectar huecos y duplicados.
- Las lecturas guardadas sin conexión se reenvían con su `ts` original, en orden, a ritmo limitado.
- `deviceId` es un identificador opaco (UUIDv7) impreso en el QR junto con el código de reclamo; no es la MAC.
- La configuración se publica retenida, así un nodo que se reinicia la recibe al reconectar sin pedirla.

Estados del nodo:

| Estado | Entra cuando | Sale cuando | Qué ve el cliente |
| --- | --- | --- | --- |
| Fabricado | El CLI de fábrica lo registra con credencial y código de reclamo | Un usuario lo reclama | Nada |
| Reclamado | El usuario escanea el QR y lo asigna a un espacio | Llega la primera lectura | "Esperando primera lectura" |
| En línea | Llega una lectura o el broker publica `online` | El Last Will publica `offline` | Semáforo con su nivel |
| Sin conexión | El broker publica `offline` | Vuelve `online` | Gris, "Sin datos desde …"; alarma tras el tiempo configurado |
| Desvinculado | El propietario lo libera | Otro usuario lo reclama | Desaparece del espacio anterior; sus datos quedan con ese espacio |
| Revocado | El equipo revoca su credencial o su lote | Se vuelve a dar de alta en fábrica | "Dispositivo deshabilitado" |

## Seguridad y aislamiento

El aislamiento no depende de que cada consulta recuerde filtrar: Postgres rechaza las filas ajenas aunque el código olvide el `WHERE`.

**Roles de base de datos:**

| Rol | Usado por | Acceso |
| --- | --- | --- |
| `lympha_owner` | Solo migraciones | Dueño del esquema; nunca lo usa un proceso en ejecución |
| `lympha_app` | `api` | Sujeto a RLS con `FORCE ROW LEVEL SECURITY`; ve solo los espacios del usuario de la petición |
| `lympha_system` | `ingest`, `worker`, `notifier` | Permisos mínimos por tabla; escribe datos de nodos sin pasar por el contexto de usuario |

**Autenticación (MVP):** la PWA usa solo el SDK de Firebase Auth, sin componentes de UI prefabricados; todas las pantallas de acceso son propias. Cada petición lleva `Authorization: Bearer <idToken>` (vida de 1 h, renovado por el SDK); `api` lo verifica con `firebase-admin`, exige correo verificado y traduce el `uid` al `usuarios.id` interno, creando el perfil en la primera petición. El stream SSE se abre con `fetch` en streaming porque `EventSource` no admite cabeceras. Al cerrar sesión o borrar la cuenta se revocan los refresh tokens, y las rutas sensibles (desvincular nodo, cambiar roles, borrar cuenta) verifican la revocación.

**Alcance de Firebase Auth:** solo cubre a las personas. La identidad de los nodos sigue siendo de Lympha (credencial en Dynamic Security y reclamo por QR), y la autorización por espacio sigue en Postgres con RLS: Firebase dice quién es el usuario, Lympha decide qué puede ver. Las cuentas se almacenan en la infraestructura de Google fuera de México, así que el aviso de privacidad debe declarar esa transferencia (RNF-07). Si después del MVP se cambia de proveedor, solo cambian la verificación del token y la exportación de usuarios.

**Contexto por petición:** toda consulta de la API corre dentro de una transacción que primero ejecuta `set_config('app.usuario_id', $1, true)`. Las políticas comparan `espacio_id` contra las membresías de ese usuario, con `USING` para leer y `WITH CHECK` para escribir.

**Tiempo real:** el cliente se conecta por Server-Sent Events a `/api/stream?espacio=<id>`. El servidor verifica la membresía antes de abrir el flujo y solo reenvía eventos publicados en el canal Redis de ese espacio.

**Nodos:**

- Credencial única por nodo en Dynamic Security; el ACL limita el nodo a su prefijo.
- Revocar un nodo o un lote es borrar o deshabilitar sus clientes en el broker, efectivo en segundos (RNF-03).
- El código de reclamo se guarda como hash; el reclamo tiene límite de intentos por usuario y por nodo.
- TLS en el puerto 8883; el puerto 1883 no se expone a internet.

**Pruebas de aislamiento en CI:** por cada endpoint y canal, un usuario de otro espacio intenta leer, escribir y suscribirse, y debe recibir 404. Si una ruta nueva no tiene su prueba, el pipeline falla.

**Superficie expuesta:** solo Caddy (443) y Mosquitto (8883). Postgres, Redis y la API administrativa del broker quedan en red interna.

## Decisiones y alternativas

Cada decisión favorece lo que un equipo de una persona puede operar y depurar, por encima del máximo rendimiento teórico.

| # | Decisión | Alternativas descartadas | Por qué |
| --- | --- | --- | --- |
| D1 | Monolito modular con 4 procesos | Microservicios; un solo proceso | Los microservicios multiplican la operación sin beneficio a esta escala. Un proceso único mezcla la ingesta con la API |
| D2 | Node.js 22 + TypeScript + Fastify | Express 5 en JS; NestJS | Fastify valida con esquemas y genera OpenAPI; TypeScript atrapa errores de inquilino. NestJS agrega capas innecesarias |
| D3 | Postgres 16 + TimescaleDB | Postgres + MongoDB; InfluxDB | Un solo motor permite RLS, JOIN y un solo respaldo. Mongo duplicaría el aislamiento |
| D4 | Drizzle ORM con SQL explícito | Prisma; Mongoose | Control de transacciones para fijar el contexto RLS; migraciones en SQL legible |
| D5 | Mosquitto 2 + Dynamic Security | Archivo passwd + SIGHUP; EMQX; ThingsBoard | Alta de clientes por API sin acceso a Docker; sin licencias que cobren por dispositivo |
| D6 | BullMQ sobre Redis | Kafka; RabbitMQ; Redis Streams a mano | Ya conocido, con reintentos, trabajos diferidos y límites de tasa |
| D7 | Server-Sent Events + pub/sub de Redis | Socket.io | El flujo es solo servidor → cliente; SSE va sobre HTTP normal y el token se envía con fetch en streaming |
| D8 | Firebase Authentication, solo para el MVP | Sesiones propias; Clerk; Auth0; Supabase Auth; Ory Kratos | Cubre RF-01 a RF-04 sin código de identidad propio y sin UI de terceros: el SDK solo expone funciones. Gratis en el uso base. Clerk y Auth0 giran alrededor de sus componentes o su login hospedado; Ory Kratos habría que operarlo; el proyecto gratuito de Supabase se pausa por inactividad |
| D9 | Outbox para notificaciones | Enviar Telegram desde el worker | Alarma y aviso se guardan en la misma transacción: ni avisos perdidos ni duplicados por reintentos |
| D10 | WiFi por punto de acceso del nodo con portal cautivo | BLE con app nativa; Web Bluetooth | Funciona en cualquier teléfono sin instalar nada; Web Bluetooth no está en Safari de iOS |
| D11 | Telegram por webhook | Long polling | Un endpoint HTTPS ya existe; sin proceso extra |
| D12 | PWA (React + Vite) | App nativa; Flutter | Un solo código para móvil y escritorio; instalable; sin tiendas en el MVP |

## Despliegue y operación

El MVP corre completo en un solo servidor virtual con Docker Compose; la separación en procesos permite repartirlo en varias máquinas después sin cambiar código.

**Topología inicial:**

- Un VPS de 4 vCPU y 8 GB de RAM: Caddy, `api`, `ingest`, `worker`, `notifier`, Postgres + Timescale, Redis y Mosquitto.
- Caddy termina TLS en el 443 con certificados automáticos; Mosquitto usa certificados del mismo dominio en el 8883.
- Almacenamiento de objetos compatible con S3 para respaldos y binarios de firmware.
- Tres entornos: desarrollo local, pruebas y producción, cada uno con un solo comando (RNF-27).

**Capacidad:**

| Escala | Mensajes por segundo | Qué cambia |
| --- | --- | --- |
| 1,000 nodos | unos 17 | Nada; un solo servidor |
| 10,000 nodos | unos 167 | Postgres en su propio servidor; dos instancias de `ingest` y `worker` con suscripción compartida |
| Más de 10,000 | más de 167 | Broker en clúster o broker gestionado; réplicas de lectura; revisar la arquitectura |

**Respaldos:** volcado de Postgres diario y archivado continuo de WAL hacia almacenamiento de objetos, con restauración de prueba cada trimestre (RNF-13).

**Observabilidad:**

- Logs estructurados en JSON con `espacio_id`, `nodo_id` y un id de petición.
- Métricas: mensajes por segundo, latencia de la cola, alarmas abiertas, nodos en línea, errores de Telegram.
- Alertas internas: caída de ingesta de más de 50 % en 10 min (RNF-28), cola atascada, certificado próximo a vencer.

**Firmware:** OTA por HTTPS con partición de respaldo; si el firmware nuevo no se conecta al broker, el nodo vuelve a la versión anterior (RNF-30). Despliegue por porcentaje de la flota.

## Preguntas abiertas

La arquitectura resuelve la configuración del WiFi (D10) y deja abiertas cuatro preguntas que no cambian su forma, pero sí el trabajo dentro de los módulos.

- [ ] **Método WQI por perfil:** el motor admite cualquier método porque es una librería versionada; falta elegir y validar las curvas con un especialista.
- [ ] **Segmento inicial:** si es solo hogar, RF-07 y RF-08 (miembros) pueden esperar; si incluye negocios, entran al MVP.
- [ ] **Modelo de negocio:** define los límites por espacio y si hacen falta planes en el módulo `espacios`.
- [ ] **Cálculo del WQI en el nodo:** para el LED local (RF-25) el firmware necesita una versión simplificada del motor; hay que decidir si se porta a C++ o si el servidor envía umbrales precalculados por `config`.
- [ ] **Proveedor de VPS y región:** latencia desde México y dónde se almacenan los datos personales.
- [ ] **Identidad después del MVP:** decidir si Firebase Auth se queda o se migra (Supabase Auth, Ory Kratos); migrar exige exportar los usuarios con sus hashes.

## Fuentes

- [Firebase Authentication: niveles e Identity Platform](https://firebase.google.com/docs/auth/)
- [Supabase: límites del plan gratuito y pausa por inactividad](https://makerkit.dev/blog/saas/supabase-pricing)
- [Ory Kratos: servidor de identidad headless](https://docs.wakemeops.com/packages/kratos/)
