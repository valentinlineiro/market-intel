import { defineConfig } from 'vitest/config';
import { cloudflarePool } from '@cloudflare/vitest-pool-workers';
import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve(__dirname, 'src/main/infrastructure/worker/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).sort();
const migrations = migrationFiles.map((file) => {
  return fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
});

export default defineConfig({
  define: {
    __DB_MIGRATIONS__: JSON.stringify(migrations),
  },
  test: {
    include: ['src/main/infrastructure/worker/test/integration/**/*.test.ts'],
    pool: cloudflarePool({
      wrangler: {
        configPath: './src/main/infrastructure/worker/wrangler.toml',
      },
    }),
  },
});


