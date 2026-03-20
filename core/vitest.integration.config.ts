import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    // Include only integration tests
    include: ['**/*.integration.test.{ts,js}'],
    // Don't exclude anything for integration tests
    exclude: ['node_modules/**'],
    // Longer timeout for API calls
    testTimeout: 30000,
  },
});