import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
});
