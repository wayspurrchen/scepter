/**
 * Tests for the deletion-marker module — the canonical source for the
 * tombstoned-reference format under R015.
 *
 * @validates {R015.§2.AC.01} marker format `_deleted_<ID>_at_<TIMESTAMP>`
 * @validates {R015.§2.AC.02} parser-invisibility (fails note-ID validator)
 * @validates {R015.§2.AC.04} marker regex shape and capture groups
 * @validates {DD020.§1.DC.01} formatDeletionMarker construction
 * @validates {DD020.§1.DC.02} isDeletionMarker predicate disjoint from note-ID
 * @validates {DD020.§1.DC.03} DELETION_MARKER_RE regex
 * @validates {DD020.§1.DC.05} marker timestamp consumes timestampPrecision
 * @validates {DD020.§1.DC.07} parseDeletionMarker symmetric inverse
 */

import { describe, it, expect } from 'vitest';
import {
  DELETION_MARKER_RE,
  formatDeletionMarker,
  formatMarkerTimestamp,
  isDeletionMarker,
  parseDeletionMarker,
} from './deletion-marker';

const NOTE_ID_RE = /^[A-Z]{1,5}\d{3,5}$/;

describe('formatMarkerTimestamp', () => {
  it('produces YYYYMMDD under date precision', () => {
    // 2026-05-19 UTC
    const date = new Date(Date.UTC(2026, 4, 19, 14, 30, 0));
    expect(formatMarkerTimestamp(date, 'date')).toBe('20260519');
  });

  it('produces YYYYMMDDHHMM under datetime precision', () => {
    const date = new Date(Date.UTC(2026, 4, 19, 14, 30, 0));
    expect(formatMarkerTimestamp(date, 'datetime')).toBe('202605191430');
  });

  it('zero-pads single-digit month, day, hour, minute', () => {
    const date = new Date(Date.UTC(2026, 0, 5, 3, 7, 0));
    expect(formatMarkerTimestamp(date, 'date')).toBe('20260105');
    expect(formatMarkerTimestamp(date, 'datetime')).toBe('202601050307');
  });

  it('uses UTC, not local timezone', () => {
    // Anchored at UTC midnight — same wall clock everywhere
    const date = new Date(Date.UTC(2026, 4, 19, 0, 0, 0));
    expect(formatMarkerTimestamp(date, 'date')).toBe('20260519');
  });
});

describe('formatDeletionMarker', () => {
  const date = new Date(Date.UTC(2026, 4, 19, 14, 30, 0));

  it('emits the canonical R015 §2.AC.01 shape under date precision', () => {
    expect(formatDeletionMarker('R005', date, 'date')).toBe(
      '_deleted_R005_at_20260519',
    );
  });

  it('emits the canonical R015 §2.AC.01 shape under datetime precision', () => {
    expect(formatDeletionMarker('R005', date, 'datetime')).toBe(
      '_deleted_R005_at_202605191430',
    );
  });

  it('preserves multi-letter shortcodes (e.g., ARCH, DD)', () => {
    expect(formatDeletionMarker('ARCH017', date, 'date')).toBe(
      '_deleted_ARCH017_at_20260519',
    );
    expect(formatDeletionMarker('DD020', date, 'date')).toBe(
      '_deleted_DD020_at_20260519',
    );
  });

  it('preserves 5-letter / 5-digit IDs (validator boundary)', () => {
    expect(formatDeletionMarker('US12345', date, 'date')).toBe(
      '_deleted_US12345_at_20260519',
    );
  });
});

