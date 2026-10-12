# Plantilla de configuración de Valkey. entrypoint.sh sustituye las contraseñas desde el entorno
# y escribe el resultado en /tmp; la plantilla nunca contiene secretos.
appendonly yes
appendfsync everysec
dir /data
maxmemory 1gb
# BullMQ exige noeviction: nunca debe expulsar claves de colas
maxmemory-policy noeviction
# solo AOF, sin snapshots RDB
save ""
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command DEBUG ""

# Un usuario por proceso. BullMQ usa scripts Lua (+@scripting) , MULTI/EXEC (+@transaction) y consulta INFO al conectar (+info).
user default off
user api      on >${VALKEY_PW_API}      ~nodo:*:estado ~rl:* ~tg:* ~bull:mantenimiento:* &espacio:* &invalidar:* +@read +@write +@pubsub +@scripting +@connection +@transaction -@dangerous +info
user ingest   on >${VALKEY_PW_INGEST}   ~nodo:* ~bull:lecturas:* &invalidar:* +@read +@write +@pubsub +@scripting +@connection +@transaction -@dangerous +info
user worker   on >${VALKEY_PW_WORKER}   ~nodo:* ~bull:* &espacio:* &invalidar:* +@read +@write +@pubsub +@scripting +@connection +@transaction -@dangerous +info
