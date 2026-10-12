-- 0006_alarmas: alarmas con ciclo de vida y bandeja de salida (outbox) de notificaciones.
CREATE TABLE app.alarmas (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  nodo_id        uuid NOT NULL REFERENCES app.nodos(id) ON DELETE CASCADE,
  espacio_id     uuid NOT NULL REFERENCES app.espacios(id) ON DELETE CASCADE,
  tipo           app.alarma_tipo   NOT NULL,
  severidad      app.nivel         NOT NULL,           -- regular | mala | critica
  estado         app.alarma_estado NOT NULL DEFAULT 'activa',
  abierta_en     timestamptz NOT NULL DEFAULT now(),
  escalada_en    timestamptz,
  atendida_por   uuid REFERENCES app.usuarios(id) ON DELETE SET NULL,
  atendida_en    timestamptz,
  resuelta_en    timestamptz,
  causa          text,                                 -- parámetro limitante o motivo
  detalle        jsonb NOT NULL DEFAULT '{}',          -- valores al abrir y al escalar
  CHECK ((estado = 'resuelta') = (resuelta_en IS NOT NULL))
);
-- una sola alarma abierta por nodo y tipo (RF-30)
CREATE UNIQUE INDEX alarmas_una_abierta ON app.alarmas (nodo_id, tipo) WHERE estado <> 'resuelta';
CREATE INDEX alarmas_espacio_idx ON app.alarmas (espacio_id, abierta_en DESC);

CREATE TABLE app.notificaciones_salida (
  id                  uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  espacio_id          uuid NOT NULL REFERENCES app.espacios(id) ON DELETE CASCADE,
  alarma_id           uuid REFERENCES app.alarmas(id) ON DELETE CASCADE,
  usuario_id          uuid NOT NULL REFERENCES app.usuarios(id) ON DELETE CASCADE,
  canal               text NOT NULL DEFAULT 'telegram' CHECK (canal IN ('telegram', 'push', 'email')),
  evento              text NOT NULL CHECK (evento IN ('abierta', 'escalada', 'resuelta', 'recordatorio', 'sin_conexion', 'reconectado')),
  clave_idempotencia  text NOT NULL UNIQUE,            -- p. ej. alarma_id:evento:usuario_id:secuencia
  payload             jsonb NOT NULL,                  -- texto ya formateado y datos del mensaje
  estado              text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviada', 'fallida', 'descartada')),
  intentos            smallint NOT NULL DEFAULT 0,
  enviar_despues_de   timestamptz NOT NULL DEFAULT now(),   -- horario silencioso y reintentos
  enviada_en          timestamptz,
  error               text,
  creado_en           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX salida_pendientes ON app.notificaciones_salida (enviar_despues_de) WHERE estado = 'pendiente';
