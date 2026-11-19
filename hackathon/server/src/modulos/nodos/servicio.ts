import type { ObjectId } from "mongodb";
import { type Catalogo, parametroDe } from "../../dominio/catalogo.ts";
import {
  Conflicto,
  NoEncontrado,
  type Rol,
  ServicioNoDisponible,
  SolicitudInvalida,
} from "../../dominio/errores.ts";
import { detalleAlerta, tituloAlerta } from "../../dominio/frases.ts";
import type { AlertaDoc } from "../alertas/index.ts";
import type { ServicioComunidades } from "../comunidades/index.ts";
import { crearDocumentoNodo } from "./nodo.ts";
import type {
  AlmacenNodos,
  CambiosNodo,
  ComprobadorToken,
  EventoNodo,
  PuntoSerie,
} from "./puertos.ts";
import type { NodoDoc, UltimoNodo } from "./tipos.ts";

export type OpcionesNodos = {
  almacen: AlmacenNodos;
  comunidades: Pick<ServicioComunidades, "acceso">;
  comprobador: ComprobadorToken;
  catalogo: Catalogo;
  /** Host de Blynk que se guarda en el nodo nuevo. */
  blynkHost: string;
  /** Cifra el token de Blynk antes de guardarlo (AES-256-GCM). */
  cifrar: (token: string) => string;
  reloj?: () => Date;
};

export const MAX_NODOS_POR_COMUNIDAD = 20;
const TOKEN_BLYNK = /^[A-Za-z0-9_-]{16,64}$/;
const DIA_MS = 86_400_000;
/** Pasos «redondos» (segundos) entre los que se elige para que la gráfica no pida más de lo que muestra. */
const PASOS_S = [
  5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14_400, 21_600, 43_200, 86_400,
];
const PUNTOS_OBJETIVO = 240;
const PUNTOS_MAX = 1000;
const PASO_MIN_S = 5;

export type DatosAlta = {
  nombre: string;
  tokenBlynk: string;
  ubicacion?: { texto: string; lat?: number; lng?: number } | undefined;
  parametros?: string[] | undefined;
};

export type ParametroVista = {
  id: string;
  nombre: string;
  unidad: string;
  decimales: number;
  norma: { min: number | null; max: number | null; fuente: string } | null;
};

export type NodoVista = {
  id: string;
  comunidad_id: string;
  nombre: string;
  ubicacion: { texto: string; lat?: number; lng?: number } | null;
  parametros: ParametroVista[];
  /** `sin_lecturas`: aún no llega ninguna · `sin_datos`: dejó de enviar · `conectado`: envía datos. */
  conexion: "sin_lecturas" | "conectado" | "sin_datos";
  ultimo: {
    ts: Date;
    v: Record<string, number>;
    estado: UltimoNodo["estado"];
    estados: UltimoNodo["estados"];
    estable: boolean | null;
    sin_datos: boolean;
  } | null;
  /** Qué actuador tiene, o `null`. El detalle y los controles salen de `/actuador`. */
  actuador: { habilitado: boolean; nombre: string; simulado: boolean } | null;
  rol: Rol;
  creado: Date;
};

export type AlertaVista = {
  id: string;
  tipo: AlertaDoc["tipo"];
  parametro: string | null;
  severidad: AlertaDoc["severidad"];
  severidad_maxima: AlertaDoc["severidad_maxima"];
  estado: AlertaDoc["estado"];
  abierta: Date;
  cerrada: Date | null;
  valor_apertura: number | null;
  valor_cierre: number | null;
  titulo: string;
  detalle: string;
};

export type EventoVista = {
  ts: Date;
  tipo: EventoNodo["tipo"];
  mensaje: string;
  /** `true` si la nota o la calibración la hizo quien consulta. */
  propia: boolean;
};

export type ConsultaSerie = {
  desde?: Date | undefined;
  hasta?: Date | undefined;
  pasoS?: number | undefined;
};
export type ConsultaEventos = {
  desde?: Date | undefined;
  hasta?: Date | undefined;
  limite?: number | undefined;
};