describe('isDeletionMarker', () => {
  it('returns true for a well-formed marker', () => {
    expect(isDeletionMarker('_deleted_R005_at_20260519')).toBe(true);
    expect(isDeletionMarker('_deleted_R005_at_202605191430')).toBe(true);
  });

  it('returns false for a live note ID', () => {
    expect(isDeletionMarker('R005')).toBe(false);
    expect(isDeletionMarker('ARCH017')).toBe(false);
    expect(isDeletionMarker('DD020')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isDeletionMarker('')).toBe(false);
  });

  it('returns false for a token that contains but is not the marker', () => {
    expect(isDeletionMarker('_deleted_R005_at_20260519.§1.AC.03')).toBe(false);
    expect(isDeletionMarker('see _deleted_R005_at_20260519')).toBe(false);
  });

  it('returns false for malformed marker shapes', () => {
    // missing underscore prefix
    expect(isDeletionMarker('deleted_R005_at_20260519')).toBe(false);
    // missing _at_ infix
    expect(isDeletionMarker('_deleted_R005_20260519')).toBe(false);
    // ID portion fails the note-ID validator (lowercase)
    expect(isDeletionMarker('_deleted_r005_at_20260519')).toBe(false);
    // timestamp too short (< 8 digits per R015 §2.AC.04)
    expect(isDeletionMarker('_deleted_R005_at_2026')).toBe(false);
  });

  it('is disjoint from NOTE_ID_RE per R015 §2.AC.02', () => {
    // Every valid note ID fails isDeletionMarker
    const liveIds = ['R001', 'D003', 'ARCH017', 'DD020', 'US12345'];
    for (const id of liveIds) {
      expect(NOTE_ID_RE.test(id)).toBe(true);
      expect(isDeletionMarker(id)).toBe(false);
    }
    // Every marker fails NOTE_ID_RE
    const markers = [
      '_deleted_R005_at_20260519',
      '_deleted_ARCH017_at_202605191430',
      '_deleted_DD020_at_20260519',
    ];
    for (const m of markers) {
      expect(isDeletionMarker(m)).toBe(true);
      expect(NOTE_ID_RE.test(m)).toBe(false);
    }
  });
});

describe('parseDeletionMarker', () => {
  it('recovers original ID and timestamp under date precision', () => {
    expect(parseDeletionMarker('_deleted_R005_at_20260519')).toEqual({
      originalId: 'R005',
      timestamp: '20260519',
    });
  });

  it('recovers original ID and timestamp under datetime precision', () => {
    expect(parseDeletionMarker('_deleted_R005_at_202605191430')).toEqual({
      originalId: 'R005',
      timestamp: '202605191430',
    });
  });

  it('returns null for a non-marker token', () => {
    expect(parseDeletionMarker('R005')).toBeNull();
    expect(parseDeletionMarker('')).toBeNull();
    expect(parseDeletionMarker('_deleted_R005')).toBeNull();
  });

  it('is the symmetric inverse of formatDeletionMarker', () => {
    const date = new Date(Date.UTC(2026, 4, 19, 14, 30, 0));
    const ids = ['R005', 'ARCH017', 'DD020', 'US12345'];
    for (const id of ids) {
      const marker = formatDeletionMarker(id, date, 'date');
      expect(parseDeletionMarker(marker)).toEqual({
        originalId: id,
        timestamp: '20260519',
      });
    }
    for (const id of ids) {
      const marker = formatDeletionMarker(id, date, 'datetime');
      expect(parseDeletionMarker(marker)).toEqual({
        originalId: id,
        timestamp: '202605191430',
      });
    }
  });
});

describe('DELETION_MARKER_RE (unanchored, for sub-string matches)', () => {
  it('matches a marker inside a longer reference text', () => {
    const text = '_deleted_R005_at_20260519.§1.AC.03';
    const match = DELETION_MARKER_RE.exec(text);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe('R005');
    expect(match?.[2]).toBe('20260519');
  });

  it('matches inside a braced reference', () => {
    const text = '{_deleted_R005_at_20260519.§1.AC.03}';
    const match = DELETION_MARKER_RE.exec(text);
    expect(match?.[1]).toBe('R005');
    expect(match?.[2]).toBe('20260519');
  });

  it('matches inside a derives= metadata suffix', () => {
    const text = ':derives=_deleted_R005_at_20260519.§1.AC.03';
    const match = DELETION_MARKER_RE.exec(text);
    expect(match?.[1]).toBe('R005');
    expect(match?.[2]).toBe('20260519');
  });

  it('accommodates compact datetime timestamps (12+ digits)', () => {
    const text = '_deleted_R005_at_202605191430.§1.AC.03';
    const match = DELETION_MARKER_RE.exec(text);
    expect(match?.[2]).toBe('202605191430');
  });
});
