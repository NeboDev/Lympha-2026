# CLAUDE.md — Atl (hackathon Puebla 2026)

Briefing para la sesión de Claude que **construye** Atl. Léelo completo antes de tocar nada. Memoria del proyecto: mantenlo actualizado al cerrar cada paso.

## 1. Qué estás construyendo
**Atl** (nombre de trabajo, «agua» en náhuatl): vigilancia continua y reportes de la calidad del agua para comunidades, con enfoque **humanista, no comercial**. Es la versión comunitaria de Lympha (ver `../CLAUDE.md`), montada sobre **Blynk** (plataforma del hackathon) + **MongoDB Atlas** + reportes **NOM-127** en PDF + avisos por **Telegram** + sesión con **Google**.

- Evento: **Hackathon Puebla 2026, jueves 19-nov-2026**, Instituto Tecnológico de Puebla, 6 h, 16 equipos. Reto oficial: *«Sistema inteligente para la cloración y monitoreo de la calidad del agua»* (instrumentación, automatización, monitoreo). El **detalle del reto y la rúbrica se conocen el jueves** (o están en la convocatoria PDF del sitio).
- Sensor: **suponemos solo pH** (cloro residual descartado). Puede cambiar → el diseño es **dirigido por configuración** (§3).
- **Se permite código previo** (confirmado por el dueño del proyecto). Reutiliza Lympha donde ayude.
- Equipo: Jesús (arquitectura), Marvick (hardware), Brian (presentación), Brenda (comunicación).

## 2. Léelos en este orden
1. `docs/ARQUITECTURA.md` — system design, flujos, modelo de datos, API, fallos. **Es la especificación.**
2. `docs/IDENTIDAD_VISUAL.md` + `design/tokens.css` — marca, paleta, voz, reporte PDF, mensajes.
3. `docs/PLAN_HACKATON.md` — calendario, demo, criterios de «listo».
4. `docs/contexto-hackathon.md` — contexto de hardware y firmware ya bosquejado (XIDE, XC01 R5, XN03, XN13, XN44).
Si algo se contradice, manda: **datos de hardware verificados > ARQUITECTURA > PLAN > IDENTIDAD**. Si el hueco cambia el diseño, **detente y pregunta**; si es menor, decide y anótalo en `docs/decisiones.md` (créalo).

## 3. Reglas que no se negocian
1. **Dirigido por configuración:** parámetros, límites, reglas y mapeo de pines viven en `server/config/parametros.json` y en el documento del nodo. Nada de `if (parametro === "ph")` fuera de `dominio/ph.ts`. Cambiar de sensor el jueves no debe tocar la lógica.
2. **Honestidad del producto:** nunca «potable» ni «seguro» (ni en la web, ni en Telegram, ni en el PDF; con prueba automática en `dominio/frases`). El reporte dice «pH dentro/fuera del rango NOM-127», incluye **cobertura de datos** y lista **lo que no se midió**. Jamás un «CUMPLE NOM-127» global con un solo parámetro.
3. **Actuador seguro:** el firmware decide los enclavamientos (relevador apagado al arrancar, pulso máximo, apagado sin dato válido o sin comunicación). La nube **no** sube la dosis sola: recomienda y una persona confirma. Automático = solo acciones seguras (detener + avisar).
4. **Fronteras:** cada módulo expone `index.ts`; no se importan archivos internos de otro módulo. `evaluacion/` y `dominio/` son funciones **puras** con pruebas; el I/O vive en `plataforma/`. `plataforma/blynk.ts` es lo **único** que habla con Blynk (interfaz `LectorNodo`).
5. **Validar todo con zod** (`.strict()`): cuerpos, parámetros, variables de entorno (si falta una, no arranca). Recursos ajenos → **404**, no 403. Errores de dominio como clases tipadas; nunca trazas al cliente.
6. **Secretos:** **nunca leer ni pedir valores**; los nombres van en `server/.env.example` y la persona llena `.env`. El token de Blynk se **cifra** (AES-256-GCM) y no sale en API ni logs. Sin correos ni nombres en logs (ids).
7. **Fechas** en UTC (`Date`); `America/Mexico_City` solo al mostrar y agrupar por día. Español de México en todo texto visible; nombres de dominio en español `camelCase`/`snake_case`.
8. **No inventes datos:** si Blynk o el nodo no responden, se registra el hueco; no se rellena. Lo que no se pudo probar se reporta como «no probado».
9. **Diseño:** usa solo los tokens de `design/tokens.css`; estado = color + símbolo + palabra; contraste AA; objetivos de 44 px; sin CDN (fuentes y librerías autoalojadas).

