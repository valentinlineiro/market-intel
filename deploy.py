"""
deploy.py

Despliega landings generadas a Cloudflare Pages via wrangler CLI.
Todas las landings van al mismo proyecto Pages en subdirectorios por segmento.

Requiere:
  wrangler instalado y autenticado:  npm i -g wrangler && wrangler login
  CF_PAGES_PROJECT  — nombre del proyecto (default: market-intel)
  CF_PAGES_DOMAIN   — dominio base (default: market-intel.pages.dev)

Vars opcionales:
  CF_SIGNUP_WORKER_URL — URL del Worker o Pages Function para signup.
                         Si está vacía, el form apunta a /signup (Pages Function local).

Uso:
  python deploy.py --segment dentista
  python deploy.py --all
"""

import os
import sys
import shutil
import subprocess
import logging
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from schema import SEGMENTS

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [deploy] %(message)s")

DIST_DIR   = Path(__file__).parent / "dist"
CF_PROJECT = os.getenv("CF_PAGES_PROJECT", "market-intel")
CF_DOMAIN  = os.getenv("CF_PAGES_DOMAIN",  "market-intel.pages.dev")

# URL del endpoint de signup. Si está vacía se usa /signup (Pages Function en mismo dominio).
SIGNUP_URL = os.getenv("CF_SIGNUP_WORKER_URL", "")


def _patch_signup_url(html: str) -> str:
    """
    Si CF_SIGNUP_WORKER_URL está definida, sustituye el endpoint /signup
    por la URL del Worker externo. Sin esa var, /signup funciona via
    Pages Function (functions/signup.js en el mismo dominio).
    """
    if not SIGNUP_URL:
        return html
    html = html.replace("fetch('/signup'",   f"fetch('{SIGNUP_URL}'")
    html = html.replace('action="/signup"',   f'action="{SIGNUP_URL}"')
    return html


def _check_wrangler():
    result = subprocess.run(["wrangler", "--version"], capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            "wrangler no encontrado. Instala con: npm install -g wrangler\n"
            "Luego autentícate con: wrangler login"
        )


def deploy(html_path: Path, segment: str) -> str:
    """
    Copia html_path a dist/{segment}/index.html, parchea signup URL,
    y ejecuta wrangler pages deploy.

    Retorna la URL pública del segmento deployado.
    """
    _check_wrangler()

    dest = DIST_DIR / segment / "index.html"
    dest.parent.mkdir(parents=True, exist_ok=True)

    html = html_path.read_text(encoding="utf-8")
    html = _patch_signup_url(html)
    dest.write_text(html, encoding="utf-8")
    log.info(f"  dist/{segment}/index.html escrito ({len(html)} chars)")

    log.info(f"  Ejecutando wrangler pages deploy → {CF_PROJECT}...")
    result = subprocess.run(
        [
            "wrangler", "pages", "deploy", str(DIST_DIR),
            "--project-name", CF_PROJECT,
            "--commit-dirty=true",
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        log.error(f"  wrangler stderr:\n{result.stderr}")
        raise RuntimeError(f"wrangler falló (código {result.returncode}): {result.stderr[:300]}")

    url = f"https://{CF_DOMAIN}/{segment}/"
    log.info(f"  Deploy OK → {url}")
    return url


def deploy_all() -> dict[str, str]:
    """Despliega todas las landings en dist/. Útil tras regeneración masiva."""
    _check_wrangler()
    results: dict[str, str] = {}

    for seg_dir in sorted(DIST_DIR.iterdir()):
        if not seg_dir.is_dir():
            continue
        html_path = seg_dir / "index.html"
        if not html_path.exists():
            continue
        try:
            url = deploy(html_path, seg_dir.name)
            results[seg_dir.name] = url
        except Exception as e:
            log.error(f"  {seg_dir.name}: {e}")
            results[seg_dir.name] = f"ERROR: {e}"

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Deploy landings a Cloudflare Pages")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--segment", choices=list(SEGMENTS.keys()),
                       help="Segmento concreto a desplegar")
    group.add_argument("--all", action="store_true",
                       help="Despliega todas las landings en dist/")
    args = parser.parse_args()

    if args.all:
        results = deploy_all()
        for seg, url in results.items():
            print(f"  {seg:30} → {url}")
    else:
        html_path = Path(__file__).parent / f"landing_{args.segment}.html"
        if not html_path.exists():
            print(f"Error: no existe landing_{args.segment}.html")
            print(f"Genera primero con: python generate_landing.py --segment {args.segment}")
            sys.exit(1)
        url = deploy(html_path, args.segment)
        print(url)
