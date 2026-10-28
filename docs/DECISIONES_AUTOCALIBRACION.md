# Decisiones: autocalibración de sensores

Rama `claude/autocalibracion`. Se hizo sin preguntas; cada ambigüedad se resolvió con la opción más simple que sea correcta y segura. Orden: **decisión · alternativas descartadas · motivo**.

## El pedido no coincidía con el repo

El encargo hablaba de Express, Joi, MongoDB, Socket.io, `verificarToken`/`verificarRol`, un ACL de Mosquitto por MAC y un scheduler de muestras. Este repo es otra cosa (Fastify 5 + Zod, PostgreSQL/Timescale con Drizzle, SSE, Firebase Auth, roles `propietario`/`miembro`, Dynamic Security). Se aplicó la **intención** con las convenciones **reales** del repo (CLAUDE.md manda):

| Pedido | Lo que se hizo |
| --- | --- |
| Joi | Zod `.strict()` en `@lympha/contracts` |
| `verificarToken` + `verificarRol` admin/operador | `autenticar` + `exigirRol`: **propietario** calibra, **miembro** solo lee |
| Mongo / `mongoose.models.X` | No existe Mongo. Los valores crudos van en `ts.lecturas.crudo` (jsonb) |
| Socket.io `getIO()` | SSE por espacio: evento nuevo `calibracion` en el canal `espacio:{id}` de Valkey |
| Swagger JSDoc | No hay Swagger; las rutas se declaran con esquemas Zod y en `test/rutas-cubiertas.ts` |
| `/api/v1/calibraciones` | `/api/calibraciones` (el repo no versiona rutas; solo el contrato MQTT lleva `v1`) |
| Número de migración libre | `0014_autocalibracion.sql` (up solamente: el runner del repo no tiene `down`, es expand/contract) |
| `agregarReglaACL`, retenidos | No aplica (ver «Dónde se aplica») |

## Dónde se aplica la calibración

**Decisión: en el worker**, en el consumidor de la cola `lecturas`, **antes** de guardar y de evaluar el WQI (`alCalibrar`, entre leer el lote y `guardarLecturas`).
**Descartado: en el firmware vía MQTT.**
**Motivo:** el firmware es de otro repo y el pedido pedía funcionar sin tocarlo; el worker es la única pieza que ve todas las lecturas antes de que el WQI las use; no hay que extender ACL, retener mensajes ni reflashear; revertir una calibración es inmediato. El firmware ya tiene una calibración propia en NVS (`cal`: `ph_pend`, `ph_desf`, `tds_k`); la del servidor es una **segunda capa** sobre ese valor ya convertido, así que el «crudo» de esta función es *lo que el nodo publica*, no el voltaje del ADC.
**Consecuencia:** como se corrige sobre lo que el nodo ya publica, si algún día el firmware cambia su propia curva, las calibraciones guardadas dejan de valer y hay que repetirlas.

Detalles que importan:
- `calibrarFilas` **no muta** las filas. Un lote reintentado parte siempre de los valores originales: no se calibra dos veces.
- Se guarda el valor **sin calibrar** en `ts.lecturas.crudo` (jsonb `{"ph": 6.5}`), solo de los parámetros que cambiaron; es `NULL` si la lectura no se corrigió. Columna nullable sin valor por omisión: agregarla a la hypertable comprimida no reescribe datos.
- `ts.lecturas.ph` (etc.) guarda el valor **calibrado**: así el WQI, el estado del nodo, el historial diario y las vistas siguen funcionando sin cambios. El esquema que consumen quedó igual (la vista `app.v_lecturas` se recreó solo para exponer la columna nueva al final).
- La calibración de un nodo **no recalcula lecturas pasadas**: se aplica a las nuevas.
- Si la lectura de coeficientes falla, el lote se reintenta (mejor que guardar sin corregir y mezclar series).
- La temperatura no se calibra (ni siquiera aparece en el CHECK de la tabla).

