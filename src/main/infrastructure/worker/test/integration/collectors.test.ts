import { describe, it, expect } from 'vitest';
import { collectGnews } from '../../infrastructure/collectors/gnews.js';
import { collectLocalNews } from '../../infrastructure/collectors/local_news.js';
import type { GnewsSegmentConfig, Config } from '../../domain/types.js';

const RUN = process.env['CI_INTEGRATION'] === '1';

// ---------------------------------------------------------------------------
// collectGnews
// ---------------------------------------------------------------------------

describe.skipIf(!RUN)('collectGnews', () => {
  it('returns Signal[] for at least one segment', async () => {
    const apiKey = process.env['GNEWS_API_KEY'] ?? '';

    const segments: Record<string, GnewsSegmentConfig> = {
      dentista: {
        label:        'Dentista',
        queries:      ['verifactu dentista'],
        keywords:     ['verifactu', 'hacienda', 'multa'],
        salary_mean:  66500,
        income_tier:  'high',
        has_deadline: true,
      },
    };

    const signals = await collectGnews(segments, apiKey);

    expect(Array.isArray(signals)).toBe(true);
    for (const s of signals) {
      expect(s.id).toBeTruthy();
      expect(s.source).toBe('gnews');
      expect(s.collected_at).toBeTruthy();
      expect(s.segment).toBe('dentista');
      expect(s.location).toBeNull();
      expect(typeof s.raw_text).toBe('string');
      expect(typeof s.url).toBe('string');
      expect(Array.isArray(s.pain_keywords)).toBe(true);
      expect(s.income_tier).toBe('high');
      expect(s.salary_mean).toBe(66500);
      expect(s.has_deadline).toBe(true);
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// collectLocalNews
// ---------------------------------------------------------------------------

describe.skipIf(!RUN)('collectLocalNews', () => {
  it('returns Signal[] from real RSS feed', async () => {
    const cfg: Config['collectors']['local_news'] = {
      enabled:        true,
      feeds:          [
        { url: 'https://www.20minutos.es/rss/noticia/', location: 'España' },
      ],
      pain_keywords:  [
        'problema', 'queja', 'multa', 'burocracia', 'retraso', 'lento', 'caro',
        'imposible', 'denuncia', 'fallo', 'error', 'cierre', 'crisis', 'huelga',
      ],
    };

    const signals = await collectLocalNews(cfg);

    expect(Array.isArray(signals)).toBe(true);
    for (const s of signals) {
      expect(s.id).toBeTruthy();
      expect(s.source).toBe('local_news');
      expect(s.collected_at).toBeTruthy();
      expect(s.segment).toBe('general');
      expect(s.location).toBe('España');
      expect(typeof s.raw_text).toBe('string');
      expect(typeof s.url).toBe('string');
      expect(Array.isArray(s.pain_keywords)).toBe(true);
      expect(s.salary_mean).toBeNull();
      expect(s.income_tier).toBeNull();
      expect(s.has_deadline).toBe(false);
    }
  }, 30_000);
});
