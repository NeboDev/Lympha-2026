import { ObjectId } from "mongodb";
import type { Catalogo } from "../../dominio/catalogo.ts";
import {
  avisoCambioRapido,
  avisoCritico,
  avisoFueraDeRango,
  avisoRecordatorio,
  avisoRecuperacion,
  avisoSensor,
  avisoSinConexion,
  type ContextoAviso,
  lineaCloro,
} from "../../dominio/frases.ts";
import type { Marca } from "../../dominio/marca.ts";
import type { CambioNodo } from "../ingesta/index.ts";
import type { NodoDoc, UltimoNodo } from "../nodos/index.ts";
import type { AvisoDoc, TipoAviso } from "../notificaciones/index.ts";
import type { AlertaDoc, AlmacenAlertas, LoggerAlertas, SeveridadAlerta } from "./puertos.ts";
import {
  type Accion,
  type AlertaAbierta,
  alertasDeseadas,
  mayorSeveridad,
  reconciliar,
  recordatorioDebido,
} from "./reglas.ts";

const SILENCIO: LoggerAlertas = { info() {}, warn() {}, error() {} };

export type OpcionesAlertas = {
  almacen: AlmacenAlertas;
  catalogo: Catalogo;
  marca: Marca;
  recordatorioMin: number;
  reloj?: () => Date;
  logger?: LoggerAlertas;
};

export type Alertas = ReturnType<typeof crearAlertas>;

const minutosEntre = (desde: Date, hasta: Date) => (hasta.getTime() - desde.getTime()) / 60_000;
const severidadEvento = (s: SeveridadAlerta) => (s === "atencion" ? "atencion" : "alta");

