# Atl — Identidad visual y de voz

Archivos: `design/tokens.css` (fuente de verdad), `design/logo-atl.svg`, `design/paleta.html` (vista de la paleta; ábrelo en el navegador).
Nombre de trabajo **Atl**; es intercambiable (`server/config/marca.json`).

## 1. Concepto
**«Agua con rostro».** Atl no se ve como un tablero industrial ni como una app de venta: se ve como una **libreta de comunidad** — papel cálido, tinta oscura, un azul con raíz en Puebla. Tres ideas guían todo:

1. **Talavera**: el azul cobalto de la cerámica poblana es el color de marca. Da identidad local y lo distingue de los demás equipos (que irán con el azul genérico de Blynk).
2. **Papel y barro**: lienzo cálido (cal/arena) en lugar de blanco clínico; un acento terracota (barro) reservado para lo humano: bitácora, llamadas a la comunidad.
3. **Claridad sobre espectáculo**: el estado del agua se entiende en un segundo, sin jerga, y siempre con símbolo + palabra.

Relación con Lympha: **misma familia** (Inter, títulos ligeros, tarjetas planas, botones en píldora, semáforo idéntico) pero con paleta y tono propios. Lympha es el producto; Atl es su versión comunitaria.

## 2. Logo
`design/logo-atl.svg`: una gota en azul Talavera con un anillo concéntrico (la sonda / el punto de medición) y un destello. Usos:
- Símbolo solo (favicon, avatar del bot de Telegram, encabezado del PDF): 64×64, mínimo 24 px.
- Con nombre: símbolo + «Atl» en Inter 300, tracking −0.02 em.
- Zona de respeto: 1/4 del alto del símbolo. No deformar, no poner sobre fondos con poco contraste, no cambiar el azul.
- Sobre fondo oscuro: usar `--talavera` del tema oscuro (`#7FA6F2`) y anillo `#0B1626`.
- Es un boceto de hackathon; si hay tiempo, pedir a Brian/Brenda un ajuste de dibujo.

## 3. Paleta
Todos los contrastes están **calculados** (WCAG 2.x, relación de luminancia), no estimados.

### Identidad y superficies (claro)
| Nombre | Hex | Token | Uso | Contraste |
|---|---|---|---|---|
| Talavera | `#1F4FA3` | `--talavera` | botón primario, enlaces, foco | 7.3:1 sobre cal; texto blanco encima 7.8:1 |
| Talavera oscuro | `#16397A` | `--talavera-osc` | hover/presionado | 10.4:1 sobre cal |
| Agua | `#CFE8EE` | `--agua` | rellenos suaves, fondo de gráficas | decorativo |
| Manantial | `#1B7A78` | `--manantial` | acento secundario, datos positivos neutros | 4.8:1 sobre cal |
| Barro | `#9A4423` | `--barro` | bitácora, comunidad, llamadas humanas | 6.1:1 sobre cal |
| Cal | `#FBF8F2` | `--bg` | lienzo | — |
| Arena | `#F2EBDD` | `--surface` | tarjetas planas | — |
| Piedra | `#E3DAC8` | `--surface-2`/`--line` | líneas, placas de icono | — |
| Tinta | `#14233A` | `--text` | texto principal | 14.9:1 sobre cal |
| Humo | `#566175` | `--text-2` | texto secundario | 5.9:1 sobre cal, 5.3:1 sobre arena |

### Estados del agua (idénticos a Lympha)
| Estado | Relleno | Palabra y símbolo | Texto encima (`#101317`) |
|---|---|---|---|
| En rango | `#5DC756` | ● En rango | 8.7:1 |
| Atención | `#FFDA26` | ▲ Atención | 13.6:1 |
| Fuera de rango | `#FF7136` | ◆ Fuera de rango | 6.8:1 |
| Crítico | `#F92620` | ■ Crítico | 4.7:1 |
| Revisar sensor / Sin conexión | `#9AA0A6` | ? | 7.1:1 |

