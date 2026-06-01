from __future__ import annotations
import logging
from application.ports import Collector, SignalRepository
from domain.segments import SEGMENTS

log = logging.getLogger(__name__)


class CollectUseCase:
    def __init__(self, collectors: list[Collector], signal_repo: SignalRepository):
        self._collectors = collectors
        self._repo = signal_repo

    def run(self, segments: list[str] | None = None) -> dict[str, int]:
        target = segments or list(SEGMENTS.keys())
        totals: dict[str, int] = {}

        for segment in target:
            count = 0
            for collector in self._collectors:
                try:
                    signals = collector(segment)
                    for s in signals:
                        if self._repo.save(s):
                            count += 1
                except Exception as e:
                    log.error(f"Collector failed for {segment}: {e}")
            totals[segment] = count
            log.info(f"  {segment}: {count} new signals")

        return totals
