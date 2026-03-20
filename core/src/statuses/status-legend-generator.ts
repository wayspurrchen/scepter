import { StatusMappingResolver } from './status-mapping-resolver';

/**
 * Generate a legend showing emoji to status name mappings for used statuses
 */
export function generateStatusLegend(
  resolver: StatusMappingResolver,
  usedStatuses: string[]
): string {
  const emojiGroups = new Map<string, string[]>();

  // Group statuses by their resolved emoji
  for (const status of usedStatuses) {
    const mapping = resolver.resolve(status);
    if (mapping?.emoji) {
      if (!emojiGroups.has(mapping.emoji)) {
        emojiGroups.set(mapping.emoji, []);
      }
      emojiGroups.get(mapping.emoji)!.push(status);
    }
  }

  // If no statuses have emojis, return empty string
  if (emojiGroups.size === 0) {
    return '';
  }

  // Format the legend
  const lines = ['Status Legend:'];
  for (const [emoji, statuses] of emojiGroups) {
    lines.push(`  ${emoji} = ${statuses.join(', ')}`);
  }

  return lines.join('\n');
}