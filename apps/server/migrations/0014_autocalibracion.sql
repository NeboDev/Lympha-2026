-- 0014_autocalibracion: calibración lineal por nodo y parámetro (valor_calibrado = pendiente · crudo + desfase).
-- Todo es aditivo (expand): la versión anterior del código no usa nada de esto. La tabla `app.calibraciones` del
-- 0007 (modelo en mV, solo pH) no se toca ni se usa: esta tabla la reemplaza en la práctica y evita mezclar
-- dos modelos; queda reservada para una calibración por voltaje si el firmware algún día la necesita.

CREATE TABLE app.calibraciones_sensor (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  nodo_id     uuid NOT NULL REFERENCES app.nodos(id) ON DELETE CASCADE,
  espacio_id  uuid NOT NULL REFERENCES app.espacios(id) ON DELETE CASCADE,
  parametro   text NOT NULL CHECK (parametro IN ('ph', 'conductividad', 'tds', 'turbidez')),
  pendiente   double precision NOT NULL CHECK (pendiente > 0),
  -- `offset` es palabra reservada de SQL: la columna se llama `desfase`
  desfase     double precision NOT NULL,
  r2          double precision CHECK (r2 IS NULL OR (r2 >= 0 AND r2 <= 1)),
  -- [{"crudo": 7.12, "referencia": 7.0}, ...]; vacío en la identidad
  puntos      jsonb NOT NULL DEFAULT '[]',
  -- 'guiada' = salió de puntos medidos con soluciones patrón; 'identidad' = restablecida (pendiente 1, desfase 0)
  origen      text NOT NULL DEFAULT 'guiada' CHECK (origen IN ('guiada', 'identidad')),
  activa      boolean NOT NULL DEFAULT false,
  creado_por  uuid REFERENCES app.usuarios(id) ON DELETE SET NULL,
  creado_en   timestamptz NOT NULL DEFAULT now()
);
-- una sola calibración activa por nodo y parámetro
CREATE UNIQUE INDEX calibraciones_sensor_activa ON app.calibraciones_sensor (nodo_id, parametro) WHERE activa;
CREATE INDEX calibraciones_sensor_nodo ON app.calibraciones_sensor (nodo_id, creado_en DESC);

ALTER TABLE app.calibraciones_sensor ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.calibraciones_sensor FORCE ROW LEVEL SECURITY;
CREATE POLICY definer ON app.calibraciones_sensor TO lympha_owner USING (true) WITH CHECK (true);
CREATE POLICY leer ON app.calibraciones_sensor FOR SELECT TO lympha_app
  USING (espacio_id IN (SELECT app.mis_espacios()));
-- las escrituras de la API pasan por las funciones de abajo (SECURITY DEFINER), que exigen ser propietario
REVOKE ALL ON app.calibraciones_sensor FROM PUBLIC;
GRANT SELECT ON app.calibraciones_sensor TO lympha_app;
-- el worker solo lee los coeficientes vigentes para aplicarlos a las lecturas (BYPASSRLS, permisos por tabla)
GRANT SELECT ON app.calibraciones_sensor TO lympha_system;

-- Plazo tras el cual una calibración se considera vencida; configurable por perfil.
ALTER TABLE app.perfiles_uso ADD COLUMN calibracion_vence_dias integer NOT NULL DEFAULT 90
  CHECK (calibracion_vence_dias BETWEEN 1 AND 3650);

-- Trazabilidad: el valor sin calibrar de cada parámetro que se corrigió (NULL si la lectura no se corrigió).
-- Es nullable y sin valor por omisión: en una hypertable comprimida se agrega sin reescribir datos.
ALTER TABLE ts.lecturas ADD COLUMN crudo jsonb;
-- `SELECT *` de la vista se expandió al crearla: se vuelve a crear para que incluya la columna nueva (al final).
CREATE OR REPLACE VIEW app.v_lecturas WITH (security_barrier) AS
  SELECT * FROM ts.lecturas WHERE espacio_id IN (SELECT app.mis_espacios());

-- Registra una calibración y la deja activa; la anterior queda en el historial. Solo el propietario del espacio.
CREATE FUNCTION app.registrar_calibracion(
  p_nodo uuid, p_parametro text, p_pendiente double precision, p_desfase double precision,
  p_r2 double precision, p_puntos jsonb, p_origen text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE n app.nodos%ROWTYPE; nuevo uuid;
BEGIN
  SELECT * INTO n FROM app.nodos WHERE id = p_nodo FOR UPDATE;
  IF NOT FOUND OR n.espacio_id IS NULL OR NOT app.es_propietario(n.espacio_id) THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;
  UPDATE app.calibraciones_sensor SET activa = false WHERE nodo_id = p_nodo AND parametro = p_parametro AND activa;
  INSERT INTO app.calibraciones_sensor
    (nodo_id, espacio_id, parametro, pendiente, desfase, r2, puntos, origen, activa, creado_por)
  VALUES (p_nodo, n.espacio_id, p_parametro, p_pendiente, p_desfase, p_r2, p_puntos, p_origen, true, app.usuario_actual())
  RETURNING id INTO nuevo;
  INSERT INTO app.auditoria (actor_tipo, actor_id, espacio_id, nodo_id, accion, detalle)
  VALUES ('usuario', app.usuario_actual(), n.espacio_id, p_nodo, 'calibracion.registrada',
          jsonb_build_object('calibracion_id', nuevo, 'parametro', p_parametro, 'origen', p_origen));
  RETURN nuevo;
END $$;

-- Vuelve a dejar activa una calibración del historial (revertir a la anterior). Devuelve nodo y parámetro.
CREATE FUNCTION app.activar_calibracion(p_id uuid)
RETURNS TABLE (nodo_id uuid, espacio_id uuid, parametro text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE c app.calibraciones_sensor%ROWTYPE;
BEGIN
  SELECT * INTO c FROM app.calibraciones_sensor WHERE id = p_id;
  IF NOT FOUND OR NOT app.es_propietario(c.espacio_id) THEN
    RAISE EXCEPTION 'no_autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM app.nodos WHERE id = c.nodo_id FOR UPDATE;
  UPDATE app.calibraciones_sensor SET activa = false
   WHERE calibraciones_sensor.nodo_id = c.nodo_id AND calibraciones_sensor.parametro = c.parametro AND activa;
  UPDATE app.calibraciones_sensor SET activa = true WHERE id = p_id;
  INSERT INTO app.auditoria (actor_tipo, actor_id, espacio_id, nodo_id, accion, detalle)
  VALUES ('usuario', app.usuario_actual(), c.espacio_id, c.nodo_id, 'calibracion.revertida',
          jsonb_build_object('calibracion_id', p_id, 'parametro', c.parametro));
  RETURN QUERY SELECT c.nodo_id, c.espacio_id, c.parametro;
END $$;

REVOKE ALL ON FUNCTION app.registrar_calibracion(uuid, text, double precision, double precision, double precision, jsonb, text),
  app.activar_calibracion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.registrar_calibracion(uuid, text, double precision, double precision, double precision, jsonb, text),
  app.activar_calibracion(uuid) TO lympha_app;
