from __future__ import annotations
import os
import logging
import subprocess
from pathlib import Path

from application.ports import PageDeployer
from infrastructure.db.sqlite_repo import SqliteSignalRepo, SqliteOpportunityRepo
from infrastructure.db.worker_repo import WorkerSignalRepo, WorkerOpportunityRepo, available as worker_available
from infrastructure.llm.chain import LLMChain
from infrastructure.notifications import TelegramNotifier

log = logging.getLogger(__name__)

_PAGES_DIR = Path(__file__).parent / "pages"


class CloudflarePagesDeployer(PageDeployer):
    def deploy(self, segment: str, copy: dict) -> str:
        from infrastructure.pages.builder import build_html
        html = build_html(segment, copy)
        out = _PAGES_DIR / "landings" / f"{segment}.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(html, encoding="utf-8")
        project = os.environ.get("CF_PAGES_PROJECT", "market-intel")
        subprocess.run(
            ["npx", "wrangler", "pages", "deploy", str(_PAGES_DIR),
             "--project-name", project, "--commit-dirty=true"],
            capture_output=True, text=True, check=True,
        )
        domain = os.environ.get("CF_PAGES_DOMAIN", "market-intel.pages.dev")
        return f"https://{domain}/landings/{segment}.html"


class NoopDeployer(PageDeployer):
    def deploy(self, segment: str, copy: dict) -> str:
        log.info(f"[NOOP DEPLOYER] Would deploy {segment}")
        return f"https://dry-run.example/{segment}"


def build(dry_run: bool = False) -> dict:
    use_local = os.getenv("USE_LOCAL_DB") == "1" or not worker_available()
    if use_local:
        log.info("DB backend: SQLite (local)")
        signals = SqliteSignalRepo()
        opps = SqliteOpportunityRepo()
    else:
        log.info("DB backend: CF Worker")
        signals = WorkerSignalRepo()
        opps = WorkerOpportunityRepo()

    return {
        "signal_repo":  signals,
        "opp_repo":     opps,
        "llm":          LLMChain(),
        "notifier":     TelegramNotifier(),
        "deployer":     NoopDeployer() if dry_run else CloudflarePagesDeployer(),
    }
