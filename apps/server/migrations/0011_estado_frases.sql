-- 0011_estado_frases (H2): frase de causa y acción del estado actual del nodo (RF-20). La calcula el
-- worker junto con el nivel; la API solo la lee. Cambio aditivo (expand): la versión anterior del
-- código ignora las columnas nuevas.
ALTER TABLE app.estado_nodo
  ADD COLUMN causa  text,
  ADD COLUMN accion text;

-- Las curvas del perfil cisterna viven en el paquete @lympha/wqi (versionadas junto al algoritmo, un
-- solo archivo: packages/wqi/src/perfiles/cisterna.ts). Aquí queda solo la referencia, para que
-- quien mire la base no encuentre un marcador de "pendiente". Los otros tres perfiles siguen pendientes.
UPDATE app.perfiles_uso
SET config_wqi = '{"origen": "@lympha/wqi", "perfil": "cisterna", "version_algoritmo": "0.1-provisional", "provisional": true}'
WHERE id = 'cisterna';
