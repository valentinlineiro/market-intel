"""
report.py

Dashboard CLI de market intelligence.
Lee la DB SQLite y muestra oportunidades, señales recientes y stats.

Uso:
  python report.py                        # vista completa
  python report.py --segment dentista     # solo un segmento
  python report.py --signals 20           # últimas N señales por segmento
  python report.py --json                 # output JSON para scripting
"""

import sys
import json
import argparse
import warnings
from pathlib import Path
from datetime import datetime, timedelta, timezone

warnings.filterwarnings("ignore", category=DeprecationWarning)

sys.path.insert(0, str(Path(__file__).parent))

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.columns import Columns
from rich.text import Text
from rich import box

from schema import SEGMENTS, KILL_SCORE_THRESHOLD, SCALE_SCORE_THRESHOLD, ALERT_SCORE_THRESHOLD
from db.database import init_db, get_opportunities, get_signals, get_stats

console = Console()


# ── Helpers ────────────────────────────────────────────────────────────────

def score_color(score: float) -> str:
    if score >= SCALE_SCORE_THRESHOLD:
        return "bold green"
    elif score >= ALERT_SCORE_THRESHOLD:
        return "yellow"
    elif score >= KILL_SCORE_THRESHOLD:
        return "white"
    else:
        return "dim red"


def status_badge(status: str) -> Text:
    mapping = {
        "watching": Text("● watching", style="cyan"),
        "testing":  Text("▶ testing",  style="yellow"),
        "scaling":  Text("🚀 scaling", style="bold green"),
        "killed":   Text("☠ killed",   style="dim red"),
    }
    return mapping.get(status, Text(status))


def bar(value: float, max_val: float = 10.0, width: int = 10) -> str:
    filled = int(round(value / max_val * width))
    return "█" * filled + "░" * (width - filled)


def fmt_dt(iso: str) -> str:
    try:
        dt = datetime.fromisoformat(iso)
        delta = datetime.now(timezone.utc).replace(tzinfo=None) - dt
        if delta.days == 0:
            hours = delta.seconds // 3600
            return f"{hours}h ago" if hours else "just now"
        return f"{delta.days}d ago"
    except Exception:
        return iso[:10]


# ── Panels ─────────────────────────────────────────────────────────────────

def render_summary(stats: dict):
    total_s = stats["total_signals"]
    total_o = stats["total_opportunities"]
    top = stats.get("top_opportunity")

    lines = [
        f"[bold]Señales totales:[/bold] {total_s}",
        f"[bold]Oportunidades:[/bold]   {total_o}",
    ]
    if top:
        lines.append(
            f"[bold]Top oportunidad:[/bold] [yellow]{top['pain_summary']}[/yellow] "
            f"(score=[bold]{top['score']}[/bold])"
        )

    by_seg = stats.get("by_segment", {})
    if by_seg:
        seg_parts = "  ".join(
            f"[cyan]{k}[/cyan]:{v}" for k, v in sorted(by_seg.items(), key=lambda x: -x[1])
        )
        lines.append(f"[bold]Por segmento:[/bold]    {seg_parts}")

    console.print(Panel("\n".join(lines), title="[bold]Market Intel — Resumen[/bold]",
                        border_style="bright_blue"))


def render_opportunities(opps: list[dict], segment_filter: str | None = None):
    if segment_filter:
        opps = [o for o in opps if o["segment"] == segment_filter]

    if not opps:
        console.print("[dim]No hay oportunidades en DB. Ejecuta los collectors primero.[/dim]")
        return

    table = Table(
        box=box.ROUNDED,
        title="[bold]Oportunidades[/bold]",
        title_style="bold bright_blue",
        show_lines=True,
    )
    table.add_column("Segmento",      style="cyan",  min_width=22)
    table.add_column("Score",         justify="right", min_width=12)
    table.add_column("Breakdown",     min_width=38)
    table.add_column("Señales",       justify="right", min_width=8)
    table.add_column("Status",        min_width=12)
    table.add_column("Pain",          min_width=30)

    for o in opps:
        score = o["score"]
        seg_label = SEGMENTS.get(o["segment"], {}).get("label", o["segment"])

        # Breakdown mini-bars
        try:
            bd = json.loads(o["score_breakdown"]) if isinstance(o["score_breakdown"], str) else o["score_breakdown"]
        except Exception:
            bd = {}

        bd_lines = []
        for k in ("dolor", "capacidad_pago", "volumen", "competencia", "urgencia"):
            v = bd.get(k, 0)
            bd_lines.append(f"[dim]{k[:5]}[/dim] {bar(v)} [dim]{v:.1f}[/dim]")
        breakdown_str = "\n".join(bd_lines)

        score_str = Text(f"{score:.2f}/10", style=score_color(score))

        table.add_row(
            seg_label,
            score_str,
            breakdown_str,
            str(o.get("signal_count", 0)),
            status_badge(o.get("status", "watching")),
            Text(o.get("pain_summary", "—") or "—", overflow="fold"),
        )

    console.print(table)


