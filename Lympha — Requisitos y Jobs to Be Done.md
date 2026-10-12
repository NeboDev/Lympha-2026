# Lympha — Requisitos y Jobs to Be Done

Oct 10, 2026 · @Jesus AQ

## Propósito y visión

Lympha permite que cualquier persona sepa en segundos si el agua de su hogar, escuela o negocio está bien, por qué no lo está y qué hacer al respecto. Este documento fija qué debe hacer el sistema y con qué calidad, antes de decidir cómo construirlo.

**Qué es Lympha:** un producto de hardware más software. Un sensor se instala en un depósito o punto de agua (cisterna, tinaco, llave, alberca), mide parámetros fisicoquímicos de forma continua y los traduce en un índice de calidad (WQI) mostrado como semáforo, con alertas por Telegram.

**Qué no es Lympha:**

- No certifica que el agua sea potable ni sustituye análisis de laboratorio. Con los parámetros medidos no se detecta contaminación microbiológica.
- No es una herramienta de cumplimiento normativo. La NOM-127-SSA1-2021 se usa como referencia para el perfil de consumo humano, no como dictamen oficial.
- No es una plataforma IoT genérica: solo atiende calidad del agua.

**Origen:** Lympha es un producto nuevo inspirado en la experiencia de Kanan, el sistema de monitoreo desarrollado para el CICM-ICUAP de la BUAP. Kanan sigue operando como proyecto independiente; Lympha no reutiliza su código de forma directa.

**Alcance de este documento:** jobs to be done, requisitos funcionales, requisitos no funcionales, restricciones y preguntas abiertas. La arquitectura, el stack y el modelo de datos se definen en un documento posterior.

## Segmentos y personas

Lympha atiende cuatro segmentos con la misma plataforma; difieren en número de nodos, de usuarios y en quién responde cuando el agua falla.

| Segmento | Persona | Nodos típicos | Usuarios por espacio | Conocimiento técnico | Quién actúa ante un problema |
| --- | --- | --- | --- | --- | --- |
| Hogar | Responsable de la casa | 1–2 (cisterna, tinaco) | 1–4 familiares | Nulo | La misma persona o un plomero |
| Escuela | Administrador del plantel | 2–6 (cisternas, bebederos) | 2–5 (dirección, mantenimiento) | Bajo | Personal de mantenimiento |
| Pyme (restaurante, cafetería, consultorio) | Dueño u operador | 1–3 | 1–3 | Bajo | Dueño o proveedor de filtros |
| Hotel | Jefe de mantenimiento | 4–15 (cisternas, albercas, cocina) | 3–10 (gerencia, mantenimiento, turnos) | Medio | Equipo de mantenimiento por turnos |

**Personas secundarias:**

- **Instalador / distribuidor:** instala nodos para varios clientes y necesita ver su estado durante la puesta en marcha.
- **Operador de Lympha (interno):** fabrica y registra nodos, da soporte y vigila la salud de la flota.

Los números de nodos y usuarios son supuestos iniciales; deben validarse con entrevistas por segmento.

## Jobs to be done

El trabajo principal que el cliente contrata a Lympha es: **"Dejar de preocuparme por el agua que usamos, y enterarme a tiempo cuando algo cambie"**. Los requisitos funcionales se derivan de los jobs de esta sección; cada uno tiene un identificador que se referencia después.

### Job principal y jobs relacionados

