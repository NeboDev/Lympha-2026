# Atl — Arquitectura y system design

> Nombre de trabajo: **Atl** («agua» en náhuatl). Se cambia en un solo lugar (`server/config/marca.json`).
> Hackathon Puebla 2026 · 19-nov-2026 · reto oficial: **«Sistema inteligente para la cloración y monitoreo de la calidad del agua»** (tres ejes: instrumentación, automatización, monitoreo).
> Estado: **diseño, nada de esto está construido ni probado todavía.** Lo que dependa de hardware o de APIs de terceros está marcado «VERIFICAR».

## 1. Qué es y qué no es

**Atl** convierte la lectura de un sensor de agua en tres cosas útiles para una comunidad (escuela, comité de agua, cisterna compartida, hogar):

1. **Vigilancia continua** con Blynk (tiempo real, app móvil, alarma local sin red).
2. **Memoria confiable**: cada lectura, calibración, alarma y acción queda en MongoDB, con trazabilidad.
3. **Un reporte entendible** (PDF con base en NOM-127-SSA1-2021) y avisos por Telegram en lenguaje sencillo, con «qué hacer».

Enfoque **humanista, no comercial**: el producto existe para que una comunidad sepa qué pasa con su agua y pueda actuar, y para que tenga un documento que entregar a la autoridad. No hay planes, precios ni «hardware como servicio» en el producto (a lo sumo una diapositiva de sostenibilidad).

**No es** una certificación. Un sensor de pH no demuestra el cumplimiento de la NOM-127, que exige varios parámetros y muestreo de laboratorio. Reglas de redacción (heredadas de Lympha, RNF-32): **nunca** «potable» ni «seguro»; el reporte dice «pH dentro/fuera del rango de la NOM-127» y lista lo que **no** se midió.

## 2. Principio de diseño que manda: «el reto se revela el jueves»

No sabemos qué sensor habrá (suponemos **pH**; el cloro residual está descartado por ahora). La arquitectura se construye para que cambiar de sensor o de enfoque sea **configuración, no código**:

- **Catálogo de parámetros** (`server/config/parametros.json`): id, nombre, unidad, rango NOM, decimales, mapeo a pin virtual de Blynk, reglas de alarma. Agregar «ORP», «turbidez» o «cloro» = agregar una entrada.
- **Muestras con esquema flexible** en Mongo: `v: { ph: 7.1, orp: 650 }`. Sin migraciones.
- **Reglas de evaluación por parámetro** (datos, no `if`s): rango, histéresis, tasa de cambio, estabilidad.
- **Reporte generado desde el catálogo**: las tablas de estadísticas salen de los parámetros que el nodo mide; los demás se listan como «no medidos».
- Lo que sí es específico de pH queda aislado en un módulo (`dominio/ph.ts`: Nernst, calibración de 2 puntos, fracción de HOCl).

Ver la tabla de adaptación en §11.

## 3. Vista general

