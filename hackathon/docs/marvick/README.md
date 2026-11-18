# Atl para Marvick: léeme primero

Este paquete de documentos explica **qué se construyó del lado de la nube** (Blynk, servidor, Telegram, web, reportes) para que tú, que haces el **hardware y el firmware**, sepas exactamente qué espera el sistema de tu placa y qué puedes dar por hecho. Está escrito para leerse en persona **o para pasárselo a un agente de IA** como contexto (ver `PROMPT_PARA_IA.md`).

> Estado al 2026-11-18 (víspera del hackathon). Pasos 0–10 del servidor y la web están hechos y probados **con un simulador de nodo**, no con tu placa. **El firmware (Paso 11) no se ha probado contra este servidor.** Eso es lo que sigue.

## Qué es Atl en una frase
Vigilancia continua del pH del agua para comunidades: tu placa mide y manda a **Blynk**; nuestro servidor lee Blynk, guarda todo en **MongoDB Atlas**, decide el estado (en rango / atención / fuera de rango / crítico / revisar sensor / sin conexión), **avisa por Telegram**, muestra una **web** (inicio de sesión con Google) y genera **reportes PDF** con la NOM-127. Se llama «Lympha Atl».

## El dibujo completo

```
 [Sonda pH] → XN03 → ESP32-S3 (tu firmware) ──WiFi──► Blynk Cloud ◄── HTTP (poll cada 5 s) ── Servidor Atl (Node 24)
                         ▲  relevador XN13 / buzzer XN44                  ▲  escribe V8 (bomba)        │
                         └───────── V8 = pulso pedido ────────────────────┘                          ├─► MongoDB Atlas (muestras, alertas, acciones)
                                                                                                        ├─► Telegram (avisos, /estado, /reporte)
                                                                                                        └─► API REST ◄── Web (React, login Google)
```

Lo importante para ti: **el servidor no habla con tu placa directamente**. Todo pasa por los *virtual pins* de Blynk. La placa **escribe** V2, V4, V5, V6, V7 (y opcionales) y **lee** V8 cuando el servidor la escribe.

## Qué tienes que entregar (resumen de 6 líneas)
1. Publicar `V6 seq` (entero que **sube en cada muestra**): es la señal de vida. Si no cambia, el sistema dice «sin conexión».
2. Publicar `V2 ph` ya calibrado/filtrado, `V7 ph_crudo`, `V4 estado`, `V5 estable`.
3. Calibración de 2 puntos (buffers 4 y 7) guardada en NVS; comandos `c4`, `c7`, `s`, `r`.
4. **Relevador apagado al arrancar**, pulso máximo y apagado sin dato válido / sin comunicación **decididos en el firmware**, nunca solo por la nube.
5. Alarma local (buzzer + relevador) que funcione **sin WiFi**.
6. Que `V8` sea una *petición* de encender el relevador; el firmware la acepta solo si sus propios enclavamientos lo permiten.

Detalle completo, con tabla de pines y casos límite: **`CONTRATO_FIRMWARE.md`**.

## Índice de este paquete
| Archivo | Para qué |
|---|---|
| `README.md` | Este resumen |
| `CONTRATO_FIRMWARE.md` | Lo que el servidor espera de la placa: pines, formatos, reglas, checklist de pruebas |
| `ARQUITECTURA.md` | Cómo está hecho todo lo demás: módulos, flujos, base de datos, API, Telegram, control del actuador |
| `OPERACION.md` | Cómo correr el sistema, el simulador y la prueba de humo; qué probar con la placa; problemas comunes |
| `PROMPT_PARA_IA.md` | Texto listo para pegar a un agente de IA con las reglas y el contexto |

Documentos fuente más profundos (en `hackathon/docs/`): `ARQUITECTURA.md` (especificación), `decisiones.md` (bitácora de decisiones, léela si algo te sorprende), `contexto-hackathon.md` (hardware y firmware bosquejado), `GUION_DEMO.md`, `cloracion-ph.md`, `IDENTIDAD_VISUAL.md`. `hackathon/CLAUDE.md` es el briefing de reglas y la **tabla de estado por paso**.

## Reglas que no se negocian (aplican también al firmware)
- **Honestidad:** nunca se dice «potable» ni «seguro» ni «cumple NOM-127» (el producto solo dice «pH dentro/fuera del rango NOM-127»). No pongas esos textos en pantallas, buzzer ni mensajes.
- **Actuador seguro:** el firmware decide los enclavamientos. La nube **nunca sube la dosis sola**: recomienda, una persona confirma. Lo único automático desde la nube es **detener y avisar**.
- **No inventar datos:** si la sonda falla, publica `estado = 3` (error de sensor); no mandes un pH inventado.
- **Secretos:** el token de Blynk y el WiFi **no van en el repositorio**.

## Qué sí está probado y qué no
| Tema | Estado |
|---|---|
| Servidor, ingesta, alertas, Telegram, reportes PDF, API, web, control del actuador | Probado con el simulador y Blynk real; el aviso y el PDF llegaron al Telegram real |
| Inicio de sesión con Google real | Funciona (probado por Jesús) |
| **Tu firmware contra este servidor** | **No probado** |
| Relevador real accionado por Atl | **No probado** (solo simulado) |
| Calibración frente al jurado, alarma local sin red, OTA, LTE | **No probado**, depende de la placa |
| Humo ampliado con el actuador contra Blynk | Escrito, no corrido (Blynk iba lento) |

Si algo aquí contradice lo que ves en la placa, **manda lo que mediste en la placa**; avísale a Jesús y se corrige el documento o el servidor.
