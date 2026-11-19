# Contrato firmware ↔ servidor

Todo lo que el servidor Atl **espera** de la placa y todo lo que **hace** con lo que la placa publica. Si cumples esto, el sistema entero (web, Telegram, reportes, alertas) funciona sin tocar nada más. Referencia en código: `server/src/modulos/ingesta/ciclo.ts` (lectura), `server/src/modulos/nodos/nodo.ts` (mapa de pines), `server/src/modulos/control/` (actuador), `server/config/parametros.json` (límites y reglas).

## 1. Cómo se comunican (Blynk, sin MQTT propio)
- La placa usa la **librería de Blynk** (WiFi) con el Auth Token del dispositivo. Plantilla `Atl Nodos`, datastreams V1–V10 (la plantilla ya existe; el dispositivo de prueba también).
- El servidor **no se conecta a la placa**: cada `POLL_MS` (5 s por defecto) llama a la HTTP API de Blynk `GET /external/api/getAll?token=…` y lee todos los pines de un golpe. Para el actuador **escribe** un pin con `batch/update`.
- Consecuencia importante: Blynk **conserva el último valor** de cada pin aunque la placa se apague. Por eso existe `seq` (ver abajo).

## 2. Tabla de pines

| Pin | Nombre | Dirección | Tipo | ¿Lo usa el servidor hoy? |
|---|---|---|---|---|
| V0 | `led_ejemplo` | — | int | No (del ejemplo oficial) |
| V1 | `temperatura` | placa → nube | double °C | **No se guarda todavía** (solo se ve en la app de Blynk). Si no hay sensor, publica un valor fijo y no lo presentes como medido |
| **V2** | `ph` | placa → nube | double | **Sí.** pH ya calibrado y filtrado. Es *el* dato |
| V3 | `mv` | placa → nube | double | No (diagnóstico para la app de Blynk) |
| **V4** | `estado` | placa → nube | int | **Sí, parcial.** `0` ok · `1` atención · `2` fuera de rango · `3` error de sensor. El servidor evalúa el estado él mismo con V2; de V4 solo hace caso a **`3` = error de sensor** |
| **V5** | `estable` | placa → nube | int | **Sí.** `1` lectura estable, `0` estabilizando (la web lo muestra) |
| **V6** | `seq` | placa → nube | int ≥ 0 | **Sí, crítico.** Contador que **sube en cada muestra nueva** |
| **V7** | `ph_crudo` | placa → nube | double | **Sí.** pH sin filtrar (la web puede mostrar «crudo vs. filtrado») |
| **V8** | `bomba` | **nube → placa** | int 1/0 | **Sí.** Lo **escribe el servidor** (pulso de dosificación). Ver §5 |
| V9 | `modo` | — | int | No hoy (0 manual · 1 automático con enclavamientos; reservado) |
| V10 | `cal_pct` | placa → nube | double | **Se lee:** es la pendiente de la sonda como % de Nernst. Al llegar el primer valor, y cada vez que cambie 0.5 puntos o más, Atl lo guarda como una calibración «reportada por el nodo» con su diagnóstico (buena ≥ 95 %, desgastada ≥ 85 %, revisar si menos). Publícalo solo cuando cambie (tras calibrar); `0` o vacío significa «nunca calibrada» y se ignora; se descarta lo que pase de 150 |

Los pines son configurables por nodo (el mapeo vive en el documento del nodo en Mongo y en `parametros.json`); si cambias un número de pin, avísale a Jesús, no lo cambies en silencio.

