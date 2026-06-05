# Evolución: Sistema automático de ideas + validación

## 1. Estado actual (sistema base)

```
GNews RSS ─┐                     ┌─ LLM clustering ─→ DiscoveryCandidate
Local News ─┼─→ Signal ─→ D1 ───┼─ Scoring ─────────→ Opportunity
           └─────────────────────┴─ Synthesis ──────→ Landing Page
```

- **Collectors**: 2 (GNews, RSS noticias locales)
- **Discovery**: LLM clustering sobre textos HN + Google News RSS
- **Scoring**: 5 factores planos (dolor 30%, pago 25%, volumen 20%, competencia 15%, urgencia 10%)
- **Output**: Oportunidades con score → landing pages de validación
- **Infra**: Cloudflare Worker + D1 + Pages (SvelteKit) + Email

## 2. Estado objetivo

```
FUENTES (pasivas + activas) → EXTRACCIÓN → FRICCIÓN LLM → CLUSTERING embeddings → SCORING mejorado → OUTPUT dashboard
```

### 2.1 Nuevas fuentes de datos

#### Pasivas (donde la gente se queja)

| Fuente | API/Acceso | Prioridad | Viabilidad Workers |
|--------|-----------|-----------|-------------------|
| **Reddit** (subreddits nicho) | Reddit JSON API (sin auth para público) | Alta | ✅ Fácil |
| **StackOverflow** | Stack Exchange API | Alta | ✅ Fácil |
| **GitHub Issues** | GitHub REST API | Alta | ✅ Fácil |
| **YouTube comentarios** | YouTube Data API v3 | Media | ✅ Factible |
| **G2/Capterra reseñas** | Scraping (no API libre) | Media | ⚠️ Lento, usar externo |
| **Foros técnicos** | RSS/Atom feeds | Media | ✅ Fácil |
| **Facebook/LinkedIn** | APIs muy restrictivas | Baja | ❌ No recomendado |

#### Semi-estructuradas

| Fuente | API/Acceso | Prioridad | Viabilidad Workers |
|--------|-----------|-----------|-------------------|
| **Job posts** (LinkedIn, Indeed) | Scraping o APIs de pago | Alta | ⚠️ Limitado |
| **Changelogs SaaS** | RSS/Atom + APIs públicas | Media | ✅ Fácil |
| **Comparativas "X vs Y"** | Google Search + scrap | Baja | ⚠️ Complejo |
| **Listings de herramientas** | Product Hunt API, etc | Media | ✅ Factible |

#### Activas (input manual)

| Fuente | Implementación |
|--------|---------------|
| Observaciones propias | API endpoint `POST /signals` ya existe |
| Conversaciones | Formulario en dashboard + endpoint |

### 2.2 Pipeline de extracción (collectors)

Cada collector implementa la misma interfaz:

```typescript
interface ICollector {
  source: SignalSource; // 'reddit' | 'stackoverflow' | 'github' | ...
  collect(): Promise<RawSignal[]>;
}

interface RawSignal {
  source: SignalSource;
  platform: string;
  raw_text: string;
  url: string;
  context: string;           // título del hilo, contexto de la review
  author_type: 'usuario' | 'profesional' | 'empresa';
  collected_at: string;
  engagement?: {
    upvotes?: number;
    replies?: number;
    views?: number;
    score?: number;
  };
}
```

Los collectors se agrupan en batches para la cron:

```
Cron (cada 6h actual, cambiar a configurable):
  1. Colectores rápidos (Reddit, StackOverflow, GitHub) → signals
  2. Friction detection (LLM batch) → enrich signals
  3. Score opportunities existentes
  4. Notificar si hay novedades

Cron semanal (o manual):
  1. Discovery completo (todas las fuentes)
  2. Embeddings → clustering
  3. Scoring completo → detectar nuevos clusters
```

### 2.3 Friction detection (detección de fricción)

Nueva capa entre collect y discover. Toma signals crudas y extrae datos estructurados de fricción.

```typescript
interface FrictionAnalysis {
  problema: string;                    // "crear informes DOCENTIA"
  dolor: 'bajo' | 'medio' | 'alto';
  workaround: string | null;           // "Word manual + copy pasting"
  frecuencia_inferida: 'único' | 'trimestral' | 'mensual' | 'semanal' | 'diario';
  intensidad: number;                  // 1-10
  frustracion_tipo: 'emocional' | 'operativa' | 'ambas' | null;
  sennales_coste_tiempo: string[];     // ["pierdo 3 horas cada vez"]
  lenguaje_dolor: string[];            // frases literales de queja
}
```

Prompt LLM especializado:

