import { parseNoteId, isValidNoteId, parseTags } from './shared-note-utils';

export interface NoteMention {
  id: string;
  line: number;
  claimPath?: string; // Claim-level address suffix (e.g., '.§3.AC.01')
  claimMetadata?: string[]; // Metadata tokens after ':' in claim refs (e.g., ['P0', 'security'])
  contentExtension?: string;
  tagExtensions?: string[]; // Tags parsed from {ID#cat1,cat2: ...}
  inclusionModifiers?: {
    content?: boolean; // + modifier
    outgoingReferences?: boolean; // > modifier
    incomingReferences?: boolean; // < modifier
    contextHints?: boolean; // $ modifier
    everything?: boolean; // * modifier
  };
  filePath?: string;
  context?: string;
  parentMentionId?: string; // ID of containing mention
  nestedMentions?: string[]; // IDs of mentions inside this one
}

export interface CommentPatterns {
  single?: RegExp; // Single-line comment pattern
  blockStart?: RegExp; // Block comment start
  blockEnd?: RegExp; // Block comment end
  blockLine?: RegExp; // Pattern for lines within block comments
}

export interface ParseOptions {
  commentPatterns?: CommentPatterns; // Custom comment patterns
  includeContext?: boolean; // Include context after notes
  filePath?: string; // File path for tracking
}

// Default comment patterns for JavaScript/TypeScript
const DEFAULT_JS_PATTERNS: CommentPatterns = {
  single: /^\/\//,
  blockStart: /\/\*/,
  blockEnd: /\*\//,
  blockLine: /^\s*\*/,
};

/**
 * Parse note mentions from content
 */
export function parseNoteMentions(content: string, options: ParseOptions = {}): NoteMention[] {
  const { commentPatterns, includeContext = false, filePath } = options;

  const mentions: NoteMention[] = [];
  const lines = content.split('\n');
  const seenOnLine = new Map<number, Set<string>>();

  // Track block comment state
  let inBlockComment = false;
  let blockCommentPattern: CommentPatterns | null = null;

  // Track lines that are part of multiline extensions
  const skipLines = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    // Skip lines that are part of a multiline extension
    if (skipLines.has(i)) {
      continue;
    }
    const line = lines[i];

    // Check for block comment boundaries
    if (commentPatterns?.blockStart && commentPatterns.blockStart.test(line.trim())) {
      inBlockComment = true;
      blockCommentPattern = commentPatterns;
    }

    // Check if we should parse this line
    let shouldParse = true;
    let lineToMatch = line;

    if (commentPatterns) {
      // Check if this line is a comment
      let inComment = false;

      // Check single-line comment
      if (commentPatterns.single && commentPatterns.single.test(line.trim())) {
        inComment = true;
        const commentContent = removeCommentMarker(line, commentPatterns.single);
        // Parse comment content
        const commentMentions = parseLineForMentions(commentContent, i + 1, lines, {
          commentPatterns,
          inBlockComment: false,
          includeContext,
          filePath,
          skipLines,
          originalLine: line, // Pass the original line for context
        });
        for (const mention of commentMentions) {
          if (!seenOnLine.has(mention.line)) {
            seenOnLine.set(mention.line, new Set());
          }
          if (!seenOnLine.get(mention.line)!.has(mention.id)) {
            seenOnLine.get(mention.line)!.add(mention.id);
            mentions.push(mention);
          }
        }
      }
      // Check if in block comment
      else if (inBlockComment) {
        inComment = true;
        let cleanLine = line;
        // Remove block comment line markers
        if (blockCommentPattern?.blockLine && blockCommentPattern.blockLine.test(line)) {
          cleanLine = removeBlockLineMarker(line, blockCommentPattern.blockLine);
        } else {
          // Remove block start/end if on same line
          cleanLine = line
            .replace(blockCommentPattern?.blockStart || /^/, '')
            .replace(blockCommentPattern?.blockEnd || /$/, '');
        }
        const commentMentions = parseLineForMentions(cleanLine, i + 1, lines, {
          commentPatterns,
          inBlockComment: true,
          includeContext,
          filePath,
          skipLines,
          originalLine: line, // Pass the original line for context
        });
        for (const mention of commentMentions) {
          if (!seenOnLine.has(mention.line)) {
            seenOnLine.set(mention.line, new Set());
          }
          if (!seenOnLine.get(mention.line)!.has(mention.id)) {
            seenOnLine.get(mention.line)!.add(mention.id);
            mentions.push(mention);
          }
        }
      }
    }

    if (shouldParse) {
      // Look for note mentions in the line
      const noteMentions = parseLineForMentions(lineToMatch, i + 1, lines, {
        commentPatterns,
        inBlockComment,
        includeContext,
        filePath,
        skipLines,
      });

      // Add mentions, avoiding duplicates on same line
      for (const mention of noteMentions) {
        if (!seenOnLine.has(mention.line)) {
          seenOnLine.set(mention.line, new Set());
        }
        if (!seenOnLine.get(mention.line)!.has(mention.id)) {
          seenOnLine.get(mention.line)!.add(mention.id);
          mentions.push(mention);
        }
      }
    }

    // Check for block comment end
    if (inBlockComment && commentPatterns?.blockEnd && commentPatterns.blockEnd.test(line)) {
      inBlockComment = false;
      blockCommentPattern = null;
    }
  }

  return mentions;
}

