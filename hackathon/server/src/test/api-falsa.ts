import type { ObjectId } from "mongodb";
import type { AlertaDoc } from "../modulos/alertas/index.ts";
import type { ServiciosApi } from "../modulos/api/index.ts";
import { crearApp } from "../modulos/api/index.ts";
import { crearServicioBitacora, type EventoBitacora } from "../modulos/bitacora/index.ts";
import {
  type CalibracionDoc,
  crearServicioCalibraciones,
  type EventoCalibracion,
} from "../modulos/calibraciones/index.ts";
import { type ComunidadDoc, crearServicioComunidades } from "../modulos/comunidades/index.ts";
import { crearControl } from "../modulos/control/index.ts";
import { crearServicioIdentidad, type IdentidadVerificada } from "../modulos/identidad/index.ts";
import {
  type AlmacenNodos,
  crearServicioNodos,
  type EventoNodo,
  type NodoDoc,
  type PuntoSerie,
  type ResultadoToken,
} from "../modulos/nodos/index.ts";
import { crearAlmacenControlFalso } from "./control-falso.ts";
import { catalogoDePrueba, T0 } from "./falsos.ts";

export const PERSONAS: Record<string, IdentidadVerificada> = {
  "token-ana": { uid: "uid-ana", correo: "ana@ejemplo.mx", nombre: "Ana" },
  "token-beto": { uid: "uid-beto", correo: "beto@ejemplo.mx", nombre: "Beto" },
  "token-carla": { uid: "uid-carla", correo: "carla@ejemplo.mx", nombre: null },
};

export const TOKEN_BLYNK = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";

/**
 * La API completa con almacenes en memoria y los servicios reales (identidad, comunidades, nodos,
 * bitácora, calibraciones). Solo se sustituyen los bordes: Firebase, Blynk, el PDF y Telegram.
 */