```
┌─────────────────────── CAMPO ───────────────────────┐
│ Sonda pH → XN03 (ADC I²C) → ESP32-S3 (XC01 R5)       │
│   · supermuestreo + media móvil + calibración 2 pts  │
│   · compensación de temperatura, validación          │
│   · ALARMA LOCAL (buzzer XN44 + relevador XN13)      │  ← funciona sin red
│   · enclavamientos de seguridad del actuador         │
└───────────────┬─────────────────────────────────────┘
                │ WiFi (LTE con XC03 solo como extra)
                ▼
        ┌───────────────┐   eventos/alarmas de Blynk (push al teléfono)
        │  BLYNK CLOUD  │──────────────────────────────► App Blynk (vigilancia en vivo,
        │  datastreams  │                                  botón de bomba, semáforo)
        └───────┬───────┘
                │ HTTP API (polling cada 5–30 s, token por nodo)
                ▼
┌──────────────────────────── SERVIDOR ATL (Node 24 + Fastify) ───────────────────────────┐
│ ingesta ─► evaluación ─► alertas ─► Telegram (bot, long polling)                          │
│    │           │            └─► eventos                                                   │
│    ▼           ▼                                                                          │
│  MongoDB (Atlas; local en Docker como plan B)                                             │
│    ▲                                                                                      │
│  api REST ◄── sesión Google (Firebase Auth) ── PWA/Web "Atl"                              │
│  reportes PDF (pdfkit) ◄── /reporte en Telegram · botón en la web                         │
│  control ─► escribe el pin del actuador en Blynk (con confirmación humana)                │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

**Por qué dos capas (Blynk + base propia):** Blynk es excelente para ver y accionar en vivo, pero (a) el histórico del plan gratuito es corto (VERIFICAR límites), (b) no guarda calibraciones, acciones humanas ni alarmas con contexto, y (c) un reporte de cumplimiento necesita datos que no se pierdan. Blynk es la **capa de tiempo real**; Mongo es el **registro permanente y la fuente del reporte**.

**Por qué Mongo Atlas:** documentos con forma variable (parámetros que cambian el jueves), sin migraciones, y encaja con la lectura JSON de Blynk. Riesgos: necesita internet y el Wi-Fi del recinto es una incógnita. **Plan B:** `MONGODB_URI` apunta a un Mongo local en Docker; el código es idéntico. No usar la «Atlas Data API» (descontinuada); usar el driver oficial.

## 4. Componentes

### 4.1 Firmware (ESP32-S3, Arduino «ESP32S3 Dev Module»)
Base: el boceto de pH ya hecho (ver `docs/contexto-hackathon.md`, copia del contexto). Pipeline: XN03 → supermuestreo (N=64) → media móvil (M=10) → mV → pH (calibración de 2 puntos buffers 4 y 7, guardada en NVS) → compensación Nernst por temperatura → validación (0–14, sensor desconectado por lecturas pegadas a los rieles) → estado → Blynk.

Datastreams propuestos (el mapeo real vive en el catálogo; **crearlos con el MCP de Blynk**, ver §10):

| Pin | Nombre | Tipo | Notas |
|---|---|---|---|
| V0 | led_ejemplo | int | del ejemplo oficial; se puede dejar |
| V1 | temperatura | double °C | si no hay sensor, valor fijo y bandera |
| V2 | ph | double | pH ya calibrado y filtrado |
| V3 | mv | double | milivoltios (diagnóstico) |
| V4 | estado | int | 0 ok · 1 atención · 2 fuera de rango · 3 error de sensor |
| V5 | estable | int | 1 = lectura estable, 0 = estabilizando |
| V6 | seq | int | contador por muestra; el servidor lo usa para detectar nodo detenido |
| V7 | ph_crudo | double | sin filtrar (para mostrar «crudo vs. filtrado») |
| V8 | bomba | int | 1/0, relevador XN13 (actuador) |
| V9 | modo | int | 0 manual · 1 automático con enclavamientos |
| V10 | cal_pct | double | pendiente de la sonda como % de Nernst (diagnóstico) |

Comandos serial (`c4`, `c7`, `s`, `r`) se conservan para calibrar frente al jurado.

**Alarma local sin red:** buzzer + relevador por histéresis en el rango 6.5–8.5. Todo lo de seguridad del actuador se decide **en el firmware**, nunca solo en la nube (§6).

### 4.2 Blynk
- Una **plantilla** `Atl-Nodo` con los datastreams anteriores y un **dispositivo por nodo** con su Auth Token. Ejemplo oficial de la capacitación: `Hackathon_example_blynk`.
- **Eventos** de Blynk (`ph_fuera_de_rango`, `sensor_error`) para notificación push inmediata al teléfono. Son un complemento; el aviso «bueno» sale de Atl por Telegram.
- La app de Blynk es el **tablero en vivo** de la demo (gauge de pH, botón de bomba). La web de Atl no compite con eso: aporta historia, reportes y bitácora.

### 4.3 Servidor (un proceso, módulos con fronteras claras)
Stack: **Node 24** (ejecuta TypeScript directo, sin build, como Lympha), **Fastify 5** + `zod` para validar toda entrada, driver `mongodb`, `firebase-admin` solo para verificar tokens, `pdfkit` para PDF. Telegram con `fetch` contra la Bot API (long polling `getUpdates`): ~100 líneas, sin librería. Sin Postgres, Timescale, MQTT, BullMQ ni Valkey: sobran para 6 horas.

```
server/src/
  main.ts                 arranque: config → mongo → módulos → fastify
  config.ts               variables de entorno validadas con zod (si falta una, no arranca)
  modulos/
    auth/                 verificación del token de Firebase; plugin de Fastify
    comunidades/          comunidades, miembros, roles
    nodos/                alta de nodo, vinculación con Blynk (valida token), mapeo de pines
    ingesta/              poller de Blynk → muestras
    evaluacion/           reglas por parámetro → estado + eventos (puro, sin I/O)
    alertas/              abre/cierra alertas, recordatorios, decide a quién avisar
    telegram/             bot: /start <token>, /estado, /reporte, /ayuda, botones inline
    control/              escribe actuador en Blynk, con confirmación y registro
    reportes/             agregación + PDF (reusa el diseño de Kanan)
    bitacora/             notas humanas («se lavó el tinaco») que entran al reporte
    api/                  rutas REST para la web
  dominio/
    ph.ts                 Nernst, calibración 2 puntos, % de pendiente, fracción HOCl
    catalogo.ts           lee parametros.json
    frases.ts             textos humanos de avisos (sin «potable» ni «seguro»)
  plataforma/
    mongo.ts · blynk.ts · telegram-api.ts · cifrado.ts · logger.ts
