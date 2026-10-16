-- 0013_ota_h5 (H5): registro de versiones de firmware, despliegues graduales y comandos enviados a los nodos.
-- Todo es aditivo (expand): la versión anterior del código no usa nada de esto. Lo escribe el CLI `pnpm ota`
-- (lympha_owner) y las respuestas de los nodos (cmd/ack) las aplica el worker (lympha_system). La API no lo ve.

CREATE TABLE app.versiones_firmware (
  version       text PRIMARY KEY CHECK (char_length(version) BETWEEN 1 AND 32),
  sha256        text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  tamano_bytes  integer NOT NULL CHECK (tamano_bytes > 0),
  -- nombre del archivo dentro de OTA_DIR (sin ruta)
  archivo       text NOT NULL CHECK (archivo ~ '^[A-Za-z0-9._-]+\.bin$'),
  creada_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.despliegues_ota (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  version        text NOT NULL REFERENCES app.versiones_firmware(version),
  -- porcentaje acumulado de la flota elegible en la etapa actual (5, 25, 100)
  etapa          smallint NOT NULL CHECK (etapa BETWEEN 1 AND 100),
  estado         text NOT NULL DEFAULT 'en_curso' CHECK (estado IN ('en_curso', 'completado', 'detenido')),
  motivo         text CHECK (char_length(motivo) <= 280),
  iniciado_en    timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
-- un solo despliegue en curso a la vez
CREATE UNIQUE INDEX despliegues_ota_en_curso ON app.despliegues_ota ((true)) WHERE estado = 'en_curso';

CREATE TABLE app.comandos_nodo (
  -- el `id` del comando del contrato MQTT (cmd / cmd/ack)
  id             text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 64),
  nodo_id        uuid NOT NULL REFERENCES app.nodos(id),
  despliegue_id  uuid REFERENCES app.despliegues_ota(id),
  op             text NOT NULL CHECK (op IN ('reboot', 'ota')),
  version        text,
  estado         text NOT NULL DEFAULT 'enviado' CHECK (estado IN ('enviado', 'ok', 'error')),
  detalle        text CHECK (char_length(detalle) <= 200),
  enviado_en     timestamptz NOT NULL DEFAULT now(),
  respondido_en  timestamptz
);
CREATE INDEX comandos_nodo_despliegue ON app.comandos_nodo (despliegue_id, nodo_id);

REVOKE ALL ON app.versiones_firmware, app.despliegues_ota, app.comandos_nodo FROM PUBLIC;
-- el worker solo registra la respuesta de un comando ya enviado
GRANT SELECT, UPDATE (estado, detalle, respondido_en) ON app.comandos_nodo TO lympha_system;
