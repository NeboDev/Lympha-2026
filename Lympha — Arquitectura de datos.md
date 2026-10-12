# Lympha — Arquitectura de datos

Oct 11, 2026 · @Jesus AQ

## Resumen y principios

Lympha guarda todo en una base PostgreSQL 16 con TimescaleDB, dividida en dos esquemas: `app` para datos relacionales y `ts` para series de tiempo. Valkey solo guarda estado volátil y colas; si se pierde, se reconstruye desde Postgres. Mosquitto guarda las credenciales de los nodos en su propio archivo de Dynamic Security, administrado por el backend.

Principios:

1. **`espacio_id` en todo lo que pertenece a un cliente.** Es la clave de aislamiento. Se copia en las tablas de series de tiempo para filtrar sin JOIN; si un nodo cambia de espacio, sus datos históricos se quedan con el espacio anterior.
2. **Aislamiento en la base, no en el código.** Las tablas relacionales usan RLS. Las series de tiempo no pueden usar RLS porque TimescaleDB no lo soporta en chunks comprimidos; la API las lee solo a través de vistas que filtran por los espacios del usuario.
3. **Operaciones de varios pasos en funciones de la base.** Crear un espacio, reclamar un nodo o aceptar una invitación son funciones `SECURITY DEFINER` que validan y escriben todo en una transacción.
4. **Identificadores UUIDv7.** Ordenados por tiempo, sin colisiones entre entornos y útiles como `deviceId` impreso.
5. **Todo en UTC.** Columnas `timestamptz`; la zona `America/Mexico_City` solo se aplica al agregar por día y al mostrar.
6. **Nombres en español y `snake_case`**, en singular para tipos y en plural para tablas.
7. **Idempotencia en la ingesta y en los avisos:** claves únicas que convierten un reintento en un no-op.

## Mapa de entidades

&#91;embedded content: entidades · 18 tablas en 3 grupos\]

Un usuario pertenece a espacios mediante `membresias`; un espacio tiene nodos; cada nodo genera lecturas, evaluaciones y alarmas. Las tablas de la tercera columna llevan `espacio_id` copiado del nodo en el momento de escribirse, así que filtrar por cliente no requiere unir con `nodos`.

| Tabla | Esquema | Tipo | Dueño (módulo) |
| --- | --- | --- | --- |
| `usuarios`, `vinculos_telegram`, `preferencias_notificacion` | `app` | Relacional | `identidad`, `notificaciones` |
| `espacios`, `membresias`, `invitaciones` | `app` | Relacional con RLS | `espacios` |
| `lotes`, `nodos`, `perfiles_uso`, `estado_nodo` | `app` | Relacional con RLS | `dispositivos`, `calidad` |
| `calibraciones`, `eventos_usuario` | `app` | Relacional con RLS | `calibracion`, `eventos` |
| `alarmas`, `notificaciones_salida` | `app` | Relacional con RLS | `alarmas`, `notificaciones` |
| `lecturas`, `evaluaciones` | `ts` | Hypertable | `telemetria`, `calidad` |
| `lecturas_hora`, `lecturas_dia`, `evaluaciones_dia` | `ts` | Agregado continuo | `telemetria`, `calidad` |
| `auditoria` | `app` | Hypertable | transversal |

## Roles, esquemas y extensiones

Cuatro roles de inicio de sesión con permisos mínimos. Ninguno es superusuario; las extensiones se crean una sola vez al inicializar la base.

| Rol | Usado por | Qué puede hacer |
| --- | --- | --- |
| `lympha_owner` | Job de migraciones | Dueño de esquemas, tablas, vistas y funciones |
| `lympha_app` | `api` | Sujeto a RLS; lee series de tiempo solo por vistas; escribe por funciones privilegiadas |
| `lympha_system` | `ingest`, `worker`, `notifier` | `BYPASSRLS`, pero solo con los permisos concedidos tabla por tabla |
| `lympha_backup` | Respaldos | `pg_read_all_data`, sin escritura |

