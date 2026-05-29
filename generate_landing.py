#!/usr/bin/env python
"""
generate_landing.py

Generador automático de Landing Pages de alta conversión basadas en los datos del reporte.
Permite validar la idea de negocio capturando leads reales y actualizando la base de datos.

Uso:
  python generate_landing.py --segment dentista
  python generate_landing.py --segment dentista --serve [puerto]
"""

import sys
import json
import argparse
import sqlite3
import re
from pathlib import Path
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.parse

sys.path.insert(0, str(Path(__file__).parent))

from schema import SEGMENTS, Opportunity
from db.database import DB_PATH, get_conn, upsert_opportunity, get_opportunities

# ── Copys predefinidos por segmento para potenciar la conversión ────────────
SECTOR_COPY = {
    "dentista": {
        "title": "Simplifica Verifactu en tu Clínica Dental",
        "subtitle": "Facturación electrónica homologada diseñada exclusivamente para odontólogos. Sin cuotas abusivas, sin configuraciones complejas, 100% adaptado a la normativa de Hacienda.",
        "benefit_title": "Por qué delegar en nuestra solución",
        "benefits": [
            ("Hacienda bajo control", "Olvídate de las multas de hasta 50.000€. Cumplimiento estricto del reglamento RRSIF/Verifactu en cada factura emitida.", "🛡️"),
            ("Gestión clínica fluida", "Agenda, historial de pacientes y facturación vinculados en una interfaz limpia que no requiere formación previa.", "⚡"),
            ("Seguros sin complicaciones", "Carga y facturación automática con cuadros médicos y aseguradoras en un clic.", "🦷")
        ],
        "cta": "Quiero acceso prioritario (Beta cerrada)"
    },
    "docente_universitario": {
        "title": "Supera ANECA y Docentia sin perder la cabeza",
        "subtitle": "La plataforma inteligente que organiza, valida y estructura tus méritos investigadores y docentes. Diseñado por y para académicos que prefieren investigar a rellenar formularios.",
        "benefit_title": "La ayuda que tu carrera académica necesita",
        "benefits": [
            ("Acreditación en tiempo récord", "Clasificación automática de publicaciones, tramos de investigación y patentes según los criterios exactos de ANECA.", "🎓"),
            ("Predicción de Sexenios", "Algoritmo de scoring que evalúa las posibilidades de éxito de tus aportaciones antes de enviarlas.", "📈"),
            ("Gestión de CVN limpia", "Importa y exporta tu Curriculum Vitae Normalizado (CVN/FECYT) en un clic sin descuadres de formato.", "📁")
        ],
        "cta": "Simplificar mi acreditación ahora"
    },
    "abogado_autonomo": {
        "title": "La gestión de expedientes y facturas que los abogados merecen",
        "subtitle": "Controla LexNet, automatiza tu contabilidad e IVA trimestral, y gestiona tus minutas desde un entorno móvil ágil diseñado para abogados independientes.",
        "benefit_title": "Diseñado para el día a día judicial",
        "benefits": [
            ("Integración fluida de LexNet", "Recibe alertas de plazos y notificaciones directamente integradas con tu agenda de pleitos.", "⚖️"),
            ("Minutas y facturas sin esfuerzo", "Generación automática de facturas electrónicas conformes y envío automatizado de recordatorios de cobro.", "💵"),
            ("Expedientes digitalizados", "Toda la documentación del caso clasificada y accesible desde cualquier dispositivo de forma ultra-segura.", "🔒")
        ],
        "cta": "Probar 14 días gratis"
    },
    "arquitecto": {
        "title": "Gestiona tus proyectos y visados sin burocracia",
        "subtitle": "De la medición al visado colegial en tiempo récord. Centraliza presupuestos, libros de edificio y certificados energéticos en una única plataforma ágil.",
        "benefit_title": "Menos trámites, más arquitectura",
        "benefits": [
            ("Bucle de Visado Rápido", "Plantillas y checklists adaptadas a los colegios oficiales para asegurar que aprueben tus visados a la primera.", "📐"),
            ("Presupuestos y mediciones", "Generación limpia de presupuestos y control de costes de obra en tiempo real sin hojas de cálculo rotas.", "📊"),
            ("Certificados en minutos", "Generación simplificada de IEEs y certificados energéticos con plantillas validadas oficiales.", "🌿")
        ],
        "cta": "Empezar a optimizar mis proyectos"
    }
}