export function crearAlertas(op: OpcionesAlertas) {
  const reloj = op.reloj ?? (() => new Date());
  const logger = op.logger ?? SILENCIO;

  /** Datos para redactar un aviso: nombre del nodo, parámetro y límites que valen para ese nodo. */
  function contexto(nodo: NodoDoc, parametro: string | null, valor: number | null): ContextoAviso {
    const p = parametro ? op.catalogo.parametros[parametro] : undefined;
    const norma = (parametro ? nodo.umbrales?.[parametro] : undefined) ?? p?.norma ?? null;
    return {
      nodo: nodo.nombre,
      parametro: p?.nombre ?? parametro ?? "",
      articulo: p?.articulo,
      valor,
      decimales: p?.decimales ?? 2,
      unidad: p?.unidad ?? "",
      min: norma?.min ?? null,
      max: norma?.max ?? null,
    };
  }

  /** Línea del cloro para parámetros que lo afectan (los del catálogo con `cloro`). */
  function cloroDe(parametro: string | null, valor: number | null): string | null {
    const cfg = parametro ? op.catalogo.parametros[parametro]?.cloro : undefined;
    if (!cfg || valor === null) return null;
    return lineaCloro(valor, cfg.temp_defecto_c, cfg.aviso_bajo_pct);
  }

  const valorDe = (ultimo: UltimoNodo, parametro: string | null): number | null =>
    parametro ? (ultimo.v[parametro] ?? null) : null;

  /** Texto de apertura o escalada de una alerta, según su tipo y severidad. */
  function textoAbre(
    alerta: Pick<AlertaDoc, "tipo" | "parametro" | "severidad">,
    nodo: NodoDoc,
    ultimo: UltimoNodo,
    ahora: Date,
  ): string {
    const valor = valorDe(ultimo, alerta.parametro);
    const c = contexto(nodo, alerta.parametro, valor);
    switch (alerta.tipo) {
      case "nivel":
        return alerta.severidad === "critica"
          ? avisoCritico(c, {
              dosificacionDetenida: op.marca.dosificacion_automatica,
              cloro: cloroDe(alerta.parametro, valor),
            })
          : avisoFueraDeRango(c, cloroDe(alerta.parametro, valor));
      case "cambio_rapido": {
        const reglas = alerta.parametro ? op.catalogo.parametros[alerta.parametro]?.reglas : null;
        return avisoCambioRapido(c, {
          cambio: alerta.parametro ? (ultimo.detalles?.[alerta.parametro]?.cambio ?? null) : null,
          ventanaMin: reglas?.cambio_rapido.ventana_min ?? 5,
        });
      }
      case "sensor":
        return avisoSensor(c);
      case "sin_conexion":
        return avisoSinConexion({
          nodo: nodo.nombre,
          silencioMin: minutosEntre(ultimo.ultimo_cambio, ahora),
          alarmaLocal: op.marca.alarma_local_en_avisos,
        });
    }
  }

  /** Encola un aviso si la comunidad tiene chat. `false` = no hay a dónde mandarlo (aún). */
  async function avisar(
    alerta: Pick<AlertaDoc, "_id" | "nodo_id" | "comunidad_id">,
    tipo: TipoAviso,
    claveAviso: string,
    texto: string,
    ahora: Date,
    recordatorios?: number,
  ): Promise<boolean> {
    if (!(await op.almacen.hayChat(alerta.comunidad_id))) return false;
    const aviso: AvisoDoc = {
      _id: new ObjectId(),
      clave: claveAviso,
      comunidad_id: alerta.comunidad_id,
      nodo_id: alerta.nodo_id,
      alerta_id: alerta._id,
      tipo,
      texto,
      creado: ahora,
      estado: "pendiente",
      intentos: 0,
      proximo_intento: ahora,
      bloqueado_hasta: null,
      enviado: null,
      ultimo_error: null,
    };
    await op.almacen.encolarAviso(aviso);
    await op.almacen.marcarAviso(alerta._id, ahora, recordatorios);
    return true;
  }

  async function ejecutar(accion: Accion, c: CambioNodo): Promise<void> {
    const { nodo, ultimo, ahora } = c;
    const idNodo = nodo._id.toHexString();

    if (accion.tipo === "abrir") {
      const d = accion.deseada;
      const alerta: AlertaDoc = {
        _id: new ObjectId(),
        nodo_id: nodo._id,
        comunidad_id: nodo.comunidad_id,
        tipo: d.tipo,
        parametro: d.parametro,
        severidad: d.severidad,
        severidad_maxima: d.severidad,
        estado: "abierta",
        abierta: ahora,
        cerrada: null,
        ultimo_aviso: null,
        recordatorios: 0,
        valor_apertura: d.valor,
        valor_cierre: null,
      };
      // Otra instancia (o un reintento) pudo abrirla ya: no se repite nada.
      if ((await op.almacen.insertarAlerta(alerta)) === "duplicada") return;
      const texto = textoAbre(alerta, nodo, ultimo, ahora);
      const idAlerta = alerta._id.toHexString();
      logger.info({ nodo_id: idNodo, alerta_id: idAlerta, tipo: d.tipo }, "alerta abierta");
      await op.almacen.registrarEvento({
        nodo_id: nodo._id,
        comunidad_id: nodo.comunidad_id,
        ts: ahora,
        tipo: "alerta_abre",
        severidad: severidadEvento(d.severidad),
        parametro: d.parametro,
        mensaje: texto,
        datos: { alerta_id: idAlerta, tipo: d.tipo, valor: d.valor },
        autor_uid: null,
      });
      await avisar(alerta, "abre", `${idAlerta}:abre`, texto, ahora);
      return;
    }

    const a = accion.alerta;
    const idAlerta = a._id.toHexString();
    const ref = { _id: a._id, nodo_id: nodo._id, comunidad_id: nodo.comunidad_id };

    if (accion.tipo === "escalar") {
      const maxima = mayorSeveridad(accion.a, a.severidad_maxima);
      if (!(await op.almacen.cambiarSeveridad(a._id, a.severidad, accion.a, maxima))) return;
      // Sin un primer aviso no hay nada que escalar: el barrido mandará el texto actual.
      if (a.ultimo_aviso === null) return;
      const texto = textoAbre({ ...a, severidad: accion.a }, nodo, ultimo, ahora);
      await avisar(ref, "escala", `${idAlerta}:escala:${accion.a}`, texto, ahora);
      return;
    }

    if (accion.tipo === "bajar") {
      // Mejorar de crítico a fuera de rango no es una recuperación: se actualiza sin avisar.
      await op.almacen.cambiarSeveridad(a._id, a.severidad, accion.a, a.severidad_maxima);
      return;
    }

    // Cerrar.
    const valor = valorDe(ultimo, a.parametro);
    if (!(await op.almacen.cerrarAlerta(a._id, ahora, valor))) return;
    const duracionMin = minutosEntre(a.abierta, ahora);
    const texto = avisoRecuperacion(contexto(nodo, a.parametro, valor), {
      tipo: a.tipo,
      duracionMin,
    });
    logger.info(
      { nodo_id: idNodo, alerta_id: idAlerta, silenciosa: accion.silenciosa },
      "alerta cerrada",
    );
    await op.almacen.registrarEvento({
      nodo_id: nodo._id,
      comunidad_id: nodo.comunidad_id,
      ts: ahora,
      tipo: "alerta_cierra",
      severidad: "info",
      parametro: a.parametro,
      mensaje: texto,
      datos: { alerta_id: idAlerta, tipo: a.tipo, duracion_min: Math.round(duracionMin) },
      autor_uid: null,
    });
    // Los cierres solo van a quien ya fue avisado, y un cierre «silencioso» no es una recuperación.
    if (!accion.silenciosa && a.ultimo_aviso !== null) {
      await avisar(ref, "cierra", `${idAlerta}:cierra`, texto, ahora);
    }
  }

  return {
    /**
     * Reconcilia las alertas de un nodo con su última foto. Idempotente: llamarla de nuevo con la
     * misma foto no abre, escala ni cierra nada otra vez.
     */
    async sincronizar(c: CambioNodo): Promise<void> {
      const abiertas: AlertaAbierta[] = await op.almacen.alertasAbiertasDeNodo(c.nodo._id);
      const acciones = reconciliar(abiertas, alertasDeseadas(c.ultimo), c.ultimo.sin_datos);
      for (const accion of acciones) await ejecutar(accion, c);
    },

    /**
     * Pasada periódica: manda el primer aviso de las alertas que aún no lo tienen (p. ej. se
     * vinculó Telegram después) y los recordatorios que ya tocan.
     */
    async barrido(): Promise<{ avisos: number }> {
      const ahora = reloj();
      const abiertas = await op.almacen.alertasAbiertas();
      const nodos = new Map<string, NodoDoc | null>();
      let avisos = 0;
      for (const a of abiertas) {
        const id = a.nodo_id.toHexString();
        if (!nodos.has(id)) nodos.set(id, await op.almacen.nodo(a.nodo_id));
        const nodo = nodos.get(id);
        const ultimo = nodo?.ultimo;
        if (!nodo || !ultimo) continue;
        const idAlerta = a._id.toHexString();

        if (a.ultimo_aviso === null) {
          const texto = textoAbre(a, nodo, ultimo, ahora);
          if (await avisar(a, "abre", `${idAlerta}:abre`, texto, ahora)) avisos++;
        } else if (recordatorioDebido(a, ahora, op.recordatorioMin)) {
          const n = a.recordatorios + 1;
          const texto = avisoRecordatorio(
            contexto(nodo, a.parametro, valorDe(ultimo, a.parametro)),
            {
              tipo: a.tipo,
              duracionMin: minutosEntre(a.abierta, ahora),
            },
          );
          if (await avisar(a, "recordatorio", `${idAlerta}:rec:${n}`, texto, ahora, n)) avisos++;
        }
      }
      return { avisos };
    },
  };
}
