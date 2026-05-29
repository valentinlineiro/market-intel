"""
db/worker_client.py

Cliente Python para el Worker API.
Mismo contrato que d1.py pero llama al Worker en vez de a la API REST de CF.

Vars requeridas:
  WORKER_URL     — https://market-intel-api.{subdomain}.workers.dev
  WORKER_SECRET  — mismo valor que el secret del Worker
"""

import os
import json
import logging
import requests

log = logging.getLogger(__name__)

_SESSION = requests.Session()


def _url(path: str) -> str:
    base = os.environ["WORKER_URL"].rstrip("/")
    return f"{base}{path}"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {os.environ['WORKER_SECRET']}",
        "Content-Type":  "application/json",
    }


def get(path: str, params: dict | None = None) -> dict:
    r = _SESSION.get(_url(path), headers=_headers(), params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def post(path: str, body: dict) -> dict:
    r = _SESSION.post(_url(path), headers=_headers(), json=body, timeout=15)
    r.raise_for_status()
    return r.json()


def available() -> bool:
    return bool(os.environ.get("WORKER_URL") and os.environ.get("WORKER_SECRET"))