web/                      PWA (Vite + React), 4 pantallas (§8)
firmware/                 sketch Arduino + README de calibración
design/                   tokens, logo, paleta
```

Regla: cada módulo expone `index.ts`; nadie importa archivos internos de otro módulo. `evaluacion/` y `dominio/` son **funciones puras con pruebas**; todo el I/O vive en `plataforma/`.

### 4.4 Web (PWA)
Vite + React + CSS con los tokens de `design/tokens.css` (sin librería de componentes). Cuatro pantallas: **Entrar** (Google), **Mi agua** (semáforo + gráfica + estado del nodo), **Reportes** (elegir periodo → PDF), **Comunidad** (vincular Blynk, vincular Telegram, miembros, bitácora). Detalle en `IDENTIDAD_VISUAL.md`.

## 5. Flujos de datos

### 5.1 Ingesta (Blynk → Mongo)
1. Cada `POLL_MS` (5 s en la demo, 30 s «en producción») el poller pide a Blynk los valores del nodo: `GET https://{BLYNK_HOST}/external/api/getAll?token=…` (VERIFICAR forma de la respuesta con `curl` en el Paso 0).
2. Si `seq` (V6) **no cambió** desde la última vez → el nodo está detenido: no se inserta muestra; tras `SIN_DATOS_S` se abre alerta «sin conexión».
3. Si cambió → se arma `{ nodo_id, ts: ahora, v: {ph, mv, temp…}, estado, seq }`, se inserta y se actualiza `nodos.ultimo`.
4. `evaluacion.evaluar(nodo, ventana)` decide estado y eventos; `alertas` abre/cierra y encola avisos.

Limitaciones honestas: (a) `ts` es la hora del poll, no la de la medición (Blynk no da marca de tiempo en `get`); es aceptable a 5–30 s. (b) Si el nodo pierde WiFi, las muestras de ese lapso **no se recuperan** por Blynk: el reporte muestra el hueco y la **cobertura de datos %** en vez de esconderlo. (c) Mejora opcional (fase 2): `POST /api/ingesta/lotes` con clave por nodo para que el firmware reenvíe lo almacenado al reconectar.

