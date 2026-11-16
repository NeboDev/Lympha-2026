# Cloración y pH: qué se puede calcular (y qué no)

> Documento de apoyo para Atl. Estado: **referencia técnica, no probada con hardware.** Las cifras marcadas «VERIFICAR» deben contrastarse con la fuente antes de citarlas en el pitch. Nunca decir «potable» ni «seguro».

## 1. La idea en una frase
**Un sensor de pH no mide cloro ni dice cuánto cloro echar.** Lo que sí dice es **qué tan bien trabaja el cloro que ya hay**: al subir el pH, el cloro libre se vuelve menos efectivo. Con pH + temperatura se calcula la **fracción de HOCl** (la forma fuerte) y eso informa la decisión de cloración.

## 2. Química mínima
El cloro libre en agua son dos formas en equilibrio:

- **HOCl** (ácido hipocloroso): desinfectante fuerte.
- **OCl⁻** (hipoclorito): mucho más débil (del orden de decenas de veces menos efectivo; VERIFICAR el factor antes de citarlo).

`HOCl ⇌ H⁺ + OCl⁻`, con constante de acidez pKa ≈ 7.54 a 25 °C.

### Fracción de HOCl
```
fracción_HOCl = 1 / (1 + 10^(pH − pKa(T)))
pKa(T) ≈ 3000/T − 10.0686 + 0.0253·T        (T en kelvin; Morris, 1966)
```
Verificación hecha: con T = 298.15 K da pKa = 7.54, que coincide con las fuentes (7.49–7.54 según la fuente). **No se pudo confirmar el texto original de Morris**; la expresión sale de la literatura de piscinas y tratamiento. Si el jurado pregunta: «aproximación estándar, válida entre 4 y 34 °C».

### Tabla calculada (% del cloro libre como HOCl)
Calculada con la fórmula anterior (no copiada de una tabla):

| pH | 15 °C | 20 °C | 25 °C | 30 °C |
|---|---|---|---|---|
| 6.0 | 98 | 97 | 97 | 97 |
| 6.5 | 93 | 92 | 92 | 91 |
| 7.0 | 81 | 79 | 77 | 76 |
| 7.5 | 58 | 55 | 52 | 50 |
| 8.0 | 30 | 28 | 26 | 24 |
| 8.3 | 18 | 16 | 15 | 14 |
| 8.5 | 12 | 11 | 10 | 9 |
| 9.0 | 4 | 4 | 3 | 3 |

Otras fuentes dan valores ligeramente distintos (p. ej. ~72 % a pH 7.0 en una tabla militar, ~77 % en otra) por la temperatura y la constante usada. Para el demo basta «~50 % a pH 7.5, ~25 % a pH 8, ~10 % a pH 8.5».

> **Corrección a `IDENTIDAD_VISUAL.md` §8:** el ejemplo «pH 8.3 → ~24 %» no coincide con la fórmula (≈ 15 % a 25 °C). Usar el valor calculado, no uno fijo.

### Sin sensor de temperatura
Si el nodo no mide temperatura, usar 25 °C y **decirlo** («estimado a 25 °C»). Entre 15 y 30 °C la diferencia es de unos 5–8 puntos porcentuales a pH 7.5–8.

## 3. Qué recomienda Atl con solo pH
Reglas para `evaluacion/` (datos en `parametros.json`, no `if`s):

| pH | Lectura | Mensaje humano |
|---|---|---|
| < 6.5 | fuera de rango (ácido) | Corregir el pH; el cloro sería muy efectivo pero el agua puede corroer. |
| 6.5–7.5 | zona útil (≥ ~50 % HOCl) | «El cloro actúa bien con este pH.» |
| 7.5–8.0 | efectividad cae | «El cloro actúa con menos fuerza (~X %).» |
| > 8.0 | baja | «Conviene corregir el pH antes de subir la dosis.» |
| > 8.5 | fuera de rango NOM | Idem + aviso de fuera de rango. |

Principio: **antes de subir la dosis, corregir el pH.** Subir cloro con pH alto desperdicia producto y aumenta el sabor y los subproductos, sin ganar mucha desinfección.

### Dosis equivalente (indicador, no instrucción)
Para mantener la misma cantidad de HOCl al subir el pH:
```
factor_dosis = fracción_HOCl(pH_ref) / fracción_HOCl(pH_actual)
```
Ejemplo a 25 °C: de pH 7.0 (77 %) a 8.0 (26 %) → ×3. Es una **comparación ilustrativa** de por qué el pH importa; **Atl no convierte esto en una dosis automática** (regla 3 de `CLAUDE.md`: la nube recomienda, una persona confirma).

## 4. Cálculo de la dosis de cloro (lo que sí se puede calcular a mano)
Esto **no depende del pH** como entrada; el pH solo decide la eficacia.