```sql
-- 0000_init.sql (como superusuario, una sola vez por entorno)
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- digest() para hashes
CREATE EXTENSION IF NOT EXISTS citext;     -- correos sin distinguir mayúsculas

CREATE ROLE lympha_owner  LOGIN PASSWORD :'pw_owner';
CREATE ROLE lympha_app    LOGIN PASSWORD :'pw_app';
CREATE ROLE lympha_system LOGIN PASSWORD :'pw_system' BYPASSRLS;
CREATE ROLE lympha_backup LOGIN PASSWORD :'pw_backup';
GRANT pg_read_all_data TO lympha_backup;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA app AUTHORIZATION lympha_owner;
CREATE SCHEMA ts  AUTHORIZATION lympha_owner;
GRANT USAGE ON SCHEMA app, ts TO lympha_app, lympha_system;

ALTER ROLE lympha_app    SET search_path = app, pg_catalog;
ALTER ROLE lympha_system SET search_path = app, ts, pg_catalog;
ALTER ROLE lympha_app    SET statement_timeout = '5s';
ALTER ROLE lympha_system SET statement_timeout = '30s';
```

**Tipos y utilidades compartidas:**

```sql
-- 0001_tipos.sql
SET ROLE lympha_owner;

CREATE TYPE app.nivel          AS ENUM ('buena', 'regular', 'mala', 'critica', 'sin_datos');
CREATE TYPE app.confianza      AS ENUM ('ok', 'dudosa', 'revisar');
CREATE TYPE app.rol_espacio    AS ENUM ('propietario', 'miembro');
CREATE TYPE app.estado_nodo_t  AS ENUM ('fabricado', 'reclamado', 'activo', 'desvinculado', 'revocado');
CREATE TYPE app.alarma_tipo    AS ENUM ('nivel', 'sin_conexion', 'sensor');
CREATE TYPE app.alarma_estado  AS ENUM ('activa', 'atendida', 'resuelta');

-- UUIDv7: 48 bits de milisegundos + aleatorio (PostgreSQL 16 no lo trae nativo)
CREATE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
              FROM 1 FOR 6),
    52, 1), 53, 1), 'hex')::uuid
$$;

CREATE FUNCTION app.tocar_actualizado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.actualizado_en := now(); RETURN NEW; END $$;
```

## Tablas relacionales: identidad, espacios y dispositivos

Las contraseñas y sesiones viven en Firebase Auth; `usuarios` solo guarda el perfil local ligado al `uid`. Un nodo sin reclamar tiene `espacio_id` nulo y nadie lo ve.

```sql
-- 0002_identidad_espacios.sql
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
```

```sql
-- 0003_dispositivos.sql
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
```

Notas de diseño:

- El `CHECK` de `nodos` impide estados imposibles, como un nodo reclamado sin espacio o un nodo revocado que sigue asignado.
- `claim_hash` lleva un *pepper* guardado en los secretos del servidor, no en la base: un volcado de la base no basta para reclamar nodos.
- `estado_nodo` está separado de `nodos` porque se escribe con cada lectura; así las actualizaciones frecuentes no bloquean la fila que la API edita.

## Series de tiempo

Dos hypertables reciben un renglón por lectura; tres agregados continuos alimentan el historial. Cada nivel tiene su propia retención, así el disco crece con el número de nodos y no con el tiempo.

| Tabla | Chunk | Compresión | Retención | Sirve para |
| --- | --- | --- | --- | --- |
| `ts.lecturas` | 1 día | A los 2 días | 30 días | Detalle de las últimas horas, depuración |
| `ts.evaluaciones` | 7 días | A los 7 días | 90 días | Cambios de nivel, auditoría del WQI |
| `ts.lecturas_hora` | agregado | — | 13 meses | Historial por parámetro (RF-36) |
| `ts.lecturas_dia` | agregado | — | Sin límite | Tendencias largas |
| `ts.evaluaciones_dia` | agregado | — | Sin límite | Nivel predominante por día (RF-35) |