### 5.2 Alertas
Reglas por parámetro (datos en el catálogo), evaluadas sobre una ventana:

| Estado | Condición (pH, configurables) | Palabra |
|---|---|---|
| `en_rango` | 6.5 ≤ pH ≤ 8.5 y estable | «En rango» |
| `atencion` | a ≤ 0.3 de un límite **o** cambio > 0.5 pH en 5 min (aunque siga en rango: posible evento de contaminación) | «Atención» |
| `fuera_de_rango` | fuera de 6.5–8.5 | «Fuera de rango» |
| `critico` | fuera por más de 1.0 pH (< 5.5 o > 9.5) | «Crítico» |
| `revisar_sensor` | lecturas pegadas a rieles, sin cambio imposible, o calibración con pendiente < 85 % de Nernst | «Revisar sensor» |
| `sin_datos` | sin `seq` nuevo por `SIN_DATOS_S` | «Sin conexión» |

Histéresis: se entra a un estado tras `N` lecturas consecutivas y se sale con margen (p. ej. 0.1 pH), para que no parpadee. Los umbrales 0.3 / 0.5 / 1.0 / 85 % son **criterio del equipo, no de la norma**; se dicen así en el reporte.
Ciclo de vida de una alerta: `abierta → (recordatorio cada X min) → cerrada`. Un aviso por **transición**, no por lectura. Cierres solo a quien ya fue avisado. Textos en `dominio/frases.ts`.

### 5.3 Telegram
- **Vinculación (patrón de Lympha):** en la web, «Vincular Telegram» crea un `vinculos_pendientes` con token de un solo uso (expira en 10 min) → enlace `https://t.me/<bot>?start=<token>` (para un **grupo**: `?startgroup=<token>`) → el bot recibe `/start <token>`, lo canjea y guarda `chat_id` en la comunidad. **Una comunidad = un grupo**: el aviso llega a todas las familias, no solo a un dueño.
- Comandos: `/estado` (última lectura en palabras), `/reporte [días]` (PDF), `/ayuda`, `/desvincular`.
- Botones inline para acciones sensibles (§6): «Confirmar dosis» / «No, esperar».
- Fallos de envío se reintentan con retardo; el aviso queda en `eventos` aunque Telegram falle.

### 5.4 Control del actuador
Atl **no** manda dosificar por su cuenta. Flujo: evaluación sugiere → Telegram/web pide confirmación a un responsable → `control` escribe V8 en Blynk (`GET …/update?token=…&v8=1`) y registra quién, cuándo y por qué. El firmware **valida y puede rechazar** (§6).

### 5.5 Reportes
`reportes.generar({ nodo_id, desde, hasta, generado_por })` → agrega `muestras`, `eventos`, `calibraciones`, `bitacora` → PDF (carta). Contenido y diseño en `IDENTIDAD_VISUAL.md` §7. Se dispara desde la web, `/reporte` y, opcionalmente, un datastream de Blynk (botón) que el poller detecta. Se guarda el resumen y un **hash** del contenido en `reportes` para poder mostrar que el PDF no cambió.

## 6. Cloración: qué automatiza el sistema y qué no

El reto habla de **cloración**. Con solo pH no se puede medir cloro, pero **el pH decide qué tan efectivo es el cloro**: el cloro libre se reparte entre HOCl (desinfectante fuerte) y OCl⁻ (mucho más débil), y la fracción de HOCl cae al subir el pH:

`fracción_HOCl = 1 / (1 + 10^(pH − pKa))`, con `pKa(T) ≈ 3000/T − 10.0686 + 0.0253·T` (T en kelvin; ≈ 7.54 a 25 °C). *VERIFICAR la expresión con la fuente antes de citarla en el pitch.*

Valor: aunque no haya sensor de cloro, Atl puede decir en vivo «con este pH, ~X % del cloro libre es la forma efectiva», convirtiendo un pH en **información para la decisión de cloración** (el eje «monitoreo» del reto).

