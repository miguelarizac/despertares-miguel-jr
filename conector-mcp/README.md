# Conector MCP de despertares (solo lectura)

Servidor MCP (Model Context Protocol) para que Claude lea los datos de la app de despertares.
Es un servicio aparte en Render (`despertares-mcp-miguel`, Python, Frankfurt, plan gratuito);
no forma parte de la app ni de su API.

Herramientas (todas de solo lectura; la conexión abre transacciones `read only`):

- `get_baby_night_wakes(start_date, end_date)`: resumen por noche (rutina, despertares con
  vuelta a dormir, tomas, despertar de la mañana, notas).
- `export_baby_wakes_csv()`: copia completa de la tabla `wakes`.
- `export_baby_days_csv()`: copia completa de la tabla `days`.

Render:

- Build: `pip install -r conector-mcp/requirements.txt`
- Start: `python conector-mcp/app.py`
- Health check: `/healthz`
- URL del conector: `https://despertares-mcp-miguel.onrender.com/mcp`, con el encabezado
  `X-API-Key: <MCP_AUTH_TOKEN>`
- Variables: `BABY_DB_URL` (Internal Database URL de despertares-db), `MCP_AUTH_TOKEN`
  (mín. 32 caracteres), `PYTHON_VERSION`. Nunca subir valores reales al repositorio.

Si cambia la tabla `wakes` o `days` en `server.js`, revisa este conector.