```sql
-- 0004_series.sql
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
```

```sql
-- 0005_agregados.sql
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

-- día calendario de México, no día UTC
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
```

Reglas que sostienen este diseño:

- **La ventana de refresco (3–4 días) cubre el buffer del nodo (24 h).** Las lecturas que llegan tarde siguen entrando a los agregados.
- **La retención de `lecturas` (30 días) es mayor que la ventana de refresco.** Al borrar chunks viejos no se borran los agregados, porque ya nadie los vuelve a calcular.
- **El nivel predominante del día se calcula al leer:** el nivel con más conteo en `evaluaciones_dia`, con empate hacia el peor.
- **Ingesta idempotente:** `INSERT ... ON CONFLICT (nodo_id, ts) DO NOTHING`, por lotes de hasta 500 filas.
- En versiones recientes de TimescaleDB la compresión se llama *columnstore*; las funciones de este bloque siguen siendo válidas, pero conviene revisar la sintaxis de la versión fijada en la imagen.

## Alarmas, notificaciones y bandeja de salida

Una alarma es un problema con principio y fin, no un evento por lectura. Cada transición escribe filas en `notificaciones_salida` dentro de la misma transacción; `notifier` las envía después. Si el worker se reintenta, los índices únicos convierten el segundo intento en un no-op.

```sql
-- 0006_alarmas.sql
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
```

**Abrir o escalar una alarma** (dentro de la transacción del worker):

```sql
WITH alarma AS (
  INSERT INTO app.alarmas (nodo_id, espacio_id, tipo, severidad, causa, detalle)
  VALUES ($1, $2, 'nivel', $3, $4, $5)
  ON CONFLICT (nodo_id, tipo) WHERE estado <> 'resuelta'
  DO UPDATE SET severidad   = EXCLUDED.severidad,
                escalada_en = now(),
                detalle     = app.alarmas.detalle || EXCLUDED.detalle
  WHERE app.alarmas.severidad < EXCLUDED.severidad          -- solo si empeora
  RETURNING id, (xmax = 0) AS nueva
)
INSERT INTO app.notificaciones_salida (espacio_id, alarma_id, usuario_id, evento, clave_idempotencia, payload, enviar_despues_de)
SELECT $2, a.id, m.usuario_id,
       CASE WHEN a.nueva THEN 'abierta' ELSE 'escalada' END,
       a.id || ':' || CASE WHEN a.nueva THEN 'abierta' ELSE 'escalada:' || $3 END || ':' || m.usuario_id,
       $6,
       app.siguiente_envio(m.usuario_id, $1, now())          -- respeta horario silencioso
FROM alarma a
JOIN app.membresias m       ON m.espacio_id = $2
JOIN app.vinculos_telegram v ON v.usuario_id = m.usuario_id
WHERE app.quiere_aviso(m.usuario_id, $1, $3)
ON CONFLICT (clave_idempotencia) DO NOTHING;
```

El orden del enum `app.nivel` (`buena` < `regular` < `mala` < `critica`) permite comparar severidades directamente. `app.siguiente_envio` y `app.quiere_aviso` leen `preferencias_notificacion` (nodo específico primero, luego la preferencia por defecto).

**Consumo en `notifier`:**

```sql
UPDATE app.notificaciones_salida s
SET    intentos = intentos + 1
WHERE  s.id IN (
  SELECT id FROM app.notificaciones_salida
  WHERE  estado = 'pendiente' AND enviar_despues_de <= now()
  ORDER  BY enviar_despues_de
  LIMIT  50
  FOR UPDATE SKIP LOCKED
)
RETURNING s.*;
```

Tras enviar, marca `enviada`. Si Telegram falla, deja la fila `pendiente` con espera creciente en `enviar_despues_de` (30 s, 2 min, 10 min, 1 h). Después de 6 intentos la marca `fallida` y dispara la alerta interna. Si Telegram responde que el usuario bloqueó el bot, la marca `descartada` y borra el vínculo.

