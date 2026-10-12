-- 0004_series: hypertables de lecturas y evaluaciones, con compresión y retención.
CREATE TABLE ts.lecturas (
  nodo_id        uuid        NOT NULL,
  espacio_id     uuid        NOT NULL,
  ts             timestamptz NOT NULL,     -- hora del nodo (NTP)
  seq            integer     NOT NULL,
  ph             real,
  temperatura    real,
  conductividad  real,
  turbidez       real,                     -- NTU
  tds            real,
  recibido_en    timestamptz NOT NULL DEFAULT now()
);
SELECT create_hypertable('ts.lecturas', by_range('ts', INTERVAL '1 day'));
CREATE UNIQUE INDEX lecturas_nodo_ts ON ts.lecturas (nodo_id, ts DESC);   -- idempotencia
CREATE INDEX lecturas_espacio_ts      ON ts.lecturas (espacio_id, ts DESC);

ALTER TABLE ts.lecturas SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'nodo_id, espacio_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('ts.lecturas', INTERVAL '2 days');
SELECT add_retention_policy('ts.lecturas',   INTERVAL '30 days');

CREATE TABLE ts.evaluaciones (
  nodo_id              uuid        NOT NULL,
  espacio_id           uuid        NOT NULL,
  ts                   timestamptz NOT NULL,
  wqi                  numeric(5,2),
  nivel                app.nivel   NOT NULL,
  parametro_limitante  text,
  confianza            app.confianza NOT NULL,
  version_algoritmo    text        NOT NULL,   -- RNF-24
  subindices           jsonb       NOT NULL    -- {"ph":92.1,"turbidez":40.0,...}
);
SELECT create_hypertable('ts.evaluaciones', by_range('ts', INTERVAL '7 days'));
CREATE UNIQUE INDEX evaluaciones_nodo_ts ON ts.evaluaciones (nodo_id, ts DESC);
ALTER TABLE ts.evaluaciones SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'nodo_id, espacio_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('ts.evaluaciones', INTERVAL '7 days');
SELECT add_retention_policy('ts.evaluaciones',   INTERVAL '90 days');
