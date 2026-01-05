import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
    },
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30000,
    // Run tests sequentially to avoid shared state issues with shims
    sequence: {
      concurrent: false,
    },
    // Isolate test files to prevent cross-contamination
    isolate: true,
    fileParallelism: false,
  },
});