export function crearServicioNodos(op: OpcionesNodos) {
  const reloj = op.reloj ?? (() => new Date());
  const { catalogo } = op;

  function vista(nodo: NodoDoc, rol: Rol): NodoVista {
    const u = nodo.ultimo;
    return {
      id: nodo._id.toHexString(),
      comunidad_id: nodo.comunidad_id.toHexString(),
      nombre: nodo.nombre,
      ubicacion: nodo.ubicacion ?? null,
      parametros: nodo.parametros.flatMap((id) => {
        const p = catalogo.parametros[id];
        if (!p) return [];
        const umbral = nodo.umbrales?.[id];
        const limites = umbral ?? (p.norma ? { min: p.norma.min, max: p.norma.max } : null);
        return [
          {
            id,
            nombre: p.nombre,
            unidad: p.unidad,
            decimales: p.decimales,
            norma: limites
              ? { ...limites, fuente: umbral ? "Umbral de este nodo" : (p.norma?.fuente ?? "") }
              : null,
          },
        ];
      }),
      conexion: u ? (u.sin_datos ? "sin_datos" : "conectado") : "sin_lecturas",
      ultimo: u
        ? {
            ts: u.ts,
            v: u.v,
            estado: u.estado,
            estados: u.estados,
            estable: u.estable,
            sin_datos: u.sin_datos,
          }
        : null,
      actuador: nodo.actuador
        ? {
            habilitado: nodo.actuador.habilitado,
            nombre: nodo.actuador.nombre,
            simulado: nodo.actuador.simulado,
          }
        : null,
      rol,
      creado: nodo.creado,
    };
  }

  /** Elige el paso redondo más chico con el que el periodo cabe en unos 240 puntos. */
  function pasoAutomatico(duracionS: number): number {
    const ideal = duracionS / PUNTOS_OBJETIVO;
    return PASOS_S.find((p) => p >= ideal) ?? (PASOS_S.at(-1) as number);
  }

  /** `NoEncontrado` si el nodo no existe o no es de una comunidad de la persona. */
  async function acceso(uid: string, nodoId: ObjectId, minimo: Rol = "integrante") {
    const nodo = await op.almacen.nodo(nodoId);
    if (!nodo) throw new NoEncontrado("No encontramos ese nodo.");
    try {
      const { comunidad, rol } = await op.comunidades.acceso(uid, nodo.comunidad_id, minimo);
      return { nodo, comunidad, rol };
    } catch (e) {
      // Un nodo ajeno debe verse igual que uno inexistente, también en el mensaje: si no, el
      // «esa comunidad» delataría que el nodo existe.
      if (e instanceof NoEncontrado) throw new NoEncontrado("No encontramos ese nodo.");
      throw e;
    }
  }

  function periodo(
    d: { desde?: Date | undefined; hasta?: Date | undefined },
    porDefectoMs: number,
  ): { desde: Date; hasta: Date } {
    const ahora = reloj();
    const hasta = d.hasta && d.hasta < ahora ? d.hasta : ahora;
    const desde = d.desde ?? new Date(hasta.getTime() - porDefectoMs);
    if (!(desde < hasta)) {
      throw new SolicitudInvalida("periodo_invalido", "El periodo debe empezar antes de terminar.");
    }
    if (hasta.getTime() - desde.getTime() > catalogo.reporte.dias_max * DIA_MS) {
      throw new SolicitudInvalida(
        "periodo_invalido",
        `El periodo no puede pasar de ${catalogo.reporte.dias_max} días.`,
      );
    }
    return { desde, hasta };
  }

  return {
    acceso,

    async deComunidad(uid: string, comunidadId: ObjectId): Promise<NodoVista[]> {
      const { rol } = await op.comunidades.acceso(uid, comunidadId);
      const nodos = await op.almacen.nodosDeComunidad(comunidadId);
      return nodos.map((n) => vista(n, rol));
    },

    /**
     * Da de alta un nodo: comprueba el token con Blynk, lo cifra y guarda el mapeo de pines. El
     * token nunca vuelve a salir (ni en la respuesta, ni en los logs).
     */
    async alta(
      uid: string,
      comunidadId: ObjectId,
      datos: DatosAlta,
    ): Promise<NodoVista & { conectado: boolean }> {
      const { rol } = await op.comunidades.acceso(uid, comunidadId, "responsable");
      const nombre = datos.nombre.trim();
      if (nombre.length < 2 || nombre.length > 80) {
        throw new SolicitudInvalida(
          "nombre_invalido",
          "El nombre debe tener de 2 a 80 caracteres.",
        );
      }
      if (!TOKEN_BLYNK.test(datos.tokenBlynk)) {
        throw new SolicitudInvalida("token_blynk_invalido", "Ese token de Blynk no parece válido.");
      }
      const parametros = datos.parametros ?? ["ph"];
      if (parametros.length === 0 || new Set(parametros).size !== parametros.length) {
        throw new SolicitudInvalida(
          "parametros_invalidos",
          "Elige al menos un parámetro, sin repetir.",
        );
      }
      for (const id of parametros) {
        const p = catalogo.parametros[id] ? parametroDe(catalogo, id) : null;
        if (!p?.medible || !p.blynk) {
          throw new SolicitudInvalida(
            "parametros_invalidos",
            `El parámetro «${id}» no se puede medir.`,
          );
        }
      }
      if ((await op.almacen.nodosDeComunidad(comunidadId)).length >= MAX_NODOS_POR_COMUNIDAD) {
        throw new Conflicto(
          "demasiados_nodos",
          `Una comunidad admite hasta ${MAX_NODOS_POR_COMUNIDAD} nodos.`,
        );
      }
      if (await op.almacen.existeNombre(comunidadId, nombre)) {
        throw new Conflicto("nodo_repetido", "Ya hay un nodo con ese nombre en la comunidad.");
      }

      const r = await op.comprobador.comprobar(datos.tokenBlynk);
      if (r === "invalido") {
        throw new SolicitudInvalida("token_blynk_invalido", "Blynk no reconoce ese token.");
      }
      if (r === "sin_respuesta") {
        throw new ServicioNoDisponible(
          "blynk_no_responde",
          "Blynk no respondió. Intenta de nuevo en un momento.",
        );
      }

      const nodo: NodoDoc = {
        ...crearDocumentoNodo({
          comunidadId,
          nombre,
          tokenCifrado: op.cifrar(datos.tokenBlynk),
          host: op.blynkHost,
          catalogo,
          parametros,
          ahora: reloj(),
        }),
        ...(datos.ubicacion ? { ubicacion: datos.ubicacion } : {}),
      };
      await op.almacen.insertar(nodo);
      // El token es válido aunque la placa esté apagada: se guarda y se avisa si no está conectada.
      return { ...vista(nodo, rol), conectado: r === "conectado" };
    },

    /**
     * Quita el nodo (solo responsables): deja de sondearse y de avisar, pero conserva sus datos como archivo.
     * Un nodo quitado se ve como inexistente. No se puede quitar con un pulso del actuador en marcha.
     */
    async quitar(uid: string, nodoId: ObjectId): Promise<void> {
      const { nodo } = await acceso(uid, nodoId, "responsable");
      const r = await op.almacen.archivar(nodo._id, reloj());
      if (r === "pulso_activo") {
        throw new Conflicto(
          "pulso_en_curso",
          "Hay un pulso del actuador pendiente o en curso. Detenlo o espera a que termine antes de quitar el nodo.",
        );
      }
      if (r === "no_existe") throw new NoEncontrado("No encontramos ese nodo.");
    },

    /** Cambia el nombre y/o el lugar de un nodo (solo responsables). */
    async editar(uid: string, nodoId: ObjectId, datos: CambiosNodo): Promise<NodoVista> {
      const { nodo, rol } = await acceso(uid, nodoId, "responsable");
      const cambios: CambiosNodo = {};
      if (datos.nombre !== undefined) {
        const nombre = datos.nombre.trim();
        if (nombre.length < 2 || nombre.length > 80) {
          throw new SolicitudInvalida(
            "nombre_invalido",
            "El nombre debe tener de 2 a 80 caracteres.",
          );
        }
        if (nombre !== nodo.nombre) {
          if (await op.almacen.existeNombre(nodo.comunidad_id, nombre)) {
            throw new Conflicto("nodo_repetido", "Ya hay un nodo con ese nombre en la comunidad.");
          }
          cambios.nombre = nombre;
        }
      }
      if (datos.ubicacion !== undefined) {
        cambios.ubicacion = datos.ubicacion === null ? null : datos.ubicacion;
      }
      if (Object.keys(cambios).length === 0) return vista(nodo, rol);
      const nuevo = await op.almacen.actualizar(nodo._id, cambios);
      if (!nuevo) throw new NoEncontrado("No encontramos ese nodo.");
      return vista(nuevo, rol);
    },

    /** Los nodos quitados de una comunidad (solo responsables), para poder restaurarlos. */
    async quitados(uid: string, comunidadId: ObjectId) {
      await op.comunidades.acceso(uid, comunidadId, "responsable");
      const lista = await op.almacen.archivadosDeComunidad(comunidadId);
      return lista.map((n) => ({
        id: n._id.toHexString(),
        nombre: n.nombre,
        ubicacion: n.ubicacion ?? null,
        quitado: n.archivado ?? n.creado,
      }));
    },

    /** Devuelve un nodo quitado a la comunidad (solo responsables). Sus datos viejos siguen ahí. */
    async restaurar(uid: string, nodoId: ObjectId): Promise<NodoVista> {
      const nodo = await op.almacen.nodoConArchivados(nodoId);
      if (!nodo) throw new NoEncontrado("No encontramos ese nodo.");
      let rol: Rol;
      try {
        rol = (await op.comunidades.acceso(uid, nodo.comunidad_id, "responsable")).rol;
      } catch (e) {
        // Igual que `acceso`: un nodo ajeno se ve como uno inexistente.
        if (e instanceof NoEncontrado) throw new NoEncontrado("No encontramos ese nodo.");
        throw e;
      }
      if (!nodo.archivado) {
        throw new Conflicto(
          "nodo_no_quitado",
          "Ese nodo no está quitado: ya está en la comunidad.",
        );
      }
      if (
        (await op.almacen.nodosDeComunidad(nodo.comunidad_id)).length >= MAX_NODOS_POR_COMUNIDAD
      ) {
        throw new Conflicto(
          "demasiados_nodos",
          `Una comunidad admite hasta ${MAX_NODOS_POR_COMUNIDAD} nodos.`,
        );
      }
      if (await op.almacen.existeNombre(nodo.comunidad_id, nodo.nombre)) {
        throw new Conflicto(
          "nodo_repetido",
          "Ya hay otro nodo con ese nombre. Cámbiale el nombre a ese primero y vuelve a restaurar.",
        );
      }
      if (!(await op.almacen.restaurar(nodo._id))) {
        throw new Conflicto(
          "nodo_no_quitado",
          "Ese nodo no está quitado: ya está en la comunidad.",
        );
      }
      const { archivado: _quitado, ...activo } = nodo;
      return vista(activo, rol);
    },

    async detalle(uid: string, nodoId: ObjectId): Promise<NodoVista> {
      const { nodo, rol } = await acceso(uid, nodoId);
      return vista(nodo, rol);
    },

    /** Serie para la gráfica: promedio, mínimo y máximo por tramo. Sin `paso`, se elige uno. */
    async serie(uid: string, nodoId: ObjectId, c: ConsultaSerie) {
      const { nodo } = await acceso(uid, nodoId);
      const { desde, hasta } = periodo(c, DIA_MS);
      const duracionS = (hasta.getTime() - desde.getTime()) / 1000;
      const pasoS = c.pasoS ?? pasoAutomatico(duracionS);
      if (pasoS < PASO_MIN_S) {
        throw new SolicitudInvalida(
          "paso_invalido",
          `El paso mínimo es de ${PASO_MIN_S} segundos.`,
        );
      }
      if (Math.ceil(duracionS / pasoS) > PUNTOS_MAX) {
        throw new SolicitudInvalida(
          "demasiados_puntos",
          `Con ese paso saldrían más de ${PUNTOS_MAX} puntos: usa un paso mayor o un periodo menor.`,
        );
      }
      const puntos: PuntoSerie[] = await op.almacen.serie(
        nodo._id,
        nodo.parametros,
        desde,
        hasta,
        pasoS,
      );
      return { desde, hasta, paso_s: pasoS, parametros: nodo.parametros, puntos };
    },

    /** Alertas y eventos (sin datos, reconexión, bitácora, calibraciones) de los últimos días. */
    async eventos(uid: string, nodoId: ObjectId, c: ConsultaEventos) {
      const { nodo } = await acceso(uid, nodoId);
      const { desde, hasta } = periodo(c, 30 * DIA_MS);
      const limite = Math.min(Math.max(c.limite ?? 100, 1), 200);
      const nombreDe = (id: string | null) =>
        id === null ? null : (catalogo.parametros[id]?.nombre ?? id);
      const decimalesDe = (id: string | null) =>
        id === null ? 2 : (catalogo.parametros[id]?.decimales ?? 2);

      const [alertas, eventos] = await Promise.all([
        op.almacen.alertas(nodo._id, desde, hasta, limite),
        op.almacen.eventos(nodo._id, nodo.comunidad_id, desde, hasta, limite),
      ]);
      return {
        desde,
        hasta,
        alertas: alertas.map(
          (a): AlertaVista => ({
            id: a._id.toHexString(),
            tipo: a.tipo,
            parametro: a.parametro,
            severidad: a.severidad,
            severidad_maxima: a.severidad_maxima,
            estado: a.estado,
            abierta: a.abierta,
            cerrada: a.cerrada,
            valor_apertura: a.valor_apertura,
            valor_cierre: a.valor_cierre,
            titulo: tituloAlerta({
              tipo: a.tipo,
              severidadMaxima: a.severidad_maxima,
              parametro: nombreDe(a.parametro),
            }),
            detalle: detalleAlerta({
              tipo: a.tipo,
              severidadMaxima: a.severidad_maxima,
              parametro: nombreDe(a.parametro),
              abierta: a.abierta,
              cerrada: a.cerrada,
              valorApertura: a.valor_apertura,
              decimales: decimalesDe(a.parametro),
              hasta,
            }),
          }),
        ),
        eventos: eventos.map(
          (e): EventoVista => ({
            ts: e.ts,
            tipo: e.tipo,
            mensaje: e.mensaje,
            propia: e.autor_uid === uid,
          }),
        ),
      };
    },
  };
}

export type ServicioNodos = ReturnType<typeof crearServicioNodos>;
