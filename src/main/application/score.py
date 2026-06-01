from __future__ import annotations
import logging
from datetime import datetime, timedelta
from collections import Counter

from application.ports import SignalRepository, OpportunityRepository, Notifier
from domain.models import Opportunity, Signal, ActiveSegment
from domain.rules import (
    compute_opportunity_score, income_tier_score, urgency_score, volume_score,
    KILL_SCORE_THRESHOLD, SCALE_SCORE_THRESHOLD, ALERT_SCORE_THRESHOLD,
)

log = logging.getLogger(__name__)


class ScoreUseCase:
    def __init__(self, signal_repo: SignalRepository,
                 opp_repo: OpportunityRepository, notifier: Notifier):
        self._signals = signal_repo
        self._opps = opp_repo
        self._notifier = notifier

    def run(self, segments: list[ActiveSegment], dry_run: bool = False) -> list[dict]:
        results = []

        for seg in segments:
            signals = self._signals.get(segment=seg.key, limit=500)
            opp = self._score_segment(seg, signals)
            opp = self._apply_rules(opp)

            if not dry_run:
                self._opps.upsert(opp)
                if opp.score >= ALERT_SCORE_THRESHOLD and opp.status == "watching":
                    if self._should_alert(opp):
                        msg = self._format_alert(opp, seg)
                        if self._notifier.send(msg):
                            opp.telegram_alerted_at = datetime.utcnow()
                            self._opps.upsert(opp)

            results.append({
                "segment": seg.key,
                "score": opp.score,
                "status": opp.status,
                "signal_count": opp.signal_count,
                "breakdown": opp.score_breakdown,
                "pain_summary": opp.pain_summary,
            })

        results.sort(key=lambda r: r["score"], reverse=True)
        return results

    def _score_segment(self, seg: ActiveSegment, signals: list[Signal]) -> Opportunity:
        dolor, pain_summary = self._dolor_score(signals)
        breakdown = {
            "dolor":          dolor,
            "capacidad_pago": float(income_tier_score(seg.income_tier)),
            "volumen":        volume_score(seg.discovery_score),
            "competencia":    5.0,
            "urgencia":       float(urgency_score(seg.has_deadline)),
        }
        existing = self._opps.get_by_segment(seg.key)
        opp_id = existing.id if existing else Opportunity(segment=seg.key).id
        return Opportunity(
            id=opp_id,
            segment=seg.key,
            pain_summary=pain_summary or (existing.pain_summary if existing else ""),
            score=compute_opportunity_score(breakdown),
            score_breakdown=breakdown,
            signal_ids=[s.id for s in signals[-50:]],
            signal_count=self._signals.count(segment=seg.key),
            first_seen=existing.first_seen if existing else datetime.utcnow(),
            last_updated=datetime.utcnow(),
            status=existing.status if existing else "watching",
            landing_url=existing.landing_url if existing else None,
            emails_captured=existing.emails_captured if existing else 0,
            telegram_alerted_at=existing.telegram_alerted_at if existing else None,
        )

    def _dolor_score(self, signals: list[Signal]) -> tuple[float, str]:
        if not signals:
            return 0.0, ""
        cutoff = datetime.utcnow() - timedelta(days=30)
        recent = [s for s in signals if s.collected_at > cutoff]
        if not recent:
            return 0.0, ""
        week_ago = datetime.utcnow() - timedelta(days=7)
        freq_score = min(len(recent) / 20, 1.0) * 10
        weighted, total_w, all_kw = 0.0, 0.0, []
        for s in recent:
            w = 2.0 if s.collected_at > week_ago else 1.0
            weighted += s.signal_strength * w
            total_w += w
            all_kw.extend(s.pain_keywords_found)
        intensity = (weighted / total_w) * 10 if total_w else 0
        dolor = round((freq_score * 0.5 + intensity * 0.5), 2)
        top_kw = [kw for kw, _ in Counter(all_kw).most_common(3)]
        summary = f"Dolor en: {', '.join(top_kw)}" if top_kw else f"{len(recent)} señales recientes"
        return min(dolor, 10.0), summary

    def _apply_rules(self, opp: Opportunity) -> Opportunity:
        if opp.status in ("killed", "scaling"):
            return opp
        age = (datetime.utcnow() - opp.first_seen).days
        if opp.signal_count == 0 and age >= opp.kill_threshold_days and opp.score < KILL_SCORE_THRESHOLD:
            opp.status = "killed"
        elif opp.score >= SCALE_SCORE_THRESHOLD and opp.emails_captured >= opp.scale_threshold_emails:
            opp.status = "scaling"
        return opp

    def _should_alert(self, opp: Opportunity) -> bool:
        if not opp.telegram_alerted_at:
            return True
        return (datetime.utcnow() - opp.telegram_alerted_at).total_seconds() > 86400

    def _format_alert(self, opp: Opportunity, seg: ActiveSegment) -> str:
        bd = opp.score_breakdown
        lines = [
            f"🎯 *Oportunidad detectada*",
            f"*Segmento:* {seg.label}",
            f"*Score:* {opp.score}/10",
            f"*Dolor:* {bd.get('dolor', 0):.1f} | *Pago:* {bd.get('capacidad_pago', 0):.0f} | *Urgencia:* {bd.get('urgencia', 0):.0f}",
            f"*Señales:* {opp.signal_count}",
            f"*Resumen:* {opp.pain_summary}",
        ]
        if seg.has_deadline:
            lines.append("⚠️ Deadline activo")
        return "\n".join(lines)
