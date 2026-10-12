-- 0008_aislamiento: RLS para tablas relacionales, vistas filtradas para series de tiempo y
-- operaciones privilegiadas. Todo depende de la variable de sesión app.usuario_id.

CREATE FUNCTION app.usuario_actual() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.usuario_id', true), '')::uuid
$$;

-- SECURITY DEFINER: lee membresias sin pasar por su propia RLS (evita recursión)
CREATE FUNCTION app.mis_espacios() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT espacio_id FROM app.membresias WHERE usuario_id = app.usuario_actual()
$$;

CREATE FUNCTION app.es_propietario(p_espacio uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.membresias
                 WHERE espacio_id = p_espacio AND usuario_id = app.usuario_actual() AND rol = 'propietario')
$$;

ALTER TABLE app.espacios        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.espacios        FORCE ROW LEVEL SECURITY;
ALTER TABLE app.membresias      ENABLE ROW LEVEL SECURITY; ALTER TABLE app.membresias      FORCE ROW LEVEL SECURITY;
ALTER TABLE app.invitaciones    ENABLE ROW LEVEL SECURITY; ALTER TABLE app.invitaciones    FORCE ROW LEVEL SECURITY;
ALTER TABLE app.nodos           ENABLE ROW LEVEL SECURITY; ALTER TABLE app.nodos           FORCE ROW LEVEL SECURITY;
ALTER TABLE app.estado_nodo     ENABLE ROW LEVEL SECURITY; ALTER TABLE app.estado_nodo     FORCE ROW LEVEL SECURITY;
ALTER TABLE app.alarmas         ENABLE ROW LEVEL SECURITY; ALTER TABLE app.alarmas         FORCE ROW LEVEL SECURITY;
ALTER TABLE app.calibraciones   ENABLE ROW LEVEL SECURITY; ALTER TABLE app.calibraciones   FORCE ROW LEVEL SECURITY;
ALTER TABLE app.eventos_usuario ENABLE ROW LEVEL SECURITY; ALTER TABLE app.eventos_usuario FORCE ROW LEVEL SECURITY;
ALTER TABLE app.usuarios        ENABLE ROW LEVEL SECURITY; ALTER TABLE app.usuarios        FORCE ROW LEVEL SECURITY;
ALTER TABLE app.vinculos_telegram ENABLE ROW LEVEL SECURITY; ALTER TABLE app.vinculos_telegram FORCE ROW LEVEL SECURITY;
ALTER TABLE app.preferencias_notificacion ENABLE ROW LEVEL SECURITY; ALTER TABLE app.preferencias_notificacion FORCE ROW LEVEL SECURITY;

-- FORCE también somete al dueño: las funciones SECURITY DEFINER (mis_espacios, reclamar_nodo, ...) corren
-- como lympha_owner y, sin estas políticas, no verían ninguna fila. El dueño nunca se conecta desde
-- la API; solo lo usan las migraciones, las semillas de desarrollo y estas funciones.
CREATE POLICY definer ON app.espacios        TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY definer ON app.membresias      TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY definer ON app.invitaciones    TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY definer ON app.nodos           TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY definer ON app.estado_nodo     TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY definer ON app.alarmas         TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY definer ON app.calibraciones   TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY definer ON app.eventos_usuario TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY definer ON app.usuarios        TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY definer ON app.vinculos_telegram TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY definer ON app.preferencias_notificacion TO lympha_owner USING (true) WITH CHECK (true);

-- datos del propio usuario
CREATE POLICY yo        ON app.usuarios                  TO lympha_app USING (id = app.usuario_actual()) WITH CHECK (id = app.usuario_actual());
CREATE POLICY yo        ON app.vinculos_telegram         TO lympha_app USING (usuario_id = app.usuario_actual()) WITH CHECK (usuario_id = app.usuario_actual());
CREATE POLICY yo        ON app.preferencias_notificacion TO lympha_app USING (usuario_id = app.usuario_actual()) WITH CHECK (usuario_id = app.usuario_actual());

-- lectura para cualquier miembro del espacio
CREATE POLICY leer ON app.espacios        FOR SELECT TO lympha_app USING (id         IN (SELECT app.mis_espacios()));
CREATE POLICY leer ON app.membresias      FOR SELECT TO lympha_app USING (espacio_id IN (SELECT app.mis_espacios()));
CREATE POLICY leer ON app.nodos           FOR SELECT TO lympha_app USING (espacio_id IN (SELECT app.mis_espacios()));
CREATE POLICY leer ON app.estado_nodo     FOR SELECT TO lympha_app USING (espacio_id IN (SELECT app.mis_espacios()));
CREATE POLICY leer ON app.alarmas         FOR SELECT TO lympha_app USING (espacio_id IN (SELECT app.mis_espacios()));
CREATE POLICY leer ON app.calibraciones   FOR SELECT TO lympha_app USING (espacio_id IN (SELECT app.mis_espacios()));
CREATE POLICY leer ON app.eventos_usuario FOR SELECT TO lympha_app USING (espacio_id IN (SELECT app.mis_espacios()));

-- escritura: miembros atienden alarmas y registran eventos; solo el propietario edita el resto
CREATE POLICY atender     ON app.alarmas         FOR UPDATE TO lympha_app
  USING (espacio_id IN (SELECT app.mis_espacios())) WITH CHECK (espacio_id IN (SELECT app.mis_espacios()));
CREATE POLICY registrar   ON app.eventos_usuario FOR INSERT TO lympha_app
  WITH CHECK (espacio_id IN (SELECT app.mis_espacios()) AND creado_por = app.usuario_actual());
