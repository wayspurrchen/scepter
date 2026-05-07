/**
 * Ordered registry of built-in confidence adapters and the
 * getAdapter(filePath) lookup.
 *
 * Order is "most-specific-first" — narrower matchers register before
 * broader ones. The Hat 1 registry contains only the C-family adapter
 * so adapter lookup is well-defined for source files (the only shape
 * with a real adapter at this step). The markdown-frontmatter adapter
 * is added in DD016 §4 (Hat 2 step 9).
 *
 * @see {DD016.§4} registry mechanics
 */

import type { ConfidenceAdapter } from './adapter.js';
import { cFamilyAdapter } from './adapters/c-family.js';

/**
 * @implements {DD016.§4.DC.14} adapters array readonly, not exported
 * @implements {DD016.§4.DC.16,.DC.17} first-match-wins, pure
 * @implements {S003.§2.AC.03,.AC.04} returns adapter or null, pure
 * @see {S003.§2.AC.02} markdown-frontmatter order — Hat 2 step 9
 */
const adapters: readonly ConfidenceAdapter[] = [
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