Reglas: el estado **nunca va solo en color** (siempre símbolo + palabra); el texto sobre un relleno de estado es **siempre** `#101317`; el azul Talavera **no** se usa para comunicar estado, solo acciones.

### Escala de pH
Degradado tipo papel indicador: `#E5674A` (ácido, ≈4) → `#5FB877` (neutro, ≈7) → `#6B7FE0` (básico, ≈10). Úsalo en el indicador de pH y en la gráfica (franja de la zona 6.5–8.5 sombreada con `--good-soft`).

### Modo oscuro
Sigue el sistema (`prefers-color-scheme`). Fondo `#0B1626`, superficie `#13233A`, texto `#F3EEE4` (15.7:1), humo `#9DA9BC` (7.6:1), Talavera claro `#7FA6F2` (7.5:1), barro claro `#E58A62` (7.0:1). Todo definido ya en `tokens.css`.

## 4. Tipografía
- **Inter variable** (OFL 1.1), autoalojada: copiar `apps/web/public/fuentes/inter-latin.woff2` a `web/public/fuentes/`. Cero dependencia de CDN (el Wi-Fi del recinto es incierto).
- Títulos: Inter **300**, tracking −0.02 em. Cuerpo: 400/500, 16 px, interlineado 1.55.
- Escala: 12 · 14 · 16 · 20 · 32 · 48 px. Cifras de pH en tamaño grande y **tabulares** (`font-variant-numeric: tabular-nums`) para que no «bailen».
- **PDF:** pdfkit usa Helvetica estándar (acentos y «ñ» funcionan en WinAnsi; VERIFICAR). No incrustar Inter salvo que se tenga el TTF.

## 5. Forma, espacio, movimiento
- Base de 4 px. Tarjetas planas, radio 20 px, sin sombra (sombra mínima solo en elementos flotantes). Botones y etiquetas en **píldora**. Inputs radio 10 px.
- Objetivo táctil mínimo **44 px**. Diseño móvil primero (se usará en teléfono y proyector).
- Movimiento sobrio: la cifra de pH se actualiza con transición corta; respeta `prefers-reduced-motion`. Sin animaciones decorativas.
- Iconos: **Lucide** (trazo 1.75), solo monocromo. Sin emoji dentro de la web (sí en Telegram, §8).

## 6. Pantallas (4)
1. **Entrar:** logo, frase, botón «Entrar con Google» (píldora). Debajo, una línea: «Atl no certifica el agua; te ayuda a vigilarla y a documentarla.»
2. **Mi agua:** tarjeta grande con el estado (relleno de estado, símbolo + palabra) y **pH en tipografía grande** con el indicador de escala; línea «lectura estable · hace 4 s»; frase de **qué hacer** («Espera 10 min y vuelve a medir»); gráfica de 24 h con franja 6.5–8.5; mini-tarjeta «Efectividad del cloro con este pH: ~X %». Si hay sonda degradada: tarjeta «Revisar sensor».
3. **Reportes:** selector de periodo (Hoy · 7 días · 30 días · personalizado), vista previa de las cifras clave, botón «Descargar reporte PDF», lista de reportes anteriores.
4. **Comunidad:** miembros; «Vincular Blynk» (pegar token o escanear QR → validación con ✓); «Vincular Telegram» (botón que abre el enlace); **Bitácora** (campo «¿Qué se hizo?» con fecha y autor, en acento barro).
Estados vacíos y de error explican **qué pasó y qué hacer**, en el tono de §8.

