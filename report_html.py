"""
report_html.py

Genera un index.html estático a partir de la DB.
Se llama desde el workflow de GitHub Pages tras cada collect.

Uso:
  python report_html.py              # genera index.html en el directorio actual
  python report_html.py --out /tmp   # genera en otro directorio
"""

import sys
import json
import argparse
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent))

from schema import SEGMENTS, KILL_SCORE_THRESHOLD, SCALE_SCORE_THRESHOLD, ALERT_SCORE_THRESHOLD
from db.database import init_db, get_opportunities, get_signals, get_stats


# ── Helpers ────────────────────────────────────────────────────────────────

def score_color(score: float) -> str:
    if score >= SCALE_SCORE_THRESHOLD:
        return "#22c55e"   # green
    elif score >= ALERT_SCORE_THRESHOLD:
        return "#f59e0b"   # amber
    elif score >= KILL_SCORE_THRESHOLD:
        return "#94a3b8"   # slate
    else:
        return "#ef4444"   # red


def status_badge(status: str) -> str:
    styles = {
        "watching": ("●", "#60a5fa", "#1e3a5f"),
        "testing":  ("▶", "#f59e0b", "#3d2e00"),
        "scaling":  ("🚀", "#22c55e", "#14401f"),
        "killed":   ("☠", "#ef4444", "#3b0f0f"),
    }
    icon, color, bg = styles.get(status, ("?", "#94a3b8", "#1e293b"))
    return (
        f'<span style="background:{bg};color:{color};padding:2px 10px;'
        f'border-radius:999px;font-size:0.75rem;font-weight:600;">'
        f'{icon} {status}</span>'
    )


def bar_html(value: float, max_val: float = 10.0, color: str = "#60a5fa") -> str:
    pct = min(value / max_val * 100, 100)
    return (
        f'<div style="display:flex;align-items:center;gap:6px;">'
        f'<div style="flex:1;background:#1e293b;border-radius:4px;height:6px;">'
        f'<div style="width:{pct:.0f}%;background:{color};height:6px;border-radius:4px;"></div>'
        f'</div>'
        f'<span style="font-size:0.7rem;color:#94a3b8;width:24px;">{value:.1f}</span>'
        f'</div>'
    )


def fmt_dt(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso)
        delta = datetime.now(timezone.utc).replace(tzinfo=None) - dt
        if delta.days == 0:
            h = delta.seconds // 3600
            return f"{h}h ago" if h else "just now"
        return f"{delta.days}d ago"
    except Exception:
        return iso[:10]


# ── HTML sections ──────────────────────────────────────────────────────────

def render_opportunity_card(o: dict) -> str:
    score = o.get("score", 0)
    seg = SEGMENTS.get(o["segment"], {})
    label = seg.get("label", o["segment"])
    color = score_color(score)

    try:
        bd = json.loads(o["score_breakdown"]) if isinstance(o["score_breakdown"], str) else o["score_breakdown"]
    except Exception:
        bd = {}

    breakdown_rows = ""
    bar_colors = {
        "dolor":          "#f87171",
        "capacidad_pago": "#34d399",
        "volumen":        "#60a5fa",
        "competencia":    "#a78bfa",
        "urgencia":       "#fb923c",
    }
    labels_es = {
        "dolor": "Dolor", "capacidad_pago": "Capacidad pago",
        "volumen": "Volumen", "competencia": "Competencia", "urgencia": "Urgencia",
    }
    for k in ("dolor", "capacidad_pago", "volumen", "competencia", "urgencia"):
        v = bd.get(k, 0)
        breakdown_rows += f"""
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="color:#64748b;font-size:0.7rem;width:110px;">{labels_es[k]}</span>
          {bar_html(v, color=bar_colors[k])}
        </div>"""

    deadline = seg.get("active_deadline")
    deadline_badge = (
        f'<span style="color:#fb923c;font-size:0.7rem;">⚠ Deadline {deadline}</span>'
        if deadline else ""
    )

    pain = o.get("pain_summary") or "—"
    signals = o.get("signal_count", 0)

    return f"""
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:20px;
                position:relative;overflow:hidden;">
      <div style="position:absolute;top:0;right:0;width:4px;height:100%;background:{color};border-radius:0 12px 12px 0;"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
        <div>
          <div style="font-weight:600;color:#f1f5f9;margin-bottom:4px;">{label}</div>
          <div style="font-size:0.75rem;color:#64748b;">{pain}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.8rem;font-weight:700;color:{color};line-height:1;">{score:.1f}</div>
          <div style="font-size:0.65rem;color:#475569;">/10</div>
        </div>
      </div>
      {breakdown_rows}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;">
        {status_badge(o.get("status","watching"))}
        <span style="font-size:0.7rem;color:#475569;">{signals} señales</span>
        {deadline_badge}
      </div>
    </div>"""


