import type { SCEpterConfig } from '../types/config';

/**
 * Default SCEpter configuration with source code integration disabled by default.
 * Users can enable and configure it in their project's scepter.config.js
 */
export const defaultSCEpterConfig: Partial<SCEpterConfig> = {
  // Source code integration is opt-in
  sourceCodeIntegration: {
    enabled: false,
    folders: ['src', 'lib', 'app'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.git/**',
      '*.min.js',
      '*.bundle.js',
      '*.test.js',
      '*.spec.js'
    ],
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.py'],
    cacheSourceRefs: true,
    validateOnStartup: false
  },
  
  // Default context configuration
  context: {
    defaultDepth: 2,
    followHints: true,
    maxTokens: 100000
  },
  
  // Default notes configuration
  notes: {
    autoCreate: true,
    fileNamePattern: '{ID}.md'
  },
  
  // Default timestamp precision (date-only)
  timestampPrecision: 'date',

  // Default paths
  paths: {
    notesRoot: '_scepter',
    dataDir: '_scepter'
  }
};

/**
 * Example source code integration configuration for users to reference
 */
export const exampleSourceCodeIntegrationConfig = {
  sourceCodeIntegration: {
    enabled: true,
    folders: ['src', 'lib', 'app', 'scripts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      '.git/**',
      '**/*.min.js',
      '**/*.bundle.js',
      '**/*.test.js',
      '**/*.spec.js',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/vendor/**',
      '**/third-party/**'
    ],
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.rb', '.go'],
    cacheSourceRefs: true,
    validateOnStartup: true
  }
};