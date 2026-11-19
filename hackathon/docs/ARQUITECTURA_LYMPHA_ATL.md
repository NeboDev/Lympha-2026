# Lympha Atl — Arquitectura completa del sistema

> Documento de referencia de **cómo está construido** Lympha Atl (hackathon Puebla 2026). Describe el sistema tal como existe en el código a **2026-11-18**.
> Para el diseño original y sus razones, ver [`ARQUITECTURA.md`](./ARQUITECTURA.md) (la especificación de partida); para las decisiones paso a paso, [`decisiones.md`](./decisiones.md); para el proceso de trabajo, [`METODOLOGIA_DE_DESARROLLO.md`](./METODOLOGIA_DE_DESARROLLO.md).
> Todos los diagramas son [Mermaid](https://mermaid.js.org/): se ven en GitHub, en VS Code (extensión *Markdown Preview Mermaid Support*) y en la mayoría de visores de Markdown.

---

## 1. Qué es Lympha Atl

**Lympha Atl** («Atl» = *agua* en náhuatl) es la versión **comunitaria** de Lympha: vigilancia continua y reportes de la calidad del agua para escuelas, comités de agua, cisternas compartidas y hogares. Un nodo con sensor mide el pH, lo publica en **Blynk**; el servidor lo lee, lo evalúa, **guarda la historia en MongoDB**, avisa por **Telegram** y genera un **reporte PDF** con base en la NOM-127. Una persona responsable puede, además, pedir un pulso de dosificación que **solo ocurre si otra confirmación humana lo autoriza**.

Tres ideas gobiernan todo el diseño:

| Idea | Qué significa en la práctica |
|---|---|
| **Dirigido por configuración** | Parámetros, límites, reglas y pines viven en `server/config/parametros.json` y en el documento del nodo. Cambiar de sensor es agregar una entrada, no cambiar la lógica. |
| **Honestidad del producto** | Nunca se dice «potable» ni «seguro». El reporte incluye la **cobertura de datos** y lista **lo que no se midió**. Si Blynk o el nodo no responden, se registra el hueco y no se inventa nada. |
| **El actuador es seguro por diseño** | El firmware decide los enclavamientos; la nube **nunca sube la dosis sola**: recomienda y una persona confirma. Lo automático es solo detener y avisar. |

**Qué no es:** no certifica el agua. Un sensor de pH no demuestra el cumplimiento de la NOM-127.

### 1.1 Cómo se llama esta arquitectura

Con nombres **establecidos** (no inventados), Lympha Atl es:

> **Un monolito modular con arquitectura hexagonal (puertos y adaptadores).**

| Nombre | Qué es | Dónde se ve en Atl |
|---|---|---|
| **Arquitectura hexagonal / Ports & Adapters** (Alistair Cockburn, 2005) | La lógica de la aplicación queda en el centro; las **interfaces (puertos)** están dentro de la aplicación y las **implementaciones técnicas (adaptadores)** fuera. Hay puertos de entrada (*driving*) y de salida (*driven*). El hexágono es solo una forma de dibujarlo | `modulos/` define los puertos (`LectorNodo`, `AlmacenIngesta`, `AlmacenAlertas`…); `plataforma/` trae los adaptadores (Blynk, Mongo, Telegram, Firebase, PDF). Entradas: API REST, bot de Telegram, CLI y bucles |
| **Monolito modular** (estilo de despliegue) | Una sola unidad desplegable con módulos de fronteras claras | Un proceso Node con módulos que solo se hablan por su `index.ts` |
| **Functional Core, Imperative Shell** (Gary Bernhardt, 2012) | Un núcleo de funciones puras y una capa exterior que se ocupa de los efectos | `evaluacion/`, `dominio/`, `decidirCiclo` y las reglas de alertas y del actuador son puros; el I/O vive en los adaptadores |

**Patrones de diseño que lo acompañan** (también con nombre establecido):

| Patrón | Dónde |
|---|---|
| **Outbox con polling publisher** | La bandeja de avisos (`avisos`) y su enviador independiente. *Matiz honesto:* la versión clásica escribe el evento en la misma transacción que el dato; aquí la alerta y su aviso se escriben en operaciones idempotentes con **clave única**, no en una transacción multidocumento |
| **Polling** (sondeo) | El poller de Blynk consulta cada 5 s en vez de recibir webhooks |
| **Receptor idempotente** | Insertar muestras con índice único; reintentar no duplica |
| **Bucle de reconciliación** | Las alertas comparan el estado *deseado* con el *actual* y corrigen la diferencia |
| **Borrado lógico** (*soft delete*) | Quitar un nodo lo archiva y conserva el historial |

Lo que **no** es: no es microservicios (no hay servicios separados ni un broker), no es *event sourcing* ni CQRS, y no es una arquitectura en capas clásica (la dependencia apunta hacia el núcleo, no hacia abajo).

---

## 2. Contexto del sistema

Quién interactúa con Atl y con qué sistemas externos se integra.

```mermaid
flowchart LR
    subgraph Personas
        R["Persona responsable<br/>(vincula, calibra, confirma)"]
        I["Integrante<br/>(consulta, anota bitácora)"]
        F["Familias de la comunidad<br/>(reciben avisos)"]
    end

    subgraph Campo["Campo (hardware)"]
        N["Nodo ESP32-S3<br/>sonda de pH, alarma local,<br/>relevador del actuador"]
    end

    ATL(("Lympha Atl<br/>servidor + web"))

    BL[("Blynk Cloud<br/>tiempo real")]
    MG[("MongoDB Atlas<br/>registro permanente")]
    FB["Firebase Auth<br/>identidad con Google"]
    TG["Telegram Bot API<br/>avisos y reportes"]

    N -- "publica V1..V10 (WiFi)" --> BL
    BL -- "orden del actuador (V8)" --> N
    ATL -- "getAll cada 5 s / escribe V8" --> BL
    ATL <--> MG
    ATL -- "verifica ID token" --> FB
    ATL <--> TG

    R --> ATL
    I --> ATL
    TG -- "mensajes y PDF" --> F
    R -. "inicia sesión con Google" .-> FB
```

Puntos importantes:

- **Blynk es la capa de tiempo real; MongoDB es la memoria.** Blynk conserva el último valor de cada pin aunque la placa se apague; por eso Atl usa un contador `seq` como señal de vida.
- **El servidor no se conecta a la placa.** Solo habla con la API HTTP de Blynk.
- **Firebase solo identifica.** No hay contraseñas ni sesiones propias: el servidor únicamente **verifica** el ID token.

---

## 3. Vista de contenedores y despliegue

Hoy todo corre **en local** (no hay VPS): un solo proceso de servidor Node, una SPA con Vite y servicios gestionados en la nube.

```mermaid
flowchart TB
    subgraph PC["Equipo de desarrollo o demo (localhost)"]
        direction TB
        WEB["Web (SPA)<br/>React 19 + Vite<br/>:5173"]
        SRV["Servidor Atl<br/>Node 24 + Fastify 5<br/>:3000"]
        WEB -- "REST /api (Bearer)" --> SRV
    end

    subgraph Nube["Servicios gestionados"]
        MG[("MongoDB Atlas")]
        BL["Blynk Cloud"]
        FB["Firebase Auth"]
        TG["Telegram Bot API"]
    end

    subgraph Hardware
        ND["Nodo ESP32-S3<br/>(o simulador)"]
    end

    SRV <-- "driver mongodb" --> MG
    SRV -- "HTTP getAll / update" --> BL
    SRV -- "firebase-admin (solo verificar)" --> FB
    SRV -- "long polling + sendMessage" --> TG
    WEB -- "SDK firebase (acceso)" --> FB
    ND -- "WiFi" --> BL
```

| Contenedor | Tecnología | Notas |
|---|---|---|
| **Web** | Vite + React 19, CSS con tokens (`design/tokens.css`), gráfica con **MUI X Charts** | Cuatro pantallas: Entrar, Mi agua, Reportes y Comunidad. Sin CDN: fuentes y librerías autoalojadas. |
| **Servidor** | Node 24 (TypeScript directo, sin paso de build), Fastify 5 + `fastify-type-provider-zod`, driver `mongodb`, `pdfkit`, `pino` | **Un solo proceso** con varios bucles internos (sección 4). |
| **Base de datos** | MongoDB Atlas (plan B: Mongo local en Docker; el código es idéntico) | Documentos de forma flexible: no hay migraciones. |
| **Simulador** | `pnpm simulador` (escribe en Blynk como lo haría el nodo) | Permite probar toda la cadena sin hardware. |
| **Humo (smoke)** | `pnpm smoke` | Recorre la cadena real de punta a punta con datos propios y los borra. |

Arranque conjunto: desde `hackathon/`, `pnpm --ignore-workspace dev` levanta servidor y web y los detiene con Ctrl+C.

---

## 4. Procesos dentro del servidor

Un único proceso (`server/src/main.ts`) compone los módulos y arranca seis actividades concurrentes. Todas se detienen en orden con `SIGINT`/`SIGTERM`.

```mermaid
flowchart TB
    MAIN["main.ts<br/>config → Mongo → módulos"]

    API["API Fastify<br/>(HTTP :3000)"]
    POLL["Poller de Blynk<br/>cada POLL_MS = 5 s"]
    BARR["Barrido de alertas<br/>cada BARRIDO_MS = 15 s"]
    CTRL["Barrido de control<br/>cada 2 s"]
    ENV["Enviador de avisos<br/>cada 2 s"]
    TGP["Telegram<br/>long polling"]

    MAIN --> API
    MAIN --> POLL
    MAIN --> BARR
    MAIN --> CTRL
    MAIN --> ENV
    MAIN --> TGP

    POLL -- "muestra nueva" --> EVAL["Evaluación (pura)"]
    EVAL --> ALER["Alertas<br/>reconciliación"]
    ALER --> BAND[("Bandeja de avisos<br/>colección avisos")]
    BARR -- "recordatorios y primer aviso" --> BAND
    ENV -- "toma con arrendamiento" --> BAND
    ENV --> TGAPI["Telegram Bot API"]
    TGP --> TGAPI
    CTRL -- "apaga pulsos vencidos" --> BL["Blynk (V8 = 0)"]
    POLL --> BL2["Blynk (getAll)"]
    API --> DB[("MongoDB")]
    POLL --> DB
    ALER --> DB
```

Reglas de diseño del proceso:

- **Cada actividad es un bucle secuencial** (`plataforma/bucle.ts`): una ronda nunca se solapa con la siguiente.
- **Un nodo que falla no frena a los demás**: el poller aplica espera exponencial por nodo (con tope de 60 s).
- Se pueden apagar piezas por configuración: `INGESTA_ACTIVA=false` (solo API), sin `TELEGRAM_BOT_TOKEN` (los avisos esperan en la bandeja) y `ACTUADOR_ESCRIBE_BLYNK=false` (el actuador se ensaya sin mover nada).

---

## 5. Arquitectura por capas (puertos y adaptadores)

El código separa **lo que se decide** (puro, con pruebas) de **lo que toca el mundo** (red y base de datos).

```mermaid
flowchart TB
    subgraph Entrada["Bordes de entrada"]
        HTTP["API REST"]
        BOT["Bot de Telegram"]
        CLI["CLI: nodo, reporte, humo, telegram"]
        BUC["Bucles: poller, barridos, enviador"]
    end

    subgraph Modulos["modulos/ (casos de uso, con puertos)"]
        direction LR
        INGESTA["ingesta"]
        ALERTAS["alertas"]
        NOTIF["notificaciones"]
        CONTROL["control"]
        REPORTES["reportes"]
        NODOS["nodos"]
        COMU["comunidades"]
        BITA["bitacora"]
        CALI["calibraciones"]
        IDEN["identidad"]
        TELE["telegram"]
    end

    subgraph Puro["Núcleo puro (sin I/O)"]
        EVALN["evaluacion/"]
        DOM["dominio/<br/>ph.ts, catalogo.ts,<br/>frases.ts, errores.ts"]
    end

    subgraph Plataforma["plataforma/ (adaptadores)"]
        MONGO["almacen-*-mongo.ts"]
        BLY["blynk.ts, lector-blynk.ts,<br/>escritor-actuador-blynk.ts"]
        TGAD["telegram-api.ts,<br/>telegram-polling.ts"]
        FIRE["firebase.ts"]
        PDF["reporte-pdf.ts"]
        OTROS["cifrado.ts, logger.ts,<br/>bucle.ts, indices.ts"]
    end

    Entrada --> Modulos
    Modulos --> Puro
    Modulos -. "definen puertos (interfaces)" .-> Plataforma
    Plataforma -- "implementan" --> Modulos
```

**Reglas que se cumplen (y se prueban o se verifican con el linter):**

1. Cada módulo expone un `index.ts`; **nadie importa archivos internos de otro módulo**.
2. `evaluacion/` y `dominio/` son **funciones puras**: sin red, sin base de datos, con pruebas unitarias.
3. **Solo `plataforma/blynk.ts` habla con Blynk** (a través de las interfaces `LectorNodo` y del escritor del actuador): cambiar de plataforma es reemplazar un adaptador.
4. Toda entrada se valida con **zod `.strict()`**: cuerpos, parámetros, variables de entorno y el catálogo. Si falta una variable de entorno, el proceso no arranca.
5. Los errores de dominio son **clases tipadas** que la capa HTTP traduce; jamás se exponen trazas.

### 5.1 Módulos

| Módulo | Responsabilidad |
|---|---|
| `ingesta` | Sondea Blynk, decide si hay muestra nueva (`seq`), evalúa, guarda y avisa a alertas. Incluye el ciclo puro `decidirCiclo`. |
| `evaluacion` | Reglas por parámetro (rango, margen, histéresis, cambio rápido, estabilidad, sensor degradado). Puro. |
| `alertas` | Reconcilia el estado deseado contra las alertas abiertas; recordatorios; textos de aviso. |
| `notificaciones` | Bandeja de avisos (outbox) y su enviador con arrendamiento y reintentos. |
| `telegram` | Vinculación por enlace, `/estado`, `/reporte`, `/ayuda`, `/desvincular`. |
| `control` | Actuador: pedir → confirmar → pulso → apagado, con enclavamientos y registro. |
| `reportes` | Estadísticas, contenido y huella del reporte; el PDF lo dibuja `plataforma/reporte-pdf.ts`. |
| `nodos` | Alta (valida el token de Blynk), edición, quitar y restaurar (borrado lógico), series y eventos. |
| `comunidades` | Comunidades, miembros y roles; vinculación de Telegram. |
| `bitacora` | Notas humanas que entran al reporte. |
| `calibraciones` | Registro de calibraciones (hechas por una persona o reportadas por el nodo). |
| `identidad` | Verificación del token de Firebase y usuario de demostración. |
| `api` | Rutas REST, CORS, salud, autenticación y cabeceras. |

---

## 6. Dominio y configuración

### 6.1 Catálogo de parámetros

`server/config/parametros.json` (validado con zod al arrancar) describe cada parámetro: nombre, unidad, norma (mínimo y máximo), decimales, pines de Blynk y **reglas de evaluación como datos**. Agregar «turbidez» u «ORP» es agregar una entrada; no hay `if (parametro === "ph")` fuera de `dominio/ph.ts`, que concentra lo específico del pH: la ecuación de Nernst, la calibración de 2 puntos y la fracción de HOCl.

### 6.2 Pines de Blynk (contrato con el firmware)

```mermaid
flowchart LR
    subgraph Nodo["Nodo (placa)"]
        V1["V1 temperatura"]
        V2["V2 pH calibrado"]
        V3["V3 mV"]
        V4["V4 estado"]
        V5["V5 estable"]
        V6["V6 seq (señal de vida)"]
        V7["V7 pH crudo"]
        V9["V9 modo"]
        V10["V10 cal_pct"]
        V8["V8 bomba"]
    end
    subgraph Atl["Servidor Atl"]
        L["Lee: V2, V4, V5, V6, V7, V10"]
        E["Escribe: V8"]
    end
    V2 --> L
    V4 --> L
    V5 --> L
    V6 --> L
    V7 --> L
    V10 --> L
    E --> V8
```

Hoy Atl **no guarda** V1 (temperatura), V3 (mV) ni V9 (modo); se ven en la app de Blynk. El mapeo vive en el documento del nodo, así que un pin distinto es configuración.

---

## 7. Flujos principales

### 7.1 Ingesta: de Blynk a la base

```mermaid
sequenceDiagram
    autonumber
    participant P as Poller (cada 5 s)
    participant L as LectorNodo (Blynk)
    participant C as decidirCiclo (puro)
    participant E as Evaluación (pura)
    participant DB as MongoDB
    participant A as Alertas
    participant K as Control

    P->>L: leer(nodo) → getAll
    L-->>P: snapshot de pines
    P->>C: snapshot + estado del ciclo
    alt seq no cambió
        C-->>P: sin_cambio (tras SIN_DATOS_S, evento sin_datos)
    else seq cambió
        C-->>P: muestra nueva
        P->>E: evaluar cada parámetro
        E-->>P: estado, cambio rápido, estabilidad
        P->>DB: insertar muestra (ON CONFLICT: no duplica)
        P->>DB: actualizar nodos.ultimo
        P->>A: sincronizar (abre o cierra alertas)
        P->>K: reaccionar (apagar pulso si salió de rango)
    end
```

Garantías:

- **`seq` es la señal de vida.** Si no cambia, Blynk solo conserva un valor viejo: no se inserta una muestra, y tras `SIN_DATOS_S` (60 s) se abre la alerta «sin conexión».
- **Idempotencia:** una muestra repetida (mismo nodo, sesión y `seq`) se omite. Si `seq` baja, es un reinicio de la placa y se abre una *sesión* nueva.
- **Escrituras con reintento:** si Mongo cae, las escrituras esperan en memoria (hasta 200 por nodo) y se aplican **en orden** al volver; al desbordarse se descarta lo más antiguo y se registra.
- **El orden importa:** la muestra se guarda antes de las operaciones secundarias (calibración, alertas) para que un fallo posterior no frene el dato.

### 7.2 Estados del agua

La evaluación es genérica: todo sale de la norma y las reglas del catálogo. El estado general del nodo es el **peor** de sus parámetros.

```mermaid
stateDiagram-v2
    [*] --> en_rango
    en_rango --> atencion: a 0.3 o menos de un límite, o cambio rápido (3 lecturas)
    atencion --> en_rango: vuelve con margen de 0.1
    atencion --> fuera_de_rango: sale de 6.5 a 8.5 (3 lecturas)
    fuera_de_rango --> atencion: regresa con margen de 0.1
    fuera_de_rango --> critico: más de 1.0 fuera (pH menor a 5.5 o mayor a 9.5)
    en_rango --> critico: entra de inmediato
    critico --> fuera_de_rango: mejora
    en_rango --> revisar_sensor: pegado a rieles, fuera de 0 a 14, V4 = 3 o sonda degradada
    atencion --> revisar_sensor
    fuera_de_rango --> revisar_sensor
    critico --> revisar_sensor
    revisar_sensor --> en_rango: la lectura vuelve a ser creíble
```

Además existe **`sin_datos`** (sin conexión), que no decide la evaluación sino la ingesta (`seq` detenido). Los umbrales (0.3, 0.5, 1.0, 85 %) son **criterio del equipo, no de la norma**, y así lo dice el reporte.

### 7.3 Alertas y avisos

Las alertas se **reconcilian**: se calcula qué alertas *deberían* existir según el estado actual y se compara con las abiertas (abrir, subir, bajar o cerrar). Por eso reintentar o reiniciar no repite nada.

```mermaid
stateDiagram-v2
    [*] --> abierta: aparece la condición
    abierta --> abierta: sube o baja la severidad
    abierta --> abierta: recordatorio cada RECORDATORIO_MIN
    abierta --> cerrada: la condición desaparece
    cerrada --> [*]
```

| Tipo de alerta | Cuándo |
|---|---|
| `nivel` | Fuera de rango (alta) o crítico (crítica) |
| `cambio_rapido` | Cambio de 0.5 de pH en 5 min aunque siga en rango (no manda recordatorios) |
| `sensor` | La lectura no es confiable |
| `sin_conexion` | El nodo dejó de enviar datos |

**Bandeja de avisos (outbox).** Los avisos no salen directo: se escriben en la colección `avisos` en la misma operación lógica que la alerta, y un enviador independiente los entrega.

```mermaid
sequenceDiagram
    autonumber
    participant AL as Alertas
    participant B as Bandeja (avisos)
    participant EN as Enviador (cada 2 s)
    participant TG as Telegram

    AL->>B: encolar aviso (clave única, p. ej. alerta:abre)
    Note over B: la clave única evita duplicados
    loop cada 2 s
        EN->>B: tomar el siguiente pendiente (con arrendamiento)
        EN->>TG: sendMessage
        alt entregado
            EN->>B: marcar enviado
        else error temporal o 429
            EN->>B: reprogramar (5 s por 2^n, tope 10 min, máx. 8)
        else 403 o chat inexistente
            EN->>B: marcar fallido (permanente)
        end
    end
```

Garantía **al menos una vez**: un fallo justo después de enviar puede duplicar un aviso. Los textos nunca dicen «potable» ni «seguro» (lo verifica una prueba automática) y siguen el patrón *qué pasó + qué significa + qué hacer*.

### 7.4 Vinculación con Telegram

```mermaid
sequenceDiagram
    autonumber
    actor R as Responsable
    participant W as Web
    participant S as Servidor
    participant T as Telegram
    participant DB as MongoDB

    R->>W: Vincular Telegram
    W->>S: POST /comunidades/:id/telegram/vinculo
    S->>DB: guardar token de un solo uso (vence en 10 min)
    S-->>W: enlace t.me/bot?start=token
    R->>T: abre el enlace y pulsa Iniciar
    T->>S: /start token (long polling)
    S->>DB: canjear token, guardar chat_id en la comunidad
    S-->>T: confirmación al chat
    Note over R,T: Desvincular: botón en la web o /desvincular en el chat
```

Una comunidad corresponde a un chat (puede ser un grupo), de modo que el aviso llega a todas las familias.

### 7.5 Control del actuador

Regla: **la nube nunca sube la dosis sola.** Pedir un pulso no manda nada a Blynk; una persona responsable debe confirmarlo.

```mermaid
stateDiagram-v2
    [*] --> pendiente: se pide un pulso
    pendiente --> en_curso: confirma en 120 s y pasan los enclavamientos
    pendiente --> cancelada: la persona dice no
    pendiente --> expirada: nadie confirma a tiempo
    pendiente --> rechazada: un enclavamiento lo impide
    en_curso --> terminada: llega a su fin (V8 = 0)
    en_curso --> detenida: una persona o la regla de seguridad
    en_curso --> fallida: Blynk no recibió la orden
    terminada --> [*]
    detenida --> [*]
    cancelada --> [*]
    expirada --> [*]
    rechazada --> [*]
    fallida --> [*]
```

**Enclavamientos en la nube** (además de los del firmware, que son los que mandan): hay datos recientes, el sensor está sano, el pH está en rango (ni fuera de rango ni crítico), no hay otro pulso en curso, pasó el enfriamiento y la duración no supera el máximo del nodo (tope de 120 s del servidor).

```mermaid
sequenceDiagram
    autonumber
    actor R as Responsable
    participant W as Web
    participant S as Servidor (control)
    participant B as Blynk
    participant N as Nodo (firmware)

    R->>W: Pedir pulso de 30 s
    W->>S: POST /actuador/pulsos
    S-->>W: pendiente de confirmación (nada sale a Blynk)
    R->>W: Confirmar (menos de 120 s)
    W->>S: POST .../confirmar
    S->>S: revisar enclavamientos
    S->>B: V8 = 1
    B->>N: orden
    N->>N: valida y puede rechazar
    loop cada 2 s
        S->>S: barrido: ¿terminó el pulso?
    end
    S->>B: V8 = 0
    Note over S,B: Si el pH sale de rango durante el pulso, V8 = 0 primero y luego se registra y avisa
```

**Honestidad:** Blynk guarda el último valor escrito, no confirma que el relevador actuó. Los textos dicen «orden enviada» y «Atl no ve si actuó». Un actuador marcado `simulado` rotula todo como ensayo.

### 7.6 Calibración reportada por el nodo

Si el nodo publica `cal_pct` (V10, la pendiente de la sonda como % de Nernst), la ingesta lo convierte en calibración automática.

```mermaid
flowchart TD
    A["Muestra nueva con V10"] --> B{"Valor creíble?<br/>mayor que 0 y hasta 150"}
    B -- no --> Z["Se ignora"]
    B -- si --> C{"Primera vez, o cambió<br/>0.5 puntos o más?"}
    C -- no --> Z
    C -- si --> D["Se encola alCalibracion<br/>después de guardar la muestra"]
    D --> E{"La última reportada<br/>ya tiene ese valor?"}
    E -- si --> Z
    E -- no --> F["Guardar calibración<br/>origen: nodo<br/>sin puntos, offset ni temperatura"]
    F --> G["Diagnóstico: buena desde 95 %,<br/>desgastada desde 85 %, revisar por debajo"]
    G --> H["Evento en la bitácora del nodo"]
```

Una calibración registrada por una persona (con dos buffers) tiene `origen: "usuario"` y sí lleva puntos, offset y temperatura. No se abren alertas ni se manda Telegram por una sonda desgastada; queda en el historial y en el reporte.

### 7.7 Reportes PDF

```mermaid
sequenceDiagram
    autonumber
    participant U as Web o Telegram (/reporte)
    participant R as Servicio de reportes
    participant DB as MongoDB
    participant P as Generador PDF (pdfkit)

    U->>R: nodo, periodo y quién lo pide
    R->>DB: muestras, alertas, eventos, calibraciones, bitácora
    R->>R: estadísticas (promedio, mínimo, máximo, % en rango, cobertura)
    R->>R: contenido + huella (hash) del resumen
    R->>P: contenido
    P-->>U: PDF carta
    R->>DB: guardar resumen y huella del reporte
```

El PDF incluye: resumen en lenguaje sencillo, insignia «pH dentro del rango de la NOM-127 el X % del tiempo» (nunca un «CUMPLE» global), tabla de estadísticas con **cobertura de datos**, gráfica con la franja de la norma, eventos y alertas, calibraciones (rotuladas «(del nodo)» si las reportó la placa), bitácora y **lo que el reporte no cubre**.

### 7.8 Acceso e identidad

```mermaid
sequenceDiagram
    autonumber
    participant W as Web
    participant F as Firebase Auth
    participant S as Servidor
    participant DB as MongoDB

    W->>F: entrar con Google
    F-->>W: ID token
    W->>S: petición /api con Authorization Bearer
    S->>F: verificar token (firebase-admin)
    F-->>S: uid, nombre, correo
    S->>DB: registrar o actualizar usuario
    S->>S: comprobar membresía y rol
    alt recurso ajeno
        S-->>W: 404 (igual que si no existiera)
    else rol insuficiente
        S-->>W: 403
    else todo bien
        S-->>W: respuesta (Cache-Control: no-store)
    end
```

**Plan B de la demo:** un usuario de demostración fijo (`APP_ENV=demo` + `USUARIO_DEMO_ACTIVO=true` + un secreto compartido con la web), para que un fallo de Google no frene la presentación.

---

## 8. Modelo de datos (MongoDB)

Base `atl`. Fechas en UTC (`Date`); `America/Mexico_City` solo al mostrar y al agrupar por día. Los esquemas son flexibles (`v: { ph: 7.1 }`), sin migraciones.

```mermaid
erDiagram
    usuarios ||--o{ comunidades : "es miembro de"
    comunidades ||--o{ nodos : "tiene"
    nodos ||--o{ muestras : "genera"
    nodos ||--o{ alertas : "abre"
    nodos ||--o{ eventos : "registra"
    nodos ||--o{ calibraciones : "tiene"
    nodos ||--o{ acciones_actuador : "recibe"
    nodos ||--o{ reportes : "produce"
    alertas ||--o{ avisos : "origina"
    comunidades ||--o{ vinculos_pendientes : "genera"

    usuarios {
        string google_uid
        string nombre
        string correo
        date creado
    }
    comunidades {
        objectId _id
        string nombre
        string tipo
        array miembros
        object telegram
        date creado
    }
    nodos {
        objectId _id
        objectId comunidad_id
        string nombre
        object ubicacion
        object blynk
        array parametros
        object umbrales
        object ultimo
        object actuador
        date archivado
        date creado
    }
    muestras {
        objectId nodo_id
        date ts
        int seq
        int sesion
        object v
        object crudo
        string estado
        object estados
        bool estable
    }
    alertas {
        objectId nodo_id
        string tipo
        string parametro
        string severidad
        string estado
        date abierta
        date cerrada
    }
    avisos {
        string clave
        objectId alerta_id
        string estado
        int intentos
        date proximo_intento
    }
    eventos {
        objectId nodo_id
        date ts
        string tipo
        string mensaje
        string autor_uid
    }
    calibraciones {
        objectId nodo_id
        date ts
        string origen
        float pendiente_pct_nernst
        float offset_mv
        string diagnostico
    }
    acciones_actuador {
        objectId nodo_id
        string estado
        int duracion_s
        date solicitada
    }
    reportes {
        objectId nodo_id
        date desde
        date hasta
        string hash
    }
    vinculos_pendientes {
        string token
        date expira
    }
```

Notas de modelo:

- **`nodos.ultimo`** es la última «foto» (valor, estado, `seq`, `cal_pct`) para que la web y los avisos no tengan que leer las muestras.
- **Índices únicos** que sostienen las garantías: muestra por (nodo, sesión, `seq`); **una alerta abierta** por (nodo, tipo, parámetro); aviso por clave; **una acción viva** por nodo; un token de vinculación por valor (con vencimiento).
- **Borrado lógico:** quitar un nodo pone `archivado`; no se borra el historial. Un nodo archivado deja de sondearse, de verse en la API y de avisar; se puede **restaurar**.
- **Cifrado:** el token de Blynk se guarda con **AES-256-GCM** y jamás sale por la API ni a los logs.

---

## 9. API REST

Todas las rutas viven bajo `/api` y exigen `Authorization: Bearer <token de Firebase>`, salvo `GET /api/salud` (pública: `{ ok, mongo, blynk }`).

| Método y ruta | Rol mínimo | Qué hace |
|---|---|---|
| `GET /yo` | — | Usuario y sus comunidades |
| `POST /comunidades` | — | Crea una comunidad (quien la crea es responsable) |
| `GET /comunidades/:id/nodos` | integrante | Lista de nodos activos |
| `POST /comunidades/:id/nodos` | responsable | Alta: valida el token de Blynk, lo cifra y guarda el mapeo |
| `GET /comunidades/:id/nodos-quitados` | responsable | Nodos archivados |
| `POST /comunidades/:id/telegram/vinculo` | responsable | Enlace de vinculación de un solo uso |
| `DELETE /comunidades/:id/telegram` | responsable | Desvincula el chat |
| `GET /nodos/:id` | integrante | Estado, último valor y conexión |
| `PUT /nodos/:id` | responsable | Edita nombre y lugar |
| `DELETE /nodos/:id` | responsable | Quita el nodo (archiva) |
| `POST /nodos/:id/restaurar` | responsable | Restaura un nodo quitado |
| `GET /nodos/:id/muestras` | integrante | Serie agregada para la gráfica |
| `GET /nodos/:id/eventos` | integrante | Alertas, eventos y bitácora |
| `POST /nodos/:id/bitacora` | integrante | Nota humana |
| `GET`/`POST /nodos/:id/calibraciones` | integrante / responsable | Lista y registro de calibraciones |
| `GET`/`POST /nodos/:id/reportes` | integrante | Reportes anteriores / genera un PDF |
| `GET`/`PUT /nodos/:id/actuador` | responsable | Estado y ajustes del actuador |
| `POST /nodos/:id/actuador/pulsos` | responsable | Pide un pulso (no manda nada) |
| `POST .../pulsos/:accionId/confirmar` y `/cancelar` | responsable | Confirma o cancela |
| `POST /nodos/:id/actuador/detener` | responsable | Detiene un pulso en curso |

Convenciones: **un recurso ajeno responde 404, no 403**, para no revelar qué existe; un id mal formado también es 404; los errores de validación son 400; los de dominio, clases tipadas traducidas (409 conflicto, 422 token de Blynk inválido, 503 Blynk no responde); toda respuesta lleva `Cache-Control: no-store`. Una prueba verifica que **cada ruta con identificador** tenga su prueba de acceso cruzado.

---

## 10. Web (SPA)

```mermaid
flowchart TB
    SES["Sesión<br/>Firebase o demostración"] --> PUERTA{"Hay sesión?"}
    PUERTA -- no --> ENT["Entrar<br/>Google o demo"]
    PUERTA -- si --> MARCO["Marco de la app<br/>barra lateral en pantalla ancha<br/>pestañas abajo en teléfono"]
    MARCO --> AGUA["Mi agua"]
    MARCO --> REP["Reportes"]
    MARCO --> COM["Comunidad"]

    AGUA --> A1["Estado: color + símbolo + palabra"]
    AGUA --> A2["Escala de pH y efectividad del cloro"]
    AGUA --> A3["Alertas abiertas y gráfica de pH"]
    AGUA --> A4["Calibración y dosificación"]

    REP --> R1["Periodo, vista previa y PDF"]

    COM --> C1["Nodos: vincular, editar, quitar, restaurar"]
    COM --> C2["Telegram: vincular y desvincular"]
    COM --> C3["Bitácora y ajustes del actuador"]
```

- **Estado de la UI:** consultas con un `useConsulta` propio (refresco automático, reintento), sin librerías de datos ni de rutas.
- **Cliente de la API tipado y validado:** cada respuesta se valida con zod; un 204 se acepta sin cuerpo; un POST/DELETE sin cuerpo no manda `content-type`.
- **Gráfica:** MUI X Charts con la línea del promedio, mínimo y máximo, y la franja de la norma; la línea se **corta en los huecos**.
- **Reglas de diseño que no se negocian:** solo tokens de `design/tokens.css`; el estado nunca va solo en color (símbolo y palabra); contraste AA; objetivos táctiles de 44 px; claro y oscuro; móvil primero; sin CDN.
- **Honestidad en los textos:** ninguno dice «potable», «seguro» ni «cumple NOM-127»; lo que Atl no mide se dice.

---

## 11. Seguridad y privacidad

| Tema | Cómo se resuelve |
|---|---|
| Identidad | Firebase Auth; el servidor solo verifica el ID token |
| Autorización | Rol por comunidad (`responsable` / `integrante`); recurso ajeno → 404 |
| Secretos | Solo en `.env` (no versionado); `.env.example` documenta los nombres; nunca se leen ni se piden valores |
| Token de Blynk | Cifrado AES-256-GCM; no sale en la API ni en logs |
| Entradas | zod `.strict()` en cuerpos, parámetros, entorno y catálogo |
| Datos personales | Logs con `redact`; ids en lugar de correos |
| Navegador | CORS limitado a `CORS_ORIGINS`; respuestas `no-store` |
| Actuador | Enclavamientos en el firmware **y** en la nube; confirmación humana obligatoria; nunca sube la dosis solo |
| Demo | `USUARIO_DEMO_TOKEN` queda dentro del JavaScript de la web: quien abra la web puede leerlo (solo plan B) |

---

## 12. Resiliencia: qué pasa cuando algo falla

| Falla | Comportamiento |
|---|---|
| Se cae el WiFi del nodo | La alarma local sigue; Atl abre «sin conexión» y el reporte muestra el **hueco** y la cobertura, sin inventar lecturas |
| Se cae Blynk | El poller reintenta con espera exponencial por nodo; se registra y no se inventan datos |
| Se cae Mongo | `/api/salud` lo dice; las escrituras esperan en memoria (hasta 200 por nodo) y se aplican en orden al volver |
| Se cae Telegram | Los avisos esperan en la bandeja y se reintentan; la web sigue mostrando la alerta |
| Sensor desconectado | `revisar_sensor`; el pulso del actuador se apaga; no se calcula con ese dato |
| Google no entra | Usuario de demostración |
| El servidor se reinicia | Retoma desde `nodos.ultimo`: no duplica muestras ni calibraciones |
| Un nodo comparte dispositivo de Blynk con otro | Se detecta y se advierte: los dos reaccionan a los mismos pines |

---

## 13. Configuración (nombres de las variables)

Validadas con zod al arrancar; si falta una requerida, el proceso no inicia. Los **valores** nunca se documentan ni se versionan.

| Grupo | Variables |
|---|---|
| Servidor | `PORT`, `APP_ENV` (`local` o `demo`), `CORS_ORIGINS` |
| Mongo | `MONGODB_URI`, `MONGODB_DB`, `MONGODB_DNS` |
| Blynk | `BLYNK_HOST`, `POLL_MS` (5000), `SIN_DATOS_S` (60), `INGESTA_ACTIVA`, `ACTUADOR_ESCRIBE_BLYNK` |
| Alertas | `RECORDATORIO_MIN` (30), `BARRIDO_MS` (15000) |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` |
| Identidad | `FIREBASE_PROJECT_ID`, `FIREBASE_USE_EMULATOR`, `USUARIO_DEMO_ACTIVO`, `USUARIO_DEMO_TOKEN` |
| Cifrado | `ATL_CLAVE_CIFRADO` |
| Web | `VITE_API_URL`, `VITE_FIREBASE_*`, `VITE_DEMO_TOKEN` |

---

## 14. Pruebas y calidad

```mermaid
flowchart TB
    H["Prueba de humo (pnpm smoke)<br/>cadena real: simulador, Blynk, Mongo,<br/>alerta, API, PDF, Telegram"]
    I["Integración contra MongoDB real<br/>base temporal que se borra (ATL_TEST_MONGO=1)"]
    U["Unitarias (Vitest)<br/>núcleo puro, servicios con almacenes en memoria,<br/>API con almacenes falsos, web"]
    H --> I --> U
```

| Nivel | Cantidad actual | Qué cubre |
|---|---|---|
| Unitarias del servidor | 626 (más 26 de integración que se omiten sin Mongo) | Evaluación, dominio, ciclo de ingesta, alertas, control, reportes, API con acceso cruzado, frases sin «potable» |
| Unitarias de la web | 78 | Cliente de la API, cálculo de la gráfica, estados, rutas, configuración |
| Integración | Opcional (`ATL_TEST_MONGO=1`) | Índices, transiciones atómicas, archivado, calibraciones |
| Humo | Manual | Recorrido de la cadena completa con datos propios, que se borran al terminar |

Siempre en verde antes de dar un paso por terminado: `lint` (Biome), `typecheck` (TypeScript estricto), pruebas y, en la web, `build`.

---

## 15. Decisiones de diseño y sus razones

| Decisión | Razón | Costo aceptado |
|---|---|---|
| Blynk **y** una base propia | Blynk es excelente en vivo, pero su histórico gratuito es corto y no guarda calibraciones, acciones ni bitácora | Dos fuentes que mantener coherentes |
| Sondeo (polling) en vez de webhooks | No requiere URL pública (no hay VPS); es simple y robusto | La marca de tiempo es la del sondeo, no la de la medición |
| MongoDB | Esquema flexible (los parámetros pueden cambiar el día del reto), sin migraciones | Necesita internet; plan B con Mongo local |
| Un solo proceso con bucles | Para un hackathon sobran colas y brokers | Escalar exigiría separar procesos |
| Bandeja de avisos en la base | Garantiza entrega al menos una vez con reintentos, sin infraestructura extra | Posible aviso duplicado ante un fallo justo al enviar |
| Reconciliación de alertas | Idempotente: reintentar no repite nada | Más lógica que «un evento, una alerta» |
| Borrado lógico de nodos | Conserva el historial para los reportes | Los archivados quedan en la base |
| Confirmación humana del actuador | Seguridad: la nube no decide dosificar | Un paso más para el usuario |
| Calibración reportada, no calculada | El nodo ya calcula su pendiente; Atl solo la registra | Sin puntos ni offset |

---

## 16. Limitaciones y lo que no está verificado

Declarado con la misma honestidad que el producto:

- **Hardware y firmware:** el firmware está bosquejado y *compila*, pero no se ha probado en placa. Lo que se probó de punta a punta fue con el **simulador**.
- **Blynk real:** no se verificaron los límites de tasa ni del plan gratuito con sondeo sostenido; no se confirmó que el dispositivo real publique V10.
- **Google y Firebase reales:** el acceso con Google real y teléfonos reales no se probaron; sí con la cuenta de demostración.
- **Cámara y QR:** no existen en esta versión.
- **Telegram:** probado con el bot real por long polling; grupos de Telegram y el webhook no se probaron; la confirmación del actuador por botón de Telegram **no se construyó**.
- **Despliegue:** todo corre en local; la validación contra un servidor real queda para una etapa posterior.
- **Escalado:** probado con uno o pocos nodos; no con muchos a la vez ni durante horas.
- **Actuador:** sin relevador real; Atl no ve si el relevador actuó.
- **Umbrales:** 0.3 / 0.5 / 1.0 / 85 % son criterio del equipo, no de la norma, y no los ha validado un especialista.
- **Gráfica con datos reales con huecos:** probada con datos sembrados sin huecos.

---

## 17. Fuentes de los nombres de la arquitectura

- [The Hexagonal or Ports & Adapters Architecture (keynote de Alistair Cockburn, SAG 2025)](https://conferences.isaqb.org/software-architecture-gathering/sag-2025-keynote-alistair-cockburn-the-hexagonal-or-ports-adapters-architecture/): el artículo original de 2005 está en alistair.cockburn.us/hexagonal-architecture
- [Ports & Adapters Architecture (Herberto Graça)](https://herbertograca.com/2017/09/14/ports-adapters-architecture/)
- [Pattern: Transactional outbox (microservices.io)](https://microservices.io/patterns/data/transactional-outbox) y [Pattern: Polling publisher](https://microservices.io/patterns/data/polling-publisher.html)
- [Functional Core, Imperative Shell (resumen de la charla *Boundaries* de Gary Bernhardt, 2012)](https://kyle.au/notes/technology/development/functional-core-imperative-shell-pattern)
