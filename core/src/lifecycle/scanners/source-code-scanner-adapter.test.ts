/**
 * Tests for the source-code scanner adapter.
 *
 * @validates {R015.§3.AC.06} braced refs in annotation contexts (@implements, @validates, etc.)
 * @validates {R015.§3.AC.07} bare braced refs in comments without annotation prefix
 * @validates {DD020.§2.DC.08} source-annotation surface
 * @validates {DD020.§2.DC.09} source-comment surface
 */

import { describe, it, expect } from 'vitest';
import { scanSourceCode } from './source-code-scanner-adapter';

const FILE = '/proj/src/foo.ts';

describe('scanSourceCode — annotation contexts', () => {
  it('emits source-annotation span for @implements {R005}', () => {
    const content = '// @implements {R005.§1.AC.03}\nfunction foo() {}';
    const spans = scanSourceCode(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].surface).toBe('source-annotation');
    expect(spans[0].parsedAddress.noteId).toBe('R005');
  });

  it('recognizes @validates / @addresses / @depends-on / @see', () => {
    const annotations = ['@validates', '@addresses', '@depends-on', '@see'];
    for (const anno of annotations) {
      const content = `// ${anno} {R005}\n`;
      const spans = scanSourceCode(FILE, content);
      expect(spans).toHaveLength(1);
      expect(spans[0].surface).toBe('source-annotation');
    }
  });

  it('recognizes annotations inside block comments', () => {
    const content =
      '/**\n * @implements {R005.§1.AC.03} description\n */\nclass Foo {}';
    const spans = scanSourceCode(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].surface).toBe('source-annotation');
    expect(spans[0].parsedAddress.noteId).toBe('R005');
  });

  it('preserves byte ranges inside block comments', () => {
    const content =
      '/**\n * @implements {R005.§1.AC.03}\n */\n';
    const spans = scanSourceCode(FILE, content);
    expect(spans).toHaveLength(1);
    const [s, e] = spans[0].noteIdRange;
    expect(content.slice(s, e)).toBe('R005');
  });
});

describe('scanSourceCode — bare comment references', () => {
  it('emits source-comment surface for bare braced refs in comments', () => {
    const content = '// see {R005} for context\nconst x = 1;';
    const spans = scanSourceCode(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].surface).toBe('source-comment');
  });

  it('emits source-comment for bare refs in block comments', () => {
    const content = '/* see {R005.§1.AC.03} */\nclass Foo {}';
    const spans = scanSourceCode(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].surface).toBe('source-comment');
  });

  it('Python-style # comments are recognized too', () => {
    const content = '# @implements {R005}\n';
    const spans = scanSourceCode(FILE, content);
    expect(spans).toHaveLength(1);
    expect(spans[0].surface).toBe('source-annotation');
  });
});

describe('scanSourceCode — non-comment contexts', () => {
  it('does NOT emit spans for refs inside string literals', () => {
    const content = "const msg = '{R005}';\n";
    const spans = scanSourceCode(FILE, content);
    expect(spans).toHaveLength(0);
  });

  it('does NOT emit spans for refs inside double-quoted strings', () => {
    const content = 'const msg = "{R005}";\n';
    const spans = scanSourceCode(FILE, content);
    expect(spans).toHaveLength(0);
  });

  it('does NOT emit spans for refs inside template literals', () => {
    const content = 'const msg = `{R005}`;\n';
    const spans = scanSourceCode(FILE, content);
    expect(spans).toHaveLength(0);
  });

  it('does NOT emit spans for refs in plain code (no comment)', () => {
    const content = 'const x = R005;\n';
    const spans = scanSourceCode(FILE, content);
    // Even if it could be a braceless ref, source-code scanner only
    // emits inside comments, so 0.
    expect(spans).toHaveLength(0);
  });
});

describe('scanSourceCode — multi-line, multi-ref', () => {
  it('emits one span per ref, in source-order', () => {
    const content = [
      '/**',
      ' * @implements {R005.§1.AC.01}',
      ' * @implements {R007.§2.AC.03}',
      ' */',
      '// see also {R005.§3} and {R012}',
      'class Foo {}',
    ].join('\n');
    const spans = scanSourceCode(FILE, content);
    expect(spans).toHaveLength(4);
    expect(spans[0].surface).toBe('source-annotation');
    expect(spans[1].surface).toBe('source-annotation');
    expect(spans[2].surface).toBe('source-comment');
    expect(spans[3].surface).toBe('source-comment');

    const noteIds = spans.map((s) => s.parsedAddress.noteId);
    expect(noteIds).toEqual(['R005', 'R007', 'R005', 'R012']);
  });
});