**Actuador (relevador XN13 = bomba/válvula de demostración):**
- Modo **manual**: botón en Blynk/Telegram con confirmación.
- Modo **automático = solo acciones seguras**: detener la dosificación y avisar cuando el pH sale de rango, o cuando el sensor falla, o cuando se pierde la comunicación. **Subir la dosis nunca es automático**: se recomienda y lo confirma una persona.
- **Enclavamientos en el firmware:** relevador apagado al arrancar; duración máxima por pulso (p. ej. 60 s) y enfriamiento entre pulsos; apagado si no hay datos válidos de pH; apagado si se pierde Blynk más de N s; prioridad de la orden local sobre la remota.
- Honestidad: sin sensor de cloro es **lazo abierto** respecto al cloro. Si el jueves aparece un sensor de cloro/ORP, se agrega al catálogo y el mismo esquema cierra el lazo.

## 7. Modelo de datos (MongoDB)

Base `atl`. IDs: `ObjectId` por defecto (en el hackathon no se necesita UUIDv7). Fechas en UTC (`Date`); `America/Mexico_City` solo al mostrar y al agrupar por día.

```jsonc
// usuarios
{ "_id", "google_uid": "…", "nombre": "…", "correo": "…", "creado": ISODate }

// comunidades   (equivalente a "espacio" de Lympha)
{ "_id", "nombre": "Primaria X", "tipo": "escuela|comite|hogar|otro",
  "miembros": [{ "uid": "…", "rol": "responsable|integrante" }],
  "telegram": { "chat_id": 123, "titulo": "Padres 3ºA", "vinculado": ISODate } | null,
  "creado": ISODate }

// nodos
{ "_id", "comunidad_id", "nombre": "Tinaco azotea", "ubicacion": { "texto": "…", "lat": 19.0, "lng": -98.2 },
  "blynk": { "host": "blynk.cloud", "token_cifrado": "…", "plantilla": "Atl-Nodo",
             "mapeo": { "ph": "v2", "mv": "v3", "temp": "v1", "estado": "v4", "seq": "v6", "bomba": "v8" } },
  "parametros": ["ph"],                         // ids del catálogo que este nodo mide
  "umbrales": { "ph": { "min": 6.5, "max": 8.5 } },   // por defecto vienen del catálogo
  "ultimo": { "ts": ISODate, "v": { "ph": 7.1 }, "estado": "en_rango", "seq": 1042 },
  "creado": ISODate }

// muestras      (índice { nodo_id: 1, ts: -1 }; único { nodo_id: 1, seq: 1 } si se usa seq)
{ "_id", "nodo_id", "ts": ISODate, "seq": 1042,
  "v": { "ph": 7.12, "mv": -2.1, "temp": 21.4 }, "crudo": { "ph": 7.31 },
  "estado": "en_rango", "estable": true }

// eventos       (índice { nodo_id: 1, ts: -1 }; { comunidad_id: 1, ts: -1 })
{ "_id", "nodo_id", "comunidad_id", "ts", "tipo": "alerta_abre|alerta_cierra|sin_datos|reconexion|calibracion|actuador|bitacora|reporte",
  "severidad": "info|atencion|alta", "parametro": "ph",
  "mensaje": "El pH bajó a 6.2 …", "datos": { … }, "autor_uid": "…|null" }

// calibraciones
{ "_id", "nodo_id", "ts", "parametro": "ph", "temp": 22.0,
  "puntos": [{ "valor": 4.0, "mv": 171.0 }, { "valor": 7.0, "mv": -3.0 }],
  "pendiente_mv_por_ph": -58.0, "pendiente_pct_nernst": 98.1, "offset_mv": 3.0,
  "diagnostico": "buena|desgastada|revisar", "autor_uid": "…" }

// reportes
{ "_id", "nodo_id", "desde", "hasta", "generado": ISODate, "generado_por": "…",
  "resumen": { "ph": { "prom": 7.1, "min": 6.4, "max": 7.9, "pct_en_rango": 97.2 }, "cobertura_pct": 94.0 },
  "hash": "sha256:…" }

// vinculos_pendientes   (TTL sobre "expira")
{ "_id", "token": "…", "tipo": "telegram", "comunidad_id", "uid", "expira": ISODate }
```

