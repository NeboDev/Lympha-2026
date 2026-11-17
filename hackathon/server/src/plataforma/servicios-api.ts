import type { Db } from "mongodb";
import type { Catalogo } from "../dominio/catalogo.ts";
import type { Marca } from "../dominio/marca.ts";
import type { ServiciosApi } from "../modulos/api/index.ts";
import { crearServicioBitacora } from "../modulos/bitacora/index.ts";
import { crearServicioCalibraciones } from "../modulos/calibraciones/index.ts";
import { crearServicioComunidades } from "../modulos/comunidades/index.ts";
import { crearServicioIdentidad, type VerificadorToken } from "../modulos/identidad/index.ts";
import { type ComprobadorToken, crearServicioNodos } from "../modulos/nodos/index.ts";
import { crearServicioReportes } from "../modulos/reportes/index.ts";
import { crearTokenVinculo, enlaceDeVinculo } from "../modulos/telegram/index.ts";
import {
  crearAlmacenBitacoraMongo,
  crearAlmacenCalibracionesMongo,
  crearAlmacenComunidadesMongo,
  crearAlmacenNodosMongo,
  crearAlmacenUsuariosMongo,
} from "./almacen-api-mongo.ts";
import { crearAlmacenReportesMongo } from "./almacen-reportes-mongo.ts";
import { crearAlmacenTelegramMongo } from "./almacen-telegram-mongo.ts";
import { crearClienteBlynk } from "./blynk.ts";
import { cifrar } from "./cifrado.ts";
import { crearComprobadorBlynk } from "./comprobador-blynk.ts";
import { crearGeneradorPdf } from "./generador-reportes.ts";
import type { LogoSvg } from "./logo-svg.ts";

export type OpcionesServiciosApi = {
  db: Db;
  catalogo: Catalogo;
  marca: Marca;
  verificador: VerificadorToken;
  /** Token fijo del usuario de demostración; `null` lo desactiva. */
  demoToken: string | null;
  claveCifrado: Buffer;
  blynkHost: string;
  logo: LogoSvg;
  /** Usuario del bot de Telegram (sin @); `null` = sin Telegram, y el enlace de vinculación responde 503. */
  usuarioBot: string | null;
  /** Solo para pruebas: sustituye a la comprobación real contra Blynk. */
  comprobador?: ComprobadorToken;
  reloj?: () => Date;
};

/** Arma todos los servicios de la API sobre MongoDB. Lo comparten `main.ts` y las pruebas de integración. */
export function crearServiciosApi(op: OpcionesServiciosApi): ServiciosApi {
  const reloj = op.reloj ?? (() => new Date());
  const identidad = crearServicioIdentidad({
    verificador: op.verificador,
    almacen: crearAlmacenUsuariosMongo(op.db),
    demoToken: op.demoToken,
    reloj,
  });
  const comunidades = crearServicioComunidades({
    almacen: crearAlmacenComunidadesMongo(op.db),
    reloj,
  });
  const nodos = crearServicioNodos({
    almacen: crearAlmacenNodosMongo(op.db),
    comunidades,
    comprobador: op.comprobador ?? crearComprobadorBlynk(crearClienteBlynk({ host: op.blynkHost })),
    catalogo: op.catalogo,
    blynkHost: op.blynkHost,
    cifrar: (token) => cifrar(token, op.claveCifrado),
    reloj,
  });
  const reportes = crearGeneradorPdf({
    servicio: crearServicioReportes({
      almacen: crearAlmacenReportesMongo(op.db),
      catalogo: op.catalogo,
      marca: op.marca,
      reloj,
    }),
    logo: op.logo,
  });
  const almacenTelegram = crearAlmacenTelegramMongo(op.db);
  const usuarioBot = op.usuarioBot;

  return {
    identidad,
    comunidades,
    nodos,
    bitacora: crearServicioBitacora({ almacen: crearAlmacenBitacoraMongo(op.db), nodos, reloj }),
    calibraciones: crearServicioCalibraciones({
      almacen: crearAlmacenCalibracionesMongo(op.db),
      nodos,
      catalogo: op.catalogo,
      reloj,
    }),
    catalogo: op.catalogo,
    reportes: {
      async generar(nodoId, desde, hasta, generadoPor) {
        const r = await reportes.periodo(nodoId, desde, hasta, generadoPor);
        return { pdf: r.pdf, nombreArchivo: r.nombreArchivo };
      },
    },
    telegram: usuarioBot
      ? {
          async crearEnlace(comunidadId) {
            const { token, expiraEn } = await crearTokenVinculo(
              almacenTelegram,
              comunidadId,
              reloj(),
            );
            return { enlace: enlaceDeVinculo(usuarioBot, token), expira: expiraEn };
          },
        }
      : null,
  };
}
