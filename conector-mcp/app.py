"""
Conector MCP (Model Context Protocol) de solo lectura para la app de despertares, en Render.

- Escucha en 0.0.0.0:$PORT.
- Endpoint MCP en /mcp, protegido con el encabezado X-API-Key (MCP_AUTH_TOKEN).
  Sin el encabezado correcto devuelve 401; cualquier otra ruta, 404.
- /healthz para el chequeo de salud de Render.
- Valida la cabecera Host contra el dominio de Render (protección DNS rebinding).

Variables de entorno:
  BABY_DB_URL        "Internal Database URL" de despertares-db (secreta)
  MCP_AUTH_TOKEN     token aleatorio largo (mín. 32 caracteres) que Claude envía en X-API-Key
  RENDER_EXTERNAL_HOSTNAME, PORT  los rellena Render
"""

import hmac
import json
import os
import sys

import uvicorn
from mcp.server.transport_security import TransportSecuritySettings
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from despertares import mcp

MCP_PATH = "/mcp"
HEADER_NAME = b"x-api-key"

AUTH_TOKEN = os.environ.get("MCP_AUTH_TOKEN", "")
if len(AUTH_TOKEN) < 32:
    sys.exit("MCP_AUTH_TOKEN debe tener al menos 32 caracteres.")

host_name = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "localhost")

mcp.settings.host = "0.0.0.0"
mcp.settings.port = int(os.environ.get("PORT", "8000"))
mcp.settings.streamable_http_path = MCP_PATH
mcp.settings.stateless_http = True  # sobrevive a reinicios de Render sin sesiones colgadas
mcp.settings.transport_security = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=[host_name, f"{host_name}:*", "localhost:*", "127.0.0.1:*"],
    allowed_origins=[f"https://{host_name}", "https://claude.ai", "https://claude.com"],
)

inner_app = mcp.streamable_http_app()


async def healthz(_request):
    return PlainTextResponse("ok")


inner_app.router.routes.append(Route("/healthz", healthz, methods=["GET"]))


async def _send_json(send, status: int, body: dict) -> None:
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json")]})
    await send({"type": "http.response.body", "body": json.dumps(body).encode()})


def _header_ok(scope) -> bool:
    for name, value in scope.get("headers", []):
        if name.lower() == HEADER_NAME:
            return hmac.compare_digest(value, AUTH_TOKEN.encode())
    return False


async def app(scope, receive, send):
    """Puerta de entrada: autentica antes de llegar al servidor MCP."""
    if scope["type"] != "http":
        return await inner_app(scope, receive, send)
    path = scope.get("path", "")
    if path == "/healthz":
        return await inner_app(scope, receive, send)
    if path in (MCP_PATH, MCP_PATH + "/"):
        if _header_ok(scope):
            return await inner_app(scope, receive, send)
        return await _send_json(send, 401, {"error": "unauthorized"})
    return await _send_json(send, 404, {"error": "not found"})


if __name__ == "__main__":
    print(f"Conector MCP de despertares escuchando en el puerto {mcp.settings.port}")
    uvicorn.run(app, host="0.0.0.0", port=mcp.settings.port, log_level="info",
                access_log=False, proxy_headers=True, forwarded_allow_ips="*")
