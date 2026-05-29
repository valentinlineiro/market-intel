"""
llm.py

Thin LLM client. Selecciona proveedor automáticamente según keys disponibles.
Prioridad: Groq (gratis, rápido) → OpenRouter (gratis) → Anthropic (de pago).

Groq:        console.groq.com     → GROQ_API_KEY
OpenRouter:  openrouter.ai        → OPENROUTER_API_KEY
Anthropic:   console.anthropic.com → ANTHROPIC_API_KEY

Vars opcionales para cambiar modelo por defecto:
  GROQ_MODEL        (default: llama-3.1-8b-instant)
  OPENROUTER_MODEL  (default: meta-llama/llama-3.1-8b-instruct:free)
"""

import os
import logging
import requests

log = logging.getLogger(__name__)

# ── Configuración de proveedores ───────────────────────────────────────────

_PROVIDERS = [
    {
        "name":    "groq",
        "env_key": "GROQ_API_KEY",
        "url":     "https://api.groq.com/openai/v1/chat/completions",
        "model":   os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
        "type":    "openai",
    },
    {
        "name":    "openrouter",
        "env_key": "OPENROUTER_API_KEY",
        "url":     "https://openrouter.ai/api/v1/chat/completions",
        "model":   os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.1-8b-instruct:free"),
        "type":    "openai",
    },
    {
        "name":    "anthropic",
        "env_key": "ANTHROPIC_API_KEY",
        "url":     "https://api.anthropic.com/v1/messages",
        "model":   "claude-sonnet-4-20250514",
        "type":    "anthropic",
    },
]


# ── API pública ────────────────────────────────────────────────────────────

def call(prompt: str, system: str = "", max_tokens: int = 1024) -> str:
    """
    Llama al primer proveedor disponible (con API key configurada).
    Retorna el texto de la respuesta.
    Lanza RuntimeError si todos fallan o ninguno está configurado.
    """
    errors = []

    for p in _PROVIDERS:
        api_key = os.getenv(p["env_key"])
        if not api_key:
            continue

        log.debug(f"  LLM → {p['name']} ({p['model']})")
        try:
            if p["type"] == "anthropic":
                return _call_anthropic(api_key, p["model"], prompt, system, max_tokens)
            else:
                return _call_openai(api_key, p, prompt, system, max_tokens)
        except Exception as e:
            log.warning(f"  {p['name']} falló: {e}")
            errors.append(f"{p['name']}: {e}")
            continue

    raise RuntimeError(
        "Ningún LLM provider disponible.\n"
        "Configura al menos una key en .env:\n"
        "  GROQ_API_KEY        — gratis en console.groq.com\n"
        "  OPENROUTER_API_KEY  — gratis en openrouter.ai\n"
        "  ANTHROPIC_API_KEY   — de pago\n"
        + (f"Errores previos: {'; '.join(errors)}" if errors else "")
    )


def active_provider() -> str | None:
    """Devuelve el nombre del primer proveedor con key configurada. None si ninguno."""
    for p in _PROVIDERS:
        if os.getenv(p["env_key"]):
            return p["name"]
    return None


# ── Implementaciones ───────────────────────────────────────────────────────

def _call_openai(api_key: str, provider: dict, prompt: str, system: str, max_tokens: int) -> str:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
    }
    # OpenRouter requiere estos headers para trazabilidad (evita rate-limit agresivo)
    if provider["name"] == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/valentinlineiro/market-intel"
        headers["X-Title"]      = "market-intel"

    resp = requests.post(
        provider["url"],
        headers=headers,
        json={
            "model":      provider["model"],
            "max_tokens": max_tokens,
            "messages":   messages,
        },
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    # Algunos modelos devuelven finish_reason="length" — avisamos pero no fallamos
    choice = data["choices"][0]
    if choice.get("finish_reason") == "length":
        log.warning(f"  {provider['name']}: respuesta truncada por max_tokens={max_tokens}")

    return choice["message"]["content"]


def _call_anthropic(api_key: str, model: str, prompt: str, system: str, max_tokens: int) -> str:
    body: dict = {
        "model":      model,
        "max_tokens": max_tokens,
        "messages":   [{"role": "user", "content": prompt}],
    }
    if system:
        body["system"] = system

    resp = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key":         api_key,
            "anthropic-version": "2023-06-01",
            "content-type":      "application/json",
        },
        json=body,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]
