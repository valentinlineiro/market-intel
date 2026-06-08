import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectBluesky } from '../../infrastructure/collectors/bluesky.js';

afterEach(() => vi.restoreAllMocks());

const BSKY_RESPONSE = {
  posts: [
    {
      uri: 'at://did:plc:abc123/app.bsky.feed.post/xyz789',
      author: { did: 'did:plc:abc123', handle: 'gestor.bsky.social' },
      record: {
        text: 'Problema horrible con verifactu hacienda no puedo más',
        createdAt: '2024-01-15T10:00:00Z',
      },
      likeCount: 8,
      replyCount: 3,
      repostCount: 1,
    },
  ],
};

describe('collectBluesky', () => {
  it('returns signals from posts matching keywords', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => BSKY_RESPONSE }));
    const signals = await collectBluesky(['verifactu', 'hacienda'], 'dentista', 25);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]!.source).toBe('bluesky');
    expect(signals[0]!.segment).toBe('dentista');
  });

  it('builds correct bsky.app URL from at:// URI', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => BSKY_RESPONSE }));
    const signals = await collectBluesky(['verifactu'], 'dentista', 25);
    expect(signals[0]!.url).toBe('https://bsky.app/profile/gestor.bsky.social/post/xyz789');
  });

  it('sets signal fields correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => BSKY_RESPONSE }));
    const signals = await collectBluesky(['verifactu'], 'dentista', 25);
    const s = signals[0]!;
    expect(s.id).toBeTruthy();
    expect(s.pain_keywords).toContain('verifactu');
    expect(s.signal_strength).toBeGreaterThan(0);
    expect(s.signal_strength).toBeLessThanOrEqual(1);
  });

  it('skips posts with no keyword match and neutral sentiment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        posts: [{ uri: 'at://did/app.bsky.feed.post/1', author: { did: 'did', handle: 'x.bsky.social' },
          record: { text: 'Buen día a todos!', createdAt: '2024-01-01T00:00:00Z' },
          likeCount: 0, replyCount: 0, repostCount: 0 }],
      }),
    }));
    const signals = await collectBluesky(['verifactu'], 'dentista', 25);
    expect(signals).toHaveLength(0);
  });

  it('deduplicates posts with same URI across keyword searches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => BSKY_RESPONSE }));
    const signals = await collectBluesky(['verifactu', 'hacienda'], 'dentista', 25);
    const uris = signals.map(s => s.url);
    expect(new Set(uris).size).toBe(uris.length);
  });

  it('handles fetch error gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const signals = await collectBluesky(['verifactu'], 'dentista', 25);
    expect(signals).toHaveLength(0);
  });
});
