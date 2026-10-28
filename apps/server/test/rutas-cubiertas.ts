/**
 * Registro de rutas de la API y de la prueba que verifica su aislamiento (RNF-01).
 *
 * `src/main/rutas.test.ts` enumera las rutas realmente registradas y FALLA si alguna no aparece aquí.
 * Al agregar una ruta hay que declararla:
 *   - "publica": no devuelve datos de ningún espacio (p. ej. /health);
 *   - { aislamiento: "<archivo> › <prueba>" }: existe una prueba en la que otro usuario intenta leer,
 *     escribir o suscribirse y recibe 404 (o 403 si es miembro sin el rol suficiente).
 *
 * Las pruebas citadas viven en test/api.test.ts; `test/api.test.ts` comprueba además que cada nombre
 * citado existe de verdad.
 */
export type Cobertura = "publica" | { aislamiento: string };

const API = "test/api.test.ts";
const ajeno = (nombre: string): Cobertura => ({ aislamiento: `${API} › ${nombre}` });

export const RUTAS_CUBIERTAS: Record<string, Cobertura> = {
  "GET /health": "publica",
  // Solo responde con el secreto que Telegram recibió en setWebhook; no devuelve datos.
  "POST /telegram/webhook": "publica",

  "GET /api/yo": ajeno("identidad: cada token ve solo su propio perfil"),
  "PATCH /api/yo": ajeno("identidad: cada token ve solo su propio perfil"),
  "DELETE /api/yo": ajeno("eliminar la cuenta borra solo lo propio y no afecta a otros"),

  "POST /api/espacios": ajeno("crear espacio: el límite es por usuario"),
  "GET /api/espacios": ajeno("un usuario solo lista sus espacios"),
  "GET /api/espacios/:espacioId": ajeno(
    "un usuario ajeno recibe 404 en el espacio, sus miembros y sus nodos",
  ),
  "PATCH /api/espacios/:espacioId": ajeno(
    "un usuario ajeno recibe 404 al editar y un miembro recibe 403",
  ),
  "POST /api/espacios/:espacioId/invitaciones": ajeno(
    "solo el propietario invita; un ajeno recibe 404",
  ),
  "POST /api/invitaciones/aceptar": ajeno("invitaciones: el token es de un solo uso y vence"),
  "DELETE /api/espacios/:espacioId/miembros/:usuarioId": ajeno(
    "miembros: un ajeno recibe 404 y un miembro no quita a otros",
  ),
  "POST /api/espacios/:espacioId/transferir": ajeno(
    "transferir propiedad: solo el propietario y solo a un miembro",
  ),

  "POST /api/nodos/reclamar": ajeno("reclamar nodos: errores indistinguibles y límite de intentos"),
  "GET /api/nodos/:nodoId": ajeno(
    "un usuario ajeno recibe 404 en el nodo, sus lecturas y sus acciones",
  ),
  "PATCH /api/nodos/:nodoId": ajeno(
    "un usuario ajeno recibe 404 en el nodo, sus lecturas y sus acciones",
  ),
  "POST /api/nodos/:nodoId/desvincular": ajeno(
    "un usuario ajeno recibe 404 en el nodo, sus lecturas y sus acciones",
  ),
  "GET /api/espacios/:espacioId/eventos": ajeno(
    "un usuario ajeno recibe 404 en el espacio, sus miembros y sus nodos",
  ),
  "GET /api/nodos/:nodoId/lecturas": ajeno(
    "un usuario ajeno recibe 404 en el nodo, sus lecturas y sus acciones",
  ),

  // H4: historial diario (RF-35), por las vistas app.v_*_dia
  "GET /api/nodos/:nodoId/historial": ajeno(
    "historial: un usuario ajeno recibe 404; el miembro ve el nivel predominante por día",
  ),

  // H3: el vínculo de Telegram y las preferencias de aviso son del usuario en sesión (la RLS lo exige).
  "POST /api/yo/telegram/vinculo": ajeno(
    "telegram: el vínculo y las preferencias son de cada usuario",
  ),
  "GET /api/yo/telegram": ajeno("telegram: el vínculo y las preferencias son de cada usuario"),
  "DELETE /api/yo/telegram": ajeno("telegram: el vínculo y las preferencias son de cada usuario"),
  "GET /api/yo/notificaciones": ajeno(
    "telegram: el vínculo y las preferencias son de cada usuario",
  ),
  "PUT /api/yo/notificaciones": ajeno(
    "telegram: el vínculo y las preferencias son de cada usuario",
  ),
  "DELETE /api/yo/notificaciones/:nodoId": ajeno(
    "telegram: el vínculo y las preferencias son de cada usuario",
  ),
  "GET /api/espacios/:espacioId/alarmas": ajeno(
    "alarmas: un ajeno recibe 404 al listar y al atender",
  ),
  "POST /api/alarmas/:alarmaId/atender": ajeno(
    "alarmas: un ajeno recibe 404 al listar y al atender",
  ),

  // Autocalibración: leer es de cualquier miembro; guardar, revertir y restablecer, del propietario.
  "GET /api/calibraciones": ajeno(
    "calibración: un ajeno recibe 404, el miembro 403 y la recta se calcula en el servidor",
  ),
  "POST /api/calibraciones": ajeno(
    "calibración: un ajeno recibe 404, el miembro 403 y la recta se calcula en el servidor",
  ),
  "POST /api/calibraciones/restablecer": ajeno(
    "calibración: un ajeno recibe 404, el miembro 403 y la recta se calcula en el servidor",
  ),
  "POST /api/calibraciones/:calibracionId/activar": ajeno(
    "calibración: un ajeno recibe 404, el miembro 403 y la recta se calcula en el servidor",
  ),
};
