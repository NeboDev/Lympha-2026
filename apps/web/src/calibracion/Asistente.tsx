import {
  advertencias,
  calcularRegresion,
  ErrorCalibracion,
  evaluarEstabilidad,
  GUIA_CALIBRACION,
  PARAMETROS_CALIBRABLES,
  type ParametroCalibrable,
  type ResultadoRegresion,
} from "@lympha/calibracion";
import { useReducer, useState } from "react";
import { useAccionesCalibracion, useLecturasVivas } from "../api/consultas-calibracion.ts";
import { mensajeDeError } from "../api/mensajes.ts";
import { IcoCheck, IcoReloj } from "../componentes/Iconos.tsx";
import { AnimacionPaso } from "./AnimacionPaso.tsx";
import { estadoInicial, minimoDe, pasosDe, puedeTerminar, reducirAsistente } from "./asistente.ts";
import {
  anclaDe,
  lecturasCrudas,
  NOMBRES_PARAMETRO_CAL,
  numeroCal,
  valorCrudo,
  vistaPrevia,
} from "./utilidades.ts";

const TEXTO_ADVERTENCIA = {
  pendiente_atipica:
    "La pendiente se sale de lo habitual: puede que la sonda esté sucia, vieja o que un valor esté mal capturado.",
  r2_bajo:
    "Los puntos no quedan bien alineados (R² bajo). Repite el punto que se vea más raro antes de guardar.",
} as const;

const formato = (v: number, unidad: string) => `${numeroCal(v)}${unidad ? ` ${unidad}` : ""}`;

/**
 * Asistente de calibración de un parámetro: elegir → medir cada solución patrón esperando a que la lectura se
 * estabilice → revisar la recta y su efecto → confirmar. El servidor vuelve a calcular la recta con los puntos;
 * lo que se ve aquí es la misma cuenta (paquete compartido) para decidir antes de guardar.
 */