Se usa SQL con `SKIP LOCKED` y no una cola de Valkey porque la fila debe existir en la misma transacción que la alarma; varias instancias de `notifier` pueden trabajar a la vez sin enviar dos veces.

## Calibración, eventos de usuario y auditoría

```sql
-- 0007_calibracion_eventos_auditoria.sql
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
```

- `calibraciones` guarda el resultado y los puntos crudos; el firmware recibe los parámetros vigentes por el tópico `config`, no los lee de aquí.
- La comparación antes/después de RF-37 se resuelve con `evaluaciones_dia` y `lecturas_dia` en ventanas de 7 días alrededor de `ocurrido_en`; no necesita tablas extra.
- `auditoria` no tiene llaves foráneas a propósito: debe sobrevivir al borrado de cuentas y nodos. Al borrar una cuenta (RF-04) se conservan las acciones, pero `actor_id` queda apuntando a un usuario que ya no existe, sin datos personales.

## Aislamiento entre espacios

Tres mecanismos, uno por tipo de dato: RLS para tablas relacionales, vistas filtradas para series de tiempo y funciones `SECURITY DEFINER` para operaciones de varios pasos. Todos dependen de una sola variable de sesión, `app.usuario_id`, que la API fija al abrir cada transacción.

**Funciones base:**

```sql
-- 0008_aislamiento.sql
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
```

**Políticas RLS:**

```sql
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
```

**Series de tiempo:** la API no tiene permisos sobre `ts.*`. Lee por vistas que pertenecen a `lympha_owner` y filtran por los espacios del usuario; `security_barrier` impide que un filtro del usuario se evalúe antes que el de aislamiento.

```sql
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
```

**Operaciones privilegiadas:** validan permisos por dentro y hacen todo en una transacción. Son el único camino para estas acciones.

| Función | Hace | Valida |
| --- | --- | --- |
| `app.crear_espacio(nombre, tipo)` | Crea el espacio y la membresía de propietario | Usuario actual existe; máximo de espacios por usuario |
| `app.reclamar_nodo(device_id, codigo, espacio_id, perfil_id)` | Asigna el nodo, crea `estado_nodo`, escribe auditoría | Hash del código, estado fabricado o desvinculado, lote no revocado, usuario propietario del espacio |
| `app.desvincular_nodo(device_id)` | Quita el espacio y cierra alarmas abiertas | Usuario propietario |
| `app.aceptar_invitacion(token)` | Crea la membresía de miembro y marca la invitación usada | Token vigente y no usado |
| `app.transferir_propiedad(espacio_id, usuario_id)` | Intercambia roles | Usuario actual propietario; destino ya es miembro |
| `app.eliminar_mi_cuenta()` | Borra espacios donde es único miembro, membresías, preferencias y su fila de usuario | Usuario actual |

```sql
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
```

`app.claim_pepper` se fija por transacción desde la API (`set_config(..., true)`), igual que `app.usuario_id`; nunca se guarda en la base.

**Procesos internos (`lympha_system`):** tienen `BYPASSRLS`, pero solo los permisos que necesitan.

```sql
GRANT SELECT ON app.nodos, app.perfiles_uso, app.membresias, app.vinculos_telegram,
                app.preferencias_notificacion, app.lotes TO lympha_system;
GRANT SELECT, INSERT, UPDATE ON app.estado_nodo, app.alarmas, app.notificaciones_salida TO lympha_system;
GRANT INSERT ON ts.lecturas, ts.evaluaciones, app.auditoria TO lympha_system;
GRANT SELECT ON ts.lecturas, ts.evaluaciones TO lympha_system;     -- recuperar ventanas tras un reinicio
GRANT UPDATE (version_fw, estado) ON app.nodos TO lympha_system;
GRANT DELETE ON app.vinculos_telegram TO lympha_system;             -- usuario bloqueó el bot
```

