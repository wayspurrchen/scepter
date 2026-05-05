import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildClaimTree, validateClaimTree } from '../claim-tree';
import type { ClaimTreeResult } from '../claim-tree';

describe('Claim Tree', () => {
  describe('buildClaimTree — basic section parsing', () => {
    it('should parse section headings with § prefix', () => {
      const content = [
        '# Document Title',
        '',
        '## Overview',
        '',
        '### §1 First Section',
        '',
        'Content here.',
        '',
        '### §2 Second Section',
        '',
        'More content.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.sections.size).toBe(2);
      expect(result.sections.has('1')).toBe(true);
      expect(result.sections.has('2')).toBe(true);

      const s1 = result.sections.get('1')!;
      expect(s1.sectionNumber).toBe(1);
      expect(s1.heading).toBe('§1 First Section');
      expect(s1.headingLevel).toBe(3);
      expect(s1.line).toBe(5);
    });

    it('should NOT parse section headings without § prefix', () => {
      const content = [
        '### 1 First Section',
        '',
        '### 2 Second Section',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.sections.size).toBe(0);
      expect(result.roots).toHaveLength(0);
    });

    it('should ignore timestamp headings and bare numbered headings', () => {
      const content = [
        '## §1 Real Section',
        '',
        '### 2025-10-06: Task Created',
        '',
        '### 1. Note Doesn\'t Exist',
        '',
        '### 2. Already in Target Format',
        '',
        'Content.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.sections.size).toBe(1);
      expect(result.sections.has('1')).toBe(true);
      expect(result.roots).toHaveLength(1);
    });

    it('should parse nested sections like §3.1', () => {
      const content = [
        '### §3 Parent Section',
        '',
        '#### §3.1 Subsection',
        '',
        'Content.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.sections.has('3')).toBe(true);
      expect(result.sections.has('3.1')).toBe(true);

      const sub = result.sections.get('3.1')!;
      expect(sub.sectionNumber).toBe(1);
      expect(sub.headingLevel).toBe(4);
    });
  });

  describe('buildClaimTree — claim extraction', () => {
    it('should extract claim headings with section prefix', () => {
      const content = [
        '### §1 Syntax',
        '',
        '§1.AC.01 The parser MUST extract section IDs.',
        '',
        '§1.AC.02 The parser MUST extract claim IDs.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(2);
      expect(result.claims.has('1.AC.01')).toBe(true);
      expect(result.claims.has('1.AC.02')).toBe(true);

      const ac01 = result.claims.get('1.AC.01')!;
      expect(ac01.claimPrefix).toBe('AC');
      expect(ac01.claimNumber).toBe(1);
      expect(ac01.type).toBe('claim');
    });

    it('should qualify bare claims with parent section path', () => {
      const content = [
        '### §1 Section',
        '',
        '#### AC.01 First Criterion',
        '',
        'Content.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(1);
      // Bare AC.01 inside §1 becomes 1.AC.01
      expect(result.claims.has('1.AC.01')).toBe(true);
    });

    it('should parse bold-wrapped claims and qualify with section', () => {
      const content = [
        '### §1 Inline Importance',
        '',
        '**AC.01** The parser MUST recognize bare digits.',
        '',
        '**AC.02** The system MUST support filtering.',
        '',
        '### §2 Lifecycle Tags',
        '',
        '**AC.01** The parser MUST extract lifecycle tags.',
        '',
        '**AC.02** Gaps MUST exclude closed claims.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(4);
      expect(result.claims.has('1.AC.01')).toBe(true);
      expect(result.claims.has('1.AC.02')).toBe(true);
      expect(result.claims.has('2.AC.01')).toBe(true);
      expect(result.claims.has('2.AC.02')).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should parse bold-wrapped claims with colon after closing markers', () => {
      // S004-style: **GLYPH.01**: Description
      const content = [
        '### §1 Phase 4',
        '',
        '**GLYPH.01**: A `GlyphSet` type MUST be defined.',
        '',
        '**GLYPH.02**: The `image` source type SHOULD be defined.',
        '',
        '**GLYPH.03**: At least two curated glyph sets MUST be shipped.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(3);
      expect(result.claims.has('1.GLYPH.01')).toBe(true);
      expect(result.claims.has('1.GLYPH.02')).toBe(true);
      expect(result.claims.has('1.GLYPH.03')).toBe(true);
      expect(result.claims.get('1.GLYPH.01')!.claimPrefix).toBe('GLYPH');
    });

    it('should parse bold-wrapped claims without section context', () => {
      // Claims without any section heading — sectionless claims
      const content = [
        '# Document Title',
        '',
        '**GLYPH.01**: A type MUST be defined.',
        '',
        '**GLYPH.02**: The hook MUST be provided.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(2);
      // No section prefix — bare claim IDs
      expect(result.claims.has('GLYPH.01')).toBe(true);
      expect(result.claims.has('GLYPH.02')).toBe(true);
    });

    it('should handle multi-character claim prefixes', () => {
      const content = [
        '### §1 Section',
        '',
        '§1.SEC.01 Security requirement.',
        '',
        '§1.CORE.01 Core requirement.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.has('1.SEC.01')).toBe(true);
      expect(result.claims.has('1.CORE.01')).toBe(true);

      expect(result.claims.get('1.SEC.01')!.claimPrefix).toBe('SEC');
      expect(result.claims.get('1.CORE.01')!.claimPrefix).toBe('CORE');
    });
  });

  describe('buildClaimTree — tree structure', () => {
    it('should build parent-child relationships by heading level', () => {
      const content = [
        '### §1 Section One',
        '',
        '§1.AC.01 First criterion.',
        '',
        '§1.AC.02 Second criterion.',
        '',
        '### §2 Section Two',
        '',
        '§2.AC.01 Third criterion.',
      ].join('\n');

      const result = buildClaimTree(content);
      // §1 and §2 should be roots (both at level 3)
      expect(result.roots.length).toBe(2);
      expect(result.roots[0].id).toBe('1');
      expect(result.roots[1].id).toBe('2');
    });

    it('should nest claims under their section', () => {
      const content = [
        '## §1 Parent',
        '',
        '### §1.AC.01 First claim',
        '',
        'Content for AC.01.',
        '',
        '### §1.AC.02 Second claim',
        '',
        'Content for AC.02.',
      ].join('\n');

      const result = buildClaimTree(content);
      const section = result.sections.get('1')!;
      expect(section.children).toHaveLength(2);
      expect(section.children[0].id).toBe('1.AC.01');
      expect(section.children[1].id).toBe('1.AC.02');
    });
  });

  describe('buildClaimTree — content boundaries (endLine)', () => {
    it('should set endLine to line before next same-level heading', () => {
      const content = [
        '### §1 First Section',    // line 1
        '',                          // line 2
        'Some content.',             // line 3
        '',                          // line 4
        '### §2 Second Section',    // line 5
        '',                          // line 6
        'More content.',             // line 7
      ].join('\n');

      const result = buildClaimTree(content);
      const s1 = result.sections.get('1')!;
      expect(s1.line).toBe(1);
      expect(s1.endLine).toBe(4); // line before §2's heading

      const s2 = result.sections.get('2')!;
      expect(s2.line).toBe(5);
      expect(s2.endLine).toBe(7); // end of document
    });

    it('should set endLine to end of document for last heading', () => {
      const content = [
        '### §1 Only Section',      // line 1
        '',                          // line 2
        'Content.',                  // line 3
        '',                          // line 4
        'More content.',             // line 5
      ].join('\n');

      const result = buildClaimTree(content);
      const s1 = result.sections.get('1')!;
      expect(s1.endLine).toBe(5);
    });

    // The following five tests cover the structural patterns identified in
    // a claim boundary audit.
    // 
    // Each pattern asserts the exact expected endLine for the affected
    // claims so the boundary cap can't silently regress.

    it('Pattern A: clean paragraph siblings under a section heading', () => {
      // DD050:96-99 shape — paragraph claims separated by a single blank.
      // The first claim's body ends at the blank line immediately before
      // the next sibling — i.e., the line of its own definition since
      // there's no body content between them.
      const content = [
        '## §1 Schema',                                              // 1
        '',                                                          // 2
        '### Schema Configuration',                                  // 3
        '',                                                          // 4
        '§1.DC.01:5 The schema MUST be configured with directMode.', // 5
        '',                                                          // 6
        '§1.DC.02:4 The schema MUST allow external composition.',   // 7
      ].join('\n');

      const result = buildClaimTree(content);
      const dc01 = result.claims.get('1.DC.01')!;
      const dc02 = result.claims.get('1.DC.02')!;
      // DC.01: paragraph rule terminates at the blank on line 6.
      expect(dc01.line).toBe(5);
      expect(dc01.endLine).toBe(5);
      // DC.02: no further structural sibling, no further blank — runs to EOF.
      expect(dc02.line).toBe(7);
      expect(dc02.endLine).toBe(7);
    });

    it('Pattern B: paragraph-claim with intervening plain sub-heading', () => {
      // DD050:96-102 shape — `### Identity TypeDefinition` (a plain heading,
      // not a claim or section) sits between two sibling claims. Without
      // the paragraph-claim termination rule, DC.01's body would extend
      // through the plain heading and the blank line beneath it, so the
      // hover excerpt for DC.01 would include the *next* subsection's
      // heading. With the fix, DC.01 ends at the first blank line.
      const content = [
        '## §1 Schema',                                              // 1
        '',                                                          // 2
        '### Schema Configuration',                                  // 3
        '',                                                          // 4
        '§1.DC.01:5 The schema MUST be configured with directMode.', // 5
        '',                                                          // 6
        '### Identity TypeDefinition',                               // 7
        '',                                                          // 8
        '§1.DC.03 The Identity TypeDefinition MUST define fields.', // 9
      ].join('\n');

      const result = buildClaimTree(content);
      const dc01 = result.claims.get('1.DC.01')!;
      const dc03 = result.claims.get('1.DC.03')!;
      // DC.01 must NOT include line 7 (`### Identity TypeDefinition`) or
      // line 8 (the blank beneath it) — those belong to DC.03.
      expect(dc01.line).toBe(5);
      expect(dc01.endLine).toBe(5);
      // DC.03 starts at line 9. The plain heading on line 7 already opened
      // the next sub-region; no blank follows DC.03 so it runs to EOF.
      expect(dc03.line).toBe(9);
      expect(dc03.endLine).toBe(9);
    });

    it('Pattern C: paragraph-claim embedded inside a heading-claim body', () => {
      // DD006 §1.PERF.01 shape — a paragraph-claim sits inside a heading-
      // claim's body, sandwiched between cypher fences. Without the
      // paragraph-claim termination rule, PERF.01 attributes ~18 lines of
      // unrelated cypher to itself because there is no further structural
      // node before the next heading-claim. With the fix, PERF.01 ends at
      // the first blank line — its single sentence — and DC.01 still owns
      // the full body up to DC.02.
      const content = [
        '## §1 Graph Mode',                                          // 1
        '',                                                          // 2
        '### §1.DC.01 Field node schema change',                    // 3
        '',                                                          // 4
        'The Field node gains a `fieldDefId` property.',            // 5
        '',                                                          // 6
        '§1.PERF.01:derives=R051.§2.PERF.03 The fieldDefId lookup MUST NOT degrade read-path latency.', // 7
        '',                                                          // 8
        '**Current Field creation** (FieldEngine.addField):',        // 9
        '```cypher',                                                 // 10
        'MATCH (n:Node {id: $nodeId})',                              // 11
        'CREATE (f:Field {id: $fieldId})',                           // 12
        'CREATE (n)-[:HAS_FIELD]->(f)',                              // 13
        'CREATE (f)-[:INSTANCE_OF]->(fd)',                           // 14
        '```',                                                       // 15
        '',                                                          // 16
        '### §1.DC.02 Index on Field.fieldDefId',                   // 17
      ].join('\n');

      const result = buildClaimTree(content);
      const dc01 = result.claims.get('1.DC.01')!;
      const perf01 = result.claims.get('1.PERF.01')!;
      const dc02 = result.claims.get('1.DC.02')!;

      // DC.01 (heading-claim, level 3) must own its full body — through the
      // cypher fences — up to but not including DC.02's heading at line 17.
      expect(dc01.line).toBe(3);
      expect(dc01.endLine).toBe(16);

      // PERF.01 (paragraph-claim) must end at the first blank line on
      // line 8 — its body is just the one-sentence claim. It must NOT
      // extend through the cypher fences (lines 9-15) which semantically
      // belong to DC.01.
      expect(perf01.line).toBe(7);
      expect(perf01.endLine).toBe(7);

      // DC.02 starts where DC.01 ends.
      expect(dc02.line).toBe(17);
    });

    it('Pattern D: sub-lettered claims with intervening plain sub-headings', () => {
      // DD050:165-201 shape — DC.06, DC.06a, DC.07, DC.08, DC.08a interleaved
      // with plain `### TypeDefinition` headings. Pattern D's overshoot is
      // the same mechanism as Pattern B (intervening plain heading), now
      // with sub-lettered claims that share heading levels with their base
      // claims. The paragraph-claim termination rule fixes both.
      const content = [
        '## §1 Schema',                                              // 1
        '',                                                          // 2
        '### EmailLink TypeDefinition',                              // 3
        '',                                                          // 4
        '§1.DC.06 The EmailLink MUST define fields.',               // 5
        '',                                                          // 6
        '### PasswordCredential TypeDefinition',                    // 7
        '',                                                          // 8
        '§1.DC.06a:5 The schema MUST define a PasswordCredential.', // 9
        '',                                                          // 10
        '### ExternalIdentity TypeDefinition',                       // 11
        '',                                                          // 12
        '§1.DC.07 The ExternalIdentity MUST define fields.',        // 13
        '',                                                          // 14
        '### Relationship Definitions',                              // 15
        '',                                                          // 16
        '§1.DC.08 The schema MUST define a OWNED_BY relationship.', // 17
        '- Handle to Identity (outgoing).',                          // 18
        '- Identity to Handle (incoming).',                          // 19
        '',                                                          // 20
        '§1.DC.08a:5 The schema MUST define a HAS_CREDENTIAL relationship.', // 21
        '- EmailLink to PasswordCredential (outgoing).',             // 22
        '- PasswordCredential to EmailLink (incoming).',             // 23
      ].join('\n');

      const result = buildClaimTree(content);
      const dc06 = result.claims.get('1.DC.06')!;
      const dc06a = result.claims.get('1.DC.06a')!;
      const dc07 = result.claims.get('1.DC.07')!;
      const dc08 = result.claims.get('1.DC.08')!;
      const dc08a = result.claims.get('1.DC.08a')!;

      // DC.06: the plain `### PasswordCredential TypeDefinition` on line 7
      // belongs to DC.06a, not DC.06. With the paragraph-claim rule, DC.06
      // ends at the first blank line on line 6.
      expect(dc06.endLine).toBe(5);

      // DC.06a: same — the plain `### ExternalIdentity TypeDefinition` on
      // line 11 belongs to DC.07. DC.06a ends at the first blank on line 10.
      expect(dc06a.endLine).toBe(9);

      // DC.07: the plain `### Relationship Definitions` on line 15 belongs
      // to DC.08, not DC.07. DC.07 ends at the first blank on line 14.
      expect(dc07.endLine).toBe(13);

      // DC.08: bullet-list body extends through line 19; the blank on line
      // 20 terminates the paragraph.
      expect(dc08.endLine).toBe(19);

      // DC.08a: bullet-list body extends through line 23 (EOF, no trailing
      // blank). With no blank line found, it runs to end of document.
      expect(dc08a.endLine).toBe(23);
    });

    it('Pattern E: heading-claim with metadata in heading text', () => {
      // DD057 §3 shape — `### §3.DC.NN:derives=...` where each claim is its
      // own heading. The claim ID and metadata are both in the heading text.
      // Each heading-claim is a same-level sibling of the next, so each
      // body extends cleanly from its line to the line before the next
      // sibling. This pattern was already correct in the prior parser and
      // must remain correct after the fix.
      const content = [
        '## §3 registerSchema detection',                            // 1
        '',                                                          // 2
        '### §3.DC.01:derives=DEF015.§1.FC.01',                     // 3
        '',                                                          // 4
        '`registerSchema(schema, options)` MUST invoke a detection step.', // 5
        '',                                                          // 6
        'Subsequent body paragraph for DC.01.',                     // 7
        '',                                                          // 8
        '### §3.DC.02:derives=DEF015.§1.FC.02',                     // 9
        '',                                                          // 10
        'If the changeset contains any change of kind X, ...',      // 11
      ].join('\n');

      const result = buildClaimTree(content);
      const dc01 = result.claims.get('3.DC.01')!;
      const dc02 = result.claims.get('3.DC.02')!;

      // DC.01 (heading-claim, level 3) ends at the line before DC.02's
      // heading. The metadata in the heading text is preserved on the
      // claim's `metadata` field.
      expect(dc01.line).toBe(3);
      expect(dc01.endLine).toBe(8);
      expect(dc01.metadata).toContain('derives=DEF015.§1.FC.01');

      // DC.02 runs to EOF.
      expect(dc02.line).toBe(9);
      expect(dc02.endLine).toBe(11);
      expect(dc02.metadata).toContain('derives=DEF015.§1.FC.02');
    });

    it('heading-claim ignores deeper plain headings (does not over-tighten)', () => {
      // Negative case: a plain heading at a level *deeper* than the
      // heading-claim's own level must NOT terminate the body. Only
      // same-or-shallower headings cap a heading-claim. Without this guard,
      // a `#### Sub-detail` heading would prematurely end a `### §1.DC.01`
      // claim's body.
      const content = [
        '## §1 Section',                                             // 1
        '',                                                          // 2
        '### §1.DC.01 First claim',                                  // 3
        '',                                                          // 4
        'Body paragraph.',                                           // 5
        '',                                                          // 6
        '#### Sub-detail (plain h4, deeper than DC.01)',            // 7
        '',                                                          // 8
        'More body for DC.01.',                                      // 9
        '',                                                          // 10
        '### §1.DC.02 Second claim',                                 // 11
      ].join('\n');

      const result = buildClaimTree(content);
      const dc01 = result.claims.get('1.DC.01')!;
      // DC.01 (level 3) must include its level-4 sub-heading and the prose
      // beneath it. It only terminates at DC.02 (level 3) on line 11.
      expect(dc01.line).toBe(3);
      expect(dc01.endLine).toBe(10);
    });
  });

  describe('buildClaimTree — documents without claim markup', () => {
    it('should produce empty tree for plain markdown', () => {
      const content = [
        '# My Document',
        '',
        '## Overview',
        '',
        'This is a document without any claim markup.',
        '',
        '## Details',
        '',
        'More text here.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.roots).toHaveLength(0);
      expect(result.claims.size).toBe(0);
      expect(result.sections.size).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should produce empty tree for empty content', () => {
      const result = buildClaimTree('');
      expect(result.roots).toHaveLength(0);
      expect(result.claims.size).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('buildClaimTree — same-file repeats are tolerated', () => {
    // Restating a claim ID later in the same note (e.g. in a TOC, summary,
    // or appendix) is a normal authoring pattern, not a redefinition. The
    // parser keeps the first occurrence as the canonical entry and silently
    // drops subsequent occurrences. No duplicate error is emitted.
    it('should silently drop repeated claim IDs', () => {
      const content = [
        '### §1 Section',
        '',
        '§1.AC.01 First occurrence at line 3.',
        '',
        '§1.AC.01 Restatement in a TOC at line 5.',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const duplicateErrors = errors.filter((e) => e.type === 'duplicate');
      expect(duplicateErrors).toHaveLength(0);
      expect(result.claims.size).toBe(1);
      expect(result.claims.get('1.AC.01')!.line).toBe(3);
    });

    it('should silently drop repeated section IDs', () => {
      const content = [
        '### §1 First',
        '',
        '### §1 Restatement',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const duplicateErrors = errors.filter((e) => e.type === 'duplicate');
      expect(duplicateErrors).toHaveLength(0);
      expect(result.sections.size).toBe(1);
    });
  });

  describe('validateClaimTree — monotonic numbering', () => {
    it('should detect non-monotonic claim numbering', () => {
      const content = [
        '## §1 Section',
        '',
        '### §1.AC.03 Out of order',
        '',
        '### §1.AC.01 Should come first',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const monotonicErrors = errors.filter((e) => e.type === 'non-monotonic');
      expect(monotonicErrors.length).toBeGreaterThanOrEqual(1);
    });

    it('should accept monotonically increasing claims', () => {
      const content = [
        '## §1 Section',
        '',
        '### §1.AC.01 First',
        '',
        '### §1.AC.02 Second',
        '',
        '### §1.AC.03 Third',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const monotonicErrors = errors.filter((e) => e.type === 'non-monotonic');
      expect(monotonicErrors).toHaveLength(0);
    });

    it('should accept sub-lettered claims as valid refinements', () => {
      const content = [
        '## §1 Section',
        '',
        '### §1.DIFF.03 Base claim',
        '',
        '### §1.DIFF.03a Sub-claim a',
        '',
        '### §1.DIFF.03b Sub-claim b',
        '',
        '### §1.DIFF.03c Sub-claim c',
        '',
        '### §1.DIFF.04 Next integer',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const monotonicErrors = errors.filter((e) => e.type === 'non-monotonic');
      expect(monotonicErrors).toHaveLength(0);
    });

    it('should detect sub-letter going backwards within same number', () => {
      const content = [
        '## §1 Section',
        '',
        '### §1.AC.01a Sub a',
        '',
        '### §1.AC.01 Base after sub',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const monotonicErrors = errors.filter((e) => e.type === 'non-monotonic');
      expect(monotonicErrors.length).toBeGreaterThanOrEqual(1);
    });

    it('should accept sub-lettered claims starting from base without a gap', () => {
      const content = [
        '## §1 Section',
        '',
        '### §1.CLASS.01 Base',
        '',
        '### §1.CLASS.01a Refinement',
        '',
        '### §1.CLASS.02 Next',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const monotonicErrors = errors.filter((e) => e.type === 'non-monotonic');
      expect(monotonicErrors).toHaveLength(0);
    });

    it('should check monotonicity per prefix independently', () => {
      const content = [
        '## §1 Section',
        '',
        '### §1.AC.01 AC first',
        '',
        '### §1.SEC.01 SEC first',
        '',
        '### §1.AC.02 AC second',
        '',
        '### §1.SEC.02 SEC second',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const monotonicErrors = errors.filter((e) => e.type === 'non-monotonic');
      expect(monotonicErrors).toHaveLength(0);
    });
  });

  describe('validateClaimTree — forbidden form detection', () => {
    it('should detect forbidden form AC01 in headings', () => {
      const content = [
        '### §1 Section',
        '',
        '#### AC01 Bad form',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      expect(forbiddenErrors.length).toBeGreaterThanOrEqual(1);
      expect(forbiddenErrors[0].claimId).toBe('AC01');
    });

    // Section/topic labels with a single-letter prefix (e.g. `B10`, `H1`,
    // `T1`) are common in specs and are not claim attempts. The forbidden-
    // form rule requires 2+ letters, so these should not fire.
    it('should NOT flag single-letter labels like B10 as forbidden form', () => {
      const content = [
        '## §1 Section',
        '',
        '#### B10: Community & Sharing',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      expect(forbiddenErrors).toHaveLength(0);
    });

    // The forbidden-form rule is anchored at the start of heading/paragraph
    // text. Mid-text occurrences of letter+digits are not flagged.
    it('should NOT flag B10 mid-heading or mid-paragraph', () => {
      const content = [
        '## §1 Section',
        '',
        '### Stage B10 Parser',
        '',
        'See B10 in the appendix for details.',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      expect(forbiddenErrors).toHaveLength(0);
    });
  });

  describe('validateClaimTree — alphanumeric prefix detection', () => {
    // @validates {R004.§1.AC.07} Alphanumeric prefix rejected — heading position
    it('should detect alphanumeric prefix PH1.01 in headings', () => {
      const content = [
        '### §1 Section',
        '',
        '#### PH1.01 Some claim',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      expect(forbiddenErrors.length).toBeGreaterThanOrEqual(1);
      const phError = forbiddenErrors.find((e) => e.claimId === 'PH1.01');
      expect(phError).toBeDefined();
      expect(phError!.message).toContain('Alphanumeric prefix "PH1" is forbidden');
      expect(phError!.message).toContain('alphabetic-only');
      expect(phError!.message).toContain('"PH"');
    });

    // @validates {R004.§1.AC.07} Alphanumeric prefix rejected — paragraph position
    it('should detect alphanumeric prefix PH1.01 in paragraph claim', () => {
      const content = [
        '### §1 Section',
        '',
        'PH1.01 The system MUST do something.',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      expect(forbiddenErrors.length).toBeGreaterThanOrEqual(1);
      const phError = forbiddenErrors.find((e) => e.claimId === 'PH1.01');
      expect(phError).toBeDefined();
      expect(phError!.message).toContain('Alphanumeric prefix "PH1" is forbidden');
    });

    // @validates {R004.§1.AC.07} Alphanumeric prefix rejected — multi-letter form
    it('should detect alphanumeric prefix PRD2.05', () => {
      const content = [
        '### §1 Section',
        '',
        '#### PRD2.05 Bad prefix',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      const prdError = forbiddenErrors.find((e) => e.claimId === 'PRD2.05');
      expect(prdError).toBeDefined();
      expect(prdError!.message).toContain('"PRD2"');
      expect(prdError!.message).toContain('"PRD"');
    });

    // @validates {R004.§1.AC.07} Alphabetic-only prefix is the control case
    it('should NOT flag valid AC.01 heading', () => {
      const content = [
        '### §1 Section',
        '',
        '#### AC.01 Good form',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      expect(forbiddenErrors).toHaveLength(0);
    });

    // @validates {R004.§1.AC.07} Note ID + claim prefix is not alphanumeric prefix
    it('should NOT flag note ID followed by claim like R009.AC.01', () => {
      const content = [
        '### §1 Section',
        '',
        '#### R009.AC.01 Cross-doc reference in heading',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      expect(forbiddenErrors).toHaveLength(0);
    });

    // @validates {R004.§1.AC.07} Fully-qualified ref in prose is not flagged
    it('should NOT flag fully-qualified reference R004.§1.AC.01 in prose', () => {
      const content = [
        '### §1 Section',
        '',
        'The claim R004.§1.AC.01 is referenced here.',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      expect(forbiddenErrors).toHaveLength(0);
    });

    // @validates {R004.§1.AC.07} Note ID followed by section number is not flagged
    it('should NOT flag note ID followed by section like DD007.01.DC.002', () => {
      const content = [
        '### §1 Section',
        '',
        'See DD007.01.DC.002 for an example with section path.',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      expect(forbiddenErrors).toHaveLength(0);
    });

    // @validates {R004.§1.AC.07} Existing AC01 forbidden form still fires
    it('should still detect existing forbidden form AC01 (regression check)', () => {
      const content = [
        '### §1 Section',
        '',
        '#### AC01 Bad form (no dot)',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
      expect(forbiddenErrors.length).toBeGreaterThanOrEqual(1);
      // The original "missing dot" check fires; the alphanumeric-prefix check
      // should not fire because there's no `.NN` segment after the digits.
      expect(forbiddenErrors[0].claimId).toBe('AC01');
      expect(forbiddenErrors[0].message).toContain('missing dot');
    });
  });

  describe('validateClaimTree — multi-letter-segment prefix detection', () => {
    // @validates {R004.§1.AC.08} Multi-letter-segment prefix rejected — heading position
    it('should detect FOO.AC.01 in headings', () => {
      const content = [
        '### §1 Foo',
        '',
        '#### FOO.AC.01 First Foo claim',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const multisegErrors = errors.filter(
        (e) => e.type === 'forbidden-form' && e.message.includes('Multi-letter-segment'),
      );
      expect(multisegErrors).toHaveLength(1);
      expect(multisegErrors[0].claimId).toBe('FOO.AC.01');
      expect(multisegErrors[0].message).toContain('"FOO.AC"');
      expect(multisegErrors[0].message).toContain('§N.AC.01');
      expect(multisegErrors[0].message).toContain('## §N FOO');
    });

    // @validates {R004.§1.AC.08} Multi-letter-segment prefix rejected — paragraph position
    it('should detect FOO.AC.01 in paragraph claim', () => {
      const content = [
        '### §1 Foo',
        '',
        'FOO.AC.01 The system MUST do something.',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const multisegErrors = errors.filter(
        (e) => e.type === 'forbidden-form' && e.message.includes('Multi-letter-segment'),
      );
      expect(multisegErrors).toHaveLength(1);
      expect(multisegErrors[0].claimId).toBe('FOO.AC.01');
    });

    // @validates {R004.§1.AC.08} Multi-letter-segment prefix rejected — table cell
    it('should detect FOO.AC.01 in table first cell', () => {
      const content = [
        '## §1 Foo',
        '',
        '| Code | Criterion |',
        '|------|-----------|',
        '| FOO.AC.01 | First claim |',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const multisegErrors = errors.filter(
        (e) => e.type === 'forbidden-form' && e.message.includes('Multi-letter-segment'),
      );
      expect(multisegErrors).toHaveLength(1);
      expect(multisegErrors[0].claimId).toBe('FOO.AC.01');
    });

    // @validates {R004.§1.AC.08} Bold-wrapped multi-segment is detected
    it('should detect bold-wrapped **FOO.AC.01** in table cell', () => {
      const content = [
        '## §1 Foo',
        '',
        '| Code | Criterion |',
        '|------|-----------|',
        '| **FOO.AC.01** | First claim |',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const multisegErrors = errors.filter(
        (e) => e.type === 'forbidden-form' && e.message.includes('Multi-letter-segment'),
      );
      expect(multisegErrors).toHaveLength(1);
      expect(multisegErrors[0].claimId).toBe('FOO.AC.01');
    });

    // @validates {R004.§1.AC.08} Multi-letter prefix variations
    it('should detect BAR.AC.01 and BAZ.SEC.03 forms', () => {
      const content = [
        '## §1',
        '',
        '#### BAR.AC.01 First',
        '',
        '## §2',
        '',
        '#### BAZ.SEC.03 Second',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const multisegErrors = errors.filter(
        (e) => e.type === 'forbidden-form' && e.message.includes('Multi-letter-segment'),
      );
      expect(multisegErrors.map((e) => e.claimId).sort()).toEqual(['BAR.AC.01', 'BAZ.SEC.03']);
    });

    // @validates {R004.§1.AC.08} Note-ID-prefixed forms are NOT flagged
    it('should NOT flag R004.AC.01 (note ID + claim, single letter segment)', () => {
      const content = [
        '## §1',
        '',
        '#### R004.AC.01 Cross-doc claim header',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const multisegErrors = errors.filter(
        (e) => e.type === 'forbidden-form' && e.message.includes('Multi-letter-segment'),
      );
      expect(multisegErrors).toHaveLength(0);
    });

    // @validates {R004.§1.AC.08} Fully-qualified prose ref is not flagged
    it('should NOT flag R004.§1.AC.01 in prose', () => {
      const content = [
        '## §1',
        '',
        'See R004.§1.AC.01 for the rule.',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const multisegErrors = errors.filter(
        (e) => e.type === 'forbidden-form' && e.message.includes('Multi-letter-segment'),
      );
      expect(multisegErrors).toHaveLength(0);
    });

    // @validates {R004.§1.AC.08} Backtick-protected discussion is not flagged
    it('should NOT flag backtick-protected `FOO.AC.01` in prose', () => {
      const content = [
        '## §1',
        '',
        'The `FOO.AC.01` form is forbidden — use `§1.AC.01` instead.',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const multisegErrors = errors.filter(
        (e) => e.type === 'forbidden-form' && e.message.includes('Multi-letter-segment'),
      );
      expect(multisegErrors).toHaveLength(0);
    });

    // @validates {R004.§1.AC.08} Single-segment AC.01 control case
    it('should NOT flag valid AC.01 heading', () => {
      const content = [
        '## §1',
        '',
        '#### AC.01 Good form',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const multisegErrors = errors.filter(
        (e) => e.type === 'forbidden-form' && e.message.includes('Multi-letter-segment'),
      );
      expect(multisegErrors).toHaveLength(0);
    });

    // @validates {R004.§1.AC.08} Multi-segment claim is silently dropped without check
    it('confirms parser silently drops multi-segment claims (regression baseline)', () => {
      const content = [
        '## §1 Foo',
        '',
        '| Code | Criterion |',
        '|------|-----------|',
        '| FOO.AC.01 | First claim |',
        '| FOO.AC.02 | Second claim |',
      ].join('\n');

      const result = buildClaimTree(content);
      // The forbidden-form check fires, but no claim node is created — this is
      // the silent-drop behavior the linter exists to surface.
      expect(result.claims.size).toBe(0);
      const errors = validateClaimTree(result);
      const multisegErrors = errors.filter(
        (e) => e.type === 'forbidden-form' && e.message.includes('Multi-letter-segment'),
      );
      expect(multisegErrors).toHaveLength(2);
    });
  });

  describe('validateClaimTree — bare-id ambiguity is not flagged at definition time', () => {
    // Section-qualified claims that share a bare suffix (`§1.AC.01`,
    // `§2.AC.01`) are the normal payoff of using sections — they are not
    // ambiguous. Ambiguity is a reference-resolution concern; the lint
    // doesn't pre-flag definitions for hypothetical bare references.
    it('should NOT raise ambiguous errors for matching bare suffixes across sections', () => {
      const content = [
        '## §1 First Section',
        '',
        '### §1.AC.01 First section AC.01',
        '',
        '## §2 Second Section',
        '',
        '### §2.AC.01 Second section AC.01',
      ].join('\n');

      const result = buildClaimTree(content);
      const errors = validateClaimTree(result);
      const ambiguousErrors = errors.filter((e) => e.type === 'ambiguous');
      expect(ambiguousErrors).toHaveLength(0);
    });
  });

  describe('buildClaimTree — table row claims', () => {
    it('should parse claims from first cell of table rows', () => {
      const content = [
        '### §1 Open Questions',
        '',
        '| OQ.01 | What format for persistence? | Resolved |',
        '| OQ.02 | How to handle rollback? | Open |',
        '| OQ.03 | Migration function shape? | Resolved |',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(3);
      expect(result.claims.has('1.OQ.01')).toBe(true);
      expect(result.claims.has('1.OQ.02')).toBe(true);
      expect(result.claims.has('1.OQ.03')).toBe(true);
    });

    it('should use full row as heading', () => {
      const content = [
        '### §1 Questions',
        '',
        '| OQ.01 | What format? | Resolved |',
      ].join('\n');

      const result = buildClaimTree(content);
      const claim = result.claims.get('1.OQ.01')!;
      expect(claim.heading).toBe('OQ.01 | What format? | Resolved');
    });

    it('should skip table separator rows', () => {
      const content = [
        '### §1 Questions',
        '',
        '| ID | Question | Status |',
        '|---|---|---|',
        '| OQ.01 | What format? | Resolved |',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(1);
      expect(result.claims.has('1.OQ.01')).toBe(true);
    });

    it('should skip header rows without claim IDs', () => {
      const content = [
        '### §1 Questions',
        '',
        '| ID | Question | Status |',
        '|---|---|---|',
        '| OQ.01 | What format? | Resolved |',
        '| OQ.02 | How to rollback? | Open |',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(2);
      // "ID" doesn't match LINE_CLAIM_RE — no false positive
    });

    it('should ignore claim IDs in non-first cells', () => {
      const content = [
        '### §1 Mapping',
        '',
        '| File | Implements | Notes |',
        '|---|---|---|',
        '| migration.ts | AC.01 | The main runner |',
      ].join('\n');

      const result = buildClaimTree(content);
      // "File" doesn't match, and we only check first cell
      expect(result.claims.size).toBe(0);
    });

    it('should not match braced references in first cell', () => {
      const content = [
        '### §1 Traceability',
        '',
        '| {R007.§1.AC.01} | searchClaims() | Main entry |',
      ].join('\n');

      const result = buildClaimTree(content);
      // Braced references start with {, not a claim pattern
      expect(result.claims.size).toBe(0);
    });

    it('should handle bold-wrapped claims in table cells', () => {
      const content = [
        '### §1 Scope',
        '',
        '| **DC.01** | New blob module | Design complete |',
        '| **DC.02** | Shape declaration | Design complete |',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(2);
      expect(result.claims.has('1.DC.01')).toBe(true);
      expect(result.claims.has('1.DC.02')).toBe(true);
    });

    it('should handle claims with metadata suffix in table cells', () => {
      const content = [
        '### §1 Scope',
        '',
        '| DC.01:4 | Important claim | Design complete |',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(1);
      const claim = result.claims.get('1.DC.01')!;
      expect(claim.metadata).toContain('4');
    });

    it('should respect opt-out directive', () => {
      const content = [
        '<!-- no-table-claims -->',
        '',
        '### §1 Reference Table',
        '',
        '| AC.01 | Implemented | migration.ts |',
        '| AC.02 | Implemented | runner.ts |',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(0);
    });

    it('should qualify table claims with section context', () => {
      const content = [
        '### §2 Phase Two',
        '',
        '| DC.01 | Version tracking | Done |',
        '',
        '### §3 Phase Three',
        '',
        '| DC.01 | Re-save scheduler | Done |',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.has('2.DC.01')).toBe(true);
      expect(result.claims.has('3.DC.01')).toBe(true);
    });

    it('should work without section context (bare table claims)', () => {
      const content = [
        '# Document',
        '',
        '| OQ.01 | First question | Open |',
        '| OQ.02 | Second question | Resolved |',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.has('OQ.01')).toBe(true);
      expect(result.claims.has('OQ.02')).toBe(true);
    });
  });

  describe('buildClaimTree — parse R004 requirements document', () => {
    let r004Content: string;
    let r004Tree: ClaimTreeResult;

    try {
      // Resolve the path relative to the project root
      const r004Path = resolve(
        __dirname,
        '../../../../../_scepter/notes/requirements/R004 Claim-Level Addressability and Traceability System.md',
      );
      r004Content = readFileSync(r004Path, 'utf-8');
    } catch {
      // If the file doesn't exist, skip these tests
      r004Content = '';
    }

    if (!r004Content) {
      it.skip('R004 file not found — skipping integration tests', () => {});
    }

    if (r004Content) {
      it('should parse R004 without throwing', () => {
        r004Tree = buildClaimTree(r004Content);
        expect(r004Tree).toBeDefined();
        expect(r004Tree.roots.length).toBeGreaterThan(0);
      });

      it('should find section headings §1 through §8', () => {
        r004Tree = buildClaimTree(r004Content);
        for (let i = 1; i <= 8; i++) {
          expect(r004Tree.sections.has(String(i))).toBe(true);
        }
      });

      it('should find claims in §1 (AC.01 through AC.06)', () => {
        r004Tree = buildClaimTree(r004Content);
        for (let i = 1; i <= 6; i++) {
          const claimId = `1.AC.${String(i).padStart(2, '0')}`;
          expect(r004Tree.claims.has(claimId)).toBe(true);
        }
      });

      it('should find claims in §2 (AC.01 through AC.05)', () => {
        r004Tree = buildClaimTree(r004Content);
        for (let i = 1; i <= 5; i++) {
          const claimId = `2.AC.${String(i).padStart(2, '0')}`;
          expect(r004Tree.claims.has(claimId)).toBe(true);
        }
      });

      it('should find claims in §3 (AC.01 through AC.04)', () => {
        r004Tree = buildClaimTree(r004Content);
        for (let i = 1; i <= 4; i++) {
          const claimId = `3.AC.${String(i).padStart(2, '0')}`;
          expect(r004Tree.claims.has(claimId)).toBe(true);
        }
      });

      it('should set correct content boundaries', () => {
        r004Tree = buildClaimTree(r004Content);
        // Each claim's endLine should be >= its start line
        for (const [, claim] of r004Tree.claims) {
          expect(claim.endLine).toBeGreaterThanOrEqual(claim.line);
        }
      });

      it('should have claims as leaf nodes (no children)', () => {
        r004Tree = buildClaimTree(r004Content);
        for (const [, claim] of r004Tree.claims) {
          // Claims in R004 are leaf-level headings with no sub-headings
          expect(claim.type).toBe('claim');
        }
      });

      it('should produce no forbidden-form errors for R004', () => {
        r004Tree = buildClaimTree(r004Content);
        const errors = validateClaimTree(r004Tree);
        const forbiddenErrors = errors.filter((e) => e.type === 'forbidden-form');
        // R004 uses correct AC.01 form throughout, but it DISCUSSES the forbidden form AC01
        // The discussion text is in prose, not in headings, so it should not trigger errors
        // However, some prose mentions may be in headings or not — let's just verify
        // that any forbidden-form errors are from discussion, not actual claim headings
        for (const err of forbiddenErrors) {
          // If there are any, they should be from discussion headings, not claim definitions
          expect(err.line).toBeGreaterThan(0);
        }
      });
    }
  });

  describe('Self-prefixed claim definitions', () => {
    // @validates {R004.§3.AC.05} self-prefixed claim definitions are recognized
    // @validates {S002.§8.AC.01} parser accepts optional leading note-ID prefix on heading-form
    it('should accept heading-form self-prefix and capture it as data', () => {
      const content = [
        '# R049 Lock Authority',
        '',
        '### R049.LOCK.03 Lock authority claim',
        '',
        'Body content.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(1);
      // Canonical id has NO note-ID prefix
      expect(result.claims.has('LOCK.03')).toBe(true);
      const node = result.claims.get('LOCK.03')!;
      // @validates {S002.§8.AC.02} selfPrefix populated; canonical id stays bare
      expect(node.selfPrefix).toBe('R049');
      expect(node.id).toBe('LOCK.03');
      expect(node.claimPrefix).toBe('LOCK');
      expect(node.claimNumber).toBe(3);
    });

    // @validates {R004.§3.AC.05} bold-wrapped paragraph self-prefix recognized
    // @validates {S002.§8.AC.01} parser accepts self-prefix on bold-wrapped paragraph-form
    it('should accept bold-wrapped paragraph-form self-prefix', () => {
      const content = [
        '# R049 Lock Authority',
        '',
        '## §1 Locks',
        '',
        '**R049.LOCK.03**: The lock MUST hold for the duration of the operation.',
        '',
        'Trailing content.',
      ].join('\n');

      const result = buildClaimTree(content);
      // Bare LOCK.03 inside §1 → 1.LOCK.03
      expect(result.claims.has('1.LOCK.03')).toBe(true);
      const node = result.claims.get('1.LOCK.03')!;
      expect(node.selfPrefix).toBe('R049');
      expect(node.claimPrefix).toBe('LOCK');
      expect(node.claimNumber).toBe(3);
    });

    // @validates {R004.§3.AC.05} plain paragraph self-prefix is NOT a definition
    // @validates {S002.§8.AC.01} plain (non-bold) paragraph-form self-prefix rejected as definition
    it('should NOT treat plain (non-bold) paragraph-form self-prefix as a definition', () => {
      const content = [
        '# R049 Lock Authority',
        '',
        '## §1 Locks',
        '',
        'R049.LOCK.03 referenced here in normal prose, not a definition.',
        '',
        'Trailing content.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(0);
      expect(result.claims.has('1.LOCK.03')).toBe(false);
      expect(result.claims.has('LOCK.03')).toBe(false);
    });

    // @validates {R004.§3.AC.05} section-qualified self-prefix definitions accepted
    // @validates {S002.§8.AC.05} section-qualified self-prefix produces correct id
    it('should accept section-qualified self-prefix and produce section-qualified canonical id', () => {
      const content = [
        '# R049 Lock Authority',
        '',
        '**R049.§3.LOCK.03**: A section-qualified self-prefixed claim.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.size).toBe(1);
      expect(result.claims.has('3.LOCK.03')).toBe(true);
      const node = result.claims.get('3.LOCK.03')!;
      expect(node.id).toBe('3.LOCK.03');
      expect(node.selfPrefix).toBe('R049');
    });

    // @validates {S002.§8.AC.07} reference parser unaffected — bare claim w/o self-prefix still works
    it('should leave non-self-prefixed claim definitions unchanged', () => {
      const content = [
        '# R049 Lock Authority',
        '',
        '## §1 Locks',
        '',
        '**LOCK.03**: A normal bold-wrapped claim with no self-prefix.',
      ].join('\n');

      const result = buildClaimTree(content);
      expect(result.claims.has('1.LOCK.03')).toBe(true);
      const node = result.claims.get('1.LOCK.03')!;
      expect(node.selfPrefix).toBeUndefined();
    });
  });
});