Seguridad de datos: el **token de Blynk se cifra** (AES-256-GCM con `ATL_CLAVE_CIFRADO`) porque da control total del dispositivo; nunca se devuelve por la API, ni a logs. Sin correos ni nombres en logs (ids). Rol `responsable` para vincular, calibrar y confirmar dosis; `integrante` solo lee y puede anotar bitácora.

## 8. API REST (bajo `/api`, Bearer = token de Firebase)

| Método y ruta | Qué hace |
|---|---|
| `GET /yo` | usuario y comunidades |
| `POST /comunidades` | crea comunidad |
| `POST /comunidades/:id/nodos` | alta de nodo: recibe token de Blynk, lo **valida** (`isHardwareConnected`), lo cifra, guarda mapeo |
| `GET /nodos/:id` | estado actual + último valor + estado de conexión |
| `GET /nodos/:id/muestras?desde&hasta&paso` | serie para la gráfica (agregada por `paso`) |
| `GET /nodos/:id/eventos` | alertas, acciones, bitácora |
| `POST /nodos/:id/bitacora` | nota humana |
| `POST /nodos/:id/calibraciones` | registra una calibración (la hace el firmware; la web la muestra y la anota) |
| `POST /nodos/:id/actuador` | solicita acción; devuelve `pendiente_confirmacion` |
| `POST /nodos/:id/reportes` | genera y devuelve el PDF (`application/pdf`) |
| `POST /comunidades/:id/telegram/vinculo` | crea el enlace de vinculación |
| `GET /salud` | pública: `{ ok, mongo, blynk }` para el jurado y los chequeos |

Todo cuerpo y parámetro pasa por zod con `.strict()`. Acceso a recursos ajenos → **404** (no 403) para no revelar existencia. Errores de dominio = clases tipadas traducidas a HTTP; nunca trazas.

## 9. Sesión con Google
Firebase Auth (proveedor Google), reutilizando el proyecto `lympha-dev` o uno nuevo. La web usa el SDK `firebase`; el servidor solo **verifica** el ID token con `firebase-admin`. Sin contraseñas ni sesiones propias.
- **Riesgo del evento:** el dominio donde sirvas la web debe estar en *Authorized domains* de Firebase (`localhost` ya viene). Si presentas desde `http://localhost:5173` no hay problema; con túnel (`trycloudflare.com`) hay que agregarlo.
- **Plan B de demo:** usuario de demostración fijo, para que un fallo de Google no frene la presentación.

## 10. El MCP de Blynk: para qué sirve aquí
`https://blynk.cloud/mcp` (OAuth 2.0 con registro dinámico de cliente) expone herramientas para que un agente administre la flota: `search_devices`, `get_device`, `create_device`, `update_datastream_value`, `get_all_templates`, `get_template`, `create_template`, `create_datastream`, `edit_datastream`, `create_event`, `edit_event`. Las que cambian la estructura (plantillas, datastreams) requieren **Developer Mode** activado en el perfil de Blynk.

Uso previsto (**herramienta de construcción, no parte del runtime**):
1. Autorizar el MCP en el cliente (lo hace el dueño; OAuth en navegador).
2. Pedirle: crear la plantilla `Atl-Nodo`, los datastreams V1–V10 de §4.1, los eventos y un dispositivo de prueba con su token.
3. **El jueves**, si el reto trae otro sensor: `create_datastream`/`edit_datastream` en un minuto, sin entrar a la consola.
Opcional de pitch: «pregúntale a tu agua» con el MCP como interfaz en lenguaje natural. Solo si sobra tiempo.