/**
 * Parse mentions from a single line
 */
function parseLineForMentions(
  line: string,
  lineNumber: number,
  allLines: string[],
  context: {
    commentPatterns?: CommentPatterns;
    inBlockComment: boolean;
    includeContext: boolean;
    filePath?: string;
    skipLines?: Set<number>;
    originalLine?: string; // The original line before comment removal
  },
): NoteMention[] {
  const mentions: NoteMention[] = [];

  // Find all potential note mention starts
  // Use negative lookahead to ensure we don't match if there are more digits after
  // Groups: 1=noteID, 2=claimPath, 3=claimMetadata, 4=modifiers, 5=tags
  const startRegex = /\{([A-Z]{1,5}\d{3,5})(?!\d)((?:\.§?\d+)*(?:\.[A-Z]+\.\d{2,3}[a-z]?)?)?(?::([A-Za-z0-9,]+))?([$+><*]+)?(?:#([^:}\n]+))?/g;

  // Track processed regions to avoid parsing mentions inside other mentions
  const processedRegions: Array<{ start: number; end: number }> = [];

  let startMatch;
  while ((startMatch = startRegex.exec(line)) !== null) {
    const startIndex = startMatch.index;
    const [startText, id, claimPath, claimMetadataStr, modifiers, tagsStr] = startMatch;

    // Skip if this mention is inside an already processed region
    const isInsideProcessedRegion = processedRegions.some(
      (region) => startIndex >= region.start && startIndex < region.end,
    );
    if (isInsideProcessedRegion) {
      continue;
    }

    if (!isValidNoteId(id)) {
      continue;
    }

    // Now parse the rest manually to handle nested braces
    let pos = startIndex + startText.length;
    let extension: string | undefined;
    let hasExtension = false;
    let titleIgnored: string | undefined;

    // Skip whitespace
    while (pos < line.length && /\s/.test(line[pos])) {
      pos++;
    }

    // Check for title (text before colon)
    if (pos < line.length && line[pos] !== ':' && line[pos] !== '}') {
      const titleStart = pos;
      while (pos < line.length && line[pos] !== ':' && line[pos] !== '}') {
        pos++;
      }
      titleIgnored = line.substring(titleStart, pos).trim();
    }

    // Skip whitespace again
    while (pos < line.length && /\s/.test(line[pos])) {
      pos++;
    }

    // Check for colon (extension marker)
    if (pos < line.length && line[pos] === ':') {
      hasExtension = true;
      pos++; // Skip colon

      // Skip whitespace after colon
      while (pos < line.length && /\s/.test(line[pos])) {
        pos++;
      }

      // Find the closing brace, counting nested braces
      const extensionStart = pos;
      let braceCount = 1; // We already have one open brace
      let foundEnd = false;

      while (pos < line.length) {
        if (line[pos] === '{') {
          braceCount++;
        } else if (line[pos] === '}') {
          braceCount--;
          if (braceCount === 0) {
            extension = line.substring(extensionStart, pos).trim();
            foundEnd = true;
            break;
          }
        }
        pos++;
      }

      if (!foundEnd) {
        // Check for multiline extension
        const multilineResult = parseMultilineExtension(allLines, lineNumber - 1, context);
        if (multilineResult) {
          extension = line.substring(extensionStart).trim();
          if (multilineResult.content) {
            extension = extension ? extension + '\n' + multilineResult.content : multilineResult.content;
          }
          // Mark lines as processed
          if (context.skipLines) {
            for (let j = lineNumber; j <= multilineResult.endLine; j++) {
              context.skipLines.add(j);
            }
          }
        } else {
          // Invalid - no closing brace
          continue;
        }
      }
    } else if (pos < line.length && line[pos] === '}') {
      // Simple mention without extension
      // Valid
    } else {
      // Invalid format
      continue;
    }

    const mention: NoteMention = {
      id,
      line: lineNumber,
    };

    // Populate claim path if present
    if (claimPath) {
      mention.claimPath = claimPath;
    }

    // Populate claim metadata if present
    if (claimMetadataStr) {
      mention.claimMetadata = claimMetadataStr.split(',').filter((s) => s.length > 0);
    }

    // Parse tags if present
    if (tagsStr) {
      const tags = parseTags(tagsStr);
      if (tags.length > 0) {
        mention.tagExtensions = tags;
      }
    }

    // Parse modifiers into inclusion object
    if (modifiers) {
      mention.inclusionModifiers = {
        content: modifiers.includes('+'),
        outgoingReferences: modifiers.includes('>'),
        incomingReferences: modifiers.includes('<'),
        contextHints: modifiers.includes('$'),
        everything: modifiers.includes('*'),
      };
    }

    // Add content extension if present
    if (extension !== undefined && extension !== '') {
      mention.contentExtension = extension;
    } else if (extension === '') {
      mention.contentExtension = '';
    }

    // Add file path if provided
    if (context.filePath) {
      mention.filePath = context.filePath;
    }

    // Add context if requested
    if (context.includeContext) {
      // Use the originalLine if available (for comment parsing), otherwise use current line
      const lineForContext = context.originalLine || line;
      // Find the position in the original line
      const mentionPattern = new RegExp(`\\{${id}[^}]*\\}`);
      const match = lineForContext.match(mentionPattern);
      const originalStartIndex = match ? lineForContext.indexOf(match[0]) : startIndex;

      // Try to get context from the same line first
      const contextText = getContextFromLine(lineForContext, originalStartIndex);
      if (contextText) {
        mention.context = contextText;
      } else {
        // If no context on the same line, get the next non-comment line
        const nextLineContext = getNextLineContext(allLines, lineNumber - 1);
        if (nextLineContext) {
          mention.context = nextLineContext;
        }
      }
    }

    mentions.push(mention);

    // Mark the entire mention as processed (including nested content)
    if (hasExtension && pos > startIndex) {
      processedRegions.push({ start: startIndex, end: pos + 1 }); // +1 for closing brace
    }

    // Parse nested mentions from content extension if present
    if (mention.contentExtension) {
      const nestedMentions = parseLineForMentions(mention.contentExtension, lineNumber, [], {
        ...context,
        includeContext: false, // Don't include context for nested mentions
      });

      // Track parent-child relationships
      if (nestedMentions.length > 0) {
        mention.nestedMentions = [];

        // Process each nested mention
        for (const nested of nestedMentions) {
          if (nested.id !== mention.id) {
            // Only set parent if it doesn't already have one
            if (!nested.parentMentionId) {
              nested.parentMentionId = mention.id;
              mention.nestedMentions.push(nested.id);
            }
            nested.line = lineNumber;
            mentions.push(nested);
          }
        }
      }
    }
  }

  return mentions;
}

/**
 * Parse multiline extension content
 */
function parseMultilineExtension(
  lines: string[],
  startLine: number,
  context: {
    commentPatterns?: CommentPatterns;
    inBlockComment: boolean;
  },
): { content: string; endLine: number } | null {
  const contentLines: string[] = [];
  let i = startLine + 1;
  let foundClosing = false;

  while (i < lines.length) {
    let line = lines[i];
    const originalLine = line;

    // Remove comment markers if in comment mode
    if (context.commentPatterns) {
      if (context.commentPatterns.single && line.trim().startsWith('//')) {
        line = removeCommentMarker(line, context.commentPatterns.single);
      } else if (context.inBlockComment && context.commentPatterns.blockLine) {
        line = removeBlockLineMarker(line, context.commentPatterns.blockLine);
      }
    }

    // Check for closing brace - must be alone or at start of line for multiline
    const trimmedLine = line.trim();
    if (trimmedLine === '}') {
      foundClosing = true;
      break;
    } else if (trimmedLine.startsWith('}')) {
      // Closing brace at start of line with potential content after
      foundClosing = true;
      break;
    }

    // For single-line comments, check if line continues the comment pattern
    if (context.commentPatterns?.single && !context.inBlockComment) {
      const originalLine = lines[i];
      if (!context.commentPatterns.single.test(originalLine.trim())) {
        // Not a comment continuation, stop
        break;
      }
    }

    contentLines.push(line);
    i++;
  }

  if (!foundClosing) {
    return null;
  }

  // Join content
  let content = contentLines.join('\n');

  // Only normalize indentation for comments (where we removed comment markers)
  if (context.commentPatterns && (context.inBlockComment || context.commentPatterns.single)) {
    // Normalize indentation by finding the minimum indentation and removing it
    const nonEmptyLines = contentLines.filter((line) => line.trim().length > 0);
    if (nonEmptyLines.length > 0) {
      // Find minimum indentation
      const minIndent = Math.min(
        ...nonEmptyLines.map((line) => {
          const match = line.match(/^(\s*)/);
          return match ? match[1].length : 0;
        }),
      );

      // Remove minimum indentation from all lines
      if (minIndent > 0) {
        content = contentLines
          .map((line) => {
            if (line.trim().length === 0) {
              return line; // Preserve empty lines as-is
            }
            return line.substring(minIndent);
          })
          .join('\n');
      }
    }
  }

  content = content.trim();

  return { content, endLine: i };
}

/**
 * Remove single-line comment marker
 */
function removeCommentMarker(line: string, pattern: RegExp): string {
  const match = line.match(/^(\s*)(\/\/|#|--)\s?(.*)$/);
  if (match) {
    return match[3] || '';
  }
  return line;
}

/**
 * Remove block comment line marker
 */
function removeBlockLineMarker(line: string, pattern: RegExp): string {
  const match = line.match(/^(\s*)(\*)\s?(.*)$/);
  if (match) {
    // Preserve internal spacing but remove the * and any single space after it
    return match[3] || '';
  }
  return line;
}

/**
 * Get context for a mention - returns the text on the same line before the mention
 */
function getContextFromLine(line: string, mentionStartIndex: number): string | undefined {
  if (mentionStartIndex <= 0) return undefined;

  const beforeMention = line.substring(0, mentionStartIndex);

  // Remove comment markers if present, but keep the content
  const cleanedBefore = beforeMention
    .replace(/^\s*\/\/\s*/, '') // Remove // comments with leading spaces
    .replace(/^\s*#\s*/, '') // Remove # comments with leading spaces
    .replace(/^\s*\*\s*/, '') // Remove * from block comments with leading spaces
    .trim();

  return cleanedBefore || undefined;
}

/**
 * Get context from the next non-comment line after a mention
 */
function getNextLineContext(lines: string[], afterLine: number): string | undefined {
  for (let i = afterLine + 1; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines and comments
    if (!line || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*') || line === '*/') {
      continue;
    }

    // Return first non-comment line
    return line;
  }

  return undefined;
}