## 3. `seq`: la señal de vida (la regla más importante)
- **Cada muestra nueva incrementa `V6` en 1** (o más). Un contador que no avanza = placa detenida.
- El servidor compara `seq` entre sondeos: si **cambió**, guarda una muestra nueva con la hora del servidor; si **no cambió** durante `SIN_DATOS_S` (60 s por defecto), abre la alerta **«sin conexión»**.
- Si `seq` **baja** (reinicio de la placa), el servidor lo detecta como reinicio y abre una *sesión* nueva; no pasa nada malo. No es necesario guardar `seq` en NVS.
- Publica **primero el valor y al final `seq`** (o todo en el mismo lote): así el servidor nunca ve un `seq` nuevo con un pH viejo.
- Si publicas cada 2 s y el servidor sondea cada 5 s, se guarda **una muestra por sondeo** (verá `seq` saltar de 3 en 3); es normal.
- Un `seq` ausente, negativo o no entero se ignora como inválido.

## 4. Qué decide el servidor con tu pH (para que lo entiendas, no para que lo repitas)
El estado lo calcula el servidor con **`V2` y los límites de `parametros.json`** (versión `0.1-hackathon`; sujetos a ajuste del equipo, no son de la norma salvo 6.5–8.5):

| Estado | Criterio (por defecto) |
|---|---|
| `en_rango` | 6.5 ≤ pH ≤ 8.5 y a más de 0.3 de los límites (la estabilidad es una bandera aparte, no cambia el estado) |
| `atencion` | dentro del rango pero a **0.3 o menos** de un límite, o con cambio rápido |
| `fuera_de_rango` | fuera de 6.5–8.5 |
| `critico` | a más de **1.0** fuera de un límite (pH < 5.5 o > 9.5); entra de inmediato, sin esperar 3 lecturas |
| `revisar_sensor` | `V4 = 3`, pH fuera de 0–14, pegado a los rieles, o sonda degradada |
| `sin_datos` | `seq` sin cambiar por `SIN_DATOS_S` |

Más reglas (todas en `parametros.json`, sección `ph.reglas`): histéresis de 0.1 y **3 lecturas** seguidas para empeorar a *atención* o *fuera de rango* (evita parpadeo; *crítico* entra de inmediato), **cambio rápido** de 0.5 pH en 5 min (alerta aunque siga en rango), estabilidad (desviación < 0.02 en 10 lecturas), sonda degradada si la pendiente de la **última calibración registrada** es < 85 % de Nernst (el servidor no la lee de `V10`), y «pegado» si el valor no cambia en 120 lecturas seguidas. Conclusión práctica: **no inventes ni «arregles» el pH en el firmware para que se vea bonito**; publica lo medido y marca `V4 = 3` si la sonda falla.

La alarma local del firmware (buzzer + relevador, 6.5–8.5 con histéresis) **es independiente** y debe funcionar sin red; el servidor no la gobierna.

## 5. Actuador (V8): lo que hace el servidor y lo que **tiene que** hacer el firmware

**Lo que hace el servidor** (`modulos/control`):
1. Una persona responsable **pide** un pulso en la web (no pasa nada aún) y otra o la misma lo **confirma** en menos de 120 s.
2. Al confirmar, el servidor escribe **`V8 = 1`**.
3. Cuando se cumple la duración (verificado cada 2 s, así que ±2 s), escribe **`V8 = 0`**.
4. Si durante un pulso el pH sale de rango, el sensor falla o no hay datos, escribe **`V8 = 0` primero** y luego lo registra y avisa (solo si el nodo tiene `auto_detener`).
5. Reglas de la nube antes de aceptar un pulso: hay datos recientes, sensor sano, pH en rango (ni fuera de rango ni crítico), ningún pulso en curso y pasó el enfriamiento. La duración máxima por nodo la fija el responsable (tope de 120 s del servidor).
6. **El servidor no puede saber si el relevador realmente actuó**: Blynk devuelve el último valor escrito, no lo que hizo el hardware. Los textos dicen «orden enviada» y «Atl no ve si actuó». Si quieres que el sistema lo sepa, habría que publicar un pin de confirmación (hoy no existe; coméntalo con Jesús).