| ID | Job | Tipo | Segmentos |
| --- | --- | --- | --- |
| J1 | Saber, de un vistazo, si el agua está bien ahora | Funcional | Todos |
| J2 | Enterarme cuando el agua empeore, sin tener que revisar la app | Funcional | Todos |
| J3 | Entender qué está pasando y qué hacer, sin saber qué es el pH | Funcional | Todos |
| J4 | Saber si una acción que tomé (cambiar filtro, limpiar cisterna) funcionó | Funcional | Todos |
| J5 | Ver cómo ha estado el agua en las últimas semanas | Funcional | Todos |
| J6 | Instalar y poner a funcionar el sensor yo solo, en minutos | Funcional | Hogar, pyme |
| J7 | Confiar en que lo que dice el sensor es correcto | Emocional | Todos |
| J8 | Sentir tranquilidad de que mi familia o mis clientes usan agua en buen estado | Emocional | Hogar, escuela |
| J9 | Coordinar a mi equipo para que alguien atienda el problema | Funcional | Escuela, hotel |
| J10 | Demostrar a otros (padres, huéspedes, inspectores) que cuido el agua | Social | Escuela, hotel, pyme |
| J11 | Saber cómo está el agua en mi zona, comparada con mis vecinos | Funcional / social | Hogar |
| J12 | Mantener el sensor funcionando sin conocimientos técnicos | Funcional | Todos |
|  |  |  |  |

### Job stories

1. **J1** — Cuando abro la app por la mañana, quiero ver el estado del agua en una sola pantalla, para decidir si la uso normalmente sin pensar en ello.
2. **J2** — Cuando el agua de mi cisterna cambia de estado, quiero recibir un mensaje en Telegram con lo que pasó, para actuar sin abrir otra app.
3. **J2** — Cuando un problema se resuelve solo, quiero que también me avisen, para no seguir preocupado.
4. **J3** — Cuando el semáforo está en amarillo, quiero leer en una frase la causa probable y una acción concreta, para saber si llamo a alguien o espero.
5. **J4** — Cuando cambio el filtro, quiero comparar el antes y el después, para saber si gasté bien mi dinero.
6. **J5** — Cuando alguien en casa se queja del sabor del agua, quiero revisar los últimos 30 días, para ver si hubo un cambio real.
7. **J6** — Cuando recibo el sensor, quiero escanear un código y conectarlo a mi WiFi desde el teléfono, para tenerlo funcionando en menos de 5 minutos.
8. **J7** — Cuando el sensor se desvía o falla, quiero que la app me lo diga en vez de mostrar un color equivocado, para no confiar en un dato falso.
9. **J9** — Cuando hay una alarma en la alberca del hotel, quiero que le llegue al técnico de turno y ver quién la atendió, para que no se quede sin atender.
10. **J10** — Cuando un inspector o un padre de familia pregunta, quiero entregar un reporte mensual simple, para demostrar el seguimiento.
11. **J11** — Cuando veo que mi agua está dura, quiero saber si en mi zona pasa lo mismo, para entender si el problema es de la red o de mi cisterna.
12. **J12** — Cuando el sensor necesita mantenimiento, quiero que la app me guíe paso a paso, para hacerlo sin un técnico.

### Lo que el cliente usa hoy en lugar de Lympha

- Nada: asume que el agua está bien hasta que huele, sabe o se ve mal.
- Tiras reactivas o medidores TDS de pluma: puntuales, manuales y difíciles de interpretar.
- Análisis de laboratorio: confiables pero caros, lentos y esporádicos.
- El proveedor de filtros o el plomero: confianza en un tercero sin datos.

## Requisitos funcionales

Son 48 requisitos en 8 dominios; 24 son Must y forman el MVP. Cada uno indica los jobs que atiende. La prioridad es editable en cada fila.

### Cuenta y acceso

| ID | Requisito | Prioridad | Jobs |
| --- | --- | --- | --- |
| RF-01 | Registrarse con correo y contraseña, con verificación del correo (Firebase Auth en el MVP) | Must (MVP) | — |
| RF-02 | Iniciar y cerrar sesión, y recuperar la contraseña por correo (Firebase Auth en el MVP) | Must (MVP) | — |
| RF-03 | Iniciar sesión con Google (Firebase Auth en el MVP) | Could | J6 |
| RF-04 | Eliminar la cuenta y todos sus datos personales, en Lympha y en Firebase Auth | Must (MVP) | — |
| RF-05 | Exportar mis lecturas y alertas en CSV | Should | J5, J10 |

### Espacios y miembros

