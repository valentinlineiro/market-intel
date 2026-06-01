SEGMENTS: dict[str, dict] = {
    "dentista": {
        "label": "Dentista / Clínica dental",
        "salary_min": 25_000, "salary_mean": 66_500, "salary_max": 120_000,
        "income_tier": "high",
        "population_spain": 35_000, "population_cadiz": 400,
        "pain_keywords": [
            "verifactu", "software homologado", "hacienda", "facturación",
            "rrsif", "multa", "gestión clínica", "historia clínica",
            "seguros dentales", "cuadro médico", "aseguradora",
        ],
        "active_deadline": "2026-01-01",
        "competition_proxy": 4.0,
    },
    "docente_universitario": {
        "label": "Docente universitario (PDI)",
        "salary_min": 28_000, "salary_mean": 42_000, "salary_max": 65_000,
        "income_tier": "medium_high",
        "population_spain": 120_000, "population_cadiz": 1_800,
        "pain_keywords": [
            "aneca", "acreditación", "docentia", "sexenio", "quinquenio",
            "expediente", "méritos", "tramos", "evaluación docente",
            "plaza", "concurso oposición",
        ],
        "active_deadline": None,
        "competition_proxy": 8.5,
    },
    "abogado_autonomo": {
        "label": "Abogado autónomo / despacho pequeño",
        "salary_min": 18_000, "salary_mean": 35_000, "salary_max": 150_000,
        "income_tier": "medium_high",
        "population_spain": 180_000, "population_cadiz": 2_500,
        "pain_keywords": [
            "gestoría", "contabilidad", "irpf", "iva trimestral",
            "facturación electrónica", "agenda", "expedientes",
            "turnos de oficio", "honorarios", "lexnet",
        ],
        "active_deadline": None,
        "competition_proxy": 6.0,
    },
    "arquitecto": {
        "label": "Arquitecto / estudio pequeño",
        "salary_min": 16_000, "salary_mean": 28_500, "salary_max": 65_000,
        "income_tier": "medium",
        "population_spain": 50_000, "population_cadiz": 800,
        "pain_keywords": [
            "visado colegial", "licencia obras", "ayuntamiento",
            "presupuesto", "certificado energético", "iee",
            "promotor", "burocracia",
        ],
        "active_deadline": None,
        "competition_proxy": 7.5,
    },
}

SALARY_TIERS: dict[str, int] = {
    "high": 10,
    "medium_high": 7,
    "medium": 5,
    "low": 2,
}
