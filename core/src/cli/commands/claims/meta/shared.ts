/**
 * Shared helpers for the `meta` subcommand group.
 *
 * Centralizes KEY/VALUE parsing, claim-ID resolution with fuzzy suggestions,
 * date normalization, and the OS-username default actor. The `meta add`,
 * `meta set`, `meta unset`, `meta clear`, `meta get`, `meta log` commands
 * all use these helpers.
 *
 * @implements {DD014.§3.DC.04} KEY validation regex /^[a-z][a-z0-9._-]*$/
 * @implements {DD014.§3.DC.25} --actor default = OS username
 * @implements {DD014.§3.DC.27} Claim resolution with fuzzy match suggestions
 */
import * as os from 'os';
import type { ClaimIndexData, ClaimIndexEntry } from '../../../../claims/index.js';
import { resolveSingleClaim } from '../../shared/resolve-claim-id.js';

const KEY_PATTERN = /^[a-z][a-z0-9._-]*$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Default actor: OS username, or "cli" if unavailable.
 * Mirrors `verify-command.ts:getDefaultActor`.
 */
export function getDefaultActor(): string {
  try {
    return os.userInfo().username;
  } catch {
    return 'cli';
  }
}

/**
 * Normalize the --date option value into a full ISO 8601 datetime string.
 *
 * Accepts:
 *   - undefined  -> now()
 *   - "YYYY-MM-DD" -> "YYYY-MM-DDT00:00:00.000Z" (start-of-day UTC)
 *   - any other string -> passed through (caller is trusted to provide ISO 8601)
 */
export function parseDateOption(value: string | undefined): string {
  if (!value) return new Date().toISOString();
  if (DATE_ONLY_PATTERN.test(value)) {
    return `${value}T00:00:00.000Z`;
  }
  return value;
}

/**
 * Validate an array of keys against the KEY regex. Returns null if all keys
 * pass; otherwise returns an error message naming the first offender.
 *
 * @implements {DD014.§3.DC.26} Atomic validation across the argument list
 */
export function validateKeys(keys: string[]): string | null {
  for (const key of keys) {
    if (!KEY_PATTERN.test(key)) {
      return `Invalid KEY: "${key}". Keys must match /^[a-z][a-z0-9._-]*$/.`;
    }
  }
  return null;
}

/**
 * Parse a list of `KEY=VALUE` strings. Rejects entries with no `=` or empty
 * VALUE. Returns the parsed pairs, or an error message.
 */
export function parseKeyValuePairs(
  pairs: string[],
): { pairs: Array<{ key: string; value: string }> } | { error: string } {
  const result: Array<{ key: string; value: string }> = [];
  for (const raw of pairs) {
    const eq = raw.indexOf('=');
    if (eq <= 0) {
      return { error: `Invalid KEY=VALUE pair: "${raw}". Expected format: key=value.` };
    }
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    if (value.length === 0) {
      return { error: `Empty VALUE for key "${key}". Use \`meta unset ${key}\` to clear a key.` };
    }
    result.push({ key, value });
  }
  return { pairs: result };
}

/**
 * Resolve a claim ID against the index. Thin wrapper over the centralized
 * `resolveSingleClaim` helper, preserved as a name the meta subcommands
 * already import.
 *
 * Handles `$→§` normalization, zero-padding (`DD14 → DD014`), suffix
 * matching, and uniform user-facing diagnostics. See
 * `cli/commands/shared/resolve-claim-id.ts` for the underlying logic.
 *
 * @implements {DD014.§3.DC.27} Claim resolution with fuzzy match suggestions
 */
export function resolveClaimId(
  claim: string,
  data: ClaimIndexData,
): ClaimIndexEntry | null {
  return resolveSingleClaim(claim, data);
}
