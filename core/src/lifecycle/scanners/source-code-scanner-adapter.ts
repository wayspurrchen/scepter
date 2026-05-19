/**
 * Source-code scanner adapter for the rewriter engine.
 *
 * Emits `ReferenceSpan` records for braced claim references found in
 * source-code comments. Distinguishes two surfaces:
 *
 *   - `source-annotation`: the reference is preceded (on the same
 *     line) by one of the recognized annotation prefixes —
 *     `@implements`, `@validates`, `@addresses`, `@depends-on`,
 *     `@see`.
 *   - `source-comment`: the reference appears in a comment context
 *     without an annotation prefix (e.g., `// see {R005}` or
 *     `// {R005} is referenced here`).
 *
 * Test-name embeds inside `it('S002.§1.AC.01', ...)` are out of scope
 * for Phase 3 (see {DD020.§2.DC.10}; the test-name scanner is Phase 6,
 * gated on R015.OQ.01).
 *
 * The scanner does NOT attempt a full TypeScript / JavaScript
 * tokenization. It looks at every line and decides whether the line
 * is inside a comment via a lightweight block-comment tracker, mirroring
 * the existing `parseNoteMentions` policy. This is a deliberate
 * limitation: the rewriter must remain conservative — when in doubt,
 * we emit a span and let the predicate / user review it.
 *
 * @implements {DD020.§2.DC.08} source-code scanner emits spans for refs in @implements/@validates/@addresses/@depends-on/@see annotation contexts
 * @implements {DD020.§2.DC.09} source-code scanner emits spans for bare braced refs in comments
 */

import type { ReferenceSpan, ScannerAdapter, SpanSurface } from '../rewriter';
import { buildSpanFromCandidate } from './markdown-body-scanner';

/** Annotation prefixes recognized as `source-annotation` surface. */
const ANNOTATION_RE =
  /@(?:implements|validates|addresses|depends-on|see)\b/i;

/**
 * Build a source-code scanner adapter closure.
 */
export function createSourceCodeScanner(): ScannerAdapter {
  return scanSourceCode;
}

/**
 * Scan source-code content for braced claim references in comments.
 *
 * Comment detection is line-based and intentionally simple:
 *
 *   - `//` initiates a single-line comment that runs to end of line.
 *   - `/*` opens a block comment that continues until `*\/`.
 *   - Lines inside block comments are scanned for braced refs.
 *
 * String literals are NOT scanned (test-name embed surface is Phase 6).
 * Multi-line single-line comment runs (consecutive `//` lines) are
 * treated independently.
 */
export function scanSourceCode(filePath: string, content: string): ReferenceSpan[] {
  const spans: ReferenceSpan[] = [];

  // Pass 1: identify byte ranges that are inside comments.
  const commentRanges = findCommentRanges(content);
  if (commentRanges.length === 0) {
    return spans;
  }

  // Pass 2: within each comment range, find every braced ref and
  // classify its surface based on the preceding text on the same line.
  const bracedRe = /\{([^}\n]+)\}/g;
  for (const [rangeStart, rangeEnd] of commentRanges) {
    bracedRe.lastIndex = rangeStart;
    let match: RegExpExecArray | null;
    while ((match = bracedRe.exec(content)) !== null && match.index < rangeEnd) {
      const inner = match[1];
      const innerStart = match.index + 1;
      const trimmedStartOffset = inner.length - inner.trimStart().length;
      const trimmedRefStart = innerStart + trimmedStartOffset;
      const trimmedInner = inner.trim();

      const surface: SpanSurface = isAnnotationContext(content, match.index)
        ? 'source-annotation'
        : 'source-comment';

      const span = buildSpanFromCandidate(
        filePath,
        content,
        trimmedInner,
        trimmedRefStart,
        surface,
      );
      if (span) {
        spans.push(span);
      }
    }
  }

  spans.sort((a, b) => a.byteRange[0] - b.byteRange[0]);
  return spans;
}

/**
 * Walk the content and find every byte range that is inside a `//`,
 * `/* ... *\/`, or `# ...` (Python) comment.
 *
 * Returns `[start, end)` pairs. Adjacent or overlapping ranges are
 * NOT merged — the consumer iterates them as-is.
 */
function findCommentRanges(content: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const len = content.length;

  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;

  while (i < len) {
    const ch = content[i];
    const next = i + 1 < len ? content[i + 1] : '';

    // String-literal state-machine: skip over strings without flagging
    // their contents as comments. This is the minimum-viable token
    // tracker — sufficient because we only care about comment / not-
    // comment for purposes of finding braced refs to rewrite.
    if (!inSingleQuote && !inDoubleQuote && !inTemplate) {
      if (ch === "'") {
        inSingleQuote = true;
        i++;
        continue;
      }
      if (ch === '"') {
        inDoubleQuote = true;
        i++;
        continue;
      }
      if (ch === '`') {
        inTemplate = true;
        i++;
        continue;
      }
      if (ch === '/' && next === '/') {
        // Single-line comment.
        const start = i;
        const nlIdx = content.indexOf('\n', i);
        const end = nlIdx === -1 ? len : nlIdx;
        ranges.push([start, end]);
        i = end;
        continue;
      }
      if (ch === '/' && next === '*') {
        // Block comment.
        const start = i;
        const closeIdx = content.indexOf('*/', i + 2);
        const end = closeIdx === -1 ? len : closeIdx + 2;
        ranges.push([start, end]);
        i = end;
        continue;
      }
      if (ch === '#') {
        // Python comment.
        const start = i;
        const nlIdx = content.indexOf('\n', i);
        const end = nlIdx === -1 ? len : nlIdx;
        ranges.push([start, end]);
        i = end;
        continue;
      }
      i++;
      continue;
    }

    // Escape sequences inside strings.
    if ((inSingleQuote || inDoubleQuote || inTemplate) && ch === '\\') {
      i += 2;
      continue;
    }

    if (inSingleQuote && ch === "'") {
      inSingleQuote = false;
      i++;
      continue;
    }
    if (inDoubleQuote && ch === '"') {
      inDoubleQuote = false;
      i++;
      continue;
    }
    if (inTemplate && ch === '`') {
      inTemplate = false;
      i++;
      continue;
    }

    // Newlines terminate single/double-quote strings defensively (the
    // file is probably malformed anyway, but we recover instead of
    // running off the end).
    if (ch === '\n') {
      if (inSingleQuote) inSingleQuote = false;
      if (inDoubleQuote) inDoubleQuote = false;
      // Templates can span newlines.
    }

    i++;
  }

  return ranges;
}

/**
 * Does the text preceding `pos` on the same line contain an annotation
 * prefix? Walks back to the line start (or to a comment marker) and
 * scans for `@implements`-style tokens.
 */
function isAnnotationContext(content: string, pos: number): boolean {
  // Find the start of the current line.
  let lineStart = pos;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') {
    lineStart--;
  }
  const prefix = content.slice(lineStart, pos);
  return ANNOTATION_RE.test(prefix);
}
