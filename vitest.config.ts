import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli/index.ts'],
    },
    // Give integration tests more time — they spawn child processes
    testTimeout: 30000,
    // Run unit tests in parallel, integration sequentially
    poolOptions: {
      threads: {
        singleThread: false,
      },
    },
  },
})
