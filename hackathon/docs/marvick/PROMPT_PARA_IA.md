# Prompt de contexto para un agente de IA

Pega el bloque de abajo al inicio de la sesión con tu agente (Claude, Copilot, etc.) y, si el agente puede leer archivos, dale esta carpeta: `hackathon/docs/marvick/` (los 4 documentos hermanos) y, para más profundidad, `hackathon/docs/ARQUITECTURA.md` y `hackathon/docs/decisiones.md`.

```text
Contexto: trabajo en el HARDWARE/FIRMWARE de "Atl" (nombre comercial "Lympha Atl"), un sistema de vigilancia
del pH del agua para comunidades, para el Hackathon Puebla 2026 (jueves 19-nov-2026, 6 horas). Ya existe todo
el lado de la nube; mi parte es la placa. Lee primero estos archivos y úsalos como fuente de verdad:
  hackathon/docs/marvick/README.md
  hackathon/docs/marvick/CONTRATO_FIRMWARE.md   (lo más importante: pines, seq, estados, actuador, checklist)
  hackathon/docs/marvick/ARQUITECTURA.md
  hackathon/docs/marvick/OPERACION.md

Resumen de la arquitectura:
- Placa ESP32-S3 (Arduino "ESP32S3 Dev Module"), módulo XC01 R5 en la XBI01 IIoTrainer. Sonda de pH por el
  módulo analógico XN03 (I2C SDA 12, SCL 13; ADC 0–3.3 V, NUNCA más de 3.3 V), relevador XN13, buzzer XN44.
- La placa habla con Blynk por WiFi (Auth Token del dispositivo, plantilla "Atl Nodos", pines V1–V10). NO hay
  conexión directa placa↔servidor ni MQTT propio.
- Un servidor Node 24 lee Blynk por HTTP cada 5 s, guarda en MongoDB Atlas, evalúa el estado del agua,
  avisa por Telegram y sirve una web y reportes PDF NOM-127.
- Pines: V2 ph (calibrado y filtrado), V7 ph_crudo, V4 estado (0 ok, 1 atención, 2 fuera de rango, 3 error de
  sensor), V5 estable (1/0), V6 seq (entero que SUBE en cada muestra; es la señal de vida: si no cambia, el
  sistema dice "sin conexión"), V8 bomba (el SERVIDOR lo escribe: 1 = pulso, 0 = apagar), V1 temperatura,
  V3 mv, V9 modo, V10 cal_pct (pendiente de la sonda en % de Nernst; Atl la lee y la guarda como calibración reportada por el nodo; V3 mv no se guarda hoy).
- Calibración de 2 puntos (buffers pH 4 y 7) guardada en NVS; comandos serial c4, c7, s, r; compensación de
  Nernst por temperatura; validación 0–14 y detección de sensor desconectado.

Reglas que NO se negocian:
1. Relevador APAGADO al arrancar; no sincronizar V8 desde Blynk al conectar (puede haber un 1 viejo).
2. El firmware decide los enclavamientos: pulso máximo propio con temporizador local (no depender de que llegue
   el 0), apagar sin lectura válida, con error de sensor (estado 3), con pérdida de WiFi/Blynk o con pH fuera
   de rango, y enfriamiento entre pulsos. V8=1 es una PETICIÓN que el firmware puede rechazar.
3. La nube nunca sube la dosis sola: recomienda y una persona confirma. Lo único automático desde la nube es
   detener y avisar.
4. Alarma local (buzzer + relevador, histéresis en 6.5–8.5) que funcione SIN red.
5. No inventar datos: si la sonda falla, publicar estado=3; no mandar un pH inventado ni "arreglado".
6. Honestidad: ningún texto (pantallas, buzzer, mensajes, comentarios de usuario) dice "potable", "seguro" ni
   "cumple NOM-127". Solo "pH dentro/fuera del rango NOM-127".
7. Secretos (token de Blynk, WiFi) nunca en el repositorio ni en el chat; usar un archivo de secretos ignorado
   por git. No publicar demasiado seguido: los mensajes de Blynk del plan gratuito son limitados (publicar cada
   ~5 s, solo los pines necesarios; si pasa de ~60 s entre publicaciones hay que avisar para ajustar el servidor).
8. Español de México en textos visibles; honestidad sobre el estado: "compila" NO es "funciona". Sin hardware
   probado, reportar "no probado".

Cosas sin verificar que debes tratar como incógnitas: el registro y el orden de bytes de la entrada externa del
XN03; el voltaje de salida del módulo de pH (si es 5 V, divisor hacia el ADC); los límites del plan gratuito de
Blynk; LTE con el XC03 (sin documentación publicada).

Cuando haya una contradicción entre estos documentos y lo que mido en la placa, manda lo medido; dímelo para
corregir el documento. Antes de tocar código lista los archivos que vas a crear o modificar.
```

## Cómo usarlo bien
- Si el agente propone cambiar un pin, el formato de `seq` o los valores de `estado`, **detente**: eso rompe el contrato con el servidor. Primero se acuerda con Jesús y se cambia `parametros.json`/el mapeo del nodo.
- Pídele que, al terminar cada tarea, te diga qué **verificó en la placa** y qué solo **compila**.
- Si el agente necesita un valor secreto (token, clave del WiFi), **no se lo pegues**: que lea de un archivo local ignorado por git.
