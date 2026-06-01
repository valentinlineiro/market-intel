from __future__ import annotations
import logging
from application.ports import Collector, SignalRepository
from domain.models import ActiveSegment

log = logging.getLogger(__name__)


class CollectUseCase:
    def __init__(self, collectors: list[Collector], signal_repo: SignalRepository):
        self._collectors = collectors
        self._repo = signal_repo

    def run(self, segments: list[ActiveSegment]) -> dict[str, int]:
        totals: dict[str, int] = {}
        for seg in segments:
            count = 0
            for collector in self._collectors:
                try:
                    signals = collector(seg.key, seg.keywords)
                    for s in signals:
                        if self._repo.save(s):
                            count += 1
                except Exception as e:
                    log.error(f"Collector failed for {seg.key}: {e}")
            totals[seg.key] = count
            log.info(f"  {seg.key}: {count} new signals")
        return totals
