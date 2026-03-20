import { describe, it, expect } from 'vitest';
import { generateStatusLegend } from './status-legend-generator';
import { StatusMappingResolver } from './status-mapping-resolver';
import type { SCEpterConfig } from '../types/config';

describe('generateStatusLegend', () => {
  const baseConfig: SCEpterConfig = {
    noteTypes: {},

  };

  it('should generate a legend for used statuses', () => {
    const resolver = new StatusMappingResolver(baseConfig);
    const usedStatuses = ['pending', 'in-progress', 'completed'];

    const legend = generateStatusLegend(resolver, usedStatuses);

    expect(legend).toBe(
      'Status Legend:\n' +
      '  🔵 = pending\n' +
      '  🟡 = in-progress\n' +
      '  ✅ = completed'
    );
  });

  it('should group aliases together', () => {
    const resolver = new StatusMappingResolver(baseConfig);
    const usedStatuses = ['completed', 'done', 'finished', 'pending'];

    const legend = generateStatusLegend(resolver, usedStatuses);

    expect(legend).toBe(
      'Status Legend:\n' +
      '  ✅ = completed, done, finished\n' +
      '  🔵 = pending'
    );
  });

  it('should return empty string when no statuses have emojis', () => {
    const resolver = new StatusMappingResolver(baseConfig);
    const usedStatuses = ['unknown-status', 'another-unknown'];

    const legend = generateStatusLegend(resolver, usedStatuses);

    expect(legend).toBe('');
  });

  it('should work with empty status list', () => {
    const resolver = new StatusMappingResolver(baseConfig);
    const usedStatuses: string[] = [];

    const legend = generateStatusLegend(resolver, usedStatuses);

    expect(legend).toBe('');
  });

  it('should use custom mappings when available', () => {
    const config: SCEpterConfig = {
      ...baseConfig,
      statusMappings: {
        'custom-status': { emoji: '🚀', color: 'blue' },
      },
    };
    const resolver = new StatusMappingResolver(config);
    const usedStatuses = ['custom-status', 'pending'];

    const legend = generateStatusLegend(resolver, usedStatuses);

    expect(legend).toBe(
      'Status Legend:\n' +
      '  🚀 = custom-status\n' +
      '  🔵 = pending'
    );
  });
});