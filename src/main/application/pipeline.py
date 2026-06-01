from __future__ import annotations
import logging
from datetime import datetime

from application.collect import CollectUseCase
from application.score import ScoreUseCase
from application.validate import ValidateUseCase
from application.ports import (
    SignalRepository, OpportunityRepository,
    LLMProvider, Notifier, PageDeployer, Collector,
)

log = logging.getLogger(__name__)


class Pipeline:
    def __init__(self, signal_repo: SignalRepository, opp_repo: OpportunityRepository,
                 llm: LLMProvider, notifier: Notifier, deployer: PageDeployer,
                 collectors: list[Collector] | None = None):
        self._collect = CollectUseCase(collectors or [], signal_repo)
        self._score = ScoreUseCase(signal_repo, opp_repo, notifier)
        self._validate = ValidateUseCase(opp_repo, llm, deployer)

    def run(self, segments: list[str] | None = None, skip_collect: bool = False,
            dry_run: bool = False, force: bool = False,
            threshold: float = 7.0) -> dict:
        log.info(f"\n{'='*55}\nPIPELINE START — {datetime.utcnow().isoformat()}\n{'='*55}")

        if not skip_collect:
            collected = self._collect.run(segments=segments)
            log.info(f"Collected: {collected}")

        scored = self._score.run(segments=segments, dry_run=dry_run)
        log.info(f"Scored: {[(r['segment'], r['score']) for r in scored]}")

        deployed = self._validate.run(
            segments=segments, dry_run=dry_run, force=force, threshold=threshold
        )
        log.info(f"Deployed: {deployed}")

        return {"scored": scored, "deployed": deployed}