## Consultas críticas e índices

Cada pantalla y cada proceso caliente tiene una consulta conocida y un índice que la sirve. Toda consulta nueva sobre estas tablas debe revisarse con `EXPLAIN ANALYZE` en staging antes de llegar a producción.

| Quién | Consulta | Lo sirve | Meta |
| --- | --- | --- | --- |
| Inicio (RF-22) | Estado de todos los nodos de un espacio | Valkey `nodo:{id}:estado`; si falta, `estado_nodo_espacio_idx` | < 20 ms |
| Detalle, últimas 24 h | `v_lecturas` por `nodo_id` y rango de `ts` | `lecturas_nodo_ts` + exclusión de chunks | < 100 ms |
| Historial 7 y 30 días (RF-35) | `v_evaluaciones_dia` por `nodo_id` y `dia` | Índice del agregado continuo en `(nodo_id, dia)` | < 50 ms |
| Historial 12 meses (RF-36) | `v_lecturas_hora` por `nodo_id` y `bucket` | Índice del agregado en `(nodo_id, bucket)` | < 200 ms |
| Alertas del espacio | `alarmas` por `espacio_id`, recientes primero | `alarmas_espacio_idx` | < 30 ms |
| `ingest`: resolver nodo | `deviceId` → espacio, perfil, estado | Valkey `nodo:{id}:meta`; si falta, PK de `nodos` | < 1 ms en caché |
| `ingest`: guardar lote | `INSERT ... ON CONFLICT DO NOTHING` de hasta 500 filas | `lecturas_nodo_ts` | < 50 ms por lote |
| `worker`: ventana del nodo | Últimas N lecturas | Valkey `nodo:{id}:ventana`; si falta, `lecturas_nodo_ts` | < 5 ms |
| `worker`: abrir alarma | UPSERT sobre la alarma abierta | `alarmas_una_abierta` | < 10 ms |
| `notifier`: pendientes | 50 filas con `SKIP LOCKED` | `salida_pendientes` (parcial) | < 10 ms |
| RLS: mis espacios | `membresias` por `usuario_id` | `membresias_usuario_idx` | < 1 ms |

**Índices de los agregados continuos:**

```sql
CREATE INDEX ON ts.lecturas_hora     (nodo_id, bucket DESC);
CREATE INDEX ON ts.lecturas_dia      (nodo_id, dia DESC);
CREATE INDEX ON ts.evaluaciones_dia  (nodo_id, dia DESC);
CREATE INDEX ON ts.lecturas_hora     (espacio_id, bucket DESC);
CREATE INDEX ON ts.evaluaciones_dia  (espacio_id, dia DESC);
```

**Ejemplo: nivel predominante de los últimos 30 días de un nodo**

```sql
SELECT dia,
       (ARRAY['buena','regular','mala','critica']::app.nivel[])[
         (SELECT i FROM unnest(ARRAY[n_buena, n_regular, n_mala, n_critica]) WITH ORDINALITY AS t(n, i)
          ORDER BY n DESC, i DESC LIMIT 1)
       ] AS nivel_predominante,
       wqi_prom
FROM app.v_evaluaciones_dia
WHERE nodo_id = $1
  AND dia >= date_trunc('day', now() AT TIME ZONE 'America/Mexico_City') - INTERVAL '29 days'
ORDER BY dia;
```

El `ORDER BY n DESC, i DESC` resuelve los empates hacia el nivel peor.

## Valkey

Valkey guarda solo lo que se puede perder o reconstruir: cachés, ventanas de cálculo, colas, límites de tasa y mensajes en tiempo real. Si se vacía, el sistema sigue funcionando y se recupera desde Postgres.

