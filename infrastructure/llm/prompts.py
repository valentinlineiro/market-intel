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

SECTOR_COPY: dict[str, dict] = {
    "dentista": {
        "title": "Simplifica Verifactu en tu Clínica Dental",
        "subtitle": "Facturación electrónica homologada diseñada exclusivamente para odontólogos. Sin cuotas abusivas, sin configuraciones complejas, 100% adaptado a la normativa de Hacienda.",
        "benefits": [
            ("Hacienda bajo control", "Olvídate de las multas de hasta 50.000€. Cumplimiento estricto del reglamento RRSIF/Verifactu en cada factura emitida.", "🛡️"),
            ("Gestión clínica fluida", "Agenda, historial de pacientes y facturación vinculados en una interfaz limpia que no requiere formación previa.", "⚡"),
            ("Seguros sin complicaciones", "Carga y facturación automática con cuadros médicos y aseguradoras en un clic.", "🦷"),
        ],
        "cta": "Quiero acceso prioritario (Beta cerrada)",
    },
    "docente_universitario": {
        "title": "Supera ANECA y Docentia sin perder la cabeza",
        "subtitle": "La plataforma inteligente que organiza, valida y estructura tus méritos investigadores y docentes. Diseñado por y para académicos que prefieren investigar a rellenar formularios.",
        "benefits": [
            ("Acreditación en tiempo récord", "Clasificación automática de publicaciones, tramos de investigación y patentes según los criterios exactos de ANECA.", "🎓"),
            ("Predicción de Sexenios", "Algoritmo de scoring que evalúa las posibilidades de éxito de tus aportaciones antes de enviarlas.", "📈"),
            ("Gestión de CVN limpia", "Importa y exporta tu Curriculum Vitae Normalizado (CVN/FECYT) en un clic sin descuadres de formato.", "📁"),
        ],
        "cta": "Simplificar mi acreditación ahora",
    },
    "abogado_autonomo": {
        "title": "La gestión de expedientes y facturas que los abogados merecen",
        "subtitle": "Controla LexNet, automatiza tu contabilidad e IVA trimestral, y gestiona tus minutas desde un entorno móvil ágil diseñado para abogados independientes.",
        "benefits": [
            ("Integración fluida de LexNet", "Recibe alertas de plazos y notificaciones directamente integradas con tu agenda de pleitos.", "⚖️"),
            ("Minutas y facturas sin esfuerzo", "Generación automática de facturas electrónicas conformes y envío automatizado de recordatorios de cobro.", "💵"),
            ("Expedientes digitalizados", "Toda la documentación del caso clasificada y accesible desde cualquier dispositivo de forma ultra-segura.", "🔒"),
        ],
        "cta": "Probar 14 días gratis",
    },
    "arquitecto": {
        "title": "Gestiona tus proyectos y visados sin burocracia",
        "subtitle": "De la medición al visado colegial en tiempo récord. Centraliza presupuestos, libros de edificio y certificados energéticos en una única plataforma ágil.",
        "benefits": [
            ("Bucle de Visado Rápido", "Plantillas y checklists adaptadas a los colegios oficiales para asegurar que aprueben tus visados a la primera.", "📐"),
            ("Presupuestos y mediciones", "Generación limpia de presupuestos y control de costes de obra en tiempo real sin hojas de cálculo rotas.", "📊"),
            ("Certificados en minutos", "Generación simplificada de IEEs y certificados energéticos con plantillas validadas oficiales.", "🌿"),
        ],
        "cta": "Empezar a optimizar mis proyectos",
    },
}
