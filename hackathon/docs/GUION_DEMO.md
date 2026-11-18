# Atl — Guion de la demo (3 minutos) y lista de preparación

Esto es lo que **hoy hace Atl de verdad**, probado contra Blynk, Atlas y Telegram reales. Lo que depende del
hardware del jueves (relevador, alarma local, sonda real) va aparte, marcado **«solo si»**: no se dice en la demo
si no está probado. Honestidad primero (`CLAUDE.md` §3).

## 0. Qué se puede afirmar (y qué no)

| Se puede afirmar (probado) | No se afirma salvo que esté probado en la placa |
|---|---|
| El pH llega de Blynk a Atlas y a la web en vivo, con su estado (color + símbolo + palabra) | «El relevador dosificó» o «Atl detiene la dosificación» en la placa (Atl manda la orden a Blynk, pero no ve si el relevador actuó; probado solo en modo simulado) |
| Si el agua sale de rango, abre una alerta y avisa por Telegram con «qué hacer»; avisa al recuperarse | «La alarma local sigue con el WiFi apagado» (es del firmware; sin probar) |
| `/estado` y `/reporte` en Telegram; el reporte PDF desde la web y desde Telegram | «Calibramos frente al jurado» (el firmware calibra; la web solo muestra la última) |
| El PDF trae resumen, cobertura de datos, calibraciones, bitácora y **lo que no cubre** | «Cumple la NOM-127» o «es potable / segura»: **nunca** |
| «Con este pH, ~X % del cloro libre es la forma efectiva» (estimación; Atl no mide cloro) | «Kanan ya vigila tinacos en la BUAP»: solo si el equipo lo puede demostrar |

## 1. Antes de salir de casa / al llegar (30 min)

Hazlo en este orden. Cada línea tiene cómo comprobarla.

- [ ] **Servidor**: `cd server && pnpm dev` → «Atl listo». Si el DNS no resuelve Atlas: `MONGODB_DNS=8.8.8.8,1.1.1.1`.
- [ ] **Web**: `cd web && pnpm dev` → `http://localhost:5173` (con `localhost`, no `127.0.0.1`). Entra con Google.
- [ ] **Sin nodos viejos**: `pnpm nodo:lista` y borra los de pruebas (`pnpm nodo:borrar --id … --si`). Un nodo viejo sobre el
      mismo dispositivo de Blynk **también manda avisos** al Telegram del jurado.
- [ ] **Comprobación general (solo lee)**: `pnpm smoke --comprobar` → todo «OK», y «ninguno» en *Nodos sobre el mismo dispositivo*.
- [ ] **Humo completo** (escribe en Blynk; apaga el servidor antes o usa un dispositivo propio): `pnpm smoke`
      → todo «OK» y un PDF en `salida-humo/`. Con Telegram: `pnpm smoke --con-telegram --comunidad <id>`.
- [ ] **Telegram**: el chat del jurado vinculado (web → Comunidad → «Vincular Telegram»). Prueba `/estado` y `/reporte`.
- [ ] **Teléfono del jurado**: Telegram instalado, con internet propio (datos) por si el Wi-Fi del recinto falla.
- [ ] **Un reporte ya generado** guardado en el teléfono (el de `salida-humo/`) por si falla la red a media demo.
- [ ] **Internet del recinto incierto**: hotspot del teléfono listo. Google, Blynk, Atlas y Telegram lo necesitan.

## 2. El guion (≈ 3 min)