| ID | Requisito | Prioridad | Jobs |
| --- | --- | --- | --- |
| RF-06 | Crear uno o varios espacios (hogar, escuela, negocio, hotel) con nombre y tipo | Must (MVP) | J1 |
| RF-07 | Invitar miembros a un espacio por enlace, con rol propietario o miembro | Should | J9 |
| RF-08 | Los miembros ven nodos y alertas; solo el propietario reclama, configura y desvincula nodos | Should | J9 |
| RF-09 | Transferir la propiedad de un espacio a otro miembro | Could | — |

### Dispositivos y alta

| ID | Requisito | Prioridad | Jobs |
| --- | --- | --- | --- |
| RF-10 | Reclamar un nodo escaneando su QR y asignarlo a un espacio | Must (MVP) | J6 |
| RF-11 | Conectar el nodo al WiFi desde el teléfono, sin cables ni computadora | Must (MVP) | J6 |
| RF-12 | Nombrar el nodo y elegir su perfil de uso (cisterna/doméstico, beber, alberca, riego) | Must (MVP) | J3 |
| RF-13 | Ver si el nodo está en línea y la hora de su última lectura | Must (MVP) | J7 |
| RF-14 | Desvincular un nodo; el espacio anterior pierde todo acceso a él | Must (MVP) | — |
| RF-15 | Mover un nodo a otro espacio del mismo propietario | Could | — |
| RF-16 | Actualizar el firmware del nodo de forma remota | Should | J12 |

### Monitoreo e índice de calidad

| ID | Requisito | Prioridad | Jobs |
| --- | --- | --- | --- |
| RF-17 | Calcular un WQI de 0 a 100 por nodo según su perfil, con pH, temperatura, conductividad, turbidez y TDS | Must (MVP) | J1 |
| RF-18 | Mostrar el WQI como semáforo de 4 niveles (Buena, Regular, Mala, Crítica) más el estado "Revisar sensor / Sin datos" | Must (MVP) | J1, J7 |
| RF-19 | Un parámetro en nivel crítico limita el nivel general, aunque el promedio sea bueno | Must (MVP) | J1 |
| RF-20 | Explicar en una frase la causa probable y una acción recomendada, en lenguaje llano | Must (MVP) | J3 |
| RF-21 | No cambiar el nivel por una lectura aislada; el estado cambia solo ante un cambio sostenido | Must (MVP) | J1, J2 |
| RF-22 | Mostrar en una pantalla el estado de todos los nodos de un espacio | Must (MVP) | J1 |
| RF-23 | Ofrecer un modo avanzado con valores y gráficas por parámetro | Should | J3 |
| RF-24 | Actualizar el estado en pantalla sin recargar | Should | J1 |
| RF-25 | Mostrar el semáforo en el propio nodo (LED), aun sin internet | Could | J1 |

### Alertas y notificaciones

| ID | Requisito | Prioridad | Jobs |
| --- | --- | --- | --- |
| RF-26 | Vincular la cuenta de Telegram desde la app en un solo paso | Must (MVP) | J2 |
| RF-27 | Avisar por Telegram cuando un nodo empeora de nivel, con nodo, nivel, causa y acción | Must (MVP) | J2, J3 |
| RF-28 | Avisar cuando el nodo vuelve a un nivel mejor | Must (MVP) | J2 |
| RF-29 | Avisar cuando un nodo lleva sin conexión más del tiempo configurado | Must (MVP) | J7 |
| RF-30 | No repetir la misma alerta mientras el problema siga activo, salvo un recordatorio configurable | Must (MVP) | J2 |
| RF-31 | Elegir qué nodos y niveles notifican, y un horario silencioso | Should | J2 |
| RF-32 | Consultar el historial de alertas con su estado (activa, atendida, resuelta) y quién la atendió | Should | J9 |
| RF-33 | Notificar a todos los miembros del espacio que tengan Telegram vinculado | Should | J9 |
| RF-34 | Ofrecer notificaciones push y correo como canales alternos | Could | J2 |

