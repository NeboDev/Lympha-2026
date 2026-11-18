# Arquitectura de Atl (para quien hace el hardware, o su agente de IA)

Resumen de cómo está construido el sistema **fuera de la placa**. La especificación completa está en `hackathon/docs/ARQUITECTURA.md`; las decisiones y sus razones, en `hackathon/docs/decisiones.md`. Esto es la versión corta y fiel al código al **2026-11-18**.

## 1. Piezas

| Pieza | Qué es | Dónde vive |
|---|---|---|
| Nodo | ESP32-S3 + sonda de pH + relevador + buzzer (el firmware de Marvick) | repo de firmware / `firmware/` (pendiente) |
| **Blynk** | Capa de **tiempo real**: la placa escribe pines virtuales; el servidor los lee y escribe V8. También es el tablero en vivo de la demo | Blynk Cloud, plantilla `Atl Nodos` |
| **Servidor Atl** | Node 24 (TypeScript directo, sin build) con Fastify 5, zod, driver `mongodb`, `firebase-admin`, `pdfkit`. **Un proceso** | `hackathon/server` |
| **MongoDB Atlas** | **Registro permanente** y fuente de los reportes (Blynk no guarda histórico largo ni calibraciones ni acciones humanas) | Atlas; plan B: Mongo local en Docker (sin probar) |
| **Telegram** | Avisos, `/estado`, `/reporte`. Bot propio con `fetch` + long polling (sin librería) | `@lympha26_bot` |
| **Firebase Auth** | Inicio de sesión con Google. El servidor **solo verifica tokens**; no hay contraseñas ni sesiones propias | proyecto `Lympha Atl` |
| **Web (PWA)** | Vite + React + CSS con tokens; sin librería de componentes ni de gráficas (gráfica SVG a mano) | `hackathon/web` |
| Simulador | Hace de nodo escribiendo en Blynk por HTTP; permite probar todo **sin hardware** | `server/src/simulador` (`pnpm simulador`) |

Por qué dos capas (Blynk + Mongo): Blynk ve y acciona en vivo, pero no es registro; el reporte NOM-127 necesita datos que no se pierdan.

## 2. Flujos

### Ingesta (Blynk → Mongo)
`modulos/ingesta`: cada `POLL_MS` (5 s) el poller pide `getAll` de **cada nodo** (token descifrado en memoria). `decidirCiclo` (puro) usa `seq`: cambió → muestra nueva `{nodo_id, ts, v:{ph}, crudo, estado, seq}`, índice único por nodo (idempotente, sin duplicados); no cambió → pasados `SIN_DATOS_S` (60 s) evento `sin_datos`; reapareció → evento `reconexion`; `seq` bajó → reinicio (nueva sesión). Si Mongo cae, el poller guarda en búfer y reintenta con espera exponencial. Se puede apagar con `INGESTA_ACTIVA=false` (solo API).

### Evaluación → estado
`modulos/evaluacion` (funciones puras, sin I/O): estado por parámetro a partir de una ventana reciente: `en_rango`, `atencion`, `fuera_de_rango`, `critico`, `revisar_sensor`, `sin_datos`, con histéresis, cambio rápido, estabilidad y sensor degradado. **Todo criterio sale de `server/config/parametros.json`**; no hay `if (parametro === "ph")` fuera de `dominio/ph.ts` (Nernst, calibración de 2 puntos, mV→pH con temperatura, fracción de HOCl).

### Alertas y avisos
`modulos/alertas`: reconcilia tras cada muestra y en un barrido periódico (`BARRIDO_MS`): abre/escala/cierra alertas de tipo **nivel**, **cambio rápido**, **sensor** y **sin conexión**, y programa recordatorios (`RECORDATORIO_MIN`, la mitad si es crítica). Los avisos van a una **bandeja** en Mongo (`modulos/notificaciones`: arrendamiento + reintentos, garantía *al menos una vez*) y el **enviador** los manda por Telegram. Sin `TELEGRAM_BOT_TOKEN`, los avisos esperan en la bandeja. Los textos viven en `dominio/frases.ts` y una prueba automática impide «potable»/«seguro».

### Telegram (`modulos/telegram`)
Vinculación por enlace profundo: la web genera un enlace `t.me/<bot>?start=<token>`; al abrirlo, el bot recibe `/start <token>` y liga el chat a la comunidad. Comandos: `/start <token>`, `/estado`, `/reporte [días]` (manda el PDF), `/ayuda`, `/desvincular`. **No hay botón de confirmación del actuador en Telegram**: la confirmación es solo en la web (decisión del Paso 8).

### Reportes (`modulos/reportes`, `plataforma/reporte-pdf.ts`)
PDF carta con `pdfkit`, identidad «Lympha Atl»: resumen por periodo, **cobertura de datos**, estadística del pH (promedio, mín., máx., % dentro del rango NOM-127), alertas, calibraciones, bitácora y **lo que NO se midió** (cloro, turbidez, TDS…). Nunca dice «cumple» global con un solo parámetro. Se obtiene por la web, por la API (`POST /api/nodos/:id/reportes`), por Telegram (`/reporte`) y por CLI (`pnpm reporte`). El periodo lo elige quien lo pide (por días o por fechas).