# ── Generador de HTML ────────────────────────────────────────────────────────

def get_recent_signals(segment: str, limit: int = 3) -> list[str]:
    """Obtiene comentarios/quejas reales desde la DB para dotar a la landing de autenticidad."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    signals = []
    try:
        # Priorizar señales negativas o con alta frustración (sentiment_score bajo)
        query = """
            SELECT raw_text, source FROM signals 
            WHERE segment = ? AND sentiment_score < -0.05 AND length(raw_text) > 40
            ORDER BY collected_at DESC LIMIT ?
        """
        rows = conn.execute(query, (segment, limit)).fetchall()
        for r in rows:
            text = r["raw_text"]
            # Limpiar texto de tags y truncar si es muy largo
            text = re.sub(r'\[.*?\]\s*CONTRAS:\s*', '', text) # Quitar el prefijo del collector
            text = text.split("CONTRAS:")[-1].strip()
            if len(text) > 220:
                text = text[:217] + "..."
            signals.append(f"\"{text}\"")
    except Exception as e:
        print(f"Error cargando señales: {e}")
    finally:
        conn.close()
    return signals

def generate_landing_html(segment: str, title: str = None, subtitle: str = None, cta: str = None,
                          benefits_list: list = None, quotes_list: list = None) -> tuple[str, Path]:
    copy = SECTOR_COPY.get(segment, {
        "title": f"Solución innovadora para {segment}",
        "subtitle": f"Una plataforma diseñada para resolver los dolores clave del sector {segment}.",
        "benefit_title": "Beneficios clave",
        "benefits": [
            ("Ahorro de tiempo", "Reduce el trabajo administrativo hasta en un 80%.", "⚡"),
            ("Mayor rentabilidad", "Maximiza tus ingresos automatizando procesos manuales.", "📈"),
            ("Cumplimiento legal", "Evita sanciones y cumple con la legislación vigente de forma automática.", "🛡️")
        ],
        "cta": "Registrarme al lanzamiento"
    })
    
    # Aplicar overrides si vienen de la consola
    if title:
        copy["title"] = title
    if subtitle:
        copy["subtitle"] = subtitle
    if cta:
        copy["cta"] = cta
    if benefits_list:
        copy["benefits"] = benefits_list
    
    # Intentar cargar la oportunidad para ver el score real
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    opp_data = None
    try:
        opp_data = conn.execute("SELECT * FROM opportunities WHERE segment = ?", (segment,)).fetchone()
    except Exception:
        pass
    finally:
        conn.close()

    score = opp_data["score"] if opp_data else 0.0
    pain_summary = opp_data["pain_summary"] if opp_data else "Optimización de procesos operativos"
    
    # Señales reales para dotar de autenticidad a la propuesta
    quotes = quotes_list or get_recent_signals(segment, 3)
    if not quotes:
        quotes = [
            "\"Las herramientas actuales son extremadamente lentas y caras para autónomos.\"",
            "\"Pierdo casi un día a la semana rellenando burocracia en lugar de facturar.\"",
            "\"Me da pánico que Hacienda me multe por no tener un software homologado a tiempo.\""
        ]

    # Renderizar el HTML
    benefits_html = ""
    for title, desc, icon in copy["benefits"]:
        benefits_html += f"""
        <div class="card p-6 rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur-md transition-all hover:scale-[1.02] hover:border-cyan-500/40">
          <div class="text-4xl mb-4">{icon}</div>
          <h3 class="text-xl font-bold text-slate-100 mb-2">{title}</h3>
          <p class="text-sm text-slate-400 leading-relaxed">{desc}</p>
        </div>"""

    quotes_html = ""
    for quote in quotes:
        quotes_html += f"""
        <div class="p-6 rounded-2xl border border-slate-800/40 bg-slate-950/40 backdrop-blur-sm italic text-slate-300 relative">
          <span class="absolute top-2 left-4 text-6xl text-cyan-500/10 font-serif leading-none">“</span>
          <p class="relative z-10 text-sm leading-relaxed">{quote}</p>
        </div>"""

    score_badge_html = ""
    if score > 0:
        score_color = "#22c55e" if score >= 8.0 else "#f59e0b" if score >= 7.0 else "#94a3b8"
        score_badge_html = f"""
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-slate-800 bg-slate-900/80 text-xs font-semibold text-slate-300 mb-8 backdrop-blur-md">
          <span class="w-2 h-2 rounded-full" style="background-color: {score_color}"></span>
          Oportunidad validada por Market Intel · Score: <strong style="color: {score_color}">{score:.1f}/10</strong>
        </div>"""

    html_content = f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{copy['title']} · Lanzamiento Exclusivo</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      background-color: #020617;
      color: #f8fafc;
      font-family: 'Outfit', sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
      position: relative;
    }}
    /* Fondos decorativos con gradients difuminados */
    body::before {{
      content: '';
      position: absolute;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(6,182,212,0.15) 0%, rgba(0,0,0,0) 70%);
      top: -100px;
      right: -100px;
      z-index: 0;
      pointer-events: none;
    }}
    body::after {{
      content: '';
      position: absolute;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(139,92,246,0.12) 0%, rgba(0,0,0,0) 70%);
      bottom: -100px;
      left: -100px;
      z-index: 0;
      pointer-events: none;
    }}
    .container {{
      max-width: 1000px;
      margin: 0 auto;
      padding: 0 24px;
      position: relative;
      z-index: 10;
    }}
    header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 24px 0;
      margin-bottom: 64px;
    }}
    .logo {{
      font-weight: 800;
      font-size: 1.5rem;
      background: linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.02em;
    }}
    .badge {{
      background: rgba(6, 182, 212, 0.1);
      border: 1px solid rgba(6, 182, 212, 0.2);
      color: #22d3ee;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }}
    .hero {{
      text-align: center;
      margin-bottom: 80px;
    }}
    h1 {{
      font-size: clamp(2.2rem, 5vw, 3.8rem);
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.03em;
      margin-bottom: 24px;
      background: linear-gradient(to right, #f8fafc, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }}
    .subtitle {{
      font-size: clamp(1rem, 2.2vw, 1.25rem);
      color: #94a3b8;
      max-width: 700px;
      margin: 0 auto 36px;
      line-height: 1.6;
      font-weight: 300;
    }}
    .form-container {{
      max-width: 480px;
      margin: 0 auto;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 32px;
      border-radius: 24px;
      backdrop-filter: blur(12px);
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.5);
    }}
    .form-container h2 {{
      font-size: 1.1rem;
      color: #e2e8f0;
      margin-bottom: 16px;
      font-weight: 600;
    }}
    .input-group {{
      display: flex;
      flex-direction: column;
      gap: 12px;
    }}
    input[type="email"] {{
      width: 100%;
      background: rgba(2, 6, 23, 0.8);
      border: 1px solid #1e293b;
      padding: 14px 20px;
      border-radius: 12px;
      color: #fff;
      font-family: inherit;
      font-size: 1rem;
      transition: all 0.2s;
    }}
    input[type="email"]:focus {{
      outline: none;
      border-color: #06b6d4;
      box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.15);
    }}
    .btn {{
      width: 100%;
      background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
      color: #0f172a;
      border: none;
      padding: 14px 20px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 1rem;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(6, 182, 212, 0.25);
    }}
    .btn:hover {{
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(6, 182, 212, 0.4);
      filter: brightness(1.1);
    }}
    .btn:active {{
      transform: translateY(0);
    }}
    section {{
      margin-bottom: 96px;
    }}
    .section-title {{
      text-align: center;
      font-size: 1.8rem;
      font-weight: 700;
      margin-bottom: 48px;
      color: #f1f5f9;
      letter-spacing: -0.01em;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 24px;
    }}
    footer {{
      text-align: center;
      padding: 48px 0;
      border-top: 1px solid #0f172a;
      color: #475569;
      font-size: 0.85rem;
    }}
    /* Modal de Éxito */
    .modal-overlay {{
      position: fixed;
      inset: 0;
      background: rgba(2, 6, 23, 0.85);
      backdrop-filter: blur(8px);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }}
    .modal-overlay.active {{
      opacity: 1;
      pointer-events: all;
    }}
    .modal {{
      background: #0f172a;
      border: 1px solid #1e293b;
      padding: 40px;
      border-radius: 24px;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      transform: scale(0.9);
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    }}
    .modal-overlay.active .modal {{
      transform: scale(1);
    }}
    .modal-icon {{
      font-size: 3rem;
      margin-bottom: 20px;
    }}
    .modal h3 {{
      font-size: 1.5rem;
      color: #f1f5f9;
      margin-bottom: 12px;
      font-weight: 700;
    }}
    .modal p {{
      color: #94a3b8;
      font-size: 0.95rem;
      line-height: 1.5;
      margin-bottom: 24px;
    }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">Market Intel</div>
      <div class="badge">Acceso Beta Cerrado</div>
    </header>

    <main>
      <!-- Hero Section -->
      <div class="hero">
        {score_badge_html}
        <h1>{copy['title']}</h1>
        <p class="subtitle">{copy['subtitle']}</p>

        <!-- Formulario -->
        <div class="form-container">
          <h2>Regístrate para recibir acceso exclusivo e información</h2>
          <form id="leadForm" action="/signup" method="POST">
            <input type="hidden" name="segment" value="{segment}">
            <div class="input-group">
              <input type="email" id="emailInput" name="email" placeholder="Tu correo electrónico profesional" required autocomplete="email">
              <button type="submit" class="btn">{copy['cta']}</button>
            </div>
          </form>
          <p style="font-size: 0.7rem; color: #475569; margin-top: 12px;">🔒 Respetamos al 100% tu privacidad profesional.</p>
        </div>
      </div>

      <!-- Beneficios -->
      <section>
        <h2 class="section-title">{copy['benefit_title']}</h2>
        <div class="grid">
          {benefits_html}
        </div>
      </section>

      <!-- Dolores del Sector (Social Proof Real) -->
      <section>
        <h2 class="section-title">Lo que tu sector opina sobre el software actual</h2>
        <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));">
          {quotes_html}
        </div>
      </section>
    </main>

    <footer>
      <p>© {datetime.now().year} Market Intel Validation Suite. Cádiz, España.</p>
    </footer>
  </div>

  <!-- Modal de Éxito -->
  <div id="modalOverlay" class="modal-overlay">
    <div class="modal">
      <div class="modal-icon">🚀</div>
      <h3>¡Acceso registrado!</h3>
      <p>Te hemos añadido a la lista prioritaria para el segmento de <strong>{SEGMENTS.get(segment, {}).get('label', segment)}</strong>.<br>Te enviaremos novedades en primicia.</p>
      <button onclick="closeModal()" class="btn" style="background:#1e293b;color:#f1f5f9;box-shadow:none;">Cerrar</button>
    </div>
  </div>

  <script>
    const form = document.getElementById('leadForm');
    const modal = document.getElementById('modalOverlay');

    form.addEventListener('submit', async (e) => {{
      // Si estamos navegando de forma local (archivo://), simulamos el envío para no fallar
      if (window.location.protocol === 'file:') {{
        e.preventDefault();
        modal.classList.add('active');
        return;
      }}
      
      // Si hay servidor, enviamos por fetch para evitar recargar y mostrar modal elegante
      e.preventDefault();
      const email = document.getElementById('emailInput').value;
      try {{
        const response = await fetch('/signup', {{
          method: 'POST',
          headers: {{
            'Content-Type': 'application/x-www-form-urlencoded',
          }},
          body: `email=${{encodeURIComponent(email)}}&segment={segment}`
        }});
        if (response.ok) {{
          modal.classList.add('active');
          form.reset();
        }} else {{
          alert('Hubo un problema. Inténtalo de nuevo.');
        }}
      }} catch (err) {{
        console.error('Error al enviar:', err);
        // Fallback en caso de problemas de red
        modal.classList.add('active');
      }}
    }});

    function closeModal() {{
      modal.classList.remove('active');
    }}
  </script>
</body>
</html>"""

    # Escribir el archivo
    output_path = Path(__file__).parent / f"landing_{segment}.html"
    output_path.write_text(html_content, encoding="utf-8")
    return html_content, output_path

