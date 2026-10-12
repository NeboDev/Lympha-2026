-- 0003_dispositivos: perfiles de uso, lotes, nodos y último estado conocido.
CREATE TABLE app.perfiles_uso (
  id                 text PRIMARY KEY,                 -- 'cisterna', 'beber', 'alberca', 'riego'
  nombre             text NOT NULL,
  version            integer NOT NULL,
  config_wqi         jsonb NOT NULL,                   -- curvas, pesos, parametro limitante
  reglas_alarma      jsonb NOT NULL,                   -- duración mínima, histéresis
  activo             boolean NOT NULL DEFAULT true
);

CREATE TABLE app.lotes (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  cantidad     integer NOT NULL CHECK (cantidad > 0),
  version_hw   text NOT NULL,
  revocado_en  timestamptz,
  notas        text,
  creado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.nodos (
  id             uuid PRIMARY KEY,                       -- deviceId impreso en el QR
  lote_id        uuid NOT NULL REFERENCES app.lotes(id),
  espacio_id     uuid REFERENCES app.espacios(id) ON DELETE SET NULL,
  perfil_id      text NOT NULL DEFAULT 'cisterna' REFERENCES app.perfiles_uso(id),
  nombre         text CHECK (char_length(nombre) <= 60),
  claim_hash     bytea NOT NULL,                         -- sha256(código + pepper)
  estado         app.estado_nodo_t NOT NULL DEFAULT 'fabricado',
  version_fw     text,
  reclamado_en   timestamptz,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CHECK ((espacio_id IS NULL) = (estado IN ('fabricado', 'desvinculado', 'revocado')))
);
CREATE INDEX nodos_espacio_idx ON app.nodos (espacio_id) WHERE espacio_id IS NOT NULL;
CREATE INDEX nodos_lote_idx    ON app.nodos (lote_id);

-- último estado conocido; lo escribe el worker con UPSERT, la API lo lee
CREATE TABLE app.estado_nodo (
  nodo_id              uuid PRIMARY KEY REFERENCES app.nodos(id) ON DELETE CASCADE,
  espacio_id           uuid REFERENCES app.espacios(id) ON DELETE SET NULL,
  conectado            boolean NOT NULL DEFAULT false,
  cambio_conexion_en   timestamptz,
  ultima_lectura_en    timestamptz,
  nivel                app.nivel NOT NULL DEFAULT 'sin_datos',
  wqi                  numeric(5,2),
  parametro_limitante  text,
  confianza            app.confianza NOT NULL DEFAULT 'ok',
  ultimos_valores      jsonb,
  actualizado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX estado_nodo_espacio_idx ON app.estado_nodo (espacio_id);

CREATE TRIGGER usuarios_tocar BEFORE UPDATE ON app.usuarios FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado();
CREATE TRIGGER espacios_tocar BEFORE UPDATE ON app.espacios FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado();
CREATE TRIGGER nodos_tocar    BEFORE UPDATE ON app.nodos    FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado();
