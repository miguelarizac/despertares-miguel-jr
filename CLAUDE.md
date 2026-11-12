# Despertares Miguel Jr.

Herramienta para registrar el sueño nocturno de Miguel Jr. (despertares, rutina de acostar, tomas…),
cuyos datos se pasan cada mañana al diario de sueño de las asesoras (Mimela Sleep).

- `server.js`: API en Node + Postgres, desplegada en Render (Frankfurt, plan gratuito) con
  `render.yaml`. Cada push a `main` la redespliega.
- `public/index.html`: la web (un solo fichero) que se usa desde el iPhone.
- `.github/workflows/keepalive.yml`: mantiene despierto el servidor de noche (Render gratuito se
  duerme a los 15 min).
- `ios/`: app nativa de iPhone. **Especificación completa en `docs/ios-app.md`**: léela antes de
  tocar nada de iOS.

Reglas:
- Responde a Miguel en español.
- Nunca escribas la clave de la app (`APP_KEY`) en el código ni en el repo.
- No rompas la API: la web y los Atajos de iOS dependen de ella.
- No dejes datos de prueba en la base de datos real.