# ── Actualización de Base de Datos ───────────────────────────────────────────

def promote_to_testing(segment: str, filename: str, label: str = None):
    """Actualiza la oportunidad en DB marcando status='testing' y definiendo el deadline."""
    conn = get_conn()
    try:
        # 1. Obtener la oportunidad actual o crear una base
        opps = get_opportunities()
        existing = next((o for o in opps if o["segment"] == segment), None)
        
        from schema import compute_opportunity_score, income_tier_score, urgency_score
        
        # Calcular breakdown base si no existiese
        inc_score = 5.0
        urg_score = 0.0
        try:
            if segment in SEGMENTS:
                inc_score = float(income_tier_score(segment))
                urg_score = float(urgency_score(segment))
        except Exception:
            pass

        breakdown = {
            "dolor": 5.0,
            "capacidad_pago": inc_score,
            "volumen": 5.0,
            "competencia": 5.0,
            "urgencia": urg_score
        }
        if existing:
            try:
                breakdown = json.loads(existing["score_breakdown"]) if isinstance(existing["score_breakdown"], str) else existing["score_breakdown"]
            except Exception:
                pass

        now = datetime.utcnow()
        deadline = now + timedelta(days=7) # 7 días para validar por defecto

        opp = Opportunity(
            id=existing["id"] if existing else Opportunity.__dataclass_fields__["id"].default_factory(),
            segment=segment,
            pain_summary=existing["pain_summary"] if existing else f"Validación de dolor: {label or segment}",
            score=existing["score"] if existing else compute_opportunity_score(breakdown),
            score_breakdown=breakdown,
            signal_ids=json.loads(existing["signal_ids"]) if (existing and existing["signal_ids"]) else [],
            signal_count=existing["signal_count"] if existing else 0,
            first_seen=datetime.fromisoformat(existing["first_seen"]) if existing else now,
            last_updated=now,
            status="testing", # Poner en fase testing
            landing_url=filename,
            emails_captured=existing["emails_captured"] if existing else 0,
            validation_deadline=deadline
        )
        
        upsert_opportunity(opp)
        print(f"\n📈 Base de datos actualizada:")
        print(f"   · Segmento: [cyan]{segment}[/cyan] -> Status: [yellow]testing[/yellow]")
        print(f"   · URL asignada: {filename}")
        print(f"   · Límite de validación: {deadline.strftime('%Y-%m-%d %H:%M UTC')} (7 días)")
    except Exception as e:
        print(f"Error actualizando base de datos: {e}")
    finally:
        conn.close()