### Caché de coeficientes
En memoria del worker, por nodo, con TTL de 5 min y **invalidación por pub/sub** (`invalidar:calibracion`, mismo patrón que `invalidar:nodo`). La API publica al guardar, revertir y restablecer. **Descartado:** Valkey como caché (un salto de red por lote para un dato que cambia casi nunca) y un TTL largo sin invalidación (la persona esperaría a ver el efecto). Peor caso si se pierde el mensaje: 5 min con la recta anterior.

## Modelo de datos

- **Tabla nueva `app.calibraciones_sensor`**, no se reutilizó `app.calibraciones` (migración 0007): esa es de un modelo distinto (mV, Nernst, solo pH/conductividad/turbidez, sin TDS) y nunca se usó. Mezclar los dos modelos habría dejado columnas sin sentido. La vieja queda sin tocar.
- `offset` es palabra reservada de SQL → la columna y el campo de la API se llaman **`desfase`**.
- Una sola activa por nodo+parámetro: índice parcial único `WHERE activa`.
- `origen` (`guiada` | `identidad`): «restablecer» no borra nada, inserta una fila identidad (pendiente 1, desfase 0) y la deja activa; queda en el historial y en la auditoría.
- `pendiente > 0` por CHECK: una pendiente ≤ 0 es un sensor invertido, no una calibración.
- RLS como el resto del repo: `lympha_app` solo `SELECT`; escribir pasa por funciones `SECURITY DEFINER` (`registrar_calibracion`, `activar_calibracion`) que **exigen ser propietario** del espacio y escriben en `app.auditoria` (`calibracion.registrada`/`revertida`). `lympha_system` (worker) solo lee.
- **Plazo de vencimiento: por perfil**, columna `app.perfiles_uso.calibracion_vence_dias` (90 por omisión). **Descartado:** variable de entorno (habría que pasarla por 4 rutas y reiniciar) y una constante (no configurable). Se cambia con un `UPDATE` o una futura pantalla de perfiles. 90 días: es lo habitual para sondas de pH de uso continuo.
- Estado del nodo (`calibracion` en `nodoApi`, **aditivo y opcional**): `sin_calibrar` si no hay calibración guiada activa; `vencida` si la **más antigua** de las activas pasó el plazo (un solo parámetro vencido basta para avisar); `vigente` en otro caso. La «última» es la más reciente. Una identidad activa cuenta como sin calibrar.

## API

`GET /api/calibraciones?nodo_id=&parametro=&limite=` (miembro) · `POST /api/calibraciones` (propietario) · `POST /api/calibraciones/restablecer` (propietario) · `POST /api/calibraciones/:id/activar` (propietario, revertir).

- **El cliente nunca manda coeficientes**: manda los puntos `{crudo, referencia}` y el servidor calcula la recta (el cuerpo es `.strict()`; la prueba verifica que mandar `pendiente` da 400).
- 2 a 10 puntos. Puntos sin recta (mismo crudo en todos, pendiente ≤ 0) → **422** con un código estable (`puntos_repetidos`, `pendiente_no_positiva`…) que la PWA traduce.
- Nodo ajeno o inexistente → **404 idéntico**; miembro sin rol → **403** (RNF-01).
- **No hay endpoint de «previsualizar»**: la vista previa la calcula la PWA con el mismo paquete `@lympha/calibracion`; un endpoint puro habría sido una ruta más que proteger sin aportar nada.
- Evento SSE `calibracion` `{calibracion_id, nodo_id, espacio_id, parametro, cambio: registrada|revertida|restablecida, pendiente, desfase, actualizado_en}`; se reconoce por `calibracion_id` en `nombreEventoEspacio`. Es aditivo: un cliente anterior lo ignora. Es mejor esfuerzo; la caché del worker se invalida por otro camino.
- Fechas: se guardan en UTC (regla del repo); la PWA las muestra en `America/Mexico_City` (`fechaMexico`).

## Cálculo y estabilidad (paquete `@lympha/calibracion`)

Paquete puro compartido por servidor y PWA (como `@lympha/wqi`): los dos calculan exactamente lo mismo.

