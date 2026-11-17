import { ErrorApi, SinConexion } from "./cliente.ts";

/**
 * Lo que se le dice a la persona cuando algo falla: qué pasó y qué hacer, en el tono de
 * docs/IDENTIDAD_VISUAL.md §8 (un vecino que sabe, sin culpar y sin jerga). Nunca trazas ni códigos.
 */
const POR_CODIGO: Record<string, string> = {
  no_autenticado: "Tu sesión ya no es válida. Vuelve a entrar.",
  no_encontrado: "No encontramos eso. Puede que ya no exista o que no sea de tu comunidad.",
  sin_permiso: "Tu rol en esta comunidad no permite hacer esto. Pídeselo a quien sea responsable.",
  token_blynk_invalido:
    "Blynk no reconoce ese token. Cópialo de nuevo desde la consola de Blynk (el token del dispositivo, no el de la plantilla).",
  blynk_no_responde: "Blynk no respondió. Revisa tu internet e inténtalo de nuevo en un momento.",
  nodo_repetido: "Ya hay un nodo con ese nombre en la comunidad. Elige otro.",
  demasiados_nodos: "Esta comunidad ya tiene el máximo de nodos.",
  demasiadas_comunidades: "Ya eres responsable del máximo de comunidades.",
  nombre_invalido: "El nombre debe tener entre 2 y 80 caracteres.",
  texto_invalido: "La nota debe tener entre 1 y 500 caracteres.",
  periodo_invalido:
    "El periodo no es válido: debe empezar antes de terminar y durar máximo 90 días.",
  telegram_no_configurado: "Telegram todavía no está configurado en este servidor.",
  parametros_invalidos: "Ese parámetro no se puede medir con este nodo.",
  peticion_invalida: "Revisa los datos: alguno no tiene el formato esperado.",
  peticion_muy_grande: "Lo que enviaste es demasiado grande.",
  error_interno: "Hubo un problema de nuestro lado. Intenta de nuevo en unos minutos.",
};

export function mensajeDeError(e: unknown): string {
  if (e instanceof SinConexion) {
    return "No pudimos conectar con Atl. Revisa tu internet y que el servidor esté encendido.";
  }
  if (e instanceof ErrorApi) {
    return (
      POR_CODIGO[e.codigo] ??
      // Los mensajes del servidor ya vienen en español y sin detalles internos.
      (e.message || "Algo salió mal. Intenta de nuevo.")
    );
  }
  return "Algo salió mal. Intenta de nuevo.";
}