### Control del actuador (`modulos/control`)
Pedir → confirmar (≤ 120 s) → el servidor escribe `V8 = 1` → un barrido (cada 2 s) escribe `V8 = 0` al cumplirse la duración. Estados de una acción: `pendiente`, `en_curso`, `terminada`, `detenida`, `cancelada`, `expirada`, `rechazada`, `fallida`. Una sola acción viva por nodo (índice único parcial). Enclavamientos en la nube: sin actuador, sin datos, sensor, fuera de rango/crítico, pulso en curso y enfriamiento. Apagado automático si el agua sale de rango durante un pulso (solo con `auto_detener`). El servidor **nunca** sube la dosis sola. `ACTUADOR_ESCRIBE_BLYNK=false` ensaya todo sin escribir en Blynk; un actuador `simulado` rotula todo como simulado. **Los enclavamientos que mandan son los del firmware** (ver `CONTRATO_FIRMWARE.md` §5).

## 3. Módulos del servidor (`hackathon/server/src`)
```
main.ts            arranque: config → mongo → servicios → API, poller, barridos, Telegram
config.ts          variables de entorno validadas con zod (si falta una, no arranca)
dominio/           ph.ts · catalogo.ts · frases.ts · errores.ts   (puros)
modulos/           identidad · comunidades · nodos · ingesta · evaluacion · alertas ·
                   notificaciones · telegram · reportes · bitacora · calibraciones · control · api
plataforma/        mongo · blynk · lector-blynk · escritor-actuador-blynk · cifrado ·
                   firebase · telegram-api · telegram-polling · generador-reportes · logger · almacenes Mongo
simulador/         escenarios del nodo falso         humo/ y cli/   pruebas de humo y herramientas
```
Reglas de frontera: cada módulo expone `index.ts` y nadie importa archivos internos de otro; el I/O vive en `plataforma/`; `plataforma/blynk.ts` (con el lector y el escritor) es lo **único** que habla con Blynk.

## 4. Modelo de datos (Mongo, base `atl`)
`comunidades` (miembros con rol `responsable`/`integrante`, vínculo de Telegram) · `nodos` (token de Blynk **cifrado AES-256-GCM**, mapeo de pines, `ultimo`, `actuador`) · `muestras` · `alertas` · `eventos` · `avisos` (bandeja) · `acciones_actuador` · `calibraciones` · `bitacora` · `reportes` · `usuarios`. Fechas en UTC; `America/Mexico_City` solo para mostrar/agrupar por día. El token de Blynk nunca sale por API ni por logs.

## 5. API REST (resumen; todas bajo `/api`, Bearer de Firebase)
- `GET /api/salud` (pública) · `GET /api/yo`
- Comunidades: `POST /api/comunidades` · `GET /api/comunidades/:id/nodos` · alta de nodo (valida el token contra Blynk y lo cifra) · `POST …/telegram/vinculo` (enlace de vinculación)
- Nodos: `GET /api/nodos/:id` · `…/muestras?desde=&paso=` (máx. 1000 puntos) · `…/eventos` · `…/bitacora` · `…/calibraciones` (GET/POST) · `…/reportes` (GET lista los anteriores, POST genera el PDF)
- Actuador: `GET|PUT /api/nodos/:id/actuador` · `POST …/actuador/pulsos` · `…/pulsos/:accion/confirmar` · `…/pulsos/:accion/cancelar` · `…/actuador/detener`
- Seguridad: un recurso ajeno responde **404** (igual que inexistente), un integrante sin rol responde 403; `cache-control: no-store`; errores tipados sin trazas.

## 6. Reglas de diseño que debes respetar
1. **Dirigido por configuración:** cambiar de sensor el jueves no debe tocar la lógica; parámetros, límites y pines están en `parametros.json` y en el documento del nodo (solo `pH` es medible hoy; cloro, turbidez, TDS y ORP están en el catálogo como «no medible»).
2. **Honestidad:** nunca «potable», «seguro» ni «cumple NOM-127»; lo no medido se dice.
3. **Actuador seguro** (§2) y **no inventar datos** (un hueco se registra, no se rellena).
4. **Secretos:** nunca en el repo ni en logs; `.env` no se versiona (los nombres están en `server/.env.example`).
5. Español de México en todo texto visible; Conventional Commits; rama `hackathon/atl`.

## 7. Qué no está hecho o no se probó
- Firmware contra este servidor, relevador real y alarma local sin red (**tu parte**).
- Temperatura (`V1`), `mv` (`V3`) y `cal_pct` (`V10`) no se guardan en Mongo hoy; se pueden añadir como parámetros nuevos al catálogo si el reto lo pide.
- Botones de confirmación en Telegram, escaneo de QR, asistente de calibración en la web, instalación como PWA.
- Grupos de Telegram, varias personas a la vez, reportes de 90 días con muchos datos y comportamiento tras horas de ejecución (el polling de Telegram se atoró una vez tras suspender el equipo).
- Despliegue en un servidor real: todo corre en la laptop de Jesús; plan B de base de datos (Mongo local en Docker) sin probar.
