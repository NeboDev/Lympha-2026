import { parseArgs } from "node:util";
import { ObjectId } from "mongodb";
import { cargarConfig } from "../config.ts";
import { crearTokenVinculo, enlaceDeVinculo } from "../modulos/telegram/index.ts";
import { crearAlmacenTelegramMongo } from "../plataforma/almacen-telegram-mongo.ts";
import { cargarMarca } from "../plataforma/marca.ts";
import { conectarMongo } from "../plataforma/mongo.ts";
import { crearClienteTelegram } from "../plataforma/telegram-api.ts";

// Herramienta de desarrollo: el botón «Vincular Telegram» de la web llega en el Paso 7.
const AYUDA = `Uso:
  pnpm telegram:vinculo --comunidad <id> [--grupo]
      Imprime un enlace de un solo uso (vence en 10 min). Ábrelo en Telegram para vincular el chat
      (con --grupo, te deja elegir un grupo). El enlace es un secreto: no lo compartas.
  pnpm telegram:probar --comunidad <id>
      Manda un mensaje de prueba al chat vinculado de la comunidad.
  pnpm telegram:estado
      Muestra qué comunidades tienen un chat vinculado.`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { comunidad: { type: "string" }, grupo: { type: "boolean", default: false } },
});
const orden = positionals[0];
if (orden !== "vinculo" && orden !== "probar" && orden !== "estado") {
  console.log(AYUDA);
  process.exit(orden === undefined ? 0 : 2);
}

const config = cargarConfig(process.env);
const marca = cargarMarca();
const mongo = await conectarMongo(config);
const comunidades = mongo.db.collection<{
  _id: ObjectId;
  nombre: string;
  telegram?: { chat_id: number; titulo: string | null; tipo: string } | null;
}>("comunidades");

async function comunidadPedida() {
  if (!values.comunidad || !ObjectId.isValid(values.comunidad)) {
    throw new Error("Falta --comunidad (un id válido; mira `pnpm nodo:lista`)");
  }
  const c = await comunidades.findOne({ _id: new ObjectId(values.comunidad) });
  if (!c) throw new Error("No existe una comunidad con ese id");
  return c;
}

try {
  if (orden === "vinculo") {
    if (!config.telegramUsuario) throw new Error("Falta TELEGRAM_BOT_USERNAME en .env");
    const c = await comunidadPedida();
    const { token, expiraEn } = await crearTokenVinculo(crearAlmacenTelegramMongo(mongo.db), c._id);
    console.log(
      `Enlace para vincular Telegram a «${c.nombre}» (vence ${expiraEn.toLocaleTimeString("es-MX")}):\n\n  ${enlaceDeVinculo(config.telegramUsuario, token, values.grupo)}\n\nÁbrelo desde Telegram. El bot (${marca.nombre_bot}) confirmará la vinculación.`,
    );
  } else if (orden === "probar") {
    if (!config.telegramToken) throw new Error("Falta TELEGRAM_BOT_TOKEN en .env");
    const c = await comunidadPedida();
    if (!c.telegram) throw new Error("Esa comunidad no tiene un chat de Telegram vinculado");
    await crearClienteTelegram(config.telegramToken).enviarMensaje(
      c.telegram.chat_id,
      `✅ Mensaje de prueba de ${marca.nombre_bot}. Si lo lees, los avisos de «${c.nombre}» llegarán aquí.`,
    );
    console.log("Mensaje de prueba enviado.");
  } else {
    const todas = await comunidades.find({}).toArray();
    if (todas.length === 0) console.log("No hay comunidades.");
    for (const c of todas) {
      console.log(
        `${c._id.toHexString()}  ${c.nombre}  ` +
          (c.telegram
            ? `Telegram: vinculado (${c.telegram.tipo}${c.telegram.titulo ? `, «${c.telegram.titulo}»` : ""})`
            : "Telegram: sin vincular"),
      );
    }
  }
} catch (e) {
  console.error(`Error: ${e instanceof Error ? e.message : "desconocido"}`);
  process.exitCode = 1;
} finally {
  await mongo.cerrar();
}