```
Analiza el siguiente texto de un profesional/ usuario real.
Extrae el problema subyacente, el nivel de dolor, el workaround actual,
y cualquier señal de coste de tiempo o frustración.

Texto: {raw_text}
Contexto: {context}
Fuente: {source}

Devuelve SOLO JSON:
{
  "problema": "...",
  "dolor": "bajo|medio|alto",
  "workaround": "...",
  "frecuencia_inferida": "único|trimestral|mensual|semanal|diario",
  "intensidad": N,
  "frustracion_tipo": "emocional|operativa|ambas|null",
  "coste_tiempo_sennales": ["...", ...],
  "lenguaje_dolor": ["...", "...", ...]
}
```

Se ejecuta en batches de ~10 signals por llamada LLM (similar al clustering actual).

### 2.4 Clustering por embeddings

El cambio más importante vs el sistema actual (hoy usa solo LLM).

**Arquitectura**:

```
Signals enriquecidas con friction
       │
       ▼
Generar embeddings (Workers AI o API externa)
       │
       ▼
DBSCAN clustering en memoria (JS implementation)
       │
       ▼
Por cada cluster → LLM extrae problema normalizado + recomendación
       │
       ▼
ProblemCluster { problema, variantes, signals, sources, score }
```

**Embeddings**: Workers AI tiene modelos de embeddings:

```
@cf/baai/bge-base-en-v1.5  (768 dimensiones, EN)
O usar OpenAI text-embedding-3-small via API
```

Para eficiencia en Workers, usar un modelo pequeño.

**Clustering (DBSCAN simplificado)**:

```typescript
interface ProblemCluster {
  id: string;
  problema_normalizado: string;  // LLM-generated
  variantes: string[];           // distintas formas de expresarlo
  signal_ids: string[];
  sources: Record<SignalSource, number>;  // distribución de fuentes
  signal_count: number;
  score_agregado: number;
  dolor_promedio: number;
  workaround_comun: string | null;
  evidencia_urls: string[];      // links a posts/hilos
}
```

DBSCAN no requiere número de clusters a priori (ventaja vs k-means). Implementación ligera en TS cabe en Workers.

### 2.5 Scoring mejorado

El scoring actual:

```typescript
SCORE_WEIGHTS = {
  dolor: 0.30,
  capacidad_pago: 0.25,
  volumen: 0.20,
  competencia: 0.15,
  urgencia: 0.10,
};
```

Scoring objetivo:

```typescript
SCORE_WEIGHTS_V2 = {
  dolor: 0.25,
  capacidad_pago: 0.15,
  volumen_menciones: 0.15,
  repeticion_entre_fuentes: 0.10,  // NUEVO: aparece en Reddit Y StackOverflow
  coste_estimado_problema: 0.10,    // NUEVO: horas perdidas × tarifa
  existencia_solucion_mala: 0.10,   // NUEVO: hay solución pero es mala
  contexto_b2b: 0.10,              // NUEVO: contexto profesional vale más
  urgencia: 0.05,
};
```

**repetición_entre_fuentes**: Un problema que aparece en Reddit, StackOverflow y reseñas G2 es mucho más validado que uno que solo aparece en Reddit.

**coste_estimado_problema**: Derivado de la friction analysis (frecuencia × horas perdidas × tarifa del segmento).

**existencia_solucion_mala**: Si hay workaround pero es manual/ineficiente → puntúa alto.

**contexto_b2b**: Los problemas de empresas puntúan más que problemas personales.

### 2.6 Output final: Hot Problems Dashboard

El sistema produce una estructura como esta:

```typescript
interface HotProblem {
  problema: string;
  evidencia: Array<{
    fuente: string;
    url: string;
    cita: string;
    autor_tipo: string;
  }>;
  frecuencia_estimada: string;
  por_que_duele: string;
  soluciones_actuales: Array<{
    nombre: string;
    por_que_es_mala: string;
  }>;
  score_total: number;
  score_breakdown: EnhancedScoreBreakdown;
  cluster_id: string;
  recomendacion: 'ignorar' | 'explorar' | 'atacar';
  signal_count: number;
  source_breakdown: Record<string, number>;
}
```

El dashboard en Pages muestra:
- **🔴 Top 10 problemas calientes** (tabla principal)
- Cada problema expandible: evidencia real (links + citas textuales), frecuencia estimada, por qué duele, soluciones actuales y por qué son malas, recomendación
- **Por fuente**: cuántos signals vienen de cada fuente
- **Trending**: problemas que están ganando tracción

## 3. Mapa de implementación

### Fase 0 — Scoring fixes (prioridad máxima, ~2h)

