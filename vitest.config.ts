import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', { test: { name: 'app-core', include: ['src/lib/**/*.test.ts'] } }],
  },
});
