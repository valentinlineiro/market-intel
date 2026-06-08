import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectYouTube } from '../../infrastructure/collectors/youtube.js';

afterEach(() => vi.restoreAllMocks());

function mockFetch(...responses: object[]) {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => {
    const body = responses[call++] ?? {};
    return { ok: true, json: async () => body };
  }));
}

const SEARCH_RESPONSE = {
  items: [
    { id: { videoId: 'vid123' }, snippet: { title: 'Problemas con Verifactu' } },
  ],
};

const COMMENTS_RESPONSE = {
  items: [
    {
      snippet: {
        topLevelComment: {
          snippet: {
            textDisplay: 'Esto es horrible, no puedo con verifactu, es un problema grave y caro',
            likeCount: 5,
            publishedAt: '2024-01-01T00:00:00Z',
          },
        },
      },
    },
  ],
};

describe('collectYouTube', () => {
  it('returns signals from video comments matching keywords', async () => {
    mockFetch(SEARCH_RESPONSE, COMMENTS_RESPONSE);
    const signals = await collectYouTube(['verifactu', 'hacienda'], 'dentista', 'KEY', 5, 20);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]!.source).toBe('youtube');
    expect(signals[0]!.segment).toBe('dentista');
    expect(signals[0]!.url).toContain('vid123');
  });

  it('sets signal fields correctly', async () => {
    mockFetch(SEARCH_RESPONSE, COMMENTS_RESPONSE);
    const signals = await collectYouTube(['verifactu'], 'dentista', 'KEY', 5, 20);
    const s = signals[0]!;
    expect(s.id).toBeTruthy();
    expect(s.raw_text).toContain('verifactu');
    expect(s.pain_keywords.length).toBeGreaterThan(0);
    expect(s.signal_strength).toBeGreaterThan(0);
    expect(s.signal_strength).toBeLessThanOrEqual(1);
    expect(s.has_deadline).toBe(false);
  });

  it('returns empty array when API key is missing', async () => {
    const signals = await collectYouTube(['verifactu'], 'dentista', '', 5, 20);
    expect(signals).toHaveLength(0);
  });

  it('returns empty array when search returns no videos', async () => {
    mockFetch({ items: [] });
    const signals = await collectYouTube(['verifactu'], 'dentista', 'KEY', 5, 20);
    expect(signals).toHaveLength(0);
  });

  it('skips comments with no keyword match and neutral sentiment', async () => {
    mockFetch(SEARCH_RESPONSE, {
      items: [
        {
          snippet: {
            topLevelComment: {
              snippet: { textDisplay: 'Buen video gracias', likeCount: 0, publishedAt: '2024-01-01T00:00:00Z' },
            },
          },
        },
      ],
    });
    const signals = await collectYouTube(['verifactu'], 'dentista', 'KEY', 5, 20);
    expect(signals).toHaveLength(0);
  });

  it('handles fetch errors gracefully and returns empty array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const signals = await collectYouTube(['verifactu'], 'dentista', 'KEY', 5, 20);
    expect(signals).toHaveLength(0);
  });
});
