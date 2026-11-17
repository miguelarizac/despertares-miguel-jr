"""
Herramientas de solo lectura sobre la base de datos de la app de despertares (despertares-db).

La conexión se abre siempre en modo solo lectura (default_transaction_read_only=on):
estas herramientas no pueden crear, modificar ni borrar registros.

Cada noche va de las 18:00 a las 17:59 del día siguiente (hora de Madrid) y se etiqueta con
la fecha de la tarde en que empieza, igual que la app (server.js).
"""

import csv
import io
import json
import os
from collections import OrderedDict
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import psycopg
from mcp.server.fastmcp import FastMCP

TZ = ZoneInfo("Europe/Madrid")
DB_URL = os.environ.get("BABY_DB_URL", "")
NO_DB = "No está configurada la base de datos de despertares (falta BABY_DB_URL en Render)."

# Mismas etiquetas que la web (public/index.html).
LABEL = {
    "bath": "Baño",
    "room_in": "Entra en habitación",
    "crib": "A la cuna",
    "room_out": "Sale de habitación",
    "asleep": "Se ha dormido",
    "wake": "Despertar",
    "resleep": "Vuelve a dormirse",
    "df": "Toma (DF)",
    "up": "Despertar mañana",
    "outcrib": "Fuera de la cuna",
}
BED = ["bath", "room_in", "crib", "room_out", "asleep"]

mcp = FastMCP("despertares-miguel-jr")


async def _query(sql: str, params: tuple = ()) -> list[tuple]:
    async with await psycopg.AsyncConnection.connect(
        DB_URL,
        options="-c default_transaction_read_only=on -c statement_timeout=20000",
        connect_timeout=15,
    ) as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            return await cur.fetchall()


def _night_key(ts: datetime) -> date:
    local = ts.astimezone(TZ)
    return (local - timedelta(days=1)).date() if local.hour < 18 else local.date()


def _hm(t: datetime | None) -> str:
    return t.astimezone(TZ).strftime("%H:%M") if t else "—"


