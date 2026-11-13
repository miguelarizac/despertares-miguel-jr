# Despertares Miguel Jr.

Herramienta para registrar el sueño nocturno de Miguel Jr. (despertares, rutina de acostar, tomas…),
cuyos datos se pasan cada mañana al diario de sueño de las asesoras (Mimela Sleep).

- `server.js`: API en Node + Postgres, desplegada en Render (Frankfurt, plan gratuito) con
  `render.yaml`. Cada push a `main` la redespliega.
- `public/index.html`: la web (un solo fichero) que se usa desde el iPhone.
- `public/sw.js`: guarda la web en el móvil para que abra al instante aunque Render esté dormido.
  La web apunta cada cambio en el móvil (con hora exacta y `client_id`) y lo envía cuando el
  servidor responde; si Render duerme, lo despierta cargando su página de espera en un iframe.
- `.github/workflows/keepalive.yml`: DESACTIVADO. Los avisos externos (GitHub, cron-job.org) no
  despiertan Render gratuito: responde con su página de espera, que solo arranca el servicio en un
  navegador.
- Claves: `APP_KEYS` = `Nombre:clave,Nombre:clave` (una por persona; se guarda quién crea, edita o
  borra cada dato, en `wakes.created_by/updated_by`, `days.data._by` y la tabla `changes`).
  `APP_KEY` es la clave compartida antigua: sigue valiendo y figura como «Sin identificar».
- `ios/`: app nativa de iPhone. **Especificación completa en `docs/ios-app.md`**: léela antes de
  tocar nada de iOS.

Reglas:
- Responde a Miguel en español.
- Nunca escribas las claves de la app (`APP_KEY`, `APP_KEYS`) en el código ni en el repo.
- No rompas la API: la web y los Atajos de iOS dependen de ella.
- No dejes datos de prueba en la base de datos real.
