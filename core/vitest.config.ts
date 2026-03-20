import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    // Exclude integration tests by default
    exclude: [
      'node_modules/**',
      '**/*.integration.test.ts',
      '**/*.integration.test.js',
      'scripts/fixtures/**',
      'boilerplates/**',
      'test-scepter-project/**',
      'test-scepter-project-new/**',
      'scepter-cli-testing/**',
      'references/**',
    ],
  },
});