def render_signals_table(signals: list[dict]) -> str:
    if not signals:
        return '<p style="color:#475569;">Sin señales recientes.</p>'

    rows = ""
    for s in signals:
        try:
            kws = json.loads(s.get("pain_keywords", "[]") or "[]")
        except Exception:
            kws = []
        kw_str = ", ".join(kws[:3]) or "—"
        raw = (s.get("raw_text") or "")[:120].replace("<", "&lt;").replace(">", "&gt;")
        if len(s.get("raw_text") or "") > 120:
            raw += "…"
        strength = s.get("signal_strength", 0) or 0
        sc = "#22c55e" if strength >= 0.5 else "#f59e0b" if strength >= 0.3 else "#64748b"
        url = s.get("url", "")
        link = f'<a href="{url}" target="_blank" style="color:#60a5fa;text-decoration:none;">↗</a>' if url and url.startswith("http") else ""

        rows += f"""
        <tr style="border-bottom:1px solid #1e293b;">
          <td style="padding:8px 12px;color:#475569;font-size:0.75rem;white-space:nowrap;">{fmt_dt(s['collected_at'])}</td>
          <td style="padding:8px 12px;color:#94a3b8;font-size:0.75rem;">{s['segment']}</td>
          <td style="padding:8px 12px;color:#64748b;font-size:0.7rem;">{s.get('source','')}</td>
          <td style="padding:8px 12px;font-size:0.75rem;font-weight:600;color:{sc};">{strength:.2f}</td>
          <td style="padding:8px 12px;color:#94a3b8;font-size:0.7rem;">{kw_str}</td>
          <td style="padding:8px 12px;color:#64748b;font-size:0.7rem;max-width:300px;">{raw} {link}</td>
        </tr>"""

    return f"""
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="border-bottom:1px solid #334155;">
          <th style="padding:8px 12px;text-align:left;color:#475569;font-size:0.7rem;font-weight:500;">Cuándo</th>
          <th style="padding:8px 12px;text-align:left;color:#475569;font-size:0.7rem;font-weight:500;">Segmento</th>
          <th style="padding:8px 12px;text-align:left;color:#475569;font-size:0.7rem;font-weight:500;">Fuente</th>
          <th style="padding:8px 12px;text-align:left;color:#475569;font-size:0.7rem;font-weight:500;">Fuerza</th>
          <th style="padding:8px 12px;text-align:left;color:#475569;font-size:0.7rem;font-weight:500;">Keywords</th>
          <th style="padding:8px 12px;text-align:left;color:#475569;font-size:0.7rem;font-weight:500;">Texto</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>"""


# ── Full page ──────────────────────────────────────────────────────────────

def generate_html(stats: dict, opps: list[dict], signals: list[dict]) -> str:
    updated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    total_s = stats["total_signals"]
    total_o = stats["total_opportunities"]
    by_seg = stats.get("by_segment", {})

    seg_pills = " ".join(
        f'<span style="background:#1e293b;color:#94a3b8;padding:2px 10px;border-radius:999px;font-size:0.75rem;">'
        f'{k}: {v}</span>'
        for k, v in sorted(by_seg.items(), key=lambda x: -x[1])
    )

    opp_cards = "\n".join(render_opportunity_card(o) for o in opps)
    signals_table = render_signals_table(signals[:20])

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Market Intel — Dashboard</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #020817; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; }}
    .container {{ max-width: 1100px; margin: 0 auto; padding: 32px 16px; }}
    h2 {{ font-size: 0.75rem; font-weight: 600; letter-spacing: 0.1em; color: #475569; text-transform: uppercase; margin-bottom: 16px; }}
    .card {{ background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }}
    .stat {{ display: flex; flex-direction: column; gap: 4px; }}
    .stat-value {{ font-size: 2rem; font-weight: 700; color: #f1f5f9; }}
    .stat-label {{ font-size: 0.75rem; color: #64748b; }}
    .overflow-x {{ overflow-x: auto; }}
  </style>
</head>
<body>
  <div class="container">

    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;">
      <div>
        <div style="font-size:1.5rem;font-weight:700;color:#f1f5f9;">Market Intel</div>
        <div style="font-size:0.8rem;color:#475569;margin-top:2px;">Señales de dolor · Cádiz / España</div>
      </div>
      <div style="font-size:0.75rem;color:#334155;">Actualizado: {updated}</div>
    </div>

    <!-- Stats -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:16px;margin-bottom:32px;">
      <div class="card stat">
        <div class="stat-value">{total_s:,}</div>
        <div class="stat-label">Señales totales</div>
      </div>
      <div class="card stat">
        <div class="stat-value">{total_o}</div>
        <div class="stat-label">Oportunidades</div>
      </div>
      <div class="card" style="grid-column:span 2;">
        <div class="stat-label" style="margin-bottom:8px;">Por segmento</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">{seg_pills}</div>
      </div>
    </div>

    <!-- Opportunities -->
    <h2>Oportunidades</h2>
    <div class="grid" style="margin-bottom:32px;">
      {opp_cards}
    </div>

    <!-- Signals -->
    <h2>Señales recientes</h2>
    <div class="card overflow-x">
      {signals_table}
    </div>

    <!-- Legend -->
    <div style="margin-top:24px;display:flex;gap:16px;flex-wrap:wrap;">
      <span style="font-size:0.7rem;color:#334155;">Score ≥ {SCALE_SCORE_THRESHOLD} → <span style="color:#22c55e;">escalar</span></span>
      <span style="font-size:0.7rem;color:#334155;">Score ≥ {ALERT_SCORE_THRESHOLD} → <span style="color:#f59e0b;">alerta Telegram</span></span>
      <span style="font-size:0.7rem;color:#334155;">Score &lt; {KILL_SCORE_THRESHOLD} → <span style="color:#ef4444;">kill</span></span>
    </div>

  </div>
</body>
</html>"""


# ── Entry point ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=".", help="Directorio de salida")
    args = parser.parse_args()

    init_db()
    stats = get_stats()
    opps = get_opportunities()
    signals = get_signals(limit=100)

    html = generate_html(stats, opps, signals)
    out = Path(args.out) / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"Dashboard generado: {out} ({len(html):,} bytes)")


if __name__ == "__main__":
    main()