def _summarize(night: date, events: list[tuple[datetime, str, str]]) -> str:
    lines = [f"Noche del {night.isoformat()}:"]

    seen: set[str] = set()
    routine = []
    for t, k, _ in events:
        if k in BED and k not in seen:
            seen.add(k)
            routine.append(f"{LABEL[k]} {_hm(t)}")
    if routine:
        lines.append("- Rutina: " + " · ".join(routine))

    up = next((t for t, k, _ in reversed(events) if k == "up"), None)
    outcrib = next((t for t, k, _ in reversed(events) if k == "outcrib"), None)
    lines.append(f"- Despertar mañana: {_hm(up)}" + (f" | Fuera de la cuna: {_hm(outcrib)}" if outcrib else ""))

    wakes: list[str] = []
    awake_minutes = 0
    open_wake: datetime | None = None
    for t, k, _ in events:
        if k == "wake":
            if open_wake:
                wakes.append(_hm(open_wake))
            open_wake = t
        elif k == "resleep" and open_wake:
            mins = int((t - open_wake).total_seconds() // 60)
            awake_minutes += mins
            wakes.append(f"{_hm(open_wake)}→{_hm(t)} ({mins} min)")
            open_wake = None
    if open_wake:
        wakes.append(_hm(open_wake))
    lines.append(f"- Despertares: {len(wakes)}" + (f" ({', '.join(wakes)})" if wakes else ""))
    if awake_minutes:
        lines.append(f"- Minutos despierto (con vuelta a dormir registrada): {awake_minutes}")

    feeds = [_hm(t) for t, k, _ in events if k == "df"]
    if feeds:
        lines.append(f"- Tomas (DF): {len(feeds)} ({', '.join(feeds)})")

    notes = [f"{_hm(t)} {n}" for t, _, n in events if n]
    if notes:
        lines.append(f"- Notas: {'; '.join(notes)}")
    return "\n".join(lines)


@mcp.tool()
async def get_baby_night_wakes(start_date: str | None = None, end_date: str | None = None) -> str:
    """Resumen por noche del sueño del bebé de Miguel (solo lectura): rutina de acostar,
    despertares (con vuelta a dormir), tomas, despertar de la mañana y notas.

    Úsalo para cruzar el sueño del bebé con la recuperación de Miguel (VFC, FC en reposo,
    sueño del Garmin). Cada noche va de las 18:00 a las 17:59 del día siguiente (Madrid).

    Args:
        start_date: primera noche, YYYY-MM-DD (por defecto, hace 7 días)
        end_date: última noche, YYYY-MM-DD (por defecto, anoche)
    """
    if not DB_URL:
        return NO_DB

    today = datetime.now(TZ).date()
    try:
        first = date.fromisoformat(start_date) if start_date else today - timedelta(days=7)
        last = date.fromisoformat(end_date) if end_date else today - timedelta(days=1)
    except ValueError:
        return "Fechas no válidas: usa el formato YYYY-MM-DD."
    if last < first:
        return "La fecha final es anterior a la inicial."
    if (last - first).days > 92:
        return "Pide como máximo 3 meses de una vez."

    since = datetime.combine(first, time(18, 0), TZ)
    until = datetime.combine(last + timedelta(days=1), time(18, 0), TZ)
    try:
        rows = await _query(
            "SELECT ts, kind, COALESCE(note, '') FROM wakes WHERE ts >= %s AND ts < %s ORDER BY ts",
            (since, until),
        )
    except Exception as exc:  # noqa: BLE001
        return f"No se pudo leer la base de datos de despertares: {type(exc).__name__}."

    nights: "OrderedDict[date, list]" = OrderedDict()
    d = first
    while d <= last:
        nights[d] = []
        d += timedelta(days=1)
    for ts, kind, note in rows:
        key = _night_key(ts)
        if key in nights:
            nights[key].append((ts, kind or "wake", note))

    return "\n\n".join(
        _summarize(n, ev) if ev else f"Noche del {n.isoformat()}: sin registros." for n, ev in nights.items()
    )


@mcp.tool()
async def export_baby_wakes_csv() -> str:
    """Copia de seguridad completa de la tabla `wakes` en CSV (solo lectura).

    Columnas: id, ts (ISO 8601 en UTC), kind, note, client_id, created_by, updated_by.
    Para importarla en una base nueva (después de arrancar la app, que crea las tablas):
    \\copy wakes (id, ts, kind, note, client_id, created_by, updated_by) FROM 'archivo.csv' CSV HEADER
    y luego SELECT setval('wakes_id_seq', (SELECT max(id) FROM wakes));
    """
    if not DB_URL:
        return NO_DB
    try:
        rows = await _query(
            "SELECT id, ts, kind, COALESCE(note, ''), COALESCE(client_id, ''), "
            "COALESCE(created_by, ''), COALESCE(updated_by, '') FROM wakes ORDER BY id"
        )
    except Exception as exc:  # noqa: BLE001
        return f"No se pudo leer la base de datos de despertares: {type(exc).__name__}."

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["id", "ts", "kind", "note", "client_id", "created_by", "updated_by"])
    for rid, ts, kind, note, cid, cby, uby in rows:
        # Vacío = NULL al importar con CSV (client_id tiene índice único: no puede ir como '').
        w.writerow([rid, ts.astimezone(timezone.utc).isoformat(), kind, note, cid, cby, uby])
    return f"Registros: {len(rows)}\n\n{buf.getvalue()}"


@mcp.tool()
async def export_baby_days_csv() -> str:
    """Copia de seguridad completa de la tabla `days` en CSV (solo lectura): datos de cada día
    de la hoja de las asesoras (siestas, etc.), guardados como JSON.

    Columnas: day (YYYY-MM-DD), data (JSON). Para importarla en una base nueva:
    \\copy days (day, data) FROM 'archivo.csv' CSV HEADER
    """
    if not DB_URL:
        return NO_DB
    try:
        rows = await _query("SELECT to_char(day, 'YYYY-MM-DD'), data FROM days ORDER BY day")
    except Exception as exc:  # noqa: BLE001
        return f"No se pudo leer la base de datos de despertares: {type(exc).__name__}."

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["day", "data"])
    for day, data in rows:
        w.writerow([day, json.dumps(data, ensure_ascii=False)])
    return f"Días: {len(rows)}\n\n{buf.getvalue()}"
