-- 0000_init: permisos de esquema.
-- Extensiones, roles, contraseñas y esquemas los crea infra/postgres/init-roles.sh (como superusuario,
-- idempotente) porque CREATE ROLE ... PASSWORD y CREATE EXTENSION no pueden correr con lympha_owner.
GRANT USAGE ON SCHEMA app, ts TO lympha_app, lympha_system;