**Lo que debe hacer el firmware (obligatorio, es la capa que manda):**
- **Relevador APAGADO al arrancar.** Al conectar a Blynk, **no sincronices V8 con el valor guardado** (puede quedar un `1` viejo de antes del reinicio). Escribe tú `V8 = 0` al arrancar o ignora el valor hasta ver un flanco nuevo.
- **Pulso máximo propio** (temporizador local; no dependas de que llegue el `0`). Debe ser ≤ el máximo que el responsable configuró en la web.
- **Apagar** el relevador si: no hay lectura de pH válida, `estado = 3`, se perdió el WiFi/Blynk más de unos segundos, o el pH sale de rango (mismos criterios que la nube, pero **locales**).
- **Enfriamiento propio** entre pulsos.
- **Modo manual/automático (V9):** si implementas el automático local, que sea el firmware quien decida; la nube no lo usa.
- Tratar `V8 = 1` como **petición**: el firmware puede **rechazarla** si algún enclavamiento no se cumple, y en ese caso debe dejar `V8 = 0`.
- **Nunca** subir la dosis por una lógica que solo exista en la nube.

## 6. Qué mensajes de Blynk se gastan (¡cuidado con el plan gratuito!)
- Cada `virtualWrite` de la placa y cada llamada HTTP del servidor cuenta como mensaje en Blynk. **Los límites del plan gratuito no están verificados.** Con 5 pines cada 2 s son ~150 mensajes/min solo de la placa.
- Recomendación: publicar **cada 5 s** (igual que el sondeo) y solo los pines de la tabla marcados «Sí», o agrupar. Si pasas de ~60 s entre publicaciones hay que subir `SIN_DATOS_S` y `reporte.hueco_max_s` en el servidor (avísale a Jesús).
- Durante el desarrollo se mide el consumo de mensajes antes de dejarlo corriendo horas.

## 7. Calibración
- Dos puntos: buffers de **pH 4 y pH 7**, comandos serial `c4`, `c7` (solo capturan si la ventana es estable, < 3 mV), `s` (muestra mv4, mv7 y pendiente en mV/pH), `r` (reset). Se guarda en **NVS**.
- Publicar la **pendiente como % de Nernst** en `V10` y el **offset** ayuda a la historia («la sonda está sana/degradada»).
- El servidor guarda un registro de **calibraciones** por nodo (API `POST /api/nodos/:id/calibraciones`, solo el responsable; «Mi agua» y el PDF muestran la última). **No se sincroniza solo desde la placa** y la web hoy **no trae formulario** para anotarla: si calibras frente al jurado, pídele a Jesús que la registre por la API, o se muestra desde el serial. La pendiente de esa calibración es la que puede marcar «sonda degradada».
- Pendientes sin verificar (de `contexto-hackathon.md`): el registro y el orden de bytes de la entrada externa del XN03, y el voltaje de salida del módulo de pH (si es 5 V hace falta divisor hacia el ADC de 3.3 V máx.).

## 8. Checklist para cerrar el Paso 11 (compila ≠ funciona)
Marca solo lo que **viste funcionar en la placa**:

- [ ] La placa conecta a Blynk y `V6 seq` sube.
- [ ] Con la placa conectada, el servidor (`pnpm dev` + web, ver `OPERACION.md`) muestra el pH en vivo.
- [ ] Buffer pH 7 → la web marca «En rango»; buffer pH 4 → «Fuera de rango» y llega el aviso a Telegram.
- [ ] Desconectar la sonda → `V4 = 3` y la web dice «revisar sensor».
- [ ] Apagar la placa → a los ~60 s «sin conexión»; al prenderla, «reconexión».
- [ ] Reiniciar la placa → relevador apagado, `seq` reinicia, el sistema sigue sano.
- [ ] `V8 = 1` desde la web (pulso simulado primero) → relevador enciende y se apaga solo, aunque la nube no mande el `0`.
- [ ] Sin WiFi: alarma local (buzzer + relevador) funciona.
- [ ] Calibración a 2 puntos y pendiente razonable (95–105 % = sana).

Hasta que esto esté marcado, el reporte de estado del firmware es **«compila», no «funciona»**.
