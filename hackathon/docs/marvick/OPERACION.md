# Operación: correr Atl, probar con simulador y con tu placa

Guía práctica. Todo corre en la laptop de Jesús (no hay servidor desplegado). Los comandos se ejecutan en `hackathon/server` o `hackathon/web`, **siempre con `pnpm --ignore-workspace`** (`hackathon/` no pertenece al workspace del repo principal). Node 24 es necesario.

## 1. Primera vez
```bash
cd hackathon/server && pnpm install --ignore-workspace
cd ../web && pnpm install --ignore-workspace
```
- Servidor: copia `server/.env.example` a `server/.env` y llénalo (el `.env` **no se versiona**; Jesús tiene los valores: Mongo Atlas, clave de cifrado, token de Blynk de prueba, bot de Telegram, id de proyecto de Firebase). **No pidas ni pegues esos valores en chats ni en commits.**
- Web: copia `web/.env.example` a `web/.env` (`VITE_API_URL` y la configuración pública de Firebase).
- Si el DNS de la laptop no resuelve Atlas (`querySrv ECONNREFUSED`): `MONGODB_DNS=8.8.8.8,1.1.1.1`.
- Una vez: `pnpm db:indices` (crea los índices).

## 2. Arrancar
| Qué | Comando | Dónde |
|---|---|---|
| Servidor (API + ingesta + alertas + Telegram) | `pnpm dev` | `hackathon/server`, puerto `PORT` (3000 por defecto) |
| Web | `pnpm dev` | `hackathon/web`, http://localhost:5173 (usa `localhost`, no `127.0.0.1`: Firebase solo autoriza `localhost`) |
| Solo API (sin leer Blynk) | `INGESTA_ACTIVA=false` en `.env` | |
| Ensayar el actuador sin escribir en Blynk | `ACTUADOR_ESCRIBE_BLYNK=false` en `.env` | |

Comprobar que vive: `GET /api/salud` → `{ok, mongo, blynk}` todos `true`.

## 3. Dar de alta tu nodo
1. En Blynk, crea (o usa) un dispositivo de la plantilla `Atl Nodos` y copia su **Auth Token** (no el id de la plantilla: son dos cosas distintas; el *token del dispositivo* va en el firmware y en Atl).
2. En la web: inicia sesión con Google → **Comunidad** → agrega el nodo pegando el token. El servidor lo valida contra Blynk, lo **cifra** y no vuelve a mostrarlo.
3. Atajo para desarrollo: `pnpm nodo:alta --nombre "Tinaco azotea" [--comunidad "Comunidad demo"]` (usa `BLYNK_TOKEN_PRUEBA` del `.env`); `pnpm nodo:lista` muestra nodos y última lectura; `pnpm nodo:borrar --id <id> --si`.
4. **Un dispositivo de Blynk por nodo.** Si dos nodos de Atl apuntan al mismo dispositivo, reaccionan juntos (y los avisos van al Telegram de ambos).
5. Telegram: en **Comunidad**, «Vincular Telegram» da un enlace; ábrelo en el teléfono y toca **Iniciar**. Después prueba `/estado`.

## 4. Probar sin hardware (simulador)
El simulador escribe `ph`, `ph_crudo`, `estado`, `estable` y `seq` en el dispositivo de Blynk del `.env`, como lo haría tu firmware.
```bash
pnpm simulador --lista
pnpm simulador --escenario demo_limon          # ~2 min: 7.2 → 5.3 → 7.2 (la historia de la demo)
pnpm simulador --escenario acidificacion
pnpm simulador --escenario sensor_desconectado # estado 3
pnpm simulador --escenario nodo_detenido       # seq quieto → "sin conexión"
pnpm simulador --escenario pico --sin-escribir # solo imprime
```
Opciones: `--intervalo-s`, `--velocidad`, `--duracion-s`, `--sin-escribir`. **Cuidado:** si ya hay un nodo de Atl con Telegram vinculado sobre ese dispositivo, el servidor encendido **manda avisos reales** a ese Telegram. Por eso el simulador y tu placa **no deben escribir al mismo dispositivo a la vez**.