export function Asistente({
  nodoId,
  nombreNodo,
  parametroInicial,
}: {
  nodoId: string;
  nombreNodo: string;
  parametroInicial?: ParametroCalibrable | undefined;
}) {
  const [estado, despachar] = useReducer(
    reducirAsistente,
    parametroInicial
      ? reducirAsistente(estadoInicial, { tipo: "elegir", parametro: parametroInicial })
      : estadoInicial,
  );
  const [confirmando, setConfirmando] = useState(false);
  const [guardado, setGuardado] = useState<ParametroCalibrable | null>(null);
  const acciones = useAccionesCalibracion(nodoId);
  const vivas = useLecturasVivas(nodoId, estado.fase !== "elegir" && guardado === null);

  const parametro = estado.parametro;
  const lecturas = vivas.data?.lecturas ?? [];
  const ultimaCruda = parametro && lecturas[0] ? valorCrudo(lecturas[0], parametro) : null;

  if (guardado) {
    return (
      <section className="tarjeta grid gap-3 p-5" aria-labelledby="h-asistente">
        <h2 id="h-asistente" className="m-0 flex items-center gap-2">
          <IcoCheck tamano={22} grosor={3} /> Calibración guardada
        </h2>
        <p className="m-0" role="status">
          Se aplicará a las lecturas nuevas de {NOMBRES_PARAMETRO_CAL[guardado]} en {nombreNodo}.
          Las lecturas anteriores no cambian y siempre se conserva el valor sin calibrar.
        </p>
        <button
          type="button"
          onClick={() => {
            setGuardado(null);
            despachar({ tipo: "reiniciar" });
          }}
        >
          Calibrar otro parámetro
        </button>
      </section>
    );
  }

  if (estado.fase === "elegir" || !parametro) {
    return (
      <section className="tarjeta grid gap-4 p-5" aria-labelledby="h-asistente">
        <div>
          <h2 id="h-asistente" className="m-0">
            Calibrar {nombreNodo}
          </h2>
          <p className="detalle m-0">
            Elige qué sensor calibrar. Ten a la mano las soluciones patrón y agua destilada. La
            temperatura no se calibra.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PARAMETROS_CALIBRABLES.map((p) => (
            <button
              key={p}
              type="button"
              className="secundario"
              onClick={() => despachar({ tipo: "elegir", parametro: p })}
            >
              {NOMBRES_PARAMETRO_CAL[p]}
              <span className="detalle text-xs">
                {pasosDe(p)
                  .filter((x) => !x.opcional)
                  .map((x) => x.titulo)
                  .join(" · ")}
              </span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  const guia = GUIA_CALIBRACION[parametro];
  const pasos = pasosDe(parametro);

  if (estado.fase === "punto") {
    const paso = pasos[estado.indice];
    const referencia = estado.referencias[estado.indice] ?? 0;
    const crudas = lecturasCrudas(lecturas, parametro, estado.ancla);
    const est = evaluarEstabilidad(
      parametro,
      crudas.map((l) => l.valor),
    );
    const faltan = Math.max(0, est.necesarias - est.disponibles);
    return (
      <section className="tarjeta grid gap-4 p-5" aria-labelledby="h-asistente">
        <div>
          <p className="detalle m-0">
            {NOMBRES_PARAMETRO_CAL[parametro]} · punto {estado.indice + 1} de {pasos.length}
            {paso?.opcional ? " (opcional)" : ""}
          </p>
          <h2 id="h-asistente" className="m-0">
            {paso?.titulo}
          </h2>
        </div>

        <AnimacionPaso
          parametro={parametro}
          referencia={referencia}
          midiendo={estado.momento === "midiendo"}
          progreso={est.disponibles / est.necesarias}
          estable={estado.momento === "midiendo" && est.estable}
        />

        {estado.momento === "preparar" ? (
          <>
            <p className="m-0">{guia.indicacion}</p>
            <label>
              Valor real de esta solución{guia.unidad ? ` (${guia.unidad})` : ""}
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={Number.isFinite(referencia) ? referencia : ""}
                onChange={(e) =>
                  despachar({
                    tipo: "referencia",
                    indice: estado.indice,
                    valor: e.target.value === "" ? Number.NaN : Number(e.target.value),
                  })
                }
              />
            </label>
            <p className="detalle m-0">
              Cámbialo si el frasco indica otro valor (por ejemplo, según la temperatura).
            </p>
            <button
              type="button"
              disabled={!Number.isFinite(referencia)}
              onClick={() => despachar({ tipo: "medir", ancla: anclaDe(lecturas) })}
            >
              La sonda ya está en la solución
            </button>
          </>
        ) : (
          <>
            <div role="status" aria-live="polite" className="grid gap-2">
              <p className="m-0 text-2xl font-bold tabular-nums">
                {est.promedio === null ? "—" : formato(est.promedio, guia.unidad)}
              </p>
              <progress
                value={est.disponibles}
                max={est.necesarias}
                aria-label="Lecturas reunidas para estabilizar"
                className="w-full"
              />
              {est.estable ? (
                <p className="m-0 flex items-center gap-2 font-bold">
                  <IcoCheck tamano={18} grosor={3} /> Lectura estable
                  {est.desviacion !== null && (
                    <span className="detalle font-normal">
                      (varía ±{numeroCal(est.desviacion)})
                    </span>
                  )}
                </p>
              ) : crudas.length === 0 ? (
                <p className="detalle m-0 flex items-center gap-2">
                  <IcoReloj tamano={16} /> Esperando una lectura nueva del nodo…
                </p>
              ) : (
                <p className="detalle m-0 flex items-center gap-2">
                  <IcoReloj tamano={16} />
                  {faltan > 0
                    ? `Reuniendo lecturas: faltan ${faltan}.`
                    : "La lectura todavía se mueve; espera a que se asiente."}
                </p>
              )}
            </div>
            {vivas.isError && <p role="alert">{mensajeDeError(vivas.error)}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!est.estable || est.promedio === null}
                onClick={() =>
                  est.promedio !== null && despachar({ tipo: "capturar", crudo: est.promedio })
                }
              >
                Capturar este punto
              </button>
              <button
                type="button"
                className="secundario"
                onClick={() => despachar({ tipo: "repetir", indice: estado.indice })}
              >
                Volver atrás
              </button>
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {paso?.opcional && estado.momento === "preparar" && (
            <button type="button" className="enlace" onClick={() => despachar({ tipo: "omitir" })}>
              Omitir este punto
            </button>
          )}
          {puedeTerminar(estado) && (
            <button
              type="button"
              className="enlace"
              onClick={() => despachar({ tipo: "terminar" })}
            >
              Revisar con {estado.capturados.length} puntos
            </button>
          )}
          <button type="button" className="enlace" onClick={() => despachar({ tipo: "reiniciar" })}>
            Cancelar
          </button>
        </div>
        {estado.capturados.length > 0 && (
          <p className="detalle m-0">
            Capturados:{" "}
            {estado.capturados
              .map((c) => `${c.titulo} (${formato(c.crudo, guia.unidad)})`)
              .join(", ")}
          </p>
        )}
        {estado.capturados.length < minimoDe(parametro) && (
          <p className="detalle m-0">Se necesitan al menos {minimoDe(parametro)} puntos.</p>
        )}
      </section>
    );
  }

  // resumen
  let regresion: ResultadoRegresion | null = null;
  let errorRegresion: string | null = null;
  try {
    regresion = calcularRegresion(estado.capturados);
  } catch (error) {
    errorRegresion =
      error instanceof ErrorCalibracion ? error.message : "No se pudo calcular la calibración.";
  }
  const avisos = regresion ? advertencias(regresion) : [];
  const filas = regresion ? vistaPrevia(estado.capturados, regresion) : [];
  const despues =
    regresion && ultimaCruda !== null
      ? regresion.pendiente * ultimaCruda + regresion.desfase
      : null;

  return (
    <section className="tarjeta grid gap-4 p-5" aria-labelledby="h-asistente">
      <div>
        <p className="detalle m-0">{NOMBRES_PARAMETRO_CAL[parametro]} · revisión</p>
        <h2 id="h-asistente" className="m-0">
          Revisa antes de guardar
        </h2>
      </div>

      {errorRegresion && <p role="alert">{errorRegresion}</p>}

      {regresion && (
        <>
          <dl className="valores">
            <div>
              <dt>Pendiente</dt>
              <dd>{numeroCal(regresion.pendiente)}</dd>
            </div>
            <div>
              <dt>Desfase</dt>
              <dd>{numeroCal(regresion.desfase)}</dd>
            </div>
            <div>
              <dt>R²</dt>
              <dd>{regresion.puntos < 3 ? "— (2 puntos)" : numeroCal(regresion.r2)}</dd>
            </div>
          </dl>
          {avisos.map((a) => (
            <p key={a} role="alert" className="m-0">
              {TEXTO_ADVERTENCIA[a]}
            </p>
          ))}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tabular-nums">
              <caption className="sr-only">Antes y después de calibrar cada punto</caption>
              <thead>
                <tr>
                  <th scope="col">Real</th>
                  <th scope="col">Antes</th>
                  <th scope="col">Después</th>
                  <th scope="col">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={`${f.referencia}-${f.crudo}`}>
                    <td>{numeroCal(f.referencia)}</td>
                    <td>{numeroCal(f.crudo)}</td>
                    <td>{numeroCal(f.calibrado)}</td>
                    <td>{numeroCal(f.error)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {ultimaCruda !== null && despues !== null && (
            <p className="m-0">
              Con la última lectura, el sensor marca{" "}
              <strong>{formato(ultimaCruda, guia.unidad)}</strong> y con esta calibración marcaría{" "}
              <strong>{formato(despues, guia.unidad)}</strong>.
            </p>
          )}
        </>
      )}

      {acciones.guardar.isError && <p role="alert">{mensajeDeError(acciones.guardar.error)}</p>}

      {confirmando && regresion ? (
        <div
          className="grid gap-2 rounded-ctl border border-line p-3"
          role="group"
          aria-label="Confirmar"
        >
          <p className="m-0 font-semibold">
            ¿Guardar esta calibración? Se aplicará a las lecturas nuevas de {nombreNodo}; la
            anterior queda en el historial para volver a ella.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={acciones.guardar.isPending}
              onClick={() =>
                acciones.guardar.mutate(
                  {
                    parametro,
                    puntos: estado.capturados.map(({ crudo, referencia }) => ({
                      crudo,
                      referencia,
                    })),
                  },
                  {
                    onSuccess: () => {
                      setConfirmando(false);
                      setGuardado(parametro);
                    },
                  },
                )
              }
            >
              Sí, guardar
            </button>
            <button type="button" className="secundario" onClick={() => setConfirmando(false)}>
              Todavía no
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!regresion} onClick={() => setConfirmando(true)}>
            Guardar calibración
          </button>
          <button
            type="button"
            className="secundario"
            onClick={() => {
              setConfirmando(false);
              despachar({ tipo: "reiniciar" });
            }}
          >
            Descartar
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {pasos.map((p, i) => (
          <button
            key={p.titulo}
            type="button"
            className="enlace"
            onClick={() => despachar({ tipo: "repetir", indice: i })}
          >
            Repetir: {p.titulo}
          </button>
        ))}
      </div>
    </section>
  );
}
