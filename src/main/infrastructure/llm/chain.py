import os
import logging
import requests
from application.ports import LLMProvider

log = logging.getLogger(__name__)

_PROVIDERS = [
    {"name": "groq", "env_key": "GROQ_API_KEY",
     "url": "https://api.groq.com/openai/v1/chat/completions",
     "model": os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"), "type": "openai"},
    {"name": "openrouter", "env_key": "OPENROUTER_API_KEY",
     "url": "https://openrouter.ai/api/v1/chat/completions",
     "model": os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.1-8b-instruct:free"), "type": "openai"},
    {"name": "anthropic", "env_key": "ANTHROPIC_API_KEY",
     "url": "https://api.anthropic.com/v1/messages",
     "model": "claude-sonnet-4-20250514", "type": "anthropic"},
]


class LLMChain(LLMProvider):
    def complete(self, prompt: str, max_tokens: int = 1024) -> str:
        errors = []
        for p in _PROVIDERS:
            api_key = os.getenv(p["env_key"])
            if not api_key:
                continue
            try:
                if p["type"] == "anthropic":
                    return _call_anthropic(api_key, p["model"], prompt, max_tokens)
                return _call_openai(api_key, p, prompt, max_tokens)
            except Exception as e:
                log.warning(f"  {p['name']} failed: {e}")
                errors.append(f"{p['name']}: {e}")
        raise RuntimeError(f"No LLM provider available. Errors: {'; '.join(errors)}")


def _call_openai(api_key: str, provider: dict, prompt: str, max_tokens: int) -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if provider["name"] == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/valentinlineiro/market-intel"
        headers["X-Title"] = "market-intel"
    resp = requests.post(provider["url"], headers=headers,
        json={"model": provider["model"], "max_tokens": max_tokens,
              "messages": [{"role": "user", "content": prompt}]}, timeout=30)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _call_anthropic(api_key: str, model: str, prompt: str, max_tokens: int) -> str:
    resp = requests.post("https://api.anthropic.com/v1/messages",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": model, "max_tokens": max_tokens,
              "messages": [{"role": "user", "content": prompt}]}, timeout=30)
    resp.raise_for_status()
    return resp.json()["content"][0]["text"]
