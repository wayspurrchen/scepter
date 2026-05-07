/**
 * Ordered registry of built-in confidence adapters and the
 * getAdapter(filePath) lookup.
 *
 * Order is "most-specific-first" — narrower matchers register before
 * broader ones. Currently no two adapters overlap (`.md` for frontmatter;
 * `.ts`, `.tsx`, `.js`, `.jsx`, `.css` for c-family), but the order is
 * specified anyway so future adapters can refine dispatch by registering
 * BEFORE the adapter they narrow.
 *
 * @see {DD016.§4} registry mechanics
 */

import type { ConfidenceAdapter } from './adapter.js';
import { markdownFrontmatterAdapter } from './adapters/markdown-frontmatter.js';
import { cFamilyAdapter } from './adapters/c-family.js';

/**
 * @implements {DD016.§4.DC.14,.DC.15,.DC.16,.DC.17}
 * @implements {S003.§2.AC.01,.AC.02,.AC.03,.AC.04}
 */
const adapters: readonly ConfidenceAdapter[] = [
  markdownFrontmatterAdapter,
  cFamilyAdapter,
];

/**
 * Look up the adapter registered for a given file path. Returns the
 * first adapter whose matches() returns true, or null if none match.
 *
 * @implements {S003.§2.AC.03}
 */
export function getAdapter(filePath: string): ConfidenceAdapter | null {
  for (const adapter of adapters) {
    if (adapter.matches(filePath)) return adapter;
  }
  return null;
}
