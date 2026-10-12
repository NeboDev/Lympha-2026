-- 0002_identidad_espacios: perfil local ligado al uid de Firebase, espacios y membresías.
CREATE TABLE app.usuarios (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  auth_uid      text   NOT NULL UNIQUE,             -- uid de Firebase
  email         citext NOT NULL,
  nombre        text,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.espacios (
  id              uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  nombre          text NOT NULL CHECK (char_length(nombre) BETWEEN 1 AND 80),
  tipo            text NOT NULL CHECK (tipo IN ('hogar', 'escuela', 'pyme', 'hotel', 'otro')),
  zona_geohash    text CHECK (char_length(zona_geohash) <= 6),   -- precisión máxima ~colonia (RNF-08)
  compartir_zona  boolean NOT NULL DEFAULT false,                -- consentimiento RF-43
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.membresias (
  espacio_id  uuid NOT NULL REFERENCES app.espacios(id) ON DELETE CASCADE,
  usuario_id  uuid NOT NULL REFERENCES app.usuarios(id) ON DELETE CASCADE,
  rol         app.rol_espacio NOT NULL,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (espacio_id, usuario_id)
);
CREATE INDEX membresias_usuario_idx ON app.membresias (usuario_id);
-- un solo propietario por espacio
CREATE UNIQUE INDEX membresias_un_propietario ON app.membresias (espacio_id) WHERE rol = 'propietario';

CREATE TABLE app.invitaciones (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  espacio_id   uuid NOT NULL REFERENCES app.espacios(id) ON DELETE CASCADE,
  token_hash   bytea NOT NULL UNIQUE,                 -- sha256 del token del enlace
  rol          app.rol_espacio NOT NULL DEFAULT 'miembro' CHECK (rol = 'miembro'),
  creada_por   uuid NOT NULL REFERENCES app.usuarios(id) ON DELETE CASCADE,
  expira_en    timestamptz NOT NULL,
  usada_por    uuid REFERENCES app.usuarios(id) ON DELETE SET NULL,
  usada_en     timestamptz
);
CREATE INDEX invitaciones_espacio_idx ON app.invitaciones (espacio_id);

CREATE TABLE app.vinculos_telegram (
  usuario_id    uuid PRIMARY KEY REFERENCES app.usuarios(id) ON DELETE CASCADE,
  chat_id       bigint NOT NULL UNIQUE,
  vinculado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.preferencias_notificacion (
  id               uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  usuario_id       uuid NOT NULL REFERENCES app.usuarios(id) ON DELETE CASCADE,
  nodo_id          uuid,                                -- NULL = preferencia por defecto del usuario
  niveles          app.nivel[] NOT NULL DEFAULT '{mala,critica}',
  silencio_inicio  time,
  silencio_fin     time,
  zona_horaria     text NOT NULL DEFAULT 'America/Mexico_City',
  recordatorio_h   smallint NOT NULL DEFAULT 6 CHECK (recordatorio_h BETWEEN 1 AND 72),
  UNIQUE NULLS NOT DISTINCT (usuario_id, nodo_id)
);