**Por qué primero**: El scoring actual no discrimina correctamente (dentistas genérico puntúa más alto que dentistas con problema concreto). Sin scoring correcto, cualquier dato nuevo que añadamos produce decisiones erróneas.

- [ ] Revisar `dolorScore()` — pondera demasiado volumen sobre intensidad
- [ ] Ajustar pesos en `SCORE_WEIGHTS` para que problema concreto > volumen genérico
- [ ] Re-ejecutar market tests para verificar que dentista concreto > autónomo genérico
- [ ] Migrar DB si cambian campos

### Fase 1 — Friction detection (prioridad alta, 1-2 días)

**Por qué segundo**: Se ejecuta sobre datos GNews que ya existen. No espera a nuevos collectors. Mejora inmediata de calidad de señal.

- [ ] Nuevo módulo `application/friction.ts` con prompt LLM especializado
- [ ] Extrae: problema, dolor, workaround, frecuencia inferida, intensidad, tipo frustración
- [ ] Integrar en pipeline post-collect (cron cada 6h)
- [ ] Nuevo campo `friction_analysis` (JSON opcional) en Signal
- [ ] Tests unitarios con textos reales de ejemplo
- [ ] **Gate**: ¿mejora la calidad del scoring? Si sí, continuar. Si no, revisar prompts.

### Fase 2 — Validación: ¿cobertura o calidad?

Con scoring fijo + friction en datos GNews, responder:

- ¿Los problemas detectados son lo suficientemente específicos?
- ¿Hay suficiente volumen de señal en GNews por sí solo?
- ¿Qué clusters emergen? ¿Son nichos atacables?

**Decisión**:
- **Si falta señal específica** → Phase 3a: nuevos collectors (Reddit, etc.)
- **Si hay señal pero está desorganizada** → Phase 3b: clustering por embeddings
- **Si ambas** → Phase 3a + 3b en paralelo
- **Si el scoring aún no discrimina** → revisar factores antes de añadir datos

### Fase 3a — Nuevos collectors (condicional, 3-4 días)

Solo si la validación muestra que GNews no da suficiente señal concreta.

- [ ] Collector Reddit: `/r/askspain`, `/r/autonomos`, subreddits de nicho
- [ ] Collector StackOverflow: tags específicas españolas
- [ ] Collector GitHub Issues: issues de herramientas del sector
- [ ] Refactor `ISignalRepo` para nuevos campos

### Fase 3b — Clustering por embeddings (condicional, 3-4 días)

Solo si hay señal pero está desorganizada.

- [ ] Embeddings via Workers AI / API externa
- [ ] DBSCAN en TypeScript
- [ ] Módulo `application/cluster.ts`

### Fase 4 — Scoring expandido (bajo effort, 1 día)

Nuevos factores que aprovechan friction + clusters:

- [ ] `repeticion_entre_fuentes` — validado solo si hay múltiples fuentes
- [ ] `coste_estimado_problema` — desde friction analysis
- [ ] `existencia_solucion_mala` — desde workaround detection
- [ ] `contexto_b2b` — desde author_type
- [ ] Ajustar `SCORE_WEIGHTS` en rules.ts

### Fase 5 — Hot Problems Dashboard (2-3 días)

- [ ] Endpoint `/public/hot-problems`
- [ ] Vista en Pages con 🔴 Top 10 problemas calientes
- [ ] Evidencia expandible con citas textuales y URLs
- [ ] Filtros por fuente, score, recomendación

## 4. Cambios en la base de datos (D1)

```sql
-- Nuevos campos en signals
ALTER TABLE signals ADD COLUMN friction_analysis TEXT;  -- JSON de FrictionAnalysis
ALTER TABLE signals ADD COLUMN embedding TEXT;           -- JSON de vector embedding
ALTER TABLE signals ADD COLUMN cluster_id TEXT;          -- referencia a cluster
ALTER TABLE signals ADD COLUMN author_type TEXT;         -- 'usuario'|'profesional'|'empresa'
ALTER TABLE signals ADD COLUMN source_context TEXT;      -- título del hilo, etc
ALTER TABLE signals ADD COLUMN engagement TEXT;          -- JSON { upvotes, replies, views }

-- Nuevos campos en opportunities
ALTER TABLE opportunities ADD COLUMN cross_source_count INTEGER DEFAULT 0;
ALTER TABLE opportunities ADD COLUMN source_breakdown TEXT;   -- JSON
ALTER TABLE opportunities ADD COLUMN estimated_cost TEXT;     -- e.g. "3h/semana × 50€/h"
ALTER TABLE opportunities ADD COLUMN recommendation TEXT;     -- 'explorar'|'atacar'|'ignorar'
ALTER TABLE opportunities ADD COLUMN evidence_urls TEXT;      -- JSON array de links
ALTER TABLE opportunities ADD COLUMN current_solutions TEXT;  -- JSON array

-- Nueva tabla para clusters
CREATE TABLE IF NOT EXISTS problem_clusters (
  id TEXT PRIMARY KEY,
  problema_normalizado TEXT NOT NULL,
  variantes TEXT NOT NULL,           -- JSON array
  signal_ids TEXT NOT NULL,          -- JSON array
  signal_count INTEGER DEFAULT 0,
  source_breakdown TEXT,             -- JSON
  score_agregado REAL DEFAULT 0,
  dolor_promedio REAL DEFAULT 0,
  workaround_comun TEXT,
  embedding_centroid TEXT,           -- JSON vector
  created_at TEXT NOT NULL,
  last_updated TEXT NOT NULL
);
```

