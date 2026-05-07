/**
 * Audit command unit tests. Realizes TS001 §6.AC.04 — the pre-discovery
 * mutual-exclusivity validation between --source-only and --notes-only.
 *
 * @validates {S004.§2.AC.03}
 * @validates {DD017.DC.11}
 * @validates {TS001.§6.AC.04}
 */

import { describe, it, expect } from 'vitest';
import { resolveAuditScope } from '../audit-command.js';

describe('S004.§2.AC.03: audit scope resolution + mutual exclusivity (DC.11)', () => {
  it('rejects --source-only and --notes-only simultaneously with a clear error', () => {
    const result = resolveAuditScope({ sourceOnly: true, notesOnly: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('--source-only');
      expect(result.message).toContain('--notes-only');
      expect(result.message.toLowerCase()).toContain('mutually exclusive');
    }
  });

  it('--source-only alone resolves to scope: source', () => {
    const result = resolveAuditScope({ sourceOnly: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scope).toBe('source');
  });

  it('--notes-only alone resolves to scope: notes', () => {
    const result = resolveAuditScope({ notesOnly: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scope).toBe('notes');
  });

  it('neither flag resolves to scope: both (default)', () => {
    const result = resolveAuditScope({});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scope).toBe('both');
  });

  it('explicit false flags resolve to scope: both', () => {
    const result = resolveAuditScope({ sourceOnly: false, notesOnly: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scope).toBe('both');
  });
});