## 4. Relación con el repo Lympha (importante)
- `hackathon/` **no es parte del workspace pnpm** (`pnpm-workspace.yaml` solo incluye `apps/*`, `packages/*`, `tools/*`). Dale su propio `package.json` y usa `pnpm install --ignore-workspace` dentro de `hackathon/server` y `hackathon/web`.
- **No modifiques nada fuera de `hackathon/`** salvo una línea: el `biome.json` raíz lo lintaría (`includes: ["**", …]`). Propón agregar `"!hackathon"` a `files.includes` y **pide confirmación** antes. Alternativa: un `biome.json` propio dentro de `hackathon/`.
- Este archivo **anula** al `../CLAUDE.md` en lo que choque dentro de esta carpeta: aquí **sí** se aprueban MongoDB, Blynk, `pdfkit` y `firebase-admin`; no aplica «un solo hito activo», «no avanzar a H5», Postgres/RLS, MQTT ni las reglas de migraciones SQL. Lo demás de la raíz (secretos, español, Conventional Commits, no «potable», usar la herramienta Write para archivos largos en este entorno) **sí aplica**.
- **Rama:** propuesta `hackathon/atl` desde `dev`, **nunca** a `main`. No hagas commit ni push sin que el dueño lo pida. Commits Conventional Commits.
- **Qué reutilizar de Lympha (copiando, no importando):** `packages/wqi` (motor puro; solo si ayuda: el semáforo de pH), patrón de vinculación de `apps/server/src/modules/notificaciones/vinculo.ts`, `apps/web/src/estilos.css` (tokens de la familia), `apps/web/public/fuentes/inter-latin.woff2`, `tools/simulator` (idea de escenarios), `apps/web/src/calibracion` (animación y estados de calibración). **Del repo de Kanan** (no está aquí): `reporteGenerator.js` y `telegramBot.js`; pide al dueño la carpeta si hace falta, o reconstruye una versión mínima según `ARQUITECTURA.md` §5.5.

## 5. Stack
Node 24 (TypeScript directo, sin build, imports con extensión `.ts`, sin `enum`) · Fastify 5 + `fastify-type-provider-zod` · zod · driver `mongodb` · `firebase-admin` (solo verificar tokens) · `pdfkit` · Vitest · Telegram con `fetch` + long polling (sin librería) · Web: Vite + React + CSS con tokens (sin librería de componentes ni de gráficas; gráfica SVG a mano) · Firmware: Arduino «ESP32S3 Dev Module». **No agregues dependencias fuera de esta lista sin preguntar.**

## 6. Orden de construcción (cada paso termina con pruebas, lint y typecheck limpios)
0. **Verificación (no código):** con `curl`, comprobar `getAll`, `update`, `isHardwareConnected` de la HTTP API de Blynk con un token de prueba; anotar forma de la respuesta y límites. Probar conexión a Atlas (o Mongo local). **No avances si esto falla.**
1. Esqueleto: `server/` con `config.ts`, `plataforma/mongo.ts`, `GET /api/salud`, índices.
2. `dominio/ph.ts` + `evaluacion/` (puros) con pruebas: rangos, histéresis, cambio rápido, estabilidad, sensor degradado, fracción HOCl.
3. **Simulador de nodo** (`tools/simulador`): escribe `ph`, `estado`, `seq` en Blynk por HTTP con escenarios (`estable`, `acidificacion`, `pico`, `sensor_desconectado`, `nodo_detenido`).
4. `plataforma/blynk.ts` + `modulos/ingesta` (poller, detección de `seq` detenido, inserción idempotente).
5. `alertas` (ciclo de vida, recordatorios) + `telegram` (vinculación `/start <token>`, `/estado`, avisos, botones de confirmación).
6. `reportes` (agregación + PDF según `IDENTIDAD_VISUAL.md` §7) + `/reporte`.
7. `auth` (Firebase) + `api` REST + `comunidades`/`nodos`/`bitacora` + cifrado del token.
8. `control` (actuador con confirmación y registro).
9. `web/` (4 pantallas) con los tokens.
10. `pnpm smoke` (cadena completa con el simulador) y guion de demo.
11. Firmware: pH ya bosquejado → añadir `seq`, `estable`, `ph_crudo`, `cal_pct`, bomba/modo con enclavamientos. **El firmware no se prueba sin hardware: repórtalo como «compila», no como «funciona».**
Pasos 0–8 se pueden hacer **sin hardware** gracias al simulador.

## 7. Comandos (a definir al crear `package.json`)
`pnpm dev` (servidor con recarga) · `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm simulador --escenario acidificacion` · `pnpm smoke` · `pnpm db:indices`.

## 8. Cuándo preguntar
Contradicciones o huecos que cambian el diseño (p. ej. la rúbrica premia algo que obliga a otra arquitectura; Blynk no ofrece lo que se asumió; el reto cambia el actuador). Preguntas menores: decide y anota. **Antes de cada paso, lista los archivos que vas a crear o modificar.**

## 9. Estado
Actualiza esta sección al cerrar cada paso con: qué quedó hecho, qué se verificó de verdad y qué sigue sin verificar.

| Paso | Estado |
|---|---|
| 0 | **Hecho (2026-11-16).** Verificado de verdad: Blynk `getAll`/`update`/`get`/`isHardwareConnected` con un dispositivo de prueba; Atlas ping + escritura + borrado. Sin verificar: límites del plan gratuito de Blynk. Plantilla `Atl Nodos` (V1–V10) creada a mano. |
| 1 | **Hecho (2026-11-16).** `server/` con config zod, Mongo, logger con `redact`, `GET /api/salud`, CORS por `CORS_ORIGINS` y 11 índices. Verificado: 15 pruebas, lint y typecheck en verde; `pnpm db:indices` creó los índices en Atlas; `/api/salud` devolvió `{ok,mongo,blynk}` todos `true` con el servidor real. Con el DNS de esta máquina hace falta `MONGODB_DNS=8.8.8.8,1.1.1.1`. Sin verificar: Mongo local en Docker (el demonio no estaba activo). |
| 2–11 | pendientes |