CREATE POLICY propietario ON app.espacios        FOR UPDATE TO lympha_app USING (app.es_propietario(id)) WITH CHECK (app.es_propietario(id));
CREATE POLICY propietario ON app.nodos           FOR UPDATE TO lympha_app USING (app.es_propietario(espacio_id)) WITH CHECK (app.es_propietario(espacio_id));
CREATE POLICY propietario ON app.membresias      FOR DELETE TO lympha_app USING (app.es_propietario(espacio_id) OR usuario_id = app.usuario_actual());
CREATE POLICY propietario ON app.invitaciones    FOR ALL    TO lympha_app USING (app.es_propietario(espacio_id)) WITH CHECK (app.es_propietario(espacio_id));

-- permisos de columna: lo que la API puede tocar aunque la política lo permita
GRANT SELECT ON app.espacios, app.membresias, app.nodos, app.estado_nodo, app.alarmas,
                app.calibraciones, app.eventos_usuario, app.perfiles_uso TO lympha_app;
GRANT SELECT, INSERT, UPDATE (nombre)          ON app.usuarios TO lympha_app;
GRANT SELECT, INSERT, DELETE                   ON app.vinculos_telegram, app.eventos_usuario TO lympha_app;
GRANT SELECT, INSERT, UPDATE, DELETE           ON app.preferencias_notificacion, app.invitaciones TO lympha_app;
GRANT UPDATE (nombre, tipo, compartir_zona, zona_geohash) ON app.espacios TO lympha_app;
GRANT UPDATE (nombre, perfil_id)               ON app.nodos   TO lympha_app;
GRANT UPDATE (estado, atendida_por, atendida_en) ON app.alarmas TO lympha_app;
GRANT DELETE                                   ON app.membresias TO lympha_app;

-- Series de tiempo: la API no tiene permisos sobre ts.*; lee por vistas del dueño que filtran por los
-- espacios del usuario. security_barrier impide que un filtro del usuario se evalúe antes que el de aislamiento.
CREATE VIEW app.v_lecturas WITH (security_barrier) AS
  SELECT * FROM ts.lecturas          WHERE espacio_id IN (SELECT app.mis_espacios());
CREATE VIEW app.v_lecturas_hora WITH (security_barrier) AS
  SELECT * FROM ts.lecturas_hora     WHERE espacio_id IN (SELECT app.mis_espacios());
CREATE VIEW app.v_lecturas_dia WITH (security_barrier) AS
  SELECT * FROM ts.lecturas_dia      WHERE espacio_id IN (SELECT app.mis_espacios());
CREATE VIEW app.v_evaluaciones WITH (security_barrier) AS
  SELECT * FROM ts.evaluaciones      WHERE espacio_id IN (SELECT app.mis_espacios());
CREATE VIEW app.v_evaluaciones_dia WITH (security_barrier) AS
  SELECT * FROM ts.evaluaciones_dia  WHERE espacio_id IN (SELECT app.mis_espacios());
GRANT SELECT ON app.v_lecturas, app.v_lecturas_hora, app.v_lecturas_dia,
                app.v_evaluaciones, app.v_evaluaciones_dia TO lympha_app;

-- Operación privilegiada de ejemplo del documento de datos; las demás (crear_espacio, desvincular_nodo,
-- aceptar_invitacion, ...) llegan en H1.
CREATE FUNCTION app.reclamar_nodo(p_nodo uuid, p_codigo text, p_espacio uuid, p_perfil text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE n app.nodos%ROWTYPE;
BEGIN
  IF NOT app.es_propietario(p_espacio) THEN RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501'; END IF;

  SELECT * INTO n FROM app.nodos WHERE id = p_nodo FOR UPDATE;
  IF NOT FOUND OR n.estado NOT IN ('fabricado', 'desvinculado')
     OR EXISTS (SELECT 1 FROM app.lotes WHERE id = n.lote_id AND revocado_en IS NOT NULL)
     OR n.claim_hash <> digest(p_codigo || current_setting('app.claim_pepper'), 'sha256') THEN
    RAISE EXCEPTION 'reclamo_invalido' USING ERRCODE = 'P0001';   -- mismo error para todos los casos
  END IF;

  UPDATE app.nodos SET espacio_id = p_espacio, perfil_id = p_perfil, estado = 'reclamado', reclamado_en = now()
  WHERE id = p_nodo;
  INSERT INTO app.estado_nodo (nodo_id, espacio_id) VALUES (p_nodo, p_espacio)
  ON CONFLICT (nodo_id) DO UPDATE SET espacio_id = EXCLUDED.espacio_id, nivel = 'sin_datos', wqi = NULL;
  INSERT INTO app.auditoria (actor_tipo, actor_id, espacio_id, nodo_id, accion)
  VALUES ('usuario', app.usuario_actual(), p_espacio, p_nodo, 'nodo.reclamado');
END $$;

REVOKE ALL ON FUNCTION app.reclamar_nodo(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reclamar_nodo(uuid, text, uuid, text) TO lympha_app;

-- Procesos internos (lympha_system): BYPASSRLS, pero solo los permisos que necesitan.
GRANT SELECT ON app.nodos, app.perfiles_uso, app.membresias, app.vinculos_telegram,
                app.preferencias_notificacion, app.lotes TO lympha_system;
GRANT SELECT, INSERT, UPDATE ON app.estado_nodo, app.alarmas, app.notificaciones_salida TO lympha_system;
GRANT INSERT ON ts.lecturas, ts.evaluaciones, app.auditoria TO lympha_system;
GRANT SELECT ON ts.lecturas, ts.evaluaciones TO lympha_system;     -- recuperar ventanas tras un reinicio
GRANT UPDATE (version_fw, estado) ON app.nodos TO lympha_system;
GRANT DELETE ON app.vinculos_telegram TO lympha_system;             -- usuario bloqueó el bot
