from __future__ import annotations
import json
import logging
from datetime import datetime

from application.ports import OpportunityRepository, LLMProvider, PageDeployer
from domain.rules import ALERT_SCORE_THRESHOLD

log = logging.getLogger(__name__)


class ValidateUseCase:
    def __init__(self, opp_repo: OpportunityRepository,
                 llm: LLMProvider, deployer: PageDeployer):
        self._opps = opp_repo
        self._llm = llm
        self._deployer = deployer

    def run(self, segments: list[str] | None = None,
            dry_run: bool = False, force: bool = False,
            threshold: float = ALERT_SCORE_THRESHOLD) -> list[dict]:
        opps = self._opps.get_all()
        target = segments or [o.segment for o in opps]
        deployed = []

        for opp in opps:
            if opp.segment not in target:
                continue
            if opp.score < threshold:
                log.info(f"  Skip {opp.segment} (score={opp.score:.1f} < {threshold})")
                continue
            if opp.landing_url and not force:
                log.info(f"  Skip {opp.segment} (landing exists, no force)")
                continue

            log.info(f"  Processing {opp.segment} (score={opp.score:.1f})")
            copy = self._synthesize(opp.segment)

            if not dry_run:
                try:
                    url = self._deployer.deploy(opp.segment, copy)
                    opp.landing_url = url
                    opp.status = "testing"
                    opp.last_updated = datetime.utcnow()
                    self._opps.upsert(opp)
                    deployed.append({"segment": opp.segment, "score": opp.score, "url": url})
                    log.info(f"    Deployed: {url}")
                except Exception as e:
                    log.error(f"    Deploy failed for {opp.segment}: {e}")
            else:
                deployed.append({"segment": opp.segment, "score": opp.score, "url": None})

        return deployed

    def _synthesize(self, segment: str) -> dict:
        from infrastructure.llm.prompts import SYNTHESIS_PROMPT, SECTOR_COPY
        try:
            prompt = SYNTHESIS_PROMPT.format(
                segment_label=segment,
                signals_text="(sin señales recientes)",
                top_keywords=segment,
                salary_mean="N/A",
                deadline_note="",
            )
            raw = self._llm.complete(prompt).strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:].strip()
            data = json.loads(raw)
            return {
                "title": data["headline"],
                "subtitle": data["subtitle"],
                "benefits": [(b["title"], b["desc"], b["emoji"]) for b in data["benefits"][:3]],
                "cta": data["cta"],
            }
        except Exception as e:
            log.warning(f"  LLM synthesis failed ({e}) — using SECTOR_COPY fallback")
            return SECTOR_COPY.get(segment, {})
