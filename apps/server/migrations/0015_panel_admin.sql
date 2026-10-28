-- 0015_panel_admin: administración de plataforma (etiquetas, lotes y "de quién es esta boya").
-- Solo aditiva. El rol admin de plataforma NO sale de ningún espacio: vive en app.admins_plataforma, que
-- únicamente se puebla por CLI (`pnpm admin alta`) con lympha_owner. La API (lympha_app) no puede leerla ni
-- escribirla: solo ejecuta funciones SECURITY DEFINER que validan la fila por dentro con app.usuario_actual().
-- Ninguna función devuelve datos de agua (lecturas, WQI, alarmas) ni códigos de reclamo en claro.

CREATE TABLE app.admins_plataforma (
  usuario_id  uuid PRIMARY KEY REFERENCES app.usuarios(id) ON DELETE CASCADE,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.admins_plataforma ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.admins_plataforma FORCE ROW LEVEL SECURITY;
CREATE POLICY definer ON app.admins_plataforma TO lympha_owner USING (true) WITH CHECK (true);
REVOKE ALL ON app.admins_plataforma FROM PUBLIC, lympha_app, lympha_system;

CREATE FUNCTION app.es_admin_plataforma() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.admins_plataforma WHERE usuario_id = app.usuario_actual())
$$;

CREATE FUNCTION app.exigir_admin_plataforma() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.es_admin_plataforma() THEN RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501'; END IF;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Lectura: lotes y nodos (sin dueños, sin datos de agua)
-- ---------------------------------------------------------------------------------------------------------