## 7. Reporte PDF (carta)
Encabezado: símbolo Atl + «Bitácora de calidad del agua» + comunidad, nodo, ubicación, periodo, quién lo generó. Cuerpo, en este orden:
1. **Resumen en lenguaje sencillo** (3–4 líneas): qué se midió, cuánto del tiempo estuvo en rango, qué pasó de relevante.
2. **Insignia de pH:** «pH dentro del rango de la NOM-127 el 97.2 % del tiempo» (relleno de estado + símbolo + palabra). **Jamás** «CUMPLE NOM-127» global.
3. **Tabla de estadísticas** por parámetro medido: promedio, mínimo, máximo, límites de la norma, % en rango, n de muestras y **cobertura de datos %**.
4. **Gráfica** del periodo con la franja 6.5–8.5 (SVG/vectores en pdfkit).
5. **Eventos y alertas:** apertura, cierre, duración, qué se hizo.
6. **Calibraciones:** fecha, pendiente (% de Nernst), offset, diagnóstico de la sonda (trazabilidad).
7. **Bitácora de la comunidad** (acciones humanas, acento barro).
8. **Lo que este reporte NO cubre:** lista de parámetros de la NOM-127 no medidos (cloro residual libre, turbidez, etc.) y la aclaración de que un sensor no sustituye el muestreo y análisis de laboratorio.
9. Pie: ID del reporte, hash corto, fecha de generación (hora de México), «Generado por Atl · no es una certificación».
Paleta del PDF: tinta sobre cal, Talavera para títulos de tabla, relleno de estado solo en la insignia, barro en bitácora. Impreso en blanco y negro debe seguir entendiéndose (símbolos y palabras).

## 8. Voz y mensajes (Telegram y textos de la app)
Principios: **hablar como un vecino que sabe**, no como un manual. Frases cortas, sin jerga, **qué pasó + qué significa + qué hacer**. Nunca «potable» ni «seguro» (lo verifica una prueba). Nunca culpar. Tuteo.

| Situación | Texto |
|---|---|
| Fuera de rango | `🔶 El agua de «Tinaco azotea» salió del rango recomendado.` `El pH está en 6.2 (lo normal va de 6.5 a 8.5).` `Qué hacer: evita usarla para beber o cocinar hasta revisar. Avísale a la persona responsable.` |
| Crítico | `🟥 El pH de «Tinaco azotea» está muy fuera de rango (5.1).` `Detuvimos la dosificación. Por favor revisa el tinaco ahora.` |
| Cambio rápido | `🔸 El pH cambió 0.6 en 5 minutos, aunque sigue en rango. Puede ser algo que entró al agua. Vale la pena revisar.` |
| Sensor | `❔ La lectura de «Tinaco azotea» no es confiable (revisar la sonda). No tomes decisiones con este dato hasta calibrar.` |
| Sin conexión | `⚪ No recibimos datos de «Tinaco azotea» desde hace 5 minutos. La alarma local sigue funcionando.` |
| Recuperación | `✅ El pH de «Tinaco azotea» volvió al rango (7.1). La alerta duró 18 minutos.` |
| Cloro | `ℹ️ Con este pH (8.3) el cloro libre actúa con menos fuerza (~24 % en su forma más efectiva). Conviene corregir el pH antes de subir la dosis.` |
| Confirmación | `¿Confirmas dar un pulso de cloro de 30 s?` `[Confirmar] [No, esperar]` |
Bot de Telegram: foto = símbolo Atl; descripción «Avisos y reportes de la calidad del agua de tu comunidad»; comandos `/estado /reporte /ayuda /desvincular`.

## 9. Accesibilidad (mínimos del proyecto)
Contraste AA o más en todo texto; estado = color + símbolo + palabra; objetivos de 44 px; foco visible (`:focus-visible` con 3 px Talavera); `prefers-reduced-motion` respetado; texto escalable sin romper el diseño; idioma `lang="es"`; gráfica con descripción en texto («pH entre 6.9 y 7.3 en las últimas 24 h»).

## 10. Para la presentación
Fondo cal, títulos Inter 300, una diapositiva = una idea, el **dato real en vivo** como protagonista (pH que cambia al agregar limón/bicarbonato). Una sola foto de contexto humano (escuela, tinaco, comunidad) vale más que tres esquemas; si no hay, usar el PDF real y el mensaje de Telegram en el teléfono del jurado.