export function crearApiFalsa(
  opciones: {
    token?: ResultadoToken;
    reporteFalla?: boolean;
    actuadorFalla?: boolean;
    telegram?: boolean;
    demoToken?: string;
  } = {},
) {
  const comunidades: ComunidadDoc[] = [];
  const nodos: NodoDoc[] = [];
  const usuarios: IdentidadVerificada[] = [];
  const eventos: (EventoBitacora | EventoCalibracion)[] = [];
  const calibraciones: CalibracionDoc[] = [];
  const reportesPedidos: { nodoId: string; desde: Date; hasta: Date; por: string }[] = [];
  const enlaces: string[] = [];
  const estado = {
    serie: [] as PuntoSerie[],
    alertas: [] as AlertaDoc[],
    eventos: [] as EventoNodo[],
    token: opciones.token ?? ("conectado" as ResultadoToken),
  };
  const rutas: string[] = [];

  const almacenNodos: AlmacenNodos = {
    async nodo(id) {
      return nodos.find((n) => n._id.equals(id) && !n.archivado) ?? null;
    },
    async nodosDeComunidad(id) {
      return nodos.filter((n) => n.comunidad_id.equals(id) && !n.archivado);
    },
    async nodoConArchivados(id) {
      return nodos.find((n) => n._id.equals(id)) ?? null;
    },
    async archivadosDeComunidad(id) {
      return nodos.filter((n) => n.comunidad_id.equals(id) && n.archivado);
    },
    async actualizar(id, cambios) {
      const n = nodos.find((x) => x._id.equals(id) && !x.archivado);
      if (!n) return null;
      if (cambios.nombre !== undefined) n.nombre = cambios.nombre;
      if (cambios.ubicacion === null) delete n.ubicacion;
      else if (cambios.ubicacion !== undefined) n.ubicacion = cambios.ubicacion;
      return n;
    },
    async restaurar(id) {
      const n = nodos.find((x) => x._id.equals(id) && x.archivado);
      if (!n) return false;
      delete n.archivado;
      return true;
    },
    async archivar(id, ahora) {
      const n = nodos.find((x) => x._id.equals(id) && !x.archivado);
      if (!n) return "no_existe";
      n.archivado = ahora;
      return "ok";
    },

    async existeNombre(id, nombre) {
      return nodos.some((n) => n.comunidad_id.equals(id) && n.nombre === nombre && !n.archivado);
    },
    async insertar(n) {
      nodos.push(n);
    },
    async serie() {
      return estado.serie;
    },
    async alertas() {
      return estado.alertas;
    },
    async eventos() {
      return estado.eventos;
    },
  };

  const identidad = crearServicioIdentidad({
    verificador: {
      async verificar(token) {
        const p = PERSONAS[token];
        if (!p) throw new Error("token inválido");
        return p;
      },
    },
    almacen: {
      async registrar(u) {
        usuarios.push(u);
      },
    },
    ...(opciones.demoToken ? { demoToken: opciones.demoToken } : {}),
  });
  const serviciosComunidades = crearServicioComunidades({
    almacen: {
      async insertar(c) {
        comunidades.push(c);
      },
      async obtener(id) {
        return comunidades.find((c) => c._id.equals(id)) ?? null;
      },
      async deUsuario(uid) {
        return comunidades.filter((c) => c.miembros.some((m) => m.uid === uid));
      },
      async contarResponsable(uid) {
        return comunidades.filter((c) =>
          c.miembros.some((m) => m.uid === uid && m.rol === "responsable"),
        ).length;
      },
      async desvincularTelegram(id) {
        const c = comunidades.find((x) => x._id.equals(id));
        if (c) c.telegram = null;
      },
    },
    reloj: () => new Date(T0),
  });
  const serviciosNodos = crearServicioNodos({
    almacen: almacenNodos,
    comunidades: serviciosComunidades,
    comprobador: {
      async comprobar() {
        return estado.token;
      },
    },
    catalogo: catalogoDePrueba,
    blynkHost: "blynk.cloud",
    cifrar: (t) => `cifrado-${t.length}`,
    reloj: () => new Date(T0),
  });

  const controlFalso = crearAlmacenControlFalso(nodos);
  const escriturasActuador: { pin: string; valor: 0 | 1 }[] = [];
  const control = crearControl({
    almacen: controlFalso.almacen,
    escritor: {
      async escribir(_n, pin, valor) {
        if (opciones.actuadorFalla) throw new Error("Blynk caído");
        escriturasActuador.push({ pin, valor });
      },
    },
    nodos: serviciosNodos,
    reloj: () => new Date(T0),
  });

  const servicios: ServiciosApi = {
    identidad,
    comunidades: serviciosComunidades,
    nodos: serviciosNodos,
    bitacora: crearServicioBitacora({
      almacen: {
        async registrar(e) {
          eventos.push(e);
        },
      },
      nodos: serviciosNodos,
      reloj: () => new Date(T0),
    }),
    calibraciones: crearServicioCalibraciones({
      almacen: {
        async registrar(c, e) {
          calibraciones.push(c);
          eventos.push(e);
        },
        async listar(nodoId, limite) {
          return calibraciones.filter((c) => c.nodo_id.equals(nodoId)).slice(0, limite);
        },
      },
      nodos: serviciosNodos,
      catalogo: catalogoDePrueba,
      reloj: () => new Date(T0),
    }),
    control,
    catalogo: catalogoDePrueba,
    reportes: {
      async recientes(nodoId) {
        return reportesPedidos
          .filter((p) => p.nodoId === nodoId.toHexString())
          .map((p, i) => ({
            id: `rep${i}`,
            desde: p.desde,
            hasta: p.hasta,
            generado: new Date(T0),
            generado_por: p.por,
            huella: "abcdef012345",
            resumen: { parametros: {}, cobertura_pct: 100, alertas: 0 },
          }));
      },
      async generar(nodoId, desde, hasta, por) {
        if (opciones.reporteFalla) throw new Error("fallo interno: detalle que no debe salir");
        reportesPedidos.push({ nodoId: nodoId.toHexString(), desde, hasta, por });
        return {
          pdf: Buffer.from("%PDF-1.3 falso"),
          nombreArchivo: "reporte-prueba-2026-11-19.pdf",
        };
      },
    },
    telegram:
      opciones.telegram === false
        ? null
        : {
            async crearEnlace(id: ObjectId) {
              const enlace = `https://t.me/lympha26_bot?start=enlace-de-${id.toHexString()}`;
              enlaces.push(enlace);
              return { enlace, expira: new Date(T0 + 600_000) };
            },
          },
  };

  const app = crearApp({
    corsOrigenes: ["http://localhost:5173"],
    salud: { mongo: async () => true, blynk: async () => true },
    servicios,
    observarRutas: (metodo, url) => rutas.push(`${metodo} ${url}`),
  });

  const pedir = (
    token: string | null,
    metodo: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    cuerpo?: unknown,
  ) =>
    app.inject({
      method: metodo,
      url,
      ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
      ...(cuerpo === undefined ? {} : { payload: cuerpo as never }),
    });

  return {
    app,
    rutas,
    pedir,
    estado,
    comunidades,
    nodos,
    usuarios,
    eventos,
    calibraciones,
    control,
    controlFalso,
    escriturasActuador,
    reportesPedidos,
    enlaces,
  };
}
