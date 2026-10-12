-- 0007_calibracion_eventos_auditoria
CREATE TABLE app.calibraciones (
  id              uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  nodo_id         uuid NOT NULL REFERENCES app.nodos(id) ON DELETE CASCADE,
  espacio_id      uuid NOT NULL REFERENCES app.espacios(id) ON DELETE CASCADE,
  parametro       text NOT NULL CHECK (parametro IN ('ph', 'conductividad', 'turbidez')),
  realizada_por   uuid REFERENCES app.usuarios(id) ON DELETE SET NULL,
  iniciada_en     timestamptz NOT NULL DEFAULT now(),
  completada_en   timestamptz,
  resultado       text CHECK (resultado IN ('ok', 'reemplazar', 'fallida', 'cancelada')),
  offset_v        real,                -- desplazamiento calculado
  pendiente       real,                -- mV/pH medidos
  eficiencia      real,                -- pendiente / Nernst (0.85–1.05)
  puntos          jsonb NOT NULL DEFAULT '[]'   -- [{"buffer":7.0,"mv":-3.1,"t":24.2}, ...]
);
CREATE INDEX calibraciones_nodo_idx ON app.calibraciones (nodo_id, iniciada_en DESC);

CREATE TABLE app.eventos_usuario (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  nodo_id      uuid NOT NULL REFERENCES app.nodos(id) ON DELETE CASCADE,
  espacio_id   uuid NOT NULL REFERENCES app.espacios(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (tipo IN ('cambio_filtro', 'limpieza', 'mantenimiento', 'otro')),
  nota         text CHECK (char_length(nota) <= 280),
  ocurrido_en  timestamptz NOT NULL,
  creado_por   uuid REFERENCES app.usuarios(id) ON DELETE SET NULL,
  creado_en    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX eventos_nodo_idx ON app.eventos_usuario (nodo_id, ocurrido_en DESC);

-- auditoría: hypertable para borrar por antigüedad sin DELETE masivos (RNF-06)
CREATE TABLE app.auditoria (
  ocurrido_en  timestamptz NOT NULL DEFAULT now(),
  actor_tipo   text NOT NULL CHECK (actor_tipo IN ('usuario', 'sistema', 'soporte', 'fabrica')),
  actor_id     uuid,
  espacio_id   uuid,
  nodo_id      uuid,
  accion       text NOT NULL,       -- 'nodo.reclamado', 'nodo.desvinculado', 'membresia.rol', 'soporte.acceso', ...
  detalle      jsonb NOT NULL DEFAULT '{}',
  req_id       text
);
SELECT create_hypertable('app.auditoria', by_range('ocurrido_en', INTERVAL '30 days'));
CREATE INDEX auditoria_espacio_idx ON app.auditoria (espacio_id, ocurrido_en DESC);
CREATE INDEX auditoria_nodo_idx    ON app.auditoria (nodo_id, ocurrido_en DESC);
SELECT add_retention_policy('app.auditoria', INTERVAL '12 months');