- **Regresión:** mínimos cuadrados de `referencia` sobre `crudo`. Con 2 puntos la recta es exacta (R² = 1, no se evalúa). **Descartado:** regresión total (errores en ambos ejes) por complejidad sin beneficio con 2–4 puntos.
- **Advertencias (avisan, no bloquean):** pendiente fuera de 0.5–2 y R² < 0.98 con ≥ 3 puntos. Bloquear sería arbitrario; un sensor muy viejo puede tener pendiente fuera de rango y la persona decide.
- **Estabilidad:** las últimas 8 lecturas crudas **posteriores al momento en que la persona confirma que puso la sonda**; estable si su desviación estándar poblacional ≤ max(umbral absoluto, umbral relativo · |promedio|). Umbrales: pH 0.03; conductividad 5 µS/cm o 1 %; TDS 3 mg/L o 1 %; turbidez 0.5 NTU o 2 %. Se captura el **promedio** de esa ventana.
- **Por qué hay un paso «La sonda ya está en la solución»:** sin él, las lecturas aún de la solución anterior parecerían estables y se capturaría el punto equivocado. El ancla es la hora **del nodo** de la última lectura, no el reloj del teléfono (sin problemas de desfase).
- **Lecturas en vivo:** la PWA consulta `GET /api/nodos/:id/lecturas` cada 3 s (con `crudo` si la lectura se corrigió). **Descartado:** SSE con valores: el stream lleva el estado ya evaluado (calibrado) y no cada lectura; añadir un evento por lectura habría cambiado el contrato más de lo que el pedido justifica. **Límite conocido:** el tiempo hasta «estable» depende de cada cuánto publica el nodo (8 lecturas); con un nodo que publica cada minuto son ~8 min por punto.
- **Guía:** pH buffers 7.00 → 4.00 → 10.00 (el de 10 es opcional; mínimo 2 puntos); conductividad: agua destilada (0) + 1413 µS/cm; TDS: destilada (0) + 706 mg/L (1413 µS/cm × 0.5, el factor del nodo); turbidez: destilada (0) + patrón de 100 NTU por omisión. En todos, el valor real del patrón es **editable** (el frasco manda).

## PWA

- Pestaña «Calibración» (`/calibracion`, 4.ª pestaña; acepta `?nodo=` y `?parametro=`). Estilos y componentes existentes (`tarjeta`, `insignia`, `secundario`, `enlace`, `valores`).
- Asistente con máquina de estados pura y probada (`calibracion/asistente.ts`): elegir → (preparar → medir)×N → resumen → confirmar. Tabla antes/después por punto, pendiente, desfase, R², y «con la última lectura marcaría X». Guardar pide confirmación explícita.
- Historial con «Volver a esta calibración» (confirmación en línea) y «Restablecer» por parámetro. Solo el propietario ve los controles.
- Insignia de estado (sin calibrar / al día / vencida) con texto y símbolo (el color nunca va solo) en la lista de nodos de la pestaña y en la tarjeta del nodo, con enlace a calibrar. «Vencida» usa el color de «regular» aunque no sea un nivel de agua; es el único que llama la atención.
- **Sin conexión:** el service worker ya devuelve el cascarón para cualquier ruta (`navigateFallback`), así que `/calibracion` carga; `useEnLinea` muestra un aviso y oculta el asistente (necesita lecturas en vivo y guardar). El historial en caché **no** existe: el service worker no guarda respuestas de la API (RNF-01).

## Lo que no se hizo / límites

- **No se probó con un sensor real ni con soluciones patrón.** Está probado: regresión, estabilidad, aplicación, rutas contra Postgres/Valkey reales (404/403/422, una activa, revertir, restablecer, vencida) y la corrección + `crudo` de punta a punta hasta la API. **No** está probado: el asistente en un navegador real (se verificó que compila, pasa tipos y lint, y la máquina de estados con pruebas), ni el efecto en un nodo físico.
- No se tocó el firmware ni el ACL de Mosquitto: no hace falta reflashear ni reiniciar el broker.
- No hay `down` de la migración (el runner del repo no lo tiene; es expand/contract).
- Calibraciones por voltaje (mV) del modelo viejo (`app.calibraciones`): fuera de alcance.
- Las alarmas no se disparan por calibración vencida; solo se muestra. Un aviso por Telegram sería una regla nueva en H3.
