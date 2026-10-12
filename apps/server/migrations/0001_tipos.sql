-- 0001_tipos: tipos enumerados y utilidades compartidas.
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
