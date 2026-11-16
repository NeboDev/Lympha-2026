# Atl — Plan para el hackathon (jueves 19-nov-2026)

Datos del evento (sitio oficial): Instituto Tecnológico de Puebla, Gimnasio. Registro 8:00–8:30, inauguración 8:30–9:00, **reto de 9:00 a 17:00** (el sitio habla de «6 horas de desarrollo»; confirmar el horario real de entrega y exposición). 16 equipos de hasta 4 estudiantes + asesor. Reto: *Sistema inteligente para la cloración y monitoreo de la calidad del agua* (instrumentación, automatización, monitoreo). La **rúbrica de evaluación está en la convocatoria completa** (enlace «Descargar convocatoria» en el sitio): **leerla antes de cualquier decisión de prioridad** y ajustar este plan.

Hoy es lunes 16-nov. Quedan tres días de preparación.

## Antes del jueves (lo que se puede y debe tener hecho)
Objetivo: llegar con la infraestructura andando contra un **simulador**, para que el jueves solo se conecte el sensor real y se adapte al reto.

| Día | Entregable | Hecho cuando |
|---|---|---|
| Lun 16 | Paso 0: verificar Blynk (token, `curl` de `getAll`/`update`/`isHardwareConnected`, límites del plan) y Atlas (cluster M0, usuario, IP permitida) o Mongo local. Plantilla `Atl-Nodo` y datastreams con el **MCP de Blynk** o a mano. | un `curl` devuelve valores de un dispositivo de prueba |
| Lun–Mar | Servidor: config, mongo, ingesta, evaluación (puro, con pruebas), alertas, telegram, reportes PDF. Simulador de nodo con escenarios. | `pnpm smoke` pasa: simulador → Blynk → Mongo → alerta → Telegram → PDF |
| Mar | Web: Entrar (Google), Mi agua, Reportes, Comunidad. Tokens y logo aplicados. | recorrido completo en el teléfono con datos del simulador |
| Mié | Firmware de pH cargado y calibrado con **sonda real** si hay acceso al hardware; ensayo de pitch y de demo; plan B listo (video, simulador, Mongo local). | demo completa de 3 minutos sin tocar el código |

Pendiente de confirmar con los organizadores o la convocatoria: qué hardware exacto entregan (la capacitación del sábado 14 ya ocurrió), si el XN03 trae el pH ya acondicionado, si hay internet confiable y si se puede usar el teléfono personal como hotspot.

## El día (referencia; ajustar a la rúbrica)
| Hora | Qué |
|---|---|
| 9:00–9:30 | Conocer el reto exacto. Decidir con la tabla de adaptación (`ARQUITECTURA.md` §11). Repartir roles. |
| 9:30–11:00 | Conectar el sensor real, calibrar, pasar datos por Blynk → Atl. Ajustar catálogo si cambió algo. |
| 11:00–13:00 | La parte que responde **al reto**: la acción sobre cloración (enclavamiento, recomendación, relevador visible) y los avisos. |
| 13:00–14:00 | Reporte PDF con datos reales; probar `/reporte` en el teléfono del jurado. Comer. |
| 14:00–15:30 | Pulir la demo, casos de error, plan B. **Congelar funciones a las 15:30.** |
| 15:30–17:00 | Ensayo de pitch ×3, grabar un video de respaldo, repasar preguntas difíciles. |
Regla: si algo no funciona 30 minutos, se corta y se usa el plan B.

## Roles propuestos (4 integrantes; confirmar quién va)
- **Jesús — arquitectura/servidor** (ingesta, evaluación, Mongo).
- **Marvick — hardware/firmware** (sonda, calibración, relevador, enclavamientos).
- **Brian — presentación y diseño** (web, pitch, identidad).
- **Brenda — comunicación y contexto humano** (mensajes, historia, preguntas del jurado, bitácora).

## Demo de 3 minutos (guion)
1. **Historia (30 s):** una comunidad que no sabe qué hay en su agua. Mostrar el problema humano, no la tecnología.
2. **Vigilancia (45 s):** el pH en vivo en la app de Blynk y en Atl, «crudo vs. filtrado», estado «estable». Calibrar frente al jurado (punto 7) y mostrar la pendiente como % de Nernst.
3. **Evento (60 s):** agregar limón → el pH baja → **alarma local** (buzzer + relevador), **aviso en el Telegram del jurado** con «qué hacer», **Atl detiene la dosificación** y muestra «efectividad del cloro con este pH». Bicarbonato → vuelve al rango → aviso de recuperación.
4. **Memoria (30 s):** `/reporte` → PDF en el teléfono del jurado: resumen en lenguaje sencillo, cobertura de datos, calibración, bitácora, **y lo que no cubre**.
5. **Cierre (15 s):** «Kanan ya vigila tinacos en la BUAP; Atl lo lleva a cualquier comunidad.» *(Solo afirmar lo que sea verificable.)*

## Preguntas difíciles (preparar respuesta honesta)
- «¿Esto certifica el agua?» → No. Documenta el pH frente a la NOM-127 y dice qué no mide.
- «¿Por qué no solo Blynk?» → Blynk es el tiempo real; el histórico gratuito es corto y no guarda calibraciones ni acciones. Nuestra base conserva la bitácora para el reporte.
- «¿Y si se va el internet?» → La alarma y el actuador son locales; el servidor muestra el hueco, no lo inventa.
- «¿Dosifican cloro solos?» → Solo acciones seguras (detener). Subir la dosis lo confirma una persona. Sin sensor de cloro es lazo abierto, y lo decimos.
- «¿Qué hay de nuevo respecto a los demás?» → memoria confiable + reporte normativo + comunidad (Telegram grupal), no solo un tablero.

## Criterios para decir «listo»
- [ ] Una lectura real de pH llega a Blynk, a Mongo y a la web.
- [ ] Una alerta real llega al Telegram de otra persona.
- [ ] Un PDF real se genera con datos de la sesión y se abre en el teléfono.
- [ ] La alarma local funciona **con el WiFi apagado**.
- [ ] Ningún texto dice «potable» ni «seguro».
- [ ] Plan B probado (simulador y Mongo local).
