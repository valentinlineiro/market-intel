import { defineConfig } from 'vitest/config';
import { cloudflarePool } from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  test: {
    include: ['src/main/infrastructure/worker/test/integration/**/*.test.ts'],
    pool: cloudflarePool({
      wrangler: {
        configPath: './src/main/infrastructure/worker/wrangler.toml',
      },
    }),
  },
});
