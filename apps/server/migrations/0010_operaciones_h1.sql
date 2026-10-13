-- 0010_operaciones_h1: operaciones privilegiadas de espacios, membresías y nodos, y mantenimiento de la base.
-- Todas son SECURITY DEFINER (corren como lympha_owner, que las políticas `definer` dejan ver todo), validan
-- el permiso por dentro con app.usuario_actual() y hacen su trabajo en una sola transacción. Los errores de
-- negocio son P0001 con un código estable en el mensaje; la capa HTTP los traduce.

-- Identidad: alta o actualización del perfil local ligado al uid de Firebase. Se llama ANTES de saber el id
-- del usuario (por eso no puede depender de RLS); el uid sale de un token ya verificado.
CREATE FUNCTION app.asegurar_usuario(p_auth_uid text, p_email text, p_nombre text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE u app.usuarios%ROWTYPE;
BEGIN
  SELECT * INTO u FROM app.usuarios WHERE auth_uid = p_auth_uid;
  IF FOUND THEN
    IF u.email::text IS DISTINCT FROM p_email THEN
      UPDATE app.usuarios SET email = p_email WHERE id = u.id;
    END IF;
    RETURN u.id;
  END IF;
  INSERT INTO app.usuarios (auth_uid, email, nombre) VALUES (p_auth_uid, p_email, p_nombre)
  ON CONFLICT (auth_uid) DO UPDATE SET email = EXCLUDED.email
  RETURNING id INTO u.id;
  RETURN u.id;
END $$;

CREATE FUNCTION app.crear_espacio(p_nombre text, p_tipo text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE yo uuid := app.usuario_actual(); nuevo uuid;
BEGIN
  IF yo IS NULL OR NOT EXISTS (SELECT 1 FROM app.usuarios WHERE id = yo) THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM app.membresias WHERE usuario_id = yo AND rol = 'propietario') >= 10 THEN
    RAISE EXCEPTION 'limite_espacios' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO app.espacios (nombre, tipo) VALUES (p_nombre, p_tipo) RETURNING id INTO nuevo;
  INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES (nuevo, yo, 'propietario');
  INSERT INTO app.auditoria (actor_tipo, actor_id, espacio_id, accion)
  VALUES ('usuario', yo, nuevo, 'espacio.creado');
  RETURN nuevo;
END $$;

-- Quita el espacio al nodo y cierra sus alarmas abiertas. El historial queda con el espacio anterior.
CREATE FUNCTION app.desvincular_nodo(p_nodo uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE n app.nodos%ROWTYPE;
BEGIN
  SELECT * INTO n FROM app.nodos WHERE id = p_nodo FOR UPDATE;
  IF NOT FOUND OR n.espacio_id IS NULL OR NOT app.es_propietario(n.espacio_id) THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;
  UPDATE app.alarmas SET estado = 'resuelta', resuelta_en = now()
  WHERE nodo_id = p_nodo AND estado <> 'resuelta';
  UPDATE app.nodos SET espacio_id = NULL, estado = 'desvinculado' WHERE id = p_nodo;
  UPDATE app.estado_nodo SET espacio_id = NULL, nivel = 'sin_datos', wqi = NULL, parametro_limitante = NULL,
         ultimos_valores = NULL, actualizado_en = now()
  WHERE nodo_id = p_nodo;
  INSERT INTO app.auditoria (actor_tipo, actor_id, espacio_id, nodo_id, accion)
  VALUES ('usuario', app.usuario_actual(), n.espacio_id, p_nodo, 'nodo.desvinculado');
END $$;

-- El token viaja solo en el enlace; en la base queda su sha256 (calculado por la API).
CREATE FUNCTION app.aceptar_invitacion(p_token_hash bytea)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE yo uuid := app.usuario_actual(); inv app.invitaciones%ROWTYPE;
BEGIN
  IF yo IS NULL OR NOT EXISTS (SELECT 1 FROM app.usuarios WHERE id = yo) THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO inv FROM app.invitaciones WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR inv.usada_en IS NOT NULL OR inv.expira_en <= now() THEN
    RAISE EXCEPTION 'invitacion_invalida' USING ERRCODE = 'P0001';   -- mismo error para todos los casos
  END IF;
  -- quien ya es miembro no consume la invitación
  IF NOT EXISTS (SELECT 1 FROM app.membresias WHERE espacio_id = inv.espacio_id AND usuario_id = yo) THEN
    INSERT INTO app.membresias (espacio_id, usuario_id, rol) VALUES (inv.espacio_id, yo, 'miembro');
    UPDATE app.invitaciones SET usada_por = yo, usada_en = now() WHERE id = inv.id;
    INSERT INTO app.auditoria (actor_tipo, actor_id, espacio_id, accion)
    VALUES ('usuario', yo, inv.espacio_id, 'membresia.alta');
  END IF;
  RETURN inv.espacio_id;
END $$;

CREATE FUNCTION app.transferir_propiedad(p_espacio uuid, p_usuario uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE yo uuid := app.usuario_actual();
BEGIN
  IF NOT app.es_propietario(p_espacio) THEN RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501'; END IF;
  IF p_usuario = yo OR NOT EXISTS (
       SELECT 1 FROM app.membresias WHERE espacio_id = p_espacio AND usuario_id = p_usuario AND rol = 'miembro') THEN
    RAISE EXCEPTION 'transferencia_invalida' USING ERRCODE = 'P0001';
  END IF;
  -- el índice parcial admite un solo propietario: primero se baja al actual y luego se sube al nuevo
  UPDATE app.membresias SET rol = 'miembro'     WHERE espacio_id = p_espacio AND usuario_id = yo;
  UPDATE app.membresias SET rol = 'propietario' WHERE espacio_id = p_espacio AND usuario_id = p_usuario;
  INSERT INTO app.auditoria (actor_tipo, actor_id, espacio_id, accion, detalle)
  VALUES ('usuario', yo, p_espacio, 'membresia.rol', jsonb_build_object('nuevo_propietario', p_usuario));
END $$;

-- Quién pertenece al espacio. app.usuarios solo es visible para su dueño, así que los nombres de los demás
-- miembros salen por aquí (nunca el correo).
CREATE FUNCTION app.miembros_espacio(p_espacio uuid)
RETURNS TABLE (usuario_id uuid, nombre text, rol app.rol_espacio, desde timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT m.usuario_id, u.nombre, m.rol, m.creado_en
  FROM app.membresias m JOIN app.usuarios u ON u.id = m.usuario_id
  WHERE m.espacio_id = p_espacio AND p_espacio IN (SELECT app.mis_espacios())
  ORDER BY m.rol, m.creado_en
$$;

-- Borra al usuario y lo que solo existía por él. Un propietario con más miembros debe transferir antes.
CREATE FUNCTION app.eliminar_mi_cuenta()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE yo uuid := app.usuario_actual(); solos uuid[];
BEGIN
  IF yo IS NULL OR NOT EXISTS (SELECT 1 FROM app.usuarios WHERE id = yo) THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.membresias m
    WHERE m.usuario_id = yo AND m.rol = 'propietario'
      AND EXISTS (SELECT 1 FROM app.membresias o WHERE o.espacio_id = m.espacio_id AND o.usuario_id <> yo)
  ) THEN
    RAISE EXCEPTION 'transferir_primero' USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(array_agg(m.espacio_id), '{}') INTO solos
  FROM app.membresias m
  WHERE m.usuario_id = yo
    AND NOT EXISTS (SELECT 1 FROM app.membresias o WHERE o.espacio_id = m.espacio_id AND o.usuario_id <> yo);

  -- los nodos del espacio quedan libres (la restricción exige estado "desvinculado" sin espacio)
  UPDATE app.alarmas SET estado = 'resuelta', resuelta_en = now() WHERE espacio_id = ANY (solos) AND estado <> 'resuelta';
  UPDATE app.nodos SET espacio_id = NULL, estado = 'desvinculado' WHERE espacio_id = ANY (solos);
  UPDATE app.estado_nodo SET espacio_id = NULL, nivel = 'sin_datos', wqi = NULL, parametro_limitante = NULL,
         ultimos_valores = NULL, actualizado_en = now() WHERE espacio_id = ANY (solos);
  -- series de tiempo del espacio (RNF-06). Los agregados continuos (lecturas_hora/dia) se vacían por su retención.
  DELETE FROM ts.lecturas    WHERE espacio_id = ANY (solos);
  DELETE FROM ts.evaluaciones WHERE espacio_id = ANY (solos);
  DELETE FROM app.espacios WHERE id = ANY (solos);

  INSERT INTO app.auditoria (actor_tipo, actor_id, accion, detalle)
  VALUES ('usuario', yo, 'cuenta.eliminada', jsonb_build_object('espacios_borrados', cardinality(solos)));
  DELETE FROM app.usuarios WHERE id = yo;   -- membresías, vínculo de Telegram y preferencias caen en cascada
END $$;

REVOKE ALL ON FUNCTION app.asegurar_usuario(text, text, text), app.crear_espacio(text, text),
  app.desvincular_nodo(uuid), app.aceptar_invitacion(bytea), app.transferir_propiedad(uuid, uuid),
  app.miembros_espacio(uuid), app.eliminar_mi_cuenta() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.asegurar_usuario(text, text, text), app.crear_espacio(text, text),
  app.desvincular_nodo(uuid), app.aceptar_invitacion(bytea), app.transferir_propiedad(uuid, uuid),
  app.miembros_espacio(uuid), app.eliminar_mi_cuenta() TO lympha_app;

-- Estado del nodo: se actualiza en cada lectura (HOT updates) y la bandeja de salida se vacía a menudo.
ALTER TABLE app.estado_nodo SET (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02);
ALTER TABLE app.notificaciones_salida SET (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02);

-- Mantenimiento nocturno (TimescaleDB add_job): avisos ya resueltos de más de 90 días e invitaciones vencidas
-- de más de 30. Corre como lympha_owner, que las políticas `definer` dejan ver todas las filas.
CREATE PROCEDURE app.mantenimiento_nocturno(job_id int, config jsonb)
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM app.notificaciones_salida
  WHERE estado IN ('enviada', 'descartada', 'fallida') AND creado_en < now() - interval '90 days';
  DELETE FROM app.invitaciones WHERE expira_en < now() - interval '30 days';
END $$;

SELECT add_job('app.mantenimiento_nocturno', INTERVAL '1 day',
               initial_start => date_trunc('day', now()) + interval '1 day 3 hours');
