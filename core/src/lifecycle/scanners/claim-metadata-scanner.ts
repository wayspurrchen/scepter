/**
 * Claim-metadata scanner adapter for the rewriter engine.
 *
 * Emits `ReferenceSpan` records for the TARGET portion of
 * `:derives=TARGET` and `:superseded=TARGET` metadata suffixes on
 * claim definitions. Two surfaces:
 *
 *   - `claim-metadata-derives` — every `:derives=<addr>` occurrence.
 *   - `claim-metadata-superseded` — every `:superseded=<addr>` occurrence.
 *
 * The scanner is text-based and operates on the full content. It does
 * not require the claim itself to be parseable — encountering
 * `:derives=R005.§1.AC.03` anywhere in the content suffices to emit
 * a span pointing at the TARGET.
 *
 * Why scan the raw text rather than the claim index?
 *   1. The rewriter must run against files that the claim parser may
 *      not have indexed yet (or whose index entry might be stale).
 *   2. The scanner needs byte offsets for the substituter; the index
 *      stores semantic data without source-position fidelity at this
 *      granularity.
 *
 * @implements {DD020.§2.DC.13} claim-metadata scanner emits spans for :derives= and :superseded= TARGETs
 */

import type { ReferenceSpan, ScannerAdapter } from '../rewriter';
import { buildSpanFromCandidate } from './markdown-body-scanner';

/**
 * Build a claim-metadata scanner closure.
 */
export function createClaimMetadataScanner(): ScannerAdapter {
  return scanClaimMetadata;
}

/**
 * Scan content for `:derives=` and `:superseded=` metadata suffixes.
 *
 * Recognized shapes:
 *
 *   :derives=R005.§1.AC.03
 *   :superseded=R005.§1.AC.03
 *
 * The TARGET extraction stops at the next character that cannot
 * appear in a claim address (whitespace, comma, brace, etc.).
 */
export function scanClaimMetadata(filePath: string, content: string): ReferenceSpan[] {
  const spans: ReferenceSpan[] = [];

  // Match the metadata key followed by `=`. We capture both the key
  // and a generous TARGET expression. The TARGET character class
  // mirrors `parseMetadataSuffix`'s permitted set.
  const metaRe = /:(derives|superseded)=([A-Za-z0-9=_.§/-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = metaRe.exec(content)) !== null) {
    const key = match[1];
    const target = match[2];
    const equalsIdx = match.index + 1 + key.length; // position of `=`
    const targetStart = equalsIdx + 1;

    // Strip any trailing chars that aren't part of the claim address
    // (defensive — the regex char class is generous; e.g. a trailing
    // `/` is allowed by the parser but we want to stop at sane bounds).
    const trimmedTarget = trimAddressTail(target);
    if (trimmedTarget.length === 0) {
      continue;
    }

    const surface =
      key === 'derives'
        ? 'claim-metadata-derives'
        : 'claim-metadata-superseded';

    const span = buildSpanFromCandidate(
      filePath,
      content,
      trimmedTarget,
      targetStart,
      surface,
    );
    if (span) {
      spans.push(span);
    }
  }

  spans.sort((a, b) => a.byteRange[0] - b.byteRange[0]);
  return spans;
}

/**
 * Trim a metadata TARGET string to a well-formed claim address.
 *
 * Strips trailing characters that are unlikely to be part of a claim
 * address (e.g., a trailing slash if no alias prefix is present).
 * The character set is the same as `parseMetadataSuffix`'s, so this
 * is light cleanup not strict validation.
 */
function trimAddressTail(target: string): string {
  // Drop trailing slashes that aren't part of a valid alias-prefix
  // form. A claim address ends in a digit, letter, or sub-letter.
  return target.replace(/[\/\-_=]+$/, '');
}
