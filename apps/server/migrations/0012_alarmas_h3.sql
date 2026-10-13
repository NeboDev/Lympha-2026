-- 0012_alarmas_h3 (H3): funciones de preferencias de aviso, evento 'mejorada' y los índices del barrido
-- de mantenimiento. Todo es aditivo (expand): la versión anterior del código no usa nada de esto.

-- RF-28: se avisa cada mejora de nivel, no solo la resolución completa.
ALTER TABLE app.notificaciones_salida DROP CONSTRAINT notificaciones_salida_evento_check;
ALTER TABLE app.notificaciones_salida ADD CONSTRAINT notificaciones_salida_evento_check
  CHECK (evento IN ('abierta', 'escalada', 'mejorada', 'resuelta', 'recordatorio', 'sin_conexion', 'reconectado'));

-- ¿Quiere este usuario un aviso sobre este nodo? `p_niveles` son los niveles implicados en la transición
-- (el nuevo; en mejoras y resoluciones, también el anterior). NULL = alarma que no es de nivel
-- (sin conexión, sensor): siempre avisa. Preferencia del nodo primero; si no hay, la del usuario; si
-- tampoco, mala y crítica.
CREATE FUNCTION app.quiere_aviso(p_usuario uuid, p_nodo uuid, p_niveles app.nivel[])
RETURNS boolean LANGUAGE sql STABLE SET search_path = app, pg_temp AS $$
  SELECT p_niveles IS NULL OR coalesce(
    (SELECT niveles && p_niveles
       FROM app.preferencias_notificacion
      WHERE usuario_id = p_usuario AND (nodo_id = p_nodo OR nodo_id IS NULL)
      ORDER BY nodo_id IS NULL
      LIMIT 1),
    ARRAY['mala', 'critica']::app.nivel[] && p_niveles)
$$;

-- Horario silencioso: si `p_ahora` cae dentro de la ventana del usuario (en su zona horaria, con o sin cruce
-- de medianoche), devuelve el instante en que termina; si no, `p_ahora`. El aviso no se pierde, se difiere.
-- Una zona horaria inválida nunca debe romper la transacción del worker: ante cualquier error, avisa ya.
CREATE FUNCTION app.siguiente_envio(p_usuario uuid, p_nodo uuid, p_ahora timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = app, pg_temp AS $$
DECLARE
  p          record;
  local_ts   timestamp;
  t          time;
  fin_ts     timestamp;
  en_ventana boolean;
BEGIN
  SELECT silencio_inicio, silencio_fin, zona_horaria INTO p
    FROM app.preferencias_notificacion
   WHERE usuario_id = p_usuario AND (nodo_id = p_nodo OR nodo_id IS NULL)
   ORDER BY nodo_id IS NULL
   LIMIT 1;
  IF NOT FOUND OR p.silencio_inicio IS NULL OR p.silencio_fin IS NULL OR p.silencio_inicio = p.silencio_fin THEN
    RETURN p_ahora;
  END IF;

  local_ts := p_ahora AT TIME ZONE p.zona_horaria;
  t := local_ts::time;
  IF p.silencio_inicio < p.silencio_fin THEN
    en_ventana := t >= p.silencio_inicio AND t < p.silencio_fin;
  ELSE
    en_ventana := t >= p.silencio_inicio OR t < p.silencio_fin;
  END IF;
  IF NOT en_ventana THEN RETURN p_ahora; END IF;

  fin_ts := local_ts::date + p.silencio_fin;
  IF fin_ts <= local_ts THEN fin_ts := fin_ts + interval '1 day'; END IF;
  RETURN fin_ts AT TIME ZONE p.zona_horaria;
EXCEPTION WHEN OTHERS THEN
  RETURN p_ahora;
END $$;

REVOKE ALL ON FUNCTION app.quiere_aviso(uuid, uuid, app.nivel[]), app.siguiente_envio(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.quiere_aviso(uuid, uuid, app.nivel[]), app.siguiente_envio(uuid, uuid, timestamptz)
  TO lympha_system;

-- "/desvincular" llega desde el chat de Telegram, sin sesión de usuario: la API no sabe de quién es ese chat y
-- `vinculos_telegram` solo es visible para su dueño. Esta función borra el vínculo de ese chat (y descarta sus
-- avisos pendientes) sin exponer a quién pertenecía. Devuelve si había algo que desvincular.
CREATE FUNCTION app.desvincular_chat(p_chat bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE u uuid;
BEGIN
  DELETE FROM app.vinculos_telegram WHERE chat_id = p_chat RETURNING usuario_id INTO u;
  IF u IS NULL THEN RETURN false; END IF;
  UPDATE app.notificaciones_salida SET estado = 'descartada', error = 'sin_vinculo'
   WHERE usuario_id = u AND estado = 'pendiente' AND canal = 'telegram';
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION app.desvincular_chat(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.desvincular_chat(bigint) TO lympha_app;

-- Los avisos nombran el espacio ("Casa"); el worker solo necesita id y nombre.
GRANT SELECT (id, nombre) ON app.espacios TO lympha_system;

-- Recordatorios: último aviso de una alarma a un usuario, sin recorrer la bandeja entera.
CREATE INDEX salida_alarma_usuario_idx ON app.notificaciones_salida (alarma_id, usuario_id, creado_en DESC)
  WHERE alarma_id IS NOT NULL;

-- Barrido de desconexión (RF-29): nodos de un espacio que llevan tiempo sin conexión.
CREATE INDEX estado_nodo_desconectados_idx ON app.estado_nodo (cambio_conexion_en)
  WHERE conectado = false AND espacio_id IS NOT NULL;

-- Tiempo sin conexión antes de alarmar (RF-29); el código usa 10 min si un perfil no lo define.
UPDATE app.perfiles_uso SET reglas_alarma = '{"sin_conexion_min": 10}' WHERE id = 'cisterna';