| Clave o canal | Tipo | TTL | Escribe | Lee | Contenido |
| --- | --- | --- | --- | --- | --- |
| `nodo:{id}:meta` | hash | 10 min | `ingest` (al fallar la caché) | `ingest`, `worker` | `espacio_id`, `perfil_id`, `perfil_version`, `estado` |
| `nodo:{id}:estado` | hash | — | `worker` | `api` | Nivel, WQI, conexión, última lectura, valores |
| `nodo:{id}:ventana` | lista | 2 h | `worker` | `worker` | Últimas 15 lecturas para la ventana móvil e histéresis |
| `nodo:{id}:seq` | string | 2 días | `ingest` | `ingest` | Último `seq` para detectar huecos |
| `bull:lecturas:*` | BullMQ | — | `ingest` | `worker` | Lotes de lecturas; `jobId = deviceId:seq` evita encolar dos veces |
| `bull:mantenimiento:*` | BullMQ | — | `worker`, `api` | `worker` | Trabajos diferidos: `offline:{nodo}`, `recordatorio:{alarma}` |
| `espacio:{id}` | canal pub/sub | — | `worker` | `api` (SSE) | Cambios de estado, lecturas y alarmas del espacio |
| `invalidar:nodo` | canal pub/sub | — | `api` | `ingest`, `worker` | `deviceId` cuyo `meta` cambió (reclamo, desvinculación, perfil) |
| `rl:api:{usuario}` | contador | 1 min | `api` | `api` | Rate limit por usuario |
| `rl:reclamo:{usuario}`, `rl:reclamo:{nodo}` | contador | 1 h | `api` | `api` | Máximo 5 intentos de reclamo |
| `tg:vincular:{token}` | string | 10 min | `api` | `api` (webhook) | `usuario_id` del deep link de Telegram |

**Desconexión de un nodo (RF-29):** cuando el broker publica `offline`, `worker` programa el trabajo diferido `offline:{nodo}` para el tiempo configurado. Si el nodo vuelve antes, lo cancela. Si el trabajo corre, abre la alarma `sin_conexion`.

**Bandeja de salida sin cola:** el plan mencionaba una cola `notificaciones`; se reemplaza por la tabla `notificaciones_salida` en Postgres. `notifier` revisa la tabla cada 2 s y despierta antes con `LISTEN lympha_salida`, que el worker dispara con `pg_notify` al confirmar la transacción.

**Configuración (`infra/valkey/valkey.conf`):**

```
appendonly yes
appendfsync everysec
maxmemory 1gb
# BullMQ exige noeviction: nunca debe expulsar claves de colas
maxmemory-policy noeviction
# solo AOF, sin snapshots RDB
save ""
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command DEBUG ""

# un usuario por proceso; el despliegue genera estas líneas desde una plantilla con las contraseñas reales
user default off
user api      on >${VALKEY_PW_API}      ~nodo:*:estado ~rl:* ~tg:* ~bull:mantenimiento:* &espacio:* &invalidar:* +@read +@write +@pubsub +@scripting -@dangerous
user ingest   on >${VALKEY_PW_INGEST}   ~nodo:* ~bull:lecturas:* &invalidar:* +@read +@write +@pubsub +@scripting -@dangerous
user worker   on >${VALKEY_PW_WORKER}   ~nodo:* ~bull:* &espacio:* &invalidar:* +@read +@write +@pubsub +@scripting -@dangerous
```

BullMQ usa scripts Lua, por eso cada usuario necesita `+@scripting`. Las ACL son defensa adicional: un proceso comprometido no puede leer las claves de otro.

## Mosquitto: Dynamic Security

El broker guarda sus clientes y roles en `dynamic-security.json`, dentro de su volumen. Postgres no guarda contraseñas MQTT: solo sabe qué nodos existen. El backend administra el broker publicando comandos en `$CONTROL/dynamic-security/v1` con el cliente `lympha-admin`.

**Versión mínima: Mosquitto 2.1.** Desde esa versión, Dynamic Security sustituye `%u` (usuario) y `%c` (client id) en las ACL. Eso permite un solo rol `nodo` para toda la flota en lugar de un rol por equipo. El plan de implementación decía 2.0.x; debe actualizarse.

