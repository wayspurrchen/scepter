import chalk from 'chalk';

export interface ExcerptOptions {
  maxLength?: number;
  contextLines?: number;
  highlightPattern?: RegExp;
  ellipsis?: string;
}

/**
 * Extract excerpt from content according to SCEpter spec:
 * The first line of actual content after the title.
 * Expects content without frontmatter.
 */
export function extractExcerpt(content: string, maxLength?: number): string {
  if (!content || !content.trim()) {
    return '';
  }

  const lines = content.split('\n');
  let foundTitle = false;
  let inHeaderSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      continue;
    }

    // Check if this is a title (markdown header starting with #)
    if (trimmed.startsWith('#') && !foundTitle) {
      foundTitle = true;
      continue;
    }

    // After finding title, skip subsequent headers and structured data
    if (foundTitle) {
      // Skip headers (lines starting with #)
      if (trimmed.startsWith('#')) {
        inHeaderSection = true;
        continue;
      }

      // Skip lines that look like metadata or lists under headers
      if (
        inHeaderSection &&
        (trimmed.startsWith('-') ||
          // Skip dates
          trimmed.match(/^\d{4}-\d{2}-\d{2}/) ||
          // Skip metadata
          trimmed.match(/^\w+:\s/))
      ) {
        continue;
      }

      // We've found actual content
      inHeaderSection = false;
      if (maxLength && trimmed.length > maxLength) {
        return trimmed.substring(0, maxLength) + '...';
      }
      return trimmed;
    }

    // If no title found, return first non-empty, non-header line
    if (!trimmed.startsWith('#')) {
      if (maxLength && trimmed.length > maxLength) {
        return trimmed.substring(0, maxLength) + '...';
      }
      return trimmed;
    }
  }

  // No content found
  return '';
}

/**
 * Generate excerpt with search context
 */
export function generateSearchExcerpt(content: string, pattern: RegExp, options: ExcerptOptions = {}): string[] {
  const { contextLines = 2, maxLength = 200 } = options;

  const lines = content.split('\n');
  const excerpts: string[] = [];
  const matchedLines = new Set<number>();

  // Find all matching lines
  lines.forEach((line, index) => {
    if (pattern.test(line)) {
      matchedLines.add(index);
    }
  });

  // Build excerpts with context
  const processedLines = new Set<number>();

  for (const lineIndex of matchedLines) {
    if (processedLines.has(lineIndex)) {
      continue;
    }

    const excerptLines: string[] = [];
    const startLine = Math.max(0, lineIndex - contextLines);
    const endLine = Math.min(lines.length - 1, lineIndex + contextLines);

    for (let i = startLine; i <= endLine; i++) {
      processedLines.add(i);
      const line = lines[i];

      if (matchedLines.has(i)) {
        // Highlight the matching line
        const highlighted = highlightMatches(line, pattern);
        excerptLines.push(`${i + 1}: ${highlighted}`);
      } else {
        excerptLines.push(`${i + 1}: ${line}`);
      }
    }

    excerpts.push(excerptLines.join('\n'));
  }

  return excerpts;
}

/**
 * Highlight pattern matches in text
 */
export function highlightMatches(text: string, pattern: RegExp): string {
  // Create a new pattern with global flag to ensure all matches are replaced
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  return text.replace(globalPattern, (match) => chalk.yellow.bold(match));
}

/**
 * Extract first meaningful paragraph (same as excerpt but named more clearly)
 */
export function extractFirstParagraph(content: string): string {
  return extractExcerpt(content);
}

/**
 * Count approximate tokens (words) in content
 */
export function countTokens(content: string): number {
  // Simple word-based approximation
  // In practice, you might want to use a proper tokenizer
  return content.split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Truncate content to approximate token limit
 */
export function truncateToTokenLimit(content: string, maxTokens: number, addEllipsis: boolean = true): string {
  const words = content.split(/\s+/);

  if (words.length <= maxTokens) {
    return content;
  }

  const truncated = words.slice(0, maxTokens).join(' ');
  return addEllipsis ? truncated + '...' : truncated;
}
