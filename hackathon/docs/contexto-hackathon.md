# Contexto — Hackathon Puebla 2026 (XIDE / Microside) · sesión 14-nov-2026

## Situación
- Hackathon de 6 horas con la plataforma XIDE de Microside. Lo más probable es que **solo haya sensor de pH** (ya se descartó cloro residual).
- No han confirmado si se permite usar **código previo**. Todo lo que se reutilice de Kanan/Lympha debe poder justificarse o reconstruirse durante el evento.
- Casi todos los equipos van a usar **Blynk** porque es el ejemplo oficial (`Hackathon_example_blynk`, por WiFi, V0 = LED, V1 = botón BOOT). El dashboard no va a diferenciar a nadie.

## Hardware disponible
- XC01 R5 (ESP32-S3, Arduino "ESP32S3 Dev Module") en el socket 5 de la XBI01 IIoTrainer.
- I2C: SDA 12, SCL 13.
- XN03 analógico (0x03): ADC de 10 bits, 0–3.3 V (nunca más de 3.3 V). Lectura de ADC de 16 bits en el reg 0x20 (2 bytes). **El registro de la entrada externa y el orden de bytes no están verificados.**
- XN13 relevador (dir. 13): un byte 1/0.
- XN44 buzzer (0x2C): reg 0x01 + frecuencia (16 bits) + duración (16 bits).
- XC03 LTE/GNSS (SIM7080G): la documentación de LTE + TinyGSM + Blynk.Cloud sigue sin publicarse.
- Si el módulo de pH se alimenta a 5 V (por ejemplo, el PH-4502C), hace falta un divisor hacia el ADC.

## Firmware ya bosquejado (no cargado)
Flujo: XN03 → supermuestreo (N_OVER = 64) → media móvil (M_AVG = 10) → mV → pH con calibración en 2 puntos (buffers 4 y 7, guardada en NVS con `Preferences`) → compensación de temperatura Nernst con T fija → validación (0–14, detección de sensor desconectado por lecturas pegadas a los rieles) → alarma con histéresis en el rango NOM-127 de 6.5–8.5 (buzzer + relevador) → Blynk (V2 pH, V3 mV, V4 estado 0 ok / 1 alarma / 2 error).
- Comandos por serial: `c4`, `c7` (solo capturan si la ventana es estable, < 3 mV), `s` (muestra mv4, mv7 y pendiente en mV/pH), `r` (reset).
- No bloqueante: `WiFi.begin` + `Blynk.config`, y `BlynkTimer` para muestreo (200 ms) y envío (2 s). La alarma local funciona sin red.

## Estrategia para ganar (lo que se discutió)
1. **Medición confiable como protagonista:** mostrar señal cruda vs. filtrada en vivo, calibrar frente al jurado, reportar la pendiente como % del valor Nernst y el offset, diagnosticar la sonda (pendiente < ~85 % → sonda degradada) e indicar "lectura estable / estabilizando".
2. **Que actúe, no solo que muestre:** alertas por tasa de cambio (evento de contaminación aunque siga en rango), lazo cerrado con el relevador (bomba o válvula visible), operación sin red con reenvío al reconectar, y LTE con el XC03 como extra si da tiempo.
3. **Historia real:** Kanan ya está desplegado (tinacos BUAP/ICUAP, NOM-127, Telegram) y Lympha tiene modelo de negocio validado en Wadhwani. El pitch: "no es una idea de hackathon, es el MVP de un producto que ya existe". Telegram le gana a "abre la app de Blynk".
4. **Demo:** agua + limón + bicarbonato → el pH cambia en vivo → alarma, buzzer, relevador y mensaje al teléfono del jurado.

## Decisión nueva: usar Lympha + reportes NOM-127 de Kanan
Jesús quiere presentar el **concepto de Lympha** (semáforo / WQI de calidad del agua para hogares, escuelas, pymes y hoteles; Hardware as a Service; alertas por Telegram), pero montado sobre **Blynk** (por la plataforma del hackathon) y sumando los **reportes de cumplimiento NOM-127 en PDF de Kanan**.

### Qué hace hoy `reporteGenerator.js` (Kanan)
- `generarReporte({ nodo_id, fecha_inicio, fecha_fin, generado_por })` → Buffer PDF (pdfkit, tamaño carta).
- Fuentes: Postgres (`nodos`, `umbrales` por nodo como fuente única de los límites, `usuarios`, `alertas`) y Mongo (`Muestra` con valores ph/temperatura/conductividad/turbidez/tds).
- Contenido: encabezado KANAN/ICUAP, badge "CUMPLE / NO CUMPLE NOM-127-SSA1-2021", datos del nodo y del periodo, tabla de estadísticas por parámetro (promedio, mín., máx., límites, cumple / n fuera de rango), detalle de muestras y alertas del periodo.

### Adaptación propuesta (por decidir en la otra sesión)
- **Datos desde Blynk en vez de Mongo/Postgres:** un servicio Node pequeño que lea el histórico del datastream de pH (HTTP API de Blynk) o reciba lecturas por webhook de Blynk, y alimente `generarReporte` con solo pH (y temperatura si existe). Los umbrales 6.5–8.5 quedan en config en lugar de la tabla `umbrales`.
- **Disparo del reporte:** botón en Blynk (virtual pin → webhook) o comando de Telegram (`/reporte`) que regresa el PDF. Ideal para la demo: el jurado lo recibe en su teléfono.
- Telegram: reutilizar el patrón de `telegramBot.js` de Kanan.

### Riesgos / pendientes
- Confirmar con los organizadores si se permite código previo. Si no, presentar el reporte como "integración con el sistema existente" o reconstruir una versión mínima durante el evento.
- Verificar el registro y el orden de bytes de la entrada externa del XN03, y el voltaje de salida del módulo de pH.
- Revisar los límites del plan gratuito de Blynk (datastreams, histórico, webhooks) antes de depender de ellos.
- Pedir la rúbrica de evaluación para priorizar.
- Equipo de Lympha: Jesús (arquitectura, CEO/CTO), Marvick (hardware, calibración), Brian (presentación), Brenda (comunicación). Falta confirmar quién va al hackathon.
