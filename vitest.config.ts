import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/main/infrastructure/worker/test/unit/**/*.test.ts'],
    exclude: ['src/main/infrastructure/worker/test/integration/**'],
  },
});