### Historial y reportes

| ID | Requisito | Prioridad | Jobs |
| --- | --- | --- | --- |
| RF-35 | Ver el nivel predominante por día de los últimos 7 y 30 días | Must (MVP) | J5 |
| RF-36 | Ver el historial por parámetro hasta 12 meses, agregado por hora y día | Should | J5 |
| RF-37 | Registrar eventos (cambio de filtro, limpieza) y comparar el antes y el después | Should | J4 |
| RF-38 | Generar un reporte mensual en PDF por espacio | Could | J10 |

### Calibración y salud del sensor

| ID | Requisito | Prioridad | Jobs |
| --- | --- | --- | --- |
| RF-39 | Detectar lecturas que indiquen falla o deriva y mostrar "Revisar sensor" en lugar de un color | Must (MVP) | J7 |
| RF-40 | Guiar una calibración paso a paso desde la app | Should | J12 |
| RF-41 | Guardar el historial de calibraciones y recomendar el reemplazo del electrodo | Should | J7, J12 |
| RF-42 | Enviar recordatorios de mantenimiento | Should | J12 |

### Mapa por zonas

| ID | Requisito | Prioridad | Jobs |
| --- | --- | --- | --- |
| RF-43 | Permitir, con consentimiento explícito, compartir la zona del espacio de forma anónima | Could | J11 |
| RF-44 | Mostrar un mapa de zonas por color, solo donde haya un mínimo de nodos que impida identificar hogares | Could | J11 |

### Operación interna (equipo Lympha)

| ID | Requisito | Prioridad | Jobs |
| --- | --- | --- | --- |
| RF-45 | Registrar lotes de nodos en fábrica: identidad, credenciales, código de reclamo y QR | Must (MVP) | J6 |
| RF-46 | Revocar las credenciales de un nodo o de un lote completo | Must (MVP) | — |
| RF-47 | Consola interna para buscar un nodo y ver su estado, firmware y espacio, sin ver lecturas salvo soporte autorizado | Should | — |
| RF-48 | Ver métricas de flota: nodos activos, sin conexión y versiones de firmware | Should | — |

## Requisitos no funcionales

Cada requisito tiene un objetivo medible para poder verificarlo. Las cifras son metas iniciales: las de exactitud dependen del hardware final y deben validarse en laboratorio.

### Seguridad

| ID | Requisito | Objetivo medible |
| --- | --- | --- |
| RNF-01 | Ningún usuario lee ni modifica datos de un espacio del que no es miembro, por API ni por tiempo real | 0 fugas en pruebas automatizadas de aislamiento sobre cada endpoint y canal |
| RNF-02 | Todo tráfico cifrado: web, API y nodo–servidor | TLS 1.2 o superior; 0 puertos sin cifrar expuestos a internet |
| RNF-03 | Cada nodo tiene una credencial única; comprometer uno no da acceso a otros | Revocación de un nodo o lote efectiva en menos de 5 min |
| RNF-04 | Contraseñas, sesiones y protección contra fuerza bruta a cargo de un proveedor de identidad gestionado; Lympha no los implementa | 0 contraseñas almacenadas por Lympha; protección contra fuerza bruta activada en el proveedor |
| RNF-05 | Bases de datos y servicios internos sin exposición pública; secretos fuera del código | 0 credenciales en el repositorio, verificado en CI |
| RNF-06 | Auditoría de acciones sensibles: reclamar, desvincular, cambiar roles, acceso de soporte | Registro conservado 12 meses |

### Privacidad

| ID | Requisito | Objetivo medible |
| --- | --- | --- |
| RNF-07 | Cumplir la ley mexicana de protección de datos personales: aviso de privacidad, consentimiento y derechos ARCO | Solicitudes atendidas en el plazo legal; aviso visible antes del registro |
| RNF-08 | La ubicación se guarda con precisión reducida y el mapa nunca muestra un hogar | Precisión máxima a nivel colonia; zona visible solo con 5 o más nodos |
| RNF-09 | Minimización de datos: solo se recolecta lo necesario para el servicio | Cada campo personal justificado en el aviso de privacidad |

