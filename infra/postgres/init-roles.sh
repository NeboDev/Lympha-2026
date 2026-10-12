#!/bin/sh
# Inicialización idempotente de Postgres: extensiones, roles, contraseñas, esquemas y ajustes por rol.
#
# Se ejecuta como superusuario:
#   - la primera vez, desde /docker-entrypoint-initdb.d (el entrypoint de la imagen);
#   - en producción y para rotar contraseñas, a mano o desde el despliegue, con las variables
#     de libpq (PGHOST, PGUSER, PGPASSWORD, PGDATABASE) apuntando al servidor.
#
# Variables requeridas: PW_OWNER, PW_APP, PW_SYSTEM, PW_BACKUP.
# Es seguro correrlo más de una vez: crea lo que falta y actualiza las contraseñas.
set -eu

for v in PW_OWNER PW_APP PW_SYSTEM PW_BACKUP; do
  eval "valor=\${$v:-}"
  if [ -z "$valor" ]; then
    echo "init-roles: falta la variable $v" >&2
    exit 1
  fi
done

# Dentro del entrypoint de la imagen usamos las variables POSTGRES_*; fuera, las de libpq.
: "${PGUSER:=${POSTGRES_USER:-postgres}}"
: "${PGDATABASE:=${POSTGRES_DB:-postgres}}"
export PGUSER PGDATABASE

psql -v ON_ERROR_STOP=1 \
  -v pw_owner="$PW_OWNER" -v pw_app="$PW_APP" -v pw_system="$PW_SYSTEM" -v pw_backup="$PW_BACKUP" \
  <<'SQL'
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Roles: se crean si faltan y siempre se actualiza la contraseña (rotación).
SELECT format('CREATE ROLE %I LOGIN', r) FROM (VALUES ('lympha_owner'), ('lympha_app'),
  ('lympha_system'), ('lympha_backup')) AS t(r)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) \gexec

SELECT format('ALTER ROLE lympha_owner  PASSWORD %L', :'pw_owner') \gexec
SELECT format('ALTER ROLE lympha_app    PASSWORD %L', :'pw_app') \gexec
SELECT format('ALTER ROLE lympha_system PASSWORD %L', :'pw_system') \gexec
SELECT format('ALTER ROLE lympha_backup PASSWORD %L', :'pw_backup') \gexec

-- Ninguno es superusuario; solo lympha_system omite RLS (con permisos tabla por tabla).
ALTER ROLE lympha_owner  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE lympha_app    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
ALTER ROLE lympha_system NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
ALTER ROLE lympha_backup NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT pg_read_all_data TO lympha_backup;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT CONNECT ON DATABASE %I TO lympha_owner, lympha_app, lympha_system, lympha_backup',
              current_database()) \gexec
SELECT format('REVOKE CONNECT, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()) \gexec

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION lympha_owner;
CREATE SCHEMA IF NOT EXISTS ts  AUTHORIZATION lympha_owner;

-- pgcrypto (digest) y citext viven en app: las funciones SECURITY DEFINER fijan search_path = app, pg_temp,
-- y public queda cerrado para todos salvo para el dueño (TimescaleDB vive en public).
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA app;
CREATE EXTENSION IF NOT EXISTS citext   SCHEMA app;
GRANT USAGE ON SCHEMA public TO lympha_owner;

ALTER ROLE lympha_owner  SET search_path = app, ts, public, pg_catalog;
ALTER ROLE lympha_app    SET search_path = app, pg_catalog;
ALTER ROLE lympha_system SET search_path = app, ts, pg_catalog;
ALTER ROLE lympha_app    SET statement_timeout = '5s';
ALTER ROLE lympha_system SET statement_timeout = '30s';
SQL

echo "init-roles: listo"