## 5. Consideraciones técnicas

### Embeddings en Workers AI
```typescript
const embeddings = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
  text: ['texto 1', 'texto 2', ...]
});
// → vector de 768 dimensiones por texto
```

Workers AI runs on same infra, baja latencia, pero el modelo bge-base-en-v1.5 está optimizado para inglés. Para español, considerar:
- `@cf/intfloat/multilingual-e5-large` (multilingüe)
- O usar API externa (OpenAI text-embedding-3-small soporta español)

### DBSCAN ligero
Implementación en ~100 líneas de TS. Parámetros clave:
- `eps`: distancia máxima entre puntos del mismo cluster (ajustable)
- `minPts`: mínimo de puntos para formar cluster

Para vectores de 768d, la distancia coseno es más eficiente que euclídea.

### Límites de Workers
- CPU: 30s por request, 120s en cron → suficiente para batches de 50-100 signals
- Memoria: 128MB → embeddings de 100 signals × 768 floats × 8 bytes ≈ 600KB, sin problema
- D1: 1M rows por database, 10GB storage → más que suficiente

### Arquitectura de pipelines

```
Cada 6h (cron principal):
  collect_all() → signals crudas
  friction_detect(batch=50) → signals enriquecidas
  score_existing() → actualizar opportunities

Cada 7 días (cron discovery):
  collect_all()
  friction_detect(all)
  generate_embeddings(all)
  dbscan_cluster(embeddings)
  llm_normalize(clusters) → problem_clusters
  score_clusters() → hot problems
  notify()
```

## 6. Estructura de archivos nueva

```
src/main/infrastructure/worker/
├── application/
│   ├── collect.ts            # (existente) orquestador de collectors
│   ├── friction.ts           # NUEVO: LLM friction detection
│   ├── cluster.ts            # NUEVO: embeddings + DBSCAN
│   ├── discover.ts           # (existente) LLM clustering actual
│   ├── score.ts              # (mejorado) nuevo scoring
│   ├── synthesize.ts         # (existente)
│   └── market-test.ts        # (existente)
├── infrastructure/
│   ├── collectors/
│   │   ├── gnews.ts          # (existente)
│   │   ├── local_news.ts     # (existente)
│   │   ├── reddit.ts         # NUEVO
│   │   ├── stackoverflow.ts  # NUEVO
│   │   ├── github.ts         # NUEVO
│   │   └── youtube.ts        # NUEVO
│   ├── llm/
│   │   └── chain.ts          # (existente)
│   ├── embedding/            # NUEVO
│   │   └── provider.ts       # Workers AI / OpenAI wrapper
│   ├── clustering/           # NUEVO
│   │   └── dbscan.ts         # DBSCAN implementation
│   ├── db/
│   │   └── d1-repo.ts        # (mejorado) nuevos campos/métodos
│   ├── notify.ts             # (existente)
│   └── config.ts             # (existente)
├── domain/
│   ├── types.ts              # (mejorado) nuevos tipos
│   ├── scoring.ts            # (mejorado) nuevos factores
│   └── rules.ts              # (mejorado) nuevos weights
└── index.ts                  # (mejorado) nuevas rutas
```

## 7. Resumen de esfuerzo

| Fase | Archivos | Esfuerzo | Depende de |
|------|----------|----------|------------|
| **1** Fuentes | 3-5 nuevos collectors + refactor ports | 3-4 días | - |
| **2** Friction | 1 nuevo módulo + prompts LLM | 1-2 días | Fase 1 |
| **3** Clustering | 2 nuevos módulos (embedding + dbscan) | 3-4 días | Fase 2 |
| **4** Scoring | Modificar 3 existentes | 1 día | Fase 3 |
| **5** Dashboard | Nuevo endpoint + vista Pages | 2-3 días | Fase 3 |

**Total estimado**: 10-14 días