| Cliente | Usuario | Roles | Uso |
| --- | --- | --- | --- |
| Cada nodo | `deviceId` (client id fijado igual) | `nodo` | Publica telemetría, atributos, estado y respuestas; recibe configuración y comandos |
| `lympha-ingest` | `lympha-ingest` | `ingest` | Lee todo lo que publican los nodos, con sesión persistente |
| `lympha-control` | `lympha-control` | `control` | `api` y `worker` publican `config` y `cmd` |
| `lympha-admin` | `lympha-admin` | `admin` | `api` y CLI de fábrica: altas, revocaciones |

| Rol | Tipo de ACL | Tópico | Permite |
| --- | --- | --- | --- |
| `nodo` | `publishClientSend` | `lympha/v1/d/%u/telemetry`, `.../attributes`, `.../status`, `.../cmd/ack` | Sí |
| `nodo` | `subscribePattern` | `lympha/v1/d/%u/config`, `lympha/v1/d/%u/cmd` | Sí |
| `nodo` | `publishClientReceive` | `lympha/v1/d/%u/#` | Sí |
| `ingest` | `subscribePattern` | `lympha/v1/d/+/telemetry`, `+/attributes`, `+/status`, `+/cmd/ack` | Sí |
| `ingest` | `publishClientReceive` | `lympha/v1/d/+/#` | Sí |
| `control` | `publishClientSend` | `lympha/v1/d/+/config`, `lympha/v1/d/+/cmd` | Sí |
| `admin` | `publishClientSend` y `subscribePattern` | `$CONTROL/dynamic-security/#` | Sí |
| `revocado` | todas | `#` | No (prioridad máxima) |

Todo lo que no está en la tabla se niega: `defaultACLAccess` en `false` para todos los tipos.

**Alta de un nodo** (la ejecuta el CLI de fábrica):

```json
{"commands": [
  {"command": "createClient", "username": "0192f3a7-...-7f3a", "clientid": "0192f3a7-...-7f3a",
   "password": "<aleatoria, 32 caracteres>", "roles": [{"rolename": "nodo"}],
   "groups": [{"groupname": "lote:0192f2c1-..."}]}
]}
```

**Revocaciones:**

- **Un nodo:** `disableClient` con su usuario. El broker lo desconecta y rechaza nuevas conexiones.
- **Un lote completo:** `addGroupRole` del rol `revocado` al grupo `lote:{id}`. Por prioridad, niega todo a los nodos del lote en segundos (RNF-03).
- **Rotar la credencial de un nodo:** `setClientPassword`. Solo se usa al reprogramar en fábrica, porque la contraseña vive en la partición `identity`.

**`mosquitto.conf`:**

```
per_listener_settings false

listener 8883
certfile /mosquitto/certs/fullchain.pem
keyfile  /mosquitto/certs/privkey.pem
tls_version tlsv1.2

# procesos internos en la red de Docker, sin TLS y sin exposición
listener 1883 0.0.0.0

allow_anonymous false
plugin /usr/lib/mosquitto_dynamic_security.so
plugin_opt_config_file /mosquitto/data/dynamic-security.json

persistence true
persistence_location /mosquitto/data/

# sesión persistente de lympha-ingest: el broker guarda QoS 1 mientras ingest se reinicia
max_queued_messages 200000
max_inflight_messages 100
persistent_client_expiration 2h
```

El puerto 1883 solo se publica en la red interna de Docker; el firewall no lo abre. `lympha-ingest` se conecta con `clean_start = false` y una suscripción compartida (`$share/ingest/...`) cuando haya más de una instancia.

## Migraciones, respaldos, mantenimiento y capacidad

**Migraciones:**

