/**
 * Verification event store for SCEpter claims.
 *
 * Stores verification events in a JSON sidecar file (_scepter/verification.json).
 * Each claim has an append-only array of verification events recording when,
 * by whom, and how a claim was verified.
 *
 * The store is independent of the claim index — it loads from and saves to
 * its own file, and commands that need verification data load it separately.
 *
 * @implements {R005.§3.AC.01} Verification store as JSON file in _scepter/
 * @implements {R005.§3.AC.02} VerificationEvent interface
 * @implements {R005.§3.AC.06} Append-only store semantics
 * @implements {R005.§3.AC.07} Latest verification retrieval
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single verification event for a claim.
 * @implements {R005.§3.AC.02}
 */
export interface VerificationEvent {
  claimId: string;
  date: string;
  actor: string;
  method?: string;
}

/**
 * The verification store: a map from claim ID to an ordered array of events.
 * @implements {R005.§3.AC.01}
 */
export type VerificationStore = Record<string, VerificationEvent[]>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORE_FILENAME = 'verification.json';

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Load the verification store from disk.
 * Returns an empty store if the file does not exist.
 *
 * @param dataDir - The _scepter directory path
 * @implements {R005.§3.AC.01}
 */
export async function loadVerificationStore(dataDir: string): Promise<VerificationStore> {
  const filePath = path.join(dataDir, STORE_FILENAME);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as VerificationStore;
  } catch (err: unknown) {
    // File doesn't exist or is invalid — return empty store
    if (isNodeError(err) && err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

/**
 * Save the verification store to disk.
 * Writes JSON with 2-space indentation for human readability.
 *
 * @param dataDir - The _scepter directory path
 * @param store - The verification store to persist
 * @implements {R005.§3.AC.01}
 */
export async function saveVerificationStore(
  dataDir: string,
  store: VerificationStore,
): Promise<void> {
  const filePath = path.join(dataDir, STORE_FILENAME);
  await fs.writeFile(filePath, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

/**
 * Append a verification event to the store.
 * Creates the claim's event array if it doesn't exist yet.
 *
 * @implements {R005.§3.AC.06} Append-only semantics
 */
export function addVerificationEvent(
  store: VerificationStore,
  event: VerificationEvent,
): void {
  if (!store[event.claimId]) {
    store[event.claimId] = [];
  }
  store[event.claimId].push(event);
}

/**
 * Get the most recent verification event for a claim.
 * Returns null if no verification events exist for the claim.
 *
 * @implements {R005.§3.AC.07}
 */
export function getLatestVerification(
  store: VerificationStore,
  claimId: string,
): VerificationEvent | null {
  const events = store[claimId];
  if (!events || events.length === 0) {
    return null;
  }
  return events[events.length - 1];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
