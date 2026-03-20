/**
 * Staleness detection for SCEpter claims.
 *
 * Computes staleness by comparing file modification times of implementing
 * source files against the latest verification date for each claim.
 *
 * A claim is:
 * - **stale**: source file was modified after the last verification
 * - **unverified**: no verification event exists for the claim
 * - **current**: source file has not been modified since last verification
 *
 * Claims without Source cross-references are excluded from staleness
 * detection (R005.§4.AC.05) — staleness only applies to claims that
 * have implementing code.
 *
 * @implements {R005.§4.AC.01} Staleness computation for claims with source refs
 * @implements {R005.§4.AC.02} Separate stale vs unverified vs current statuses
 * @implements {R005.§4.AC.04} File mtime comparison against verification date
 * @implements {R005.§4.AC.05} No-Source claims excluded
 */

import * as fs from 'fs/promises';
import type { ClaimIndexData } from './claim-index.js';
import type { VerificationStore } from './verification-store.js';
import { getLatestVerification } from './verification-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single staleness assessment for a claim.
 * @implements {R005.§4.AC.01} status field
 * @implements {R005.§4.AC.02} three-way status
 */
export interface StalenessEntry {
  claimId: string;
  status: 'stale' | 'unverified' | 'current';
  importance?: number;
  lastVerified?: string;
  lastModified?: string;
  implementingFiles: string[];
}

/**
 * Options for filtering staleness computation.
 * @implements {R005.§4.AC.03} minImportance and noteId filtering
 */
export interface StalenessOptions {
  minImportance?: number;
  noteId?: string;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Compute staleness for claims in the index that have Source cross-references.
 *
 * For each eligible claim:
 * 1. Extract implementing file paths from cross-references where fromNoteId
 *    starts with "source:" (the Source projection type)
 * 2. Stat files for modification time (mtime)
 * 3. Compare latest mtime against the latest verification date
 * 4. Determine status: stale, unverified, or current
 *
 * Results are sorted: stale first, then unverified, then current.
 * Within each group, sorted by claim ID for stable output.
 *
 * @implements {R005.§4.AC.01} Core staleness computation
 * @implements {R005.§4.AC.04} File mtime comparison
 * @implements {R005.§4.AC.05} Claims without Source projection excluded
 */
export async function computeStaleness(
  index: ClaimIndexData,
  store: VerificationStore,
  options?: StalenessOptions,
): Promise<StalenessEntry[]> {
  const entries: StalenessEntry[] = [];

  for (const [fullyQualified, claim] of index.entries) {
    // Filter by noteId if specified
    if (options?.noteId && claim.noteId !== options.noteId) {
      continue;
    }

    // Filter by minimum importance if specified
    if (options?.minImportance !== undefined) {
      if (claim.importance === undefined || claim.importance < options.minImportance) {
        continue;
      }
    }

    // Find Source cross-references pointing TO this claim
    const sourceRefs = index.crossRefs.filter(
      (ref) => ref.toClaim === fullyQualified && ref.fromNoteId.startsWith('source:'),
    );

    // R005.§4.AC.05: skip claims without Source projection
    if (sourceRefs.length === 0) {
      continue;
    }

    // Extract unique file paths from source cross-references
    const filePaths = [...new Set(sourceRefs.map((ref) => ref.filePath))];

    // Get latest modification time across all implementing files
    let latestMtime: Date | undefined;
    const validFiles: string[] = [];

    for (const filePath of filePaths) {
      try {
        const stat = await fs.stat(filePath);
        validFiles.push(filePath);
        if (!latestMtime || stat.mtime > latestMtime) {
          latestMtime = stat.mtime;
        }
      } catch {
        // File may have been moved/deleted — skip it
        continue;
      }
    }

    // Skip if no valid files remain
    if (validFiles.length === 0) {
      continue;
    }

    // Get latest verification event
    const latestVerification = getLatestVerification(store, fullyQualified);

    // Determine status
    let status: StalenessEntry['status'];
    if (!latestVerification) {
      status = 'unverified';
    } else {
      const verifiedAt = new Date(latestVerification.date);
      if (latestMtime && latestMtime > verifiedAt) {
        status = 'stale';
      } else {
        status = 'current';
      }
    }

    entries.push({
      claimId: fullyQualified,
      status,
      importance: claim.importance,
      lastVerified: latestVerification?.date,
      lastModified: latestMtime?.toISOString(),
      implementingFiles: validFiles,
    });
  }

  // Sort: stale first, then unverified, then current
  // Within each group, sort by claim ID
  const statusOrder: Record<StalenessEntry['status'], number> = {
    stale: 0,
    unverified: 1,
    current: 2,
  };

  entries.sort((a, b) => {
    const statusCmp = statusOrder[a.status] - statusOrder[b.status];
    if (statusCmp !== 0) return statusCmp;
    return a.claimId.localeCompare(b.claimId);
  });

  return entries;
}
