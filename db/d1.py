"""
db/d1.py

Backend D1 para producción/CI. Misma interfaz que database.py pero
sobre Cloudflare D1 via REST API.

Vars requeridas:
  CLOUDFLARE_API_TOKEN   — token con permisos D1
  CLOUDFLARE_ACCOUNT_ID  — account ID de Cloudflare
  CF_D1_DATABASE_ID      — ID de la base de datos D1

Setup (una vez):
  wrangler d1 create market-intel
  → copia el database_id a CF_D1_DATABASE_ID

Migración del esquema:
  wrangler d1 execute market-intel --file=schema.sql
"""

import os
import json
import logging
import requests
from typing import Optional

log = logging.getLogger(__name__)

_BASE = "https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{db_id}/query"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {os.environ['CLOUDFLARE_API_TOKEN']}",
        "Content-Type":  "application/json",
    }


def _url() -> str:
    return _BASE.format(
        account_id=os.environ["CLOUDFLARE_ACCOUNT_ID"],
        db_id=os.environ["CF_D1_DATABASE_ID"],
    )


def execute(sql: str, params: list | None = None) -> list[dict]:
    """
    Ejecuta una query SQL en D1. Retorna lista de filas como dicts.
    Para INSERT/UPDATE/DELETE retorna lista vacía.
    """
    body: dict = {"sql": sql}
    if params:
        body["params"] = params

    resp = requests.post(_url(), headers=_headers(), json=body, timeout=15)
    resp.raise_for_status()

    data = resp.json()
    if not data.get("success"):
        errors = data.get("errors", [])
        raise RuntimeError(f"D1 error: {errors}")

    results = data.get("result", [{}])
    return results[0].get("results", [])


def executemany(sql: str, params_list: list[list]) -> None:
    """Ejecuta la misma query con múltiples sets de parámetros."""
    for params in params_list:
        execute(sql, params)


def available() -> bool:
    """True si todas las vars necesarias están configuradas."""
    return all(
        os.environ.get(k)
        for k in ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CF_D1_DATABASE_ID")
    )