## 11. Plan de adaptación al reto (lo que cambia según lo que se revele)

| Si el jueves… | Qué se toca |
|---|---|
| Solo hay pH (lo más probable) | nada: es el diseño base |
| Hay un segundo sensor analógico (turbidez, conductividad, TDS, ORP) | 1 entrada en `parametros.json` + pin virtual en Blynk + lectura en firmware; sin cambios de servidor |
| Hay sensor de cloro/ORP | lo anterior + regla de lazo cerrado en `evaluacion` (dosis recomendada con confirmación) |
| Cambia el actuador (válvula, bomba) | solo etiqueta/pin en el catálogo del nodo; los enclavamientos del firmware se revisan |
| La plataforma obliga a otra cosa que Blynk | `plataforma/blynk.ts` es la única pieza que habla con Blynk: se reemplaza por otro adaptador con la misma interfaz `LectorNodo` |
| La rúbrica premia otra cosa (impacto, innovación, técnica) | se ajusta el guion del pitch (`PLAN_HACKATON.md`), no la arquitectura |
| No hay internet estable | Mongo local + sin Telegram (los avisos esperan en `eventos`) + alarma local del firmware |

## 12. Fallos y degradación

| Falla | Comportamiento esperado |
|---|---|
| Se cae el WiFi del nodo | alarma local sigue; Blynk marca offline; Atl abre «sin conexión» y el reporte muestra el hueco |
| Se cae Blynk | el poller reintenta con retardo exponencial; se registra «sin datos de Blynk»; no se inventan lecturas |
| Se cae Mongo | `/api/salud` lo dice; el poller guarda hasta 200 muestras en memoria y reintenta |
| Se cae Telegram | el aviso queda en `eventos` y se reintenta; la web sigue mostrando la alerta |
| Sensor desconectado | `revisar_sensor`; el actuador se apaga; no se calcula pH |
| Google no entra | usuario de demostración |

## 13. Pruebas (proporcionales a 6 horas)
- **Unitarias (Vitest) en lo puro:** `evaluacion`, `dominio/ph`, `frases` (incluye que ningún texto diga «potable»/«seguro»), estadísticas del reporte.
- **Un simulador de nodo:** script Node que escribe `ph`, `estado`, `seq` en Blynk por HTTP con escenarios (`estable`, `acidificacion`, `pico`, `sensor_desconectado`, `nodo_detenido`). Permite probar **toda la cadena sin hardware** y es el plan B de la demo. Reusa la idea de `tools/simulator` de Lympha.
- **Una prueba de humo** (`pnpm smoke`): simulador → Blynk → poller → Mongo → alerta → mensaje de Telegram de prueba → PDF generado y no vacío.
- Sin E2E de navegador en el hackathon.

## 14. Seguridad y privacidad (mínimos)
Secretos solo en `.env` (no versionado); `.env.example` documenta los nombres. Token de Blynk cifrado. Verificación de token en cada ruta. CORS limitado a los orígenes de la web. Sin datos personales en logs. El nodo y las comunidades **no exponen** ubicaciones exactas fuera de los miembros.

## 15. Qué hay que verificar antes de afirmar que funciona
- Forma real de la respuesta de `getAll` y límites de tasa de la HTTP API de Blynk (y host regional).
- Límites del plan gratuito de Blynk (dispositivos, datastreams, eventos, histórico).
- Registro y orden de bytes de la entrada externa del XN03 (reg 0x20, 2 bytes, ¿big/little endian?) y voltaje de salida del módulo de pH (si es de 5 V, divisor al ADC; **nunca** más de 3.3 V).
- Que el Wi-Fi del recinto permita Blynk (puerto 443) y Atlas (27017 TLS); si no, Mongo local.
- Calibración real de la sonda y su pendiente.
- Que `pdfkit` con fuentes estándar muestre bien «ñ» y acentos en el PDF.
