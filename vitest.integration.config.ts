import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['src/main/infrastructure/worker/test/integration/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './src/main/infrastructure/worker/wrangler.toml',
        },
      },
    },
  },
});