```
dosis_objetivo (mg/L) = demanda_de_cloro + residual_deseado
masa_producto (g)     = V (L) · dosis (mg/L) / (1000 · pureza)      # pureza como fracción
```
- **Residual libre objetivo:** la NOM-127-SSA1-2021 maneja 0.2–1.50 mg/L de cloro residual libre (varias fuentes; **VERIFICAR en el DOF** — hay fuentes con erratas). El pH permisible es 6.5–8.5.
- **Demanda de cloro:** lo que consume el agua (materia orgánica, hierro, amoniaco). **Se mide con ensayo**: dosis aplicada − residual a un tiempo fijo. No se puede obtener del pH.
- **Pureza** (orientativa, VERIFICAR etiqueta): blanqueador doméstico ≈ 3–6 % de NaOCl; hipoclorito de calcio granulado ≈ 65–70 %.

Ejemplo: tinaco de 1000 L, dosis 2 mg/L, hipoclorito de calcio al 65 %:
`1000 · 2 / (1000 · 0.65) ≈ 3.1 g`.
Ejemplo con blanqueador al 5 % (~50 g/L de NaOCl): `1000 · 2 / (1000 · 0.05) = 40 mL` de blanqueador al ~5 % (densidad ≈ 1 g/mL).

### Tiempo de contacto (CT)
La desinfección depende de **concentración × tiempo** (CT, mg·min/L), y el CT necesario **sube con el pH**. Ejemplo de una tabla regulatoria (Giardia, 1 log, 0.5 °C, 0.4 mg/L): CT = 54 a pH 6.5 → 65 a 7.0 → 79 a 7.5 → 92 a 8.0 → 110 a 8.5. Para el pitch basta: «a mayor pH, más tiempo o más cloro para el mismo efecto». No se calcula CT en Atl (requiere cloro medido y caudal).

### Efecto del producto sobre el pH
- Hipoclorito de sodio y, más aún, de calcio **suben** el pH.
- Cloro gas y tricloro **bajan** el pH.
Por eso un lazo «dosis ↔ pH» necesita vigilar el pH después de cada pulso.

## 5. Dónde se usa esto en Atl
| Dónde | Qué |
|---|---|
| `dominio/ph.ts` | `fraccionHOCl(ph, tempC = 25)` pura y con pruebas (valores de la tabla de §2 con tolerancia ±1 punto). |
| `parametros.json` | pKa y umbrales de mensaje como datos. |
| Web «Mi agua» | mini-tarjeta «Efectividad del cloro con este pH: ~X %» (con «estimado a 25 °C» si no hay temperatura). |
| Telegram | aviso de cloro de `IDENTIDAD_VISUAL.md` §8, con el X % calculado. |
| Actuador | solo acciones seguras automáticas (detener + avisar); subir dosis = confirmación humana. |

## 6. Límites honestos (decirlos en el pitch)
1. Sin sensor de cloro/ORP, el sistema es **lazo abierto** respecto al cloro: se sabe cuánto *rinde* el cloro, no cuánto *hay*.
2. La fracción de HOCl es **teórica**: ignora cianuratos, alta fuerza iónica y amoniaco (cloraminas).
3. La efectividad real depende del cloro residual, el tiempo de contacto y la turbidez, ninguno medido con solo pH.
4. El pH de la sonda debe estar calibrado; un pH incorrecto da una efectividad incorrecta.
5. Si el jueves aparece un sensor de cloro u ORP: agregarlo al catálogo y recién ahí cerrar el lazo (dosis recomendada con confirmación).

## 7. Fuentes consultadas (16-nov-2026)
- pKa del HOCl y constante de Morris: [poolhelp.com, efectividad bactericida relativa](https://www.poolhelp.com/wp-content/uploads/2024/09/6-1-Relative-Bactericidal-Effectiveness.pdf); [Wikipedia, ácido hipocloroso](https://www.Wikipedia.org/wiki/HOCl).
- Porcentajes de HOCl por pH: [Army, medicina preventiva](https://armymedical.tpub.com/MD0166/Chlorination-Environmental-Health-Inspections-and-Surveys-II-22.htm); [Kuntze](https://www.kuntzeusa.com/case-study/why-ph-matters-in-a-free-chlorine-measurement/).
- Tabla CT por pH: [Maine CDC, tablas CT](https://www.maine.gov/dhhs/mecdc/environmental-health/dwp/cet/documents/SWTRctTables.pdf).
- Límites NOM-127-SSA1-2021: [análisis ANEAS](https://agua.org.mx/wp-content/uploads/2022/05/Análisis-de-la-Actualización-de-la-NOM-127-SSA1-2021-Agua-para-uso-y-consumo-humano.-Límites-permisibles-de-la-calidad-del-agua-ANEAS.pdf); texto oficial en el DOF (2-may-2022).
- Para profundizar: *White's Handbook of Chlorination* (Black & Veatch).