CREATE FUNCTION app.admin_listar_lotes()
RETURNS TABLE (id uuid, creado_en timestamptz, cantidad integer, version_hw text, notas text,
               revocado_en timestamptz, fabricados integer, reclamados integer, activos integer,
               desvinculados integer, revocados integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.exigir_admin_plataforma();
  RETURN QUERY
  SELECT l.id, l.creado_en, l.cantidad, l.version_hw, l.notas, l.revocado_en,
         (count(n.id) FILTER (WHERE n.estado = 'fabricado'))::integer,
         (count(n.id) FILTER (WHERE n.estado = 'reclamado'))::integer,
         (count(n.id) FILTER (WHERE n.estado = 'activo'))::integer,
         (count(n.id) FILTER (WHERE n.estado = 'desvinculado'))::integer,
         (count(n.id) FILTER (WHERE n.estado = 'revocado'))::integer
  FROM app.lotes l LEFT JOIN app.nodos n ON n.lote_id = l.id
  GROUP BY l.id
  ORDER BY l.creado_en DESC
  LIMIT 200;
END $$;

CREATE FUNCTION app.admin_listar_nodos(p_lote uuid, p_estado text, p_q text, p_limite integer, p_desplazamiento integer)
RETURNS TABLE (id uuid, lote_id uuid, estado app.estado_nodo_t, asignado boolean, version_fw text,
               creado_en timestamptz, reclamado_en timestamptz, total bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.exigir_admin_plataforma();
  RETURN QUERY
  SELECT n.id, n.lote_id, n.estado, n.espacio_id IS NOT NULL, n.version_fw, n.creado_en, n.reclamado_en,
         count(*) OVER ()
  FROM app.nodos n
  WHERE (p_lote IS NULL OR n.lote_id = p_lote)
    AND (p_estado IS NULL OR n.estado::text = p_estado)
    AND (coalesce(p_q, '') = '' OR position(lower(p_q) IN n.id::text) > 0)
  ORDER BY n.creado_en DESC, n.id
  LIMIT least(greatest(p_limite, 1), 100) OFFSET greatest(p_desplazamiento, 0);
END $$;

CREATE FUNCTION app.admin_detalle_nodo(p_nodo uuid)
RETURNS TABLE (id uuid, lote_id uuid, estado app.estado_nodo_t, asignado boolean, version_fw text,
               perfil_id text, creado_en timestamptz, reclamado_en timestamptz,
               lote_creado_en timestamptz, lote_version_hw text, lote_revocado_en timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.exigir_admin_plataforma();
  RETURN QUERY
  SELECT n.id, n.lote_id, n.estado, n.espacio_id IS NOT NULL, n.version_fw, n.perfil_id, n.creado_en,
         n.reclamado_en, l.creado_en, l.version_hw, l.revocado_en
  FROM app.nodos n JOIN app.lotes l ON l.id = n.lote_id
  WHERE n.id = p_nodo;
END $$;

CREATE FUNCTION app.admin_ids_lote(p_lote uuid) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.exigir_admin_plataforma();
  RETURN QUERY SELECT n.id FROM app.nodos n WHERE n.lote_id = p_lote ORDER BY n.id;
END $$;

-- "De quién es esta boya": ÚNICA función que expone a una persona. Cada llamada deja una fila de auditoría
-- (actor_tipo 'soporte', accion 'soporte.acceso') con ids, nunca el correo. No devuelve datos de agua.
CREATE FUNCTION app.admin_pertenece_a(p_nodo uuid)
RETURNS TABLE (nodo_id uuid, espacio_id uuid, espacio_nombre text, propietario_id uuid,
               propietario_email text, propietario_nombre text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_espacio uuid;
BEGIN
  PERFORM app.exigir_admin_plataforma();
  SELECT n.espacio_id INTO v_espacio FROM app.nodos n WHERE n.id = p_nodo;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_encontrado' USING ERRCODE = 'P0001'; END IF;

  INSERT INTO app.auditoria (actor_tipo, actor_id, espacio_id, nodo_id, accion, detalle)
  VALUES ('soporte', app.usuario_actual(), v_espacio, p_nodo, 'soporte.acceso',
          jsonb_build_object('vista', 'pertenece_a'));

  RETURN QUERY
  SELECT p_nodo, e.id, e.nombre, u.id, u.email::text, u.nombre
  FROM (SELECT 1) uno
  LEFT JOIN app.espacios e ON e.id = v_espacio
  LEFT JOIN app.membresias m ON m.espacio_id = e.id AND m.rol = 'propietario'
  LEFT JOIN app.usuarios u ON u.id = m.usuario_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------
-- Escritura: lotes, etiquetas y revocación. Todas auditadas con actor 'soporte'.
-- ---------------------------------------------------------------------------------------------------------

-- Los códigos llegan en claro (normalizados, sin guiones) y se guardan solo como sha256(código + pepper). El
-- pepper viene de la variable de transacción app.claim_pepper, igual que en reclamar_nodo.
CREATE FUNCTION app.admin_crear_lote(p_version_hw text, p_notas text, p_codigos text[])
RETURNS TABLE (lote_id uuid, creado_en timestamptz, nodo_id uuid, orden integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_lote uuid; v_creado timestamptz; v_id uuid; i integer;
BEGIN
  PERFORM app.exigir_admin_plataforma();
  IF p_codigos IS NULL OR cardinality(p_codigos) NOT BETWEEN 1 AND 50 OR btrim(coalesce(p_version_hw, '')) = '' THEN
    RAISE EXCEPTION 'lote_invalido' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO app.lotes (cantidad, version_hw, notas)
  VALUES (cardinality(p_codigos), btrim(p_version_hw), p_notas)
  RETURNING id, app.lotes.creado_en INTO v_lote, v_creado;
  FOR i IN 1 .. cardinality(p_codigos) LOOP
    v_id := app.uuid_v7();
    INSERT INTO app.nodos (id, lote_id, claim_hash, estado)
    VALUES (v_id, v_lote, digest(p_codigos[i] || current_setting('app.claim_pepper'), 'sha256'), 'fabricado');
    lote_id := v_lote; creado_en := v_creado; nodo_id := v_id; orden := i;
    RETURN NEXT;
  END LOOP;
  INSERT INTO app.auditoria (actor_tipo, actor_id, accion, detalle)
  VALUES ('soporte', app.usuario_actual(), 'lote.fabricado',
          jsonb_build_object('lote_id', v_lote, 'cantidad', cardinality(p_codigos), 'version_hw', btrim(p_version_hw), 'origen', 'panel'));
END $$;

-- Compensación si el broker rechaza el alta: solo borra un lote cuyos nodos siguen todos "fabricado".
CREATE FUNCTION app.admin_deshacer_lote(p_lote uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  PERFORM app.exigir_admin_plataforma();
  IF EXISTS (SELECT 1 FROM app.nodos WHERE lote_id = p_lote AND estado <> 'fabricado') THEN
    RAISE EXCEPTION 'lote_invalido' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM app.nodos WHERE lote_id = p_lote;
  DELETE FROM app.lotes WHERE id = p_lote;
  INSERT INTO app.auditoria (actor_tipo, actor_id, accion, detalle)
  VALUES ('soporte', app.usuario_actual(), 'lote.cancelado', jsonb_build_object('lote_id', p_lote, 'origen', 'panel'));
END $$;

-- Código nuevo para un nodo todavía "fabricado" (el anterior deja de servir). Un nodo ya reclamado no se
-- regenera: se desvincula primero. Devuelve el lote para armar la etiqueta.
CREATE FUNCTION app.admin_regenerar_nodo(p_nodo uuid, p_codigo text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE n app.nodos%ROWTYPE;
BEGIN
  PERFORM app.exigir_admin_plataforma();
  SELECT * INTO n FROM app.nodos WHERE id = p_nodo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_encontrado' USING ERRCODE = 'P0001'; END IF;
  IF n.estado <> 'fabricado' OR EXISTS (SELECT 1 FROM app.lotes WHERE id = n.lote_id AND revocado_en IS NOT NULL) THEN
    RAISE EXCEPTION 'regeneracion_invalida' USING ERRCODE = 'P0001';
  END IF;
  UPDATE app.nodos SET claim_hash = digest(p_codigo || current_setting('app.claim_pepper'), 'sha256') WHERE id = p_nodo;
  INSERT INTO app.auditoria (actor_tipo, actor_id, nodo_id, accion, detalle)
  VALUES ('soporte', app.usuario_actual(), p_nodo, 'nodo.etiqueta_regenerada', jsonb_build_object('lote_id', n.lote_id));
  RETURN n.lote_id;
END $$;

-- Parte de base de datos de la revocación (el broker se desactiva antes, desde la API). Idempotente.
CREATE FUNCTION app.admin_revocar_nodo(p_nodo uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE n app.nodos%ROWTYPE;
BEGIN
  PERFORM app.exigir_admin_plataforma();
  SELECT * INTO n FROM app.nodos WHERE id = p_nodo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_encontrado' USING ERRCODE = 'P0001'; END IF;
  IF n.estado = 'revocado' THEN RETURN; END IF;
  UPDATE app.alarmas SET estado = 'resuelta', resuelta_en = now() WHERE nodo_id = p_nodo AND estado <> 'resuelta';
  UPDATE app.nodos SET estado = 'revocado', espacio_id = NULL WHERE id = p_nodo;
  UPDATE app.estado_nodo SET espacio_id = NULL, nivel = 'sin_datos', wqi = NULL WHERE nodo_id = p_nodo;
  INSERT INTO app.auditoria (actor_tipo, actor_id, espacio_id, nodo_id, accion, detalle)
  VALUES ('soporte', app.usuario_actual(), n.espacio_id, p_nodo, 'nodo.revocado', jsonb_build_object('origen', 'panel'));
END $$;

CREATE FUNCTION app.admin_revocar_lote(p_lote uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE v_nodos integer;
BEGIN
  PERFORM app.exigir_admin_plataforma();
  IF NOT EXISTS (SELECT 1 FROM app.lotes WHERE id = p_lote) THEN RAISE EXCEPTION 'no_encontrado' USING ERRCODE = 'P0001'; END IF;
  UPDATE app.lotes SET revocado_en = coalesce(revocado_en, now()) WHERE id = p_lote;
  UPDATE app.alarmas SET estado = 'resuelta', resuelta_en = now()
  WHERE estado <> 'resuelta' AND nodo_id IN (SELECT id FROM app.nodos WHERE lote_id = p_lote);
  UPDATE app.nodos SET estado = 'revocado', espacio_id = NULL WHERE lote_id = p_lote AND estado <> 'revocado';
  GET DIAGNOSTICS v_nodos = ROW_COUNT;
  UPDATE app.estado_nodo SET espacio_id = NULL, nivel = 'sin_datos', wqi = NULL
  WHERE nodo_id IN (SELECT id FROM app.nodos WHERE lote_id = p_lote);
  INSERT INTO app.auditoria (actor_tipo, actor_id, accion, detalle)
  VALUES ('soporte', app.usuario_actual(), 'lote.revocado', jsonb_build_object('lote_id', p_lote, 'nodos', v_nodos, 'origen', 'panel'));
  RETURN v_nodos;
END $$;

REVOKE ALL ON FUNCTION app.es_admin_plataforma(), app.exigir_admin_plataforma(),
  app.admin_listar_lotes(), app.admin_listar_nodos(uuid, text, text, integer, integer),
  app.admin_detalle_nodo(uuid), app.admin_ids_lote(uuid), app.admin_pertenece_a(uuid),
  app.admin_crear_lote(text, text, text[]), app.admin_deshacer_lote(uuid),
  app.admin_regenerar_nodo(uuid, text), app.admin_revocar_nodo(uuid), app.admin_revocar_lote(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.es_admin_plataforma(),
  app.admin_listar_lotes(), app.admin_listar_nodos(uuid, text, text, integer, integer),
  app.admin_detalle_nodo(uuid), app.admin_ids_lote(uuid), app.admin_pertenece_a(uuid),
  app.admin_crear_lote(text, text, text[]), app.admin_deshacer_lote(uuid),
  app.admin_regenerar_nodo(uuid, text), app.admin_revocar_nodo(uuid), app.admin_revocar_lote(uuid)
  TO lympha_app;