- Archivos numerados en `apps/server/migrations/`, en el orden de este documento: `0000_init` a `0008_aislamiento`, y luego uno por cambio.
- drizzle-kit genera el SQL de las tablas relacionales. Lo específico de TimescaleDB, RLS, vistas, funciones y permisos se escribe a mano en archivos SQL de la misma secuencia; drizzle-kit los ejecuta sin modificarlos.
- Corren como contenedor de una sola ejecución con `lympha_owner`, una transacción por archivo. `refresh_continuous_aggregate` no puede ir dentro de una transacción, así que se ejecuta aparte después de migrar, solo cuando hace falta.
- Regla expand/contract: ninguna migración rompe la versión anterior del código.
- Los `perfiles_uso` se cargan por migración de datos; cambiar una curva crea una versión nueva, no edita la anterior (RNF-24).
- CI aplica todas las migraciones sobre una base vacía y corre las pruebas de aislamiento encima.

**Respaldos:**

| Qué | Cómo | Frecuencia | Retención |
| --- | --- | --- | --- |
| Postgres (físico) | pgBackRest a S3: completo y diferencial, más archivado continuo de WAL | Completo semanal, diferencial diario, WAL continuo | 30 días; restauración a cualquier minuto |
| Postgres (lógico) | `pg_dump` en formato custom | Semanal | 8 semanas; para auditoría o migrar de proveedor |
| `dynamic-security.json` | Copia cifrada a S3 | Diaria y después de cada lote fabricado | 30 días |
| Valkey | Sin respaldo | — | Se reconstruye desde Postgres; el AOF cubre reinicios |

Restaurar un volcado lógico de TimescaleDB requiere llamar a `timescaledb_pre_restore()` antes y a `timescaledb_post_restore()` después; el runbook de restauración lo incluye. La prueba de restauración es trimestral (RNF-13).

**Mantenimiento automático:**

- Políticas de TimescaleDB: compresión, retención y refresco de agregados, ya definidas en las secciones anteriores.
- Trabajos con `add_job` de TimescaleDB, cada noche: borrar `notificaciones_salida` enviadas, descartadas o fallidas de más de 90 días, e `invitaciones` vencidas de más de 30 días.
- `estado_nodo` se actualiza en cada lectura: `fillfactor = 70` para que las actualizaciones sean HOT y `autovacuum_vacuum_scale_factor = 0.02`. Lo mismo para `notificaciones_salida`.

**Configuración de Postgres** (servidor de 8 GB compartido con el resto de los servicios):

```
shared_buffers = 2GB
effective_cache_size = 5GB
work_mem = 16MB
maintenance_work_mem = 512MB
max_connections = 100            # pools: api 15, ingest 5, worker 10, notifier 3, migraciones 2
max_worker_processes = 16
timescaledb.max_background_workers = 8
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=lympha archive-push %p'
random_page_cost = 1.1           # disco SSD
log_min_duration_statement = 500ms
```

Con menos de 40 conexiones en total no hace falta PgBouncer en el MVP.

**Capacidad estimada con 1,000 nodos a 1 lectura por minuto** (cifras aproximadas, a confirmar con la prueba de carga):

| Tabla | Filas | Espacio en disco |
| --- | --- | --- |
| `ts.lecturas` (30 días, comprimida desde el día 2) | \~43 millones | \~1 GB |
| `ts.evaluaciones` (90 días, comprimida desde el día 7) | \~130 millones | \~4 GB |
| `ts.lecturas_hora` (13 meses) | \~9.5 millones | \~2 GB |
| `ts.lecturas_dia`, `ts.evaluaciones_dia` | \~365,000 por año cada una | Menos de 200 MB por año |
| Tablas relacionales y auditoría | — | Menos de 1 GB |

El total ronda 8 GB, así que el volumen de 80 GB alcanza para varios miles de nodos. `evaluaciones` es lo que más crece; si hace falta, se puede guardar solo cuando cambia el nivel o cada 5 minutos, lo que la reduce más de 80 %. A partir de unos 10,000 nodos, Postgres pasa a su propio servidor, como indica el plan de implementación.
