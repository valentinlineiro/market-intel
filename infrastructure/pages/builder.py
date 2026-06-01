from __future__ import annotations
from domain.segments import SEGMENTS
from infrastructure.llm.prompts import SECTOR_COPY


def build_html(segment: str, copy: dict) -> str:
    seg = SEGMENTS.get(segment, {})
    c = copy or SECTOR_COPY.get(segment, {})
    title = c.get("title", seg.get("label", segment))
    subtitle = c.get("subtitle", "")
    benefits = c.get("benefits", [])
    cta = c.get("cta", "Quiero acceso prioritario")

    benefits_html = "\n".join(
        f'<div class="benefit"><span class="emoji">{b[2] if len(b)>2 else ""}</span>'
        f'<h3>{b[0]}</h3><p>{b[1]}</p></div>'
        for b in benefits
    )

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ background: #020817; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }}
    .container {{ max-width: 680px; padding: 48px 24px; text-align: center; }}
    h1 {{ font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800; color: #f1f5f9; line-height: 1.2; margin-bottom: 20px; }}
    .subtitle {{ font-size: 1.1rem; color: #94a3b8; margin-bottom: 40px; line-height: 1.6; }}
    .benefits {{ display: grid; gap: 20px; margin-bottom: 40px; text-align: left; }}
    .benefit {{ background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }}
    .emoji {{ font-size: 1.5rem; }}
    .benefit h3 {{ font-size: 1rem; font-weight: 700; color: #f1f5f9; margin: 8px 0 4px; }}
    .benefit p {{ font-size: 0.875rem; color: #64748b; line-height: 1.5; }}
    form {{ display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }}
    input[type=email] {{ flex: 1; min-width: 220px; padding: 14px 18px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 1rem; }}
    button {{ padding: 14px 28px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; white-space: nowrap; }}
    button:hover {{ background: #2563eb; }}
    .success {{ display: none; color: #22c55e; margin-top: 16px; font-weight: 600; }}
  </style>
</head>
<body>
  <div class="container">
    <h1>{title}</h1>
    <p class="subtitle">{subtitle}</p>
    <div class="benefits">{benefits_html}</div>
    <form id="form" action="/signup" method="POST">
      <input type="hidden" name="segment" value="{segment}">
      <input type="email" name="email" placeholder="tu@email.com" required>
      <button type="submit">{cta}</button>
    </form>
    <p class="success" id="ok">✓ Apuntado. Te avisamos primero.</p>
  </div>
  <script>
    document.getElementById('form').addEventListener('submit', async e => {{
      e.preventDefault();
      const fd = new FormData(e.target);
      await fetch('/signup', {{method:'POST', body: new URLSearchParams(fd)}});
      e.target.style.display = 'none';
      document.getElementById('ok').style.display = 'block';
    }});
  </script>
</body>
</html>"""
