-- 0009_perfiles_uso: perfiles de uso (migración de datos). Las curvas y pesos reales se definen en H2
-- con un especialista; por ahora config_wqi lleva un marcador. Cambiar una curva crea una versión
-- nueva, no edita la anterior (RNF-24).
INSERT INTO app.perfiles_uso (id, nombre, version, config_wqi, reglas_alarma) VALUES
  ('cisterna', 'Cisterna / doméstico', 1, '{"pendiente": true}', '{"pendiente": true}'),
  ('beber',    'Beber',                1, '{"pendiente": true}', '{"pendiente": true}'),
  ('alberca',  'Alberca',              1, '{"pendiente": true}', '{"pendiente": true}'),
  ('riego',    'Riego',                1, '{"pendiente": true}', '{"pendiente": true}');
