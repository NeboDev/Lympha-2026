-- 0005_agregados: agregados continuos por hora y por día (día calendario de México).
CREATE MATERIALIZED VIEW ts.lecturas_hora
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT nodo_id, espacio_id,
       time_bucket(INTERVAL '1 hour', ts) AS bucket,
       avg(ph) AS ph_prom,  min(ph) AS ph_min,  max(ph) AS ph_max,
       avg(temperatura) AS t_prom, min(temperatura) AS t_min, max(temperatura) AS t_max,
       avg(conductividad) AS ec_prom, min(conductividad) AS ec_min, max(conductividad) AS ec_max,
       avg(turbidez) AS turb_prom, min(turbidez) AS turb_min, max(turbidez) AS turb_max,
       avg(tds) AS tds_prom, min(tds) AS tds_min, max(tds) AS tds_max,
       count(*) AS n
FROM ts.lecturas
GROUP BY nodo_id, espacio_id, bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('ts.lecturas_hora',
  start_offset => INTERVAL '3 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '30 minutes');
SELECT add_retention_policy('ts.lecturas_hora', INTERVAL '13 months');

CREATE MATERIALIZED VIEW ts.lecturas_dia
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT nodo_id, espacio_id,
       time_bucket(INTERVAL '1 day', ts, 'America/Mexico_City') AS dia,
       avg(ph) AS ph_prom, avg(temperatura) AS t_prom, avg(conductividad) AS ec_prom,
       avg(turbidez) AS turb_prom, max(turbidez) AS turb_max, avg(tds) AS tds_prom,
       count(*) AS n
FROM ts.lecturas
GROUP BY nodo_id, espacio_id, dia
WITH NO DATA;
SELECT add_continuous_aggregate_policy('ts.lecturas_dia',
  start_offset => INTERVAL '4 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour');

CREATE MATERIALIZED VIEW ts.evaluaciones_dia
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT nodo_id, espacio_id,
       time_bucket(INTERVAL '1 day', ts, 'America/Mexico_City') AS dia,
       avg(wqi) AS wqi_prom, min(wqi) AS wqi_min,
       count(*) FILTER (WHERE nivel = 'buena')     AS n_buena,
       count(*) FILTER (WHERE nivel = 'regular')   AS n_regular,
       count(*) FILTER (WHERE nivel = 'mala')      AS n_mala,
       count(*) FILTER (WHERE nivel = 'critica')   AS n_critica,
       count(*) FILTER (WHERE nivel = 'sin_datos') AS n_sin_datos
FROM ts.evaluaciones
GROUP BY nodo_id, espacio_id, dia
WITH NO DATA;
SELECT add_continuous_aggregate_policy('ts.evaluaciones_dia',
  start_offset => INTERVAL '4 days', end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '1 hour');

-- índices de los agregados continuos
CREATE INDEX ON ts.lecturas_hora     (nodo_id, bucket DESC);
CREATE INDEX ON ts.lecturas_dia      (nodo_id, dia DESC);
CREATE INDEX ON ts.evaluaciones_dia  (nodo_id, dia DESC);
CREATE INDEX ON ts.lecturas_hora     (espacio_id, bucket DESC);
CREATE INDEX ON ts.evaluaciones_dia  (espacio_id, dia DESC);