### Disponibilidad y confiabilidad

| ID | Requisito | Objetivo medible |
| --- | --- | --- |
| RNF-10 | Disponibilidad de app y API | 99.5 % mensual (unas 3.6 h de caída al mes) |
| RNF-11 | Ninguna lectura aceptada por el servidor se pierde por la caída de un proceso interno | 0 lecturas perdidas en pruebas de reinicio forzado |
| RNF-12 | El nodo guarda lecturas cuando no hay internet y las envía al reconectar | Al menos 24 h de lecturas en memoria local |
| RNF-13 | Respaldos con restauración probada | Pérdida máx. de 24 h de datos; restauración en menos de 4 h; prueba trimestral |

### Rendimiento y escalabilidad

| ID | Requisito | Objetivo medible |
| --- | --- | --- |
| RNF-14 | De la lectura del sensor a la pantalla | 5 s o menos (p95) |
| RNF-15 | Del cambio de nivel confirmado al mensaje de Telegram | 60 s o menos (p95) |
| RNF-16 | Carga de la pantalla de inicio en red móvil 4G | 2 s o menos (p75) |
| RNF-17 | Capacidad sin cambiar la arquitectura | 1,000 nodos a 1 lectura por minuto; ruta documentada a 10,000 |

### Usabilidad y accesibilidad

| ID | Requisito | Objetivo medible |
| --- | --- | --- |
| RNF-18 | Instalación por una persona sin experiencia, de la caja al primer dato | 5 min o menos en el 80 % de las pruebas con usuarios |
| RNF-19 | El estado del agua se entiende de un vistazo | 9 de cada 10 usuarios de prueba lo identifican correctamente en 3 s |
| RNF-20 | Accesibilidad; el color nunca es la única señal | WCAG 2.1 AA |
| RNF-21 | Interfaz en español de México, sin jerga técnica en la vista principal | Revisión de textos en cada versión |
| RNF-22 | Diseño mobile-first que también funciona en tablet y escritorio | Usable desde 360 px de ancho |

### Exactitud y calidad de datos

| ID | Requisito | Objetivo medible |
| --- | --- | --- |
| RNF-23 | Exactitud de medición tras calibración | pH ±0.2; temperatura ±0.5 °C; conductividad ±5 %; turbidez ±10 % o ±0.5 NTU |
| RNF-24 | El WQI es determinista y versionado | Mismos datos y misma versión = mismo resultado; cada índice guarda la versión del algoritmo |
| RNF-25 | Las lecturas llevan la hora del nodo sincronizada | Error de reloj de 5 s o menos |

### Mantenibilidad y operación

| ID | Requisito | Objetivo medible |
| --- | --- | --- |
| RNF-26 | Pruebas sobre la lógica de dominio: WQI, alarmas y permisos | Cobertura de 80 % o más en esos módulos |
| RNF-27 | Despliegue reproducible con entornos separados | Un comando por entorno; desarrollo, pruebas y producción |
| RNF-28 | Observabilidad: logs estructurados, métricas y alertas internas | Alerta al equipo si la ingesta cae más de 50 % en 10 min |
| RNF-29 | Contrato nodo–servidor versionado | El servidor acepta las 2 versiones de firmware anteriores |
| RNF-30 | Actualización de firmware segura | Reversión automática si el nodo no se reconecta tras la actualización |

### Hardware y legal

| ID | Requisito | Objetivo medible |
| --- | --- | --- |
| RNF-31 | Nodo apto para ambientes húmedos y sonda sumergible | Gabinete IP65 o superior; sonda IP68 |
| RNF-32 | Ningún texto de la app, empaque o publicidad afirma que el agua es potable o segura para beber | Descargo visible en la app y revisión legal de textos antes del lanzamiento |

## Restricciones, supuestos y riesgos

