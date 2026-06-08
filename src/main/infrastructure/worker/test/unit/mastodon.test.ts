import { describe, it, expect, vi, afterEach } from 'vitest';
import { collectMastodon } from '../../infrastructure/collectors/mastodon.js';

afterEach(() => vi.restoreAllMocks());

const MASTODON_RESPONSE = {
  statuses: [
    {
      id: '112345678',
      url: 'https://mastodon.social/@gestor/112345678',
      content: '<p>Problema horrible con <a href="#">verifactu</a>, hacienda me tiene loco. No puedo más con esta burocracia.</p>',
      reblogs_count: 2,
      favourites_count: 7,
      replies_count: 3,
      account: { acct: 'gestor' },
      created_at: '2024-01-15T10:00:00Z',
    },
  ],
};

describe('collectMastodon', () => {
  it('returns signals from statuses matching keywords', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MASTODON_RESPONSE }));
    const signals = await collectMastodon(['verifactu', 'hacienda'], 'dentista', ['mastodon.social'], 20);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0]!.source).toBe('mastodon');
    expect(signals[0]!.segment).toBe('dentista');
  });

  it('strips HTML from status content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MASTODON_RESPONSE }));
    const signals = await collectMastodon(['verifactu'], 'dentista', ['mastodon.social'], 20);
    expect(signals[0]!.raw_text).not.toContain('<p>');
    expect(signals[0]!.raw_text).not.toContain('<a href=');
    expect(signals[0]!.raw_text).toContain('verifactu');
  });

  it('sets signal fields correctly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MASTODON_RESPONSE }));
    const signals = await collectMastodon(['verifactu'], 'dentista', ['mastodon.social'], 20);
    const s = signals[0]!;
    expect(s.id).toBeTruthy();
    expect(s.url).toBe('https://mastodon.social/@gestor/112345678');
    expect(s.signal_strength).toBeGreaterThan(0);
    expect(s.signal_strength).toBeLessThanOrEqual(1);
  });

  it('queries each instance and deduplicates by URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => MASTODON_RESPONSE }));
    const signals = await collectMastodon(['verifactu'], 'dentista', ['mastodon.social', 'mastodon.es'], 20);
    const urls = signals.map(s => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('skips statuses with no keyword match and neutral sentiment', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        statuses: [{
          id: '1', url: 'https://mastodon.social/@x/1',
          content: '<p>Buenos días a todos</p>',
          reblogs_count: 0, favourites_count: 0, replies_count: 0,
          account: { acct: 'x' }, created_at: '2024-01-01T00:00:00Z',
        }],
      }),
    }));
    const signals = await collectMastodon(['verifactu'], 'dentista', ['mastodon.social'], 20);
    expect(signals).toHaveLength(0);
  });

  it('handles fetch error per instance gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const signals = await collectMastodon(['verifactu'], 'dentista', ['mastodon.social'], 20);
    expect(signals).toHaveLength(0);
  });
});