# ── Servidor de validación interactivo ───────────────────────────────────────

class LandingRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Silenciar logs normales para mantener consola limpia
        pass

    def do_GET(self):
        segment = self.server.segment
        filename = f"landing_{segment}.html"
        filepath = Path(__file__).parent / filename

        if self.path == "/" or self.path == f"/{filename}":
            if not filepath.exists():
                # Regenerar al vuelo por si acaso
                generate_landing_html(segment)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(filepath.read_bytes())
        else:
            self.send_error(404, "Recurso no encontrado")

    def do_POST(self):
        if self.path == "/signup":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length).decode('utf-8')
            params = urllib.parse.parse_qs(post_data)

            email_list = params.get('email', [''])
            email = email_list[0].strip()
            segment = self.server.segment

            if email and "@" in email:
                # 1. Registrar email en logs y actualizar base de datos
                success = register_lead(segment, email)
                if success:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"status": "ok"}).encode('utf-8'))
                    return
            
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Invalid email")
        else:
            self.send_error(404)

def register_lead(segment: str, email: str) -> bool:
    """Registra el email y sube en 1 el contador emails_captured de la DB SQLite."""
    # Escribir en un archivo de log local de leads para persistencia pura
    log_dir = Path(__file__).parent / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / "captured_leads.jsonl"
    
    lead = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "segment": segment,
        "email": email
    }
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(lead) + "\n")

    # Actualizar la DB SQLite
    conn = get_conn()
    try:
        # Obtener contador actual
        row = conn.execute("SELECT id, emails_captured, status, score FROM opportunities WHERE segment = ?", (segment,)).fetchone()
        if row:
            opp_id = row["id"]
            current_emails = row["emails_captured"] or 0
            new_emails = current_emails + 1
            
            # Si supera el umbral de escala, aplicar regla y poner en "scaling"
            status = row["status"]
            score = row["score"] or 0.0
            
            # En base a schema.py:
            # SCALE_SCORE_THRESHOLD = 8.0, scale_threshold_emails = 30
            if score >= 8.0 and new_emails >= 30 and status == "testing":
                status = "scaling"
                print(f"\n🎉 [bold green]¡Métrica de validación alcanzada![/bold green] Oportunidad {segment} promovida a [bold green]scaling[/bold green] (30+ leads).")

            conn.execute(
                "UPDATE opportunities SET emails_captured = ?, status = ?, last_updated = ? WHERE id = ?",
                (new_emails, status, datetime.utcnow().isoformat(), opp_id)
            )
            conn.commit()
            print(f"   ✉️ Lead capturado: [cyan]{email}[/cyan] | Total de leads para '{segment}': {new_emails}")
            return True
    except Exception as e:
        print(f"Error registrando lead en SQLite: {e}")
    finally:
        conn.close()
    return False

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Lanzador de Landing Pages de validación")
    parser.add_argument("--segment", required=True,
                        help="Segmento/sector del cual generar la landing (puede ser uno nuevo o existente)")
    parser.add_argument("--serve", nargs="?", const="8080", type=str,
                        help="Inicia el servidor web local para capturar correos (opcional puerto, default: 8080)")
    parser.add_argument("--label", help="Nombre descriptivo completo para el sector si es nuevo")
    parser.add_argument("--title", help="Título principal personalizado para la landing")
    parser.add_argument("--subtitle", help="Subtítulo personalizado para la landing")
    parser.add_argument("--cta", help="Texto del botón de llamada a la acción (CTA) personalizado")
    parser.add_argument("--benefits", help="Beneficios en formato JSON (lista de arrays [Título, Descripción, Emoji])")
    parser.add_argument("--quotes", help="Quejas/comentarios del sector en formato JSON (lista de strings)")
    args = parser.parse_args()

    segment = args.segment
    filename = f"landing_{segment}.html"
    
    # Procesar JSON si viene
    benefits_list = None
    if args.benefits:
        try:
            benefits_list = json.loads(args.benefits)
        except Exception as e:
            print(f"⚠️ Error parseando --benefits JSON: {e}")

    quotes_list = None
    if args.quotes:
        try:
            quotes_list = json.loads(args.quotes)
        except Exception as e:
            print(f"⚠️ Error parseando --quotes JSON: {e}")

    # Determinar etiqueta descriptiva
    label = args.label
    if not label:
        if segment in SEGMENTS:
            label = SEGMENTS[segment]["label"]
        else:
            label = segment.replace("_", " ").capitalize()

    # 1. Generar el archivo HTML estático
    print(f"🛠️ Generando landing page específica para el sector '{label}'...")
    _, filepath = generate_landing_html(
        segment,
        title=args.title,
        subtitle=args.subtitle,
        cta=args.cta,
        benefits_list=benefits_list,
        quotes_list=quotes_list
    )
    print(f"✨ ¡Landing page generada con éxito en: {filepath.name}")

    # 2. Promover oportunidad en DB
    promote_to_testing(segment, filename, label=label)

    # 3. Servir si se solicita
    if args.serve:
        port = int(args.serve)
        server = HTTPServer(("localhost", port), LandingRequestHandler)
        server.segment = segment
        
        print(f"\n==================================================")
        print(f"🚀 SERVIDOR DE VALIDACIÓN INTERACTIVO ACTIVO")
        print(f"   Dirección local: http://localhost:{port}")
        print(f"   Puedes abrir este link en tu navegador y probar")
        print(f"   a ingresar un correo para simular el embudo.")
        print(f"   (Presiona Ctrl+C para detener el servidor)")
        print(f"==================================================\n")
        
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n👋 Servidor apagado.")

if __name__ == "__main__":
    main()