| Min | Qué se muestra | Qué se dice (voz de vecino que sabe) |
|---|---|---|
| 0:00 | Una foto o frase de una comunidad con su tinaco. **Sin tecnología.** | «En muchas comunidades nadie sabe qué hay en su agua hasta que alguien se enferma. Queremos que lo vean antes.» |
| 0:30 | **Mi agua**: el pH real o simulado en vivo, «En rango», escala de pH, «lectura estable · hace 4 s». La app de Blynk al lado. | «Esto es el agua de este tinaco, ahora. Blynk la ve en tiempo real; Atl la **entiende** y la guarda.» |
| 1:15 | **El evento.** Real: agregar limón. Plan B: `pnpm simulador --escenario demo_limon --intervalo-s 3`. El pH baja; la tarjeta pasa a «Fuera de rango» y luego «Crítico». | «Le echamos limón. Fíjense: el pH baja y Atl lo dice con palabras: qué pasó y qué hacer.» |
| 1:35 | **El Telegram del jurado** suena: aviso con «qué hacer». En la web, la tarjeta de **efectividad del cloro** baja. | «Quien cuida el agua ya lo sabe, aunque no esté mirando la pantalla. Y con este pH el cloro actúa menos: conviene corregir el pH antes de subir la dosis.» |
| 2:00 | Recuperación (bicarbonato o el final del escenario): vuelve a «En rango» y llega el aviso de recuperación. | «Y cuando se arregla, también avisa. La alerta duró unos minutos.» |
| 2:15 | **`/reporte`** en el Telegram del jurado → el PDF llega. Se abre: resumen, insignia, gráfica, alertas, bitácora y **«Lo que este reporte no cubre»**. | «La memoria del agua. Dice lo que midió **y lo que no**: un sensor de pH no certifica nada.» |
| 2:45 | Cierre. | «Atl no certifica el agua: ayuda a una comunidad a vigilarla y a documentarla.» |

**Solo si el hardware lo permite** (pruébalo el miércoles; si no, se omite sin decirlo): la alarma local del nodo (buzzer),
el relevador que se apaga, y la calibración frente al jurado. El guion funciona **sin** ellos.

### Si sobra tiempo (30 s)
Web → Comunidad → anotar en la **bitácora** («se agregó limón»): sale en el PDF siguiente, con fecha. Es lo humano del producto.

## 3. Preguntas difíciles (respuestas honestas)

- **«¿Esto certifica el agua?»** No. Documenta el pH frente al rango de la NOM-127 y dice qué no mide.
- **«¿Por qué no solo Blynk?»** Blynk es el tiempo real; el histórico gratuito es corto y no guarda calibraciones, acciones ni
  bitácora. Atl guarda esa memoria y arma el reporte.
- **«¿Y si se va el internet?»** El servidor muestra el hueco y no lo inventa: el reporte trae la cobertura de datos. La alarma
  local es del firmware (**solo si** está probada).
- **«¿Dosifican cloro solos?»** Hoy no: Atl **recomienda**, y la estimación de efectividad del cloro es teórica (Atl no mide cloro).
  Subir la dosis lo confirma una persona. Lo automático se limita a acciones seguras (detener y avisar), **solo si** el relevador existe y está probado.
- **«¿Qué hay de nuevo?»** Memoria confiable, reporte normativo honesto y comunidad (el Telegram grupal), no solo un tablero.
- **«¿Cuántos nodos aguanta?»** Probado con un nodo a la vez en esta versión; el diseño admite varios (sin probar aquí).

## 4. Plan B (si algo falla, cortar a los 30 minutos)

| Falla | Qué hacer |
|---|---|
| Google no deja entrar | Servidor con `APP_ENV=demo`, `USUARIO_DEMO_ACTIVO=true` y `USUARIO_DEMO_TOKEN`; web con el mismo `VITE_DEMO_TOKEN` → botón «Entrar como demostración». |
| No hay sensor / agua | `pnpm simulador --escenario demo_limon --intervalo-s 3` escribe en Blynk como lo haría el nodo. |
| Telegram no llega | Mostrar el aviso en la web (alertas abiertas) y el PDF ya guardado en el teléfono. |
| Atlas no responde | **Mongo local en Docker es el plan B previsto pero NO está probado** (el demonio de Docker no estuvo activo). Probarlo el miércoles o llevar el video grabado. |
| Se cae el internet | Hotspot del teléfono. Sin internet no hay Blynk ni Atlas: usar el video de respaldo. |
| Se atora Telegram tras suspender el equipo | Reiniciar el servidor (el `/start` y los comandos pendientes se procesan al volver). |

## 5. Entre ensayos

- Volver a un estado limpio: `pnpm nodo:lista` y borrar lo que sobre; `pnpm smoke` deja el dispositivo de Blynk en calma (pH 7.2).
- Si un ensayo dejó alertas abiertas, la siguiente corrida las cierra sola cuando el agua se estabiliza.
- Cronometrar el guion completo al menos **3 veces** (plan: ensayo de pitch ×3 entre 15:30 y 17:00 del jueves, y una vez el miércoles).
