"""
synthesize.py

Genera copy de landing a partir de señales reales de dolor.
Usa llm.py para seleccionar automáticamente el provider disponible
(Groq gratis → OpenRouter gratis → Anthropic de pago).

Uso:
  python synthesize.py --segment dentista
  python synthesize.py --segment dentista --dry-run  # imprime sin guardar
"""

import sys
import json
import logging
import argparse
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import llm
from schema import SEGMENTS
from db.database import get_signals, init_db

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [synthesize] %(message)s")

SYNTHESIS_PROMPT = """\
Eres un copywriter B2B especializado en SaaS para profesionales autónomos españoles.

Tu tarea: escribir el copy de una landing page de validación usando ÚNICAMENTE \
el lenguaje que aparece en las quejas reales que te doy. Nada de marketing genérico.

QUEJAS Y FRUSTRACIONES REALES (texto literal de profesionales):
{signals_text}

CONTEXTO:
- Perfil objetivo: {segment_label}
- Dolores más mencionados: {top_keywords}
- Salario medio del segmento: {salary_mean}€/año
{deadline_note}

REGLAS:
1. El headline debe nombrar el PROBLEMA, no la solución. Usa palabras del corpus.
2. El subtitle amplía el problema con datos concretos de las señales.
3. Cada uno de los 3 beneficios resuelve uno de los 3 dolores más frecuentes.
4. El CTA genera urgencia sin ser agresivo (no uses "GRATIS" ni "AHORA").
5. Todo en español. Tono directo, sin eufemismos corporativos.

Devuelve ÚNICAMENTE JSON válido, sin texto previo ni backticks:
{{"headline":"...","subtitle":"...","benefits":[{{"title":"...","desc":"...","emoji":"..."}},{{"title":"...","desc":"...","emoji":"..."}},{{"title":"...","desc":"...","emoji":"..."}}],"cta":"..."}}
"""



def synthesize_copy(segment: str, signals: list[dict]) -> dict:
    """
    Genera copy de landing a partir de señales reales.

    Retorna dict con keys: title, subtitle, benefits (lista de tuplas), cta.
    Ese formato es compatible directo con los kwargs de generate_landing_html.

    Lanza ValueError si no hay señales útiles.
    Lanza RuntimeError si la API falla o el JSON viene malformado.
    """
    if not signals:
        raise ValueError(f"Sin señales para '{segment}'")

    seg_data = SEGMENTS.get(segment, {})
    label    = seg_data.get("label", segment)

    # Top señales por signal_strength — las más densas en pain primero
    top = sorted(signals, key=lambda s: s.get("signal_strength", 0), reverse=True)[:15]

    # Keywords dominantes del corpus
    all_kws: list[str] = []
    for s in top:
        try:
            kws = json.loads(s.get("pain_keywords", "[]") or "[]")
            all_kws.extend(kws)
        except (json.JSONDecodeError, TypeError):
            pass
    top_keywords = ", ".join(kw for kw, _ in Counter(all_kws).most_common(5)) \
                   or "gestión, burocracia, tiempo"

    # Textos limpios — truncar a 300 chars para no saturar el prompt
    signal_texts = []
    for s in top:
        text = (s.get("raw_text") or "").strip()
        if len(text) > 300:
            text = text[:297] + "..."
        if len(text) > 40:
            signal_texts.append(f"- {text}")

    if not signal_texts:
        raise ValueError(f"Señales de '{segment}' sin raw_text utilizable")

    deadline_note = ""
    if seg_data.get("active_deadline"):
        deadline_note = f"- Deadline fiscal activo: {seg_data['active_deadline']} (urgencia real)"

    prompt = SYNTHESIS_PROMPT.format(
        segment_label=label,
        signals_text="\n".join(signal_texts[:12]),
        top_keywords=top_keywords,
        salary_mean=seg_data.get("salary_mean", "N/A"),
        deadline_note=deadline_note,
    )

    log.info(f"  [{llm.active_provider()}] Sintetizando copy ({len(signal_texts)} señales, top_kw: {top_keywords[:50]})...")
    raw = llm.call(prompt).strip()

    # Limpiar backticks que a veces añade el modelo
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:].strip()

    data = json.loads(raw)

    # Validar estructura mínima
    missing = {"headline", "subtitle", "benefits", "cta"} - set(data.keys())
    if missing:
        raise ValueError(f"Copy incompleto — faltan: {missing}")
    if len(data["benefits"]) < 3:
        raise ValueError("Se esperaban exactamente 3 beneficios")

    log.info(f"  Headline: {data['headline'][:70]}...")
    log.info(f"  CTA:      {data['cta']}")

    # Convertir al formato que espera generate_landing_html
    return {
        "title":    data["headline"],
        "subtitle": data["subtitle"],
        "benefits": [(b["title"], b["desc"], b["emoji"]) for b in data["benefits"][:3]],
        "cta":      data["cta"],
    }


def run(segment: str) -> dict | None:
    """Entry point para uso desde pipeline u otros módulos."""
    init_db()
    signals = get_signals(segment=segment, limit=50)
    if not signals:
        log.warning(f"Sin señales para '{segment}' — skipping síntesis")
        return None
    try:
        return synthesize_copy(segment, signals)
    except Exception as e:
        log.error(f"  Síntesis fallida para '{segment}': {e}")
        return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Market Intel — Copy Synthesizer")
    parser.add_argument("--segment", required=True, choices=list(SEGMENTS.keys()))
    parser.add_argument("--dry-run", action="store_true", help="Imprime copy sin persistir nada")
    args = parser.parse_args()

    result = run(args.segment)
    if result:
        print(json.dumps(result, ensure_ascii=False, indent=2, default=list))
    else:
        sys.exit(1)