La restricción que más condiciona el producto es que cinco parámetros fisicoquímicos no bastan para afirmar que el agua es segura; todo el mensaje del producto debe construirse sobre esa base.

### Restricciones

- **Parámetros medidos:** pH, temperatura, conductividad, turbidez y TDS. No se miden cloro residual, oxígeno disuelto ni microbiología.
- **Hardware base:** ESP32-S3 con WiFi; sin red celular en esta versión.
- **Canal de alertas principal:** Telegram.
- **Equipo:** desarrollo a cargo de una persona en la fase inicial; el alcance del MVP debe caber en esa capacidad.
- **Código:** proyecto nuevo, independiente del repositorio de Kanan.
- **Licencias:** evitar dependencias cuya licencia exija pago o cambio de marca al pasar de cierto número de dispositivos.

### Supuestos

- Los clientes tienen WiFi estable en el punto de instalación o cerca de él.
- Los clientes usan Telegram o están dispuestos a instalarlo.
- Un intervalo de una lectura por minuto basta para todos los perfiles de uso.
- El usuario doméstico no calibrará por iniciativa propia; solo lo hará si la app lo guía y se lo pide.
- El tamaño de cada segmento (nodos y usuarios) es el de la tabla de segmentos, pendiente de validar.

### Riesgos

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| El semáforo muestra verde con agua contaminada por microorganismos | Daño a la salud del usuario y responsabilidad legal | Mensaje explícito de alcance (RNF-32); nunca usar "potable" o "seguro" |
| La deriva del electrodo de pH vuelve incorrecto el índice | El usuario deja de confiar en el producto | Detección de deriva y estado "Revisar sensor" (RF-39); calibración guiada (RF-40) |
| Turbidez sin calibrar a NTU | El índice no tiene significado físico | Calibración del sensor de turbidez antes de lanzar |
| Alertas excesivas | El usuario silencia el bot y pierde avisos reales | Estado estable (RF-21) y alertas sin repetición (RF-30) |
| Instalación complicada | Devoluciones y abandono | Prueba de instalación con usuarios reales (RNF-18) |
| Propiedad intelectual compartida con la BUAP | Bloqueo para comercializar | Consultar la normativa universitaria antes de desarrollar |
| Ubicaciones que permiten identificar hogares | Riesgo de privacidad y legal | Precisión reducida y mínimo de nodos por zona (RNF-08) |

## Fuera de alcance y preguntas abiertas

Esta versión de Lympha deja fuera todo lo que no sirve al job principal; las preguntas abiertas deben resolverse antes de cerrar la arquitectura.

### Fuera de alcance

- Cumplimiento normativo oficial y dictámenes para autoridades.
- Control de actuadores (válvulas, bombas, dosificadores de cloro).
- Medición de cloro, oxígeno disuelto o microbiología.
- Conectividad celular, LoRaWAN o NB-IoT.
- App nativa en tiendas; la primera versión es web instalable.
- Facturación y planes de pago dentro de la app.
- Predicción del índice con modelos de aprendizaje automático.

### Preguntas abiertas

- [ ] ¿Qué método de WQI se adopta para cada perfil (aritmético ponderado, CCME adaptado o propio) y con qué referencias se validan las curvas?
- [ ] ¿Qué segmento se ataca primero: hogar o negocios (escuela, hotel, pyme)?
- [ ] ¿Cómo se configura el WiFi desde el teléfono si el MVP es web? Web Bluetooth no funciona en Safari de iOS; puede requerir punto de acceso del nodo o una app nativa mínima.
- [ ] ¿Cuál es el modelo de negocio: venta del equipo, suscripción o ambos? Afecta RF-36, RF-38 y los límites por espacio.
- [ ] ¿Qué dice la normativa de propiedad intelectual de la BUAP sobre lo desarrollado durante el servicio social?
- [ ] ¿Qué umbrales y textos de acción recomendada se validan con un especialista en calidad del agua?
- [ ] ¿Se usarán los datos históricos de Kanan para validar el índice, y con qué permiso?