## 5. Prueba de humo (cadena completa)
```bash
pnpm smoke --comprobar    # solo lee: configuración, Mongo, Blynk, Telegram y nodos que comparten dispositivo
pnpm smoke --velocidad 10 --intervalo-s 2 --sondeo-s 2   # ≈ 32 llamadas a Blynk, ~40 s
```
Crea una comunidad y un nodo de prueba, simula `demo_limon`, comprueba muestras, alerta crítica abierta y cerrada, API y PDF, y **borra todo** al terminar (deja el dispositivo en pH 7.2). Se detiene si hay nodos con Telegram sobre el mismo dispositivo (usa `--aceptar-avisos` solo si lo aceptas). `--con-telegram --comunidad <id>` manda además un mensaje y el PDF.
Los pasos del actuador del humo se escribieron pero **no se han corrido** contra Blynk (iba lento ese día).

## 6. Probar con tu placa (orden sugerido)
1. Apaga el simulador. Flashea el firmware con el **token del dispositivo de tu nodo** (sin subirlo al repo).
2. En Blynk (web o app) confirma que `V6` sube y `V2` cambia.
3. Arranca el servidor y la web: el nodo aparece en «Mi agua» con su pH y estado en pocos segundos.
4. Recorre el **checklist de `CONTRATO_FIRMWARE.md` §8** y marca solo lo que viste funcionar.
5. Para el actuador, empieza con el actuador **simulado** en la web (Comunidad → ajustes del actuador) y `ACTUADOR_ESCRIBE_BLYNK=false`; solo cuando el firmware tenga sus enclavamientos, prueba el relevador real **con agua y consentimiento de Jesús**.

## 7. Calidad del código (para cambios al servidor/web)
`pnpm test` (unitarias, ~590 en servidor y ~60 en web) · `pnpm lint` · `pnpm typecheck` · `pnpm build` (web). Integración contra Atlas con base temporal: `ATL_TEST_MONGO=1` (necesita `MONGODB_URI`). Reglas: TypeScript estricto, zod `.strict()` en todo, Conventional Commits, rama `hackathon/atl`, sin commits ni push sin que Jesús lo pida.

## 8. Problemas comunes
| Síntoma | Causa probable |
|---|---|
| La web dice «No pudimos conectar con Atl» | El servidor no está arriba, `VITE_API_URL` apunta a otro puerto o falta `CORS_ORIGINS` (debe incluir `http://localhost:5173`) |
| Google abre la ventana pero no entra | Dominio no autorizado en Firebase (agregar `localhost`) o usar `127.0.0.1` en lugar de `localhost` |
| «Sin conexión» con la placa prendida | `seq` no cambia (publícalo siempre), o la placa escribe a otro dispositivo/token |
| Datos viejos aunque la placa esté apagada | Blynk conserva el último valor; solo `seq` revela que está detenida |
| No llegan avisos a Telegram | Falta `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`, el chat no está vinculado, o el polling se atoró (reinicia el servidor) |
| `querySrv ECONNREFUSED` | DNS de la laptop: usar `MONGODB_DNS=8.8.8.8,1.1.1.1` |
| Blynk responde lento (2–8 s) | Pasa; los comprobadores usan un tiempo de espera de 5 s y pueden fallar sin que Atl esté mal |
| Un nodo viejo abre alertas y manda avisos | Comparte el dispositivo de Blynk: bórralo con `pnpm nodo:borrar` o usa otro dispositivo |

## 9. Quién es quién
Jesús: arquitectura y servidor. Marvick: hardware y firmware. Brian: presentación. Brenda: comunicación. El guion de la demo (qué se puede afirmar y qué no) está en `hackathon/docs/GUION_DEMO.md`.
