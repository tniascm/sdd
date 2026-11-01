import { defineConfig } from 'vitest/config';

// NFR-008: automated tests must cover at least 85 % of source lines.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/cli/**'],
      thresholds: { lines: 85 },
      // print the report even when some tests fail, so the coverage gate stays visible
      reportOnFailure: true,
    },
  },
});