def render_signals(signals: list[dict], limit: int = 10, segment_filter: str | None = None):
    if segment_filter:
        signals = [s for s in signals if s["segment"] == segment_filter]

    signals = signals[:limit]

    if not signals:
        console.print("[dim]Sin señales recientes.[/dim]")
        return

    table = Table(
        box=box.SIMPLE_HEAVY,
        title=f"[bold]Señales recientes[/bold] (últimas {limit})",
        title_style="bold bright_blue",
    )
    table.add_column("Cuándo",    style="dim",   min_width=9)
    table.add_column("Segmento",  style="cyan",  min_width=12)
    table.add_column("Fuente",    style="magenta", min_width=10)
    table.add_column("Strength",  justify="right", min_width=9)
    table.add_column("Keywords",  min_width=24)
    table.add_column("Texto",     min_width=45)

    for s in signals:
        try:
            kws = json.loads(s.get("pain_keywords", "[]") or "[]")
        except Exception:
            kws = []
        kw_str = ", ".join(kws[:4]) or "—"

        raw = s.get("raw_text", "") or ""
        preview = raw[:120].replace("\n", " ")
        if len(raw) > 120:
            preview += "…"

        strength = s.get("signal_strength", 0) or 0
        strength_color = "green" if strength >= 0.5 else "yellow" if strength >= 0.3 else "dim"

        table.add_row(
            fmt_dt(s["collected_at"]),
            s["segment"],
            s.get("source", "?"),
            Text(f"{strength:.2f}", style=strength_color),
            kw_str,
            preview,
        )

    console.print(table)


def render_segment_detail(segment_key: str):
    seg = SEGMENTS.get(segment_key)
    if not seg:
        console.print(f"[red]Segmento desconocido: {segment_key}[/red]")
        return

    active_dl = seg.get("active_deadline")
    urgency_badge = f"[bold red]⚠ Deadline: {active_dl}[/bold red]" if active_dl else "[dim]Sin deadline activo[/dim]"

    info = (
        f"[bold]{seg['label']}[/bold]\n"
        f"CNAE {seg['cnae']} · CNO {seg['cno']}\n"
        f"Salario: {seg['salary_min']:,}–{seg['salary_max']:,}€ (media {seg['salary_mean']:,}€)\n"
        f"Población España: {seg['population_spain']:,} · Cádiz: {seg['population_cadiz']:,}\n"
        f"{urgency_badge}\n"
        f"[dim]{seg.get('notes', '')}[/dim]"
    )

    kws = "  ".join(f"[yellow]{k}[/yellow]" for k in seg["pain_keywords"])

    console.print(Panel(
        info + f"\n\n[bold]Pain keywords:[/bold]\n{kws}",
        title=f"[bold cyan]{segment_key}[/bold cyan]",
        border_style="cyan",
    ))


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Market Intel — Dashboard CLI")
    parser.add_argument("--segment", choices=list(SEGMENTS.keys()),
                        help="Filtrar por segmento")
    parser.add_argument("--signals", type=int, default=10, metavar="N",
                        help="Número de señales recientes a mostrar (default: 10)")
    parser.add_argument("--json", action="store_true", dest="as_json",
                        help="Output JSON para scripting")
    args = parser.parse_args()

    init_db()
    stats = get_stats()
    opps = get_opportunities()
    signals = get_signals(segment=args.segment, limit=args.signals * 4)

    if args.as_json:
        print(json.dumps({
            "stats": stats,
            "opportunities": opps,
            "recent_signals": signals[:args.signals],
        }, default=str, ensure_ascii=False, indent=2))
        return

    console.rule("[bold bright_blue]MARKET INTEL[/bold bright_blue]")

    render_summary(stats)
    console.print()

    if args.segment:
        render_segment_detail(args.segment)
        console.print()

    render_opportunities(opps, segment_filter=args.segment)
    console.print()

    render_signals(signals, limit=args.signals, segment_filter=args.segment)

    console.rule(f"[dim]{datetime.now(timezone.utc).replace(tzinfo=None).strftime('%Y-%m-%d %H:%M UTC')}[/dim]")


if __name__ == "__main__":
    main()
