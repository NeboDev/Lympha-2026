# Secretos cifrados (SOPS + age)

Aquí viven `staging.enc.env` y `production.enc.env`, cifrados con SOPS y una llave age **por entorno**.
Los archivos cifrados sí se versionan; las llaves privadas **nunca**.

- La llave privada de producción vive solo en `prod-1` (`/srv/lympha/keys/production.age`, permisos 600) y
  en tu gestor de contraseñas. La de staging, en `staging-1` y en el gestor.
- `infra/deploy.sh` descifra en el servidor y exporta las variables al entorno del proceso; no se escribe
  ningún archivo de entorno en disco ni entra nada a las imágenes.
- Los valores deben usar solo `A-Za-z0-9._:/@+=,-` (genera contraseñas con `openssl rand -hex 24`):
  `deploy.sh` rechaza cualquier otra cosa para no interpretar los secretos como shell.

## Primera vez

```bash
age-keygen -o staging.age            # imprime la llave pública (age1...)
# pon esa llave pública en .sops.yaml, en la regla de staging
cp infra/secrets/staging.env.example /tmp/staging.env   # rellena los valores
sops encrypt --input-type dotenv --output-type dotenv /tmp/staging.env > infra/secrets/staging.enc.env
shred -u /tmp/staging.env
```

Editar después: `SOPS_AGE_KEY_FILE=staging.age sops infra/secrets/staging.enc.env`.

## Rotación

Contraseñas de base de datos y MQTT cada 6 meses o ante cualquier sospecha; el token de Telegram, solo ante
sospecha. Para Postgres: cambia `PW_*` en el archivo cifrado, despliega y corre
`infra/postgres/init-roles.sh` con los valores nuevos (es idempotente y solo actualiza contraseñas).
Para Mosquitto: `mqtt-bootstrap` actualiza las contraseñas de los clientes internos en cada despliegue.
