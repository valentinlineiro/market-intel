import type { Collector } from '../../application/ports.js';
import type { Config, Signal } from '../../domain/types.js';
import type { Env } from '../../index.js';
import { collectGnews } from './gnews.js';
import { collectLocalNews } from './local_news.js';
import { collectGitHub } from './github.js';
import { collectStackOverflow } from './stackoverflow.js';
import { collectReddit } from './reddit.js';
import { collectYouTube } from './youtube.js';
import { collectBluesky } from './bluesky.js';
import { collectMastodon } from './mastodon.js';
import { collectHackerNews }  from './hackernews.js';
import { collectBOE }         from './boe.js';
import { collectBOJA }        from './boja.js';
import { collectBOCAs }       from './bocas.js';
import { collectBetaList }    from './betalist.js';
import { collectAppSumo }     from './appsumo.js';
import { collectProductHunt } from './producthunt.js';
import { collectINE }         from './ine.js';

export function buildRegistry(cfg: Config, env: Env): Collector[] {
  const segments = Object.entries(cfg.collectors.gnews.segments);

  return [
    {
      id: 'gnews',
      collect: () => collectGnews(cfg.collectors.gnews.segments, env.GROQ_API_KEY ?? ''),
    },
    {
      id: 'local_news',
      collect: () => collectLocalNews(cfg.collectors.local_news),
    },
    {
      id: 'github',
      collect: async () => {
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectGitHub(sc.keywords, segment, env.GITHUB_TOKEN));
        }
        return all;
      },
    },
    {
      id: 'stackoverflow',
      collect: async () => {
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectStackOverflow(sc.keywords, sc.keywords.slice(0, 3), segment, ''));
        }
        return all;
      },
    },
    {
      id: 'reddit',
      collect: async () => {
        if (!cfg.collectors.reddit.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectReddit(cfg.collectors.reddit.subreddits, sc.keywords, segment));
        }
        return all;
      },
    },
    {
      id: 'youtube',
      collect: async () => {
        if (!cfg.collectors.youtube.enabled || !env.YOUTUBE_API_KEY) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectYouTube(
            sc.keywords,
            segment,
            env.YOUTUBE_API_KEY,
            cfg.collectors.youtube.max_videos,
            cfg.collectors.youtube.max_comments_per_video,
          ));
        }
        return all;
      },
    },
    {
      id: 'bluesky',
      collect: async () => {
        if (!cfg.collectors.bluesky.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectBluesky(sc.keywords, segment, cfg.collectors.bluesky.max_results));
        }
        return all;
      },
    },
    {
      id: 'mastodon',
      collect: async () => {
        if (!cfg.collectors.mastodon.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectMastodon(
            sc.keywords,
            segment,
            cfg.collectors.mastodon.instances,
            cfg.collectors.mastodon.max_results,
          ));
        }
        return all;
      },
    },
    {
      id: 'hackernews',
      collect: async () => {
        if (!cfg.collectors.hackernews.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectHackerNews(sc.keywords, segment, cfg.collectors.hackernews.max_results));
        }
        return all;
      },
    },
    {
      id: 'boe',
      collect: async () => {
        if (!cfg.collectors.boe.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectBOE(sc.keywords, segment));
        }
        return all;
      },
    },
    {
      id: 'boja',
      collect: async () => {
        if (!cfg.collectors.boja.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectBOJA(sc.keywords, segment));
        }
        return all;
      },
    },
    {
      id: 'bocas',
      collect: async () => {
        if (!cfg.collectors.bocas.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectBOCAs(sc.keywords, segment));
        }
        return all;
      },
    },
    {
      id: 'betalist',
      collect: async () => {
        if (!cfg.collectors.betalist.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectBetaList(sc.keywords, segment));
        }
        return all;
      },
    },
    {
      id: 'appsumo',
      collect: async () => {
        if (!cfg.collectors.appsumo.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectAppSumo(sc.keywords, segment));
        }
        return all;
      },
    },
    {
      id: 'producthunt',
      collect: async () => {
        if (!cfg.collectors.producthunt.enabled || !env.PRODUCTHUNT_API_KEY) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectProductHunt(sc.keywords, segment, env.PRODUCTHUNT_API_KEY ?? ''));
        }
        return all;
      },
    },
    {
      id: 'ine',
      collect: async () => {
        if (!cfg.collectors.ine.enabled) return [];
        const all: Signal[] = [];
        for (const [segment, sc] of segments) {
          all.push(...await collectINE(sc.keywords, segment));
        }
        return all;
      },
    },
  ];
}
