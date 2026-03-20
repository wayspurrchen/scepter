import { describe, it, expect } from 'vitest';
import { parseNoteMentions, type NoteMention } from './note-parser';

describe('Note Parser', () => {
  describe('Basic note mentions', () => {
    it('should parse simple note mentions with extensions', () => {
      const content = `
{D001: Use PostgreSQL for main database}
{R001: API must support REST and GraphQL}
{Q001: Should we use Redis for caching?}
{T001: Implement user authentication}
{M001: MVP Launch - Q1 2024}
`;

      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(5);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        contentExtension: 'Use PostgreSQL for main database',
        line: 2,
      });

      expect(mentions[1]).toMatchObject({
        id: 'R001',
        contentExtension: 'API must support REST and GraphQL',
        line: 3,
      });

      expect(mentions[2].id).toBe('Q001');
      expect(mentions[3].id).toBe('T001');
      expect(mentions[4].id).toBe('M001');
    });
  });

  describe('Note mentions with tags', () => {
    it('should parse tags from mentions', () => {
      const content = `
{D001#architecture: Use microservices}
{T001#auth: Add login endpoint}
{Q001#performance,caching: Redis vs Memcached?}
{R001#api,security,auth: All endpoints must use HTTPS}
`;

      const mentions = parseNoteMentions(content);

      expect(mentions[0]).toMatchObject({
        id: 'D001',
        contentExtension: 'Use microservices',
        tagExtensions: ['architecture'],
      });

      expect(mentions[2]).toMatchObject({
        id: 'Q001',
        contentExtension: 'Redis vs Memcached?',
        tagExtensions: ['performance', 'caching'],
      });

      expect(mentions[3].tagExtensions).toEqual(['api', 'security', 'auth']);
    });

    it('should support hierarchical tags', () => {
      const content = `
{D001#auth/jwt,security/tokens: Use JWT for authentication}
{T001#api/rest,testing/integration: Write REST API tests}
`;

      const mentions = parseNoteMentions(content);

      expect(mentions[0]).toMatchObject({
        id: 'D001',
        contentExtension: 'Use JWT for authentication',
        tagExtensions: ['auth/jwt', 'security/tokens'],
      });
      expect(mentions[1]).toMatchObject({
        id: 'T001',
        contentExtension: 'Write REST API tests',
        tagExtensions: ['api/rest', 'testing/integration'],
      });
    });
  });

  describe('Multiline mentions', () => {
    it('should parse multiline mention extensions', () => {
      const content = `
{D001#architecture:
  Microservices architecture chosen for:
  - Independent scaling
  - Team autonomy
  - Technology flexibility
}

{T001#testing:
  Write comprehensive tests including:
  - Unit tests
  - Integration tests
  - E2E tests
}
`;

      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(2);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        contentExtension:
          'Microservices architecture chosen for:\n  - Independent scaling\n  - Team autonomy\n  - Technology flexibility',
        line: 2,
      });
    });
  });

  describe('Note mentions without extensions', () => {
    it('should parse simple note mentions', () => {
      const content = `
Based on {D001}, we need to implement microservices.
See {R001} for API requirements.
{Q001} needs to be answered before proceeding.
`;

      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(3);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        line: 2,
      });
      expect(mentions[0].contentExtension).toBeUndefined();
    });

    it('should parse mentions with modifiers', () => {
      const content = `
{D001+} // Include full content
{R002>} // Include outgoing references
{T001<} // Include incoming references
{Q001$} // Include context hints
{M001*} // Include everything
{X001+>} // Multiple modifiers
`;

      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(6);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        inclusionModifiers: { content: true },
      });

      expect(mentions[1]).toMatchObject({
        id: 'R002',
        inclusionModifiers: { outgoingReferences: true },
      });

      expect(mentions[2]).toMatchObject({
        id: 'T001',
        inclusionModifiers: { incomingReferences: true },
      });

      expect(mentions[3]).toMatchObject({
        id: 'Q001',
        inclusionModifiers: { contextHints: true },
      });

      expect(mentions[4]).toMatchObject({
        id: 'M001',
        inclusionModifiers: { everything: true },
      });

      expect(mentions[5]).toMatchObject({
        id: 'X001',
        inclusionModifiers: { content: true, outgoingReferences: true },
      });
    });

    it('should parse mentions with optional short titles (ignored)', () => {
      const content = `
We need secure user authentication {D001 JWT auth}.
Based on {R042 API design}, we'll use REST.
{T001+ auth implementation} is high priority.
See {Q001> caching strategy} for context.
`;

      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(4);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        line: 2,
      });

      expect(mentions[1]).toMatchObject({
        id: 'R042',
        line: 3,
      });

      expect(mentions[2]).toMatchObject({
        id: 'T001',
        inclusionModifiers: { content: true },
        line: 4,
      });

      expect(mentions[3]).toMatchObject({
        id: 'Q001',
        inclusionModifiers: { outgoingReferences: true },
        line: 5,
      });
    });

    it('should parse mentions with extensions containing short titles', () => {
      const content = `
We need secure user authentication {D001+ JWT auth: Don't forget to encrypt}.
Based on {R042< API design: REST is simpler than GraphQL for this use case}.
`;

      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(2);

      expect(mentions[0]).toMatchObject({
        id: 'D001',
        inclusionModifiers: { content: true },
        contentExtension: "Don't forget to encrypt",
        line: 2,
      });

      expect(mentions[1]).toMatchObject({
        id: 'R042',
        inclusionModifiers: { incomingReferences: true },
        contentExtension: 'REST is simpler than GraphQL for this use case',
        line: 3,
      });
    });
  });

  describe('Multiple extensions', () => {
    it('should handle multiple extensions of the same note', () => {
      const content = `
{D001#architecture: Use PostgreSQL}
Later we add more context:
{D001#database,performance: PostgreSQL for ACID compliance}
And even more:
{D001#security: PostgreSQL for row-level security}
`;

      const mentions = parseNoteMentions(content);

      // Should have 3 mentions, all extending D001
      expect(mentions).toHaveLength(3);
      expect(mentions.every((m) => m.id === 'D001')).toBe(true);

      // Each has different extension content
      expect(mentions[0].contentExtension).toBe('Use PostgreSQL');
      expect(mentions[1].contentExtension).toBe('PostgreSQL for ACID compliance');
      expect(mentions[2].contentExtension).toBe('PostgreSQL for row-level security');
    });
  });

  describe('Invalid formats', () => {
    it('should not parse invalid note formats', () => {
      const content = `
{}: Empty ID
{#tags}: Missing ID
D001: Missing braces
{D001} Valid mention without extension
{D001 Missing closing brace
{ D001}: Space before ID
{D001:}: Empty extension is valid
`;

      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(2); // {D001} and {D001:}
      expect(mentions[0].id).toBe('D001');
      expect(mentions[0].contentExtension).toBeUndefined();
      expect(mentions[1].id).toBe('D001');
      expect(mentions[1].contentExtension).toBe('');
    });

    it('should validate note ID formats', () => {
      const content = `
{TOOLONG001: Shortcode too long}
{D: Missing number}
{D00: Too few digits}
{D000001: Too many digits}
{d001: Lowercase not allowed}
{D-001: Special chars not allowed}
`;

      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(0);
    });

    it('should accept valid multi-character shortcodes', () => {
      const content = `
{X001: Single char shortcode}
{DD001: Two char shortcode}
{ARCH00001: Multi-char with 5 digits}
{US12345: User story}
{API042: API spec}
`;

      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(5);
      expect(mentions[0].id).toBe('X001');
      expect(mentions[1].id).toBe('DD001');
      expect(mentions[2].id).toBe('ARCH00001');
      expect(mentions[3].id).toBe('US12345');
      expect(mentions[4].id).toBe('API042');
    });
  });

  describe('Context preservation', () => {
    it('should track file path when provided', () => {
      const content = '{D001: Architecture decision}';

      const mentions = parseNoteMentions(content, {
        filePath: 'docs/decisions.md',
      });

      expect(mentions[0].filePath).toBe('docs/decisions.md');
    });
  });

  describe('Special content handling', () => {
    it('should handle content with special characters', () => {
      const content = `
{D001: Use "PostgreSQL" (not MySQL) for main DB}
{T001: Implement @auth decorator}
{Q001: Should we use TypeScript's \`strict\` mode?}
`;

      const mentions = parseNoteMentions(content);

      expect(mentions[0].contentExtension).toContain('"PostgreSQL"');
      expect(mentions[1].contentExtension).toContain('@auth');
      expect(mentions[2].contentExtension).toContain('`strict`');
    });

    it('should preserve content formatting', () => {
      const content = `{T001:   Preserve   multiple   spaces   }`;

      const mentions = parseNoteMentions(content);

      expect(mentions[0].contentExtension).toBe('Preserve   multiple   spaces');
    });
  });

  describe('Combined modifier parsing', () => {
    it('should handle combined modifiers correctly', () => {
      const content = `
{D001+<>$} // Multiple modifiers combined
{T001*} // Include everything modifier
`;

      const mentions = parseNoteMentions(content);

      expect(mentions[0]).toMatchObject({
        id: 'D001',
        inclusionModifiers: {
          content: true,
          incomingReferences: true,
          outgoingReferences: true,
          contextHints: true,
        },
      });

      expect(mentions[1]).toMatchObject({
        id: 'T001',
        inclusionModifiers: { everything: true },
      });
    });
  });

  describe('nested mentions', () => {
    it('should extract nested mentions from extension content', () => {
      const content = '{D001#auth: Use JWT based on {R002} requirements}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(2);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        contentExtension: 'Use JWT based on {R002} requirements',
      });
      expect(mentions[1]).toMatchObject({
        id: 'R002',
        line: 1,
      });
    });

    it('should handle multiple nested mentions', () => {
      const content = '{D001: Based on {R001} and {R002}, using {C003}}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(4); // D001, R001, R002, C003
      expect(mentions.map((m) => m.id)).toEqual(['D001', 'R001', 'R002', 'C003']);
    });

    it('should handle nested mentions with modifiers', () => {
      const content = '{D001: Must follow {R001+} and consider {R002>}}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(3);
      expect(mentions[1]).toMatchObject({
        id: 'R001',
        inclusionModifiers: { content: true },
      });
      expect(mentions[2]).toMatchObject({
        id: 'R002',
        inclusionModifiers: { outgoingReferences: true },
      });
    });

    it('should handle nested mentions in multiline extensions', () => {
      const content = `{D001#architecture:
Based on {R001} requirements and {D002} decision,
we will implement using {C003} component.
}`;
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(4);
      expect(mentions.map((m) => m.id)).toEqual(['D001', 'R001', 'D002', 'C003']);
    });

    it('should not duplicate mentions', () => {
      const content = '{D001: Use {R001} for auth and {R001} for validation}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(2); // D001 and R001 (only once)
      expect(mentions[1].id).toBe('R001');
    });

    it('should handle nested mentions with titles', () => {
      const content = '{D001: Follow {R001 Auth Requirements} and {D002 JWT Decision}}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(3);
      expect(mentions.map((m) => m.id)).toEqual(['D001', 'R001', 'D002']);
    });

    it('should handle mention without nested refs', () => {
      const content = '{D001: Simple decision without references}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0].id).toBe('D001');
    });

    it('should track parent-child relationships for nested mentions', () => {
      const content = '{D001: Use JWT based on {R002} requirements}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(2);

      // Parent mention
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        nestedMentions: ['R002'],
      });
      expect(mentions[0].parentMentionId).toBeUndefined();

      // Child mention
      expect(mentions[1]).toMatchObject({
        id: 'R002',
        parentMentionId: 'D001',
      });
      expect(mentions[1].nestedMentions).toBeUndefined();
    });

    it('should track multiple levels of nesting', () => {
      const content = '{D001: Based on {R001: which follows {S001}}}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(3);

      expect(mentions[0]).toMatchObject({
        id: 'D001',
        nestedMentions: ['R001'],
      });
      expect(mentions[0].parentMentionId).toBeUndefined();

      expect(mentions[1]).toMatchObject({
        id: 'R001',
        nestedMentions: ['S001'],
        parentMentionId: 'D001',
      });

      expect(mentions[2]).toMatchObject({
        id: 'S001',
        parentMentionId: 'R001',
      });
      expect(mentions[2].nestedMentions).toBeUndefined();
    });

    it('should handle complex nesting with multiple children', () => {
      const content = '{D001: Consider {R001}, {R002}, and {R003: based on {S001}}}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(5);

      expect(mentions[0]).toMatchObject({
        id: 'D001',
        nestedMentions: ['R001', 'R002', 'R003'],
      });

      expect(mentions[1].parentMentionId).toBe('D001');
      expect(mentions[2].parentMentionId).toBe('D001');
      expect(mentions[3]).toMatchObject({
        id: 'R003',
        parentMentionId: 'D001',
        nestedMentions: ['S001'],
      });

      expect(mentions[4]).toMatchObject({
        id: 'S001',
        parentMentionId: 'R003',
      });
      expect(mentions[4].nestedMentions).toBeUndefined();
    });
  });
});

describe('Note Parser - Code Comments', () => {
  describe('Basic note annotations in comments', () => {
    it('should parse single-line comment annotations', () => {
      const content = `
// {D001: Use dependency injection pattern}
// {T001: Refactor this class}
// {Q001: Should we cache this result?}
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions).toHaveLength(3);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        contentExtension: 'Use dependency injection pattern',
        line: 2,
      });
    });

    it('should parse multi-line comment annotations', () => {
      const content = `
/**
 * {D001: Use Repository pattern}
 * {T001: Add unit tests}
 * {R001: Must handle null values}
 */
class UserRepository {
}`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          blockStart: /\/\*/,
          blockEnd: /\*\//,
          blockLine: /^\s*\*/,
        },
      });

      expect(mentions).toHaveLength(3);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        contentExtension: 'Use Repository pattern',
        line: 3,
      });
    });
  });

  describe('Annotations with tags', () => {
    it('should parse tags in comment annotations', () => {
      const content = `
// {D001#architecture,patterns: Use CQRS pattern}
// {T001#refactoring,urgent: Extract to service}
// {Q001#performance,database,caching: Cache query results?}
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions[0]).toMatchObject({
        id: 'D001',
        contentExtension: 'Use CQRS pattern',
        tagExtensions: ['architecture', 'patterns'],
      });

      expect(mentions[1].tagExtensions).toEqual(['refactoring', 'urgent']);
      expect(mentions[2].tagExtensions).toEqual(['performance', 'database', 'caching']);
    });
  });

  describe('Note mentions in comments', () => {
    it('should parse note mentions without extensions', () => {
      const content = `
// Based on {D001}, we implement this service
// See {R001} for requirements
// {T001+} needs to be done first
// {Q001>} provides context
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions).toHaveLength(4);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        line: 2,
      });
      expect(mentions[0].contentExtension).toBeUndefined();

      expect(mentions[2]).toMatchObject({
        id: 'T001',
        inclusionModifiers: { content: true },
        line: 4,
      });

      expect(mentions[3]).toMatchObject({
        id: 'Q001',
        inclusionModifiers: { outgoingReferences: true },
        line: 5,
      });
    });

    it('should parse mentions with optional short titles', () => {
      const content = `
// We need secure user authentication {D001 JWT auth}.
// Based on {R042 API design}, we'll use REST.
// {T001+ auth implementation} is high priority.
// See {Q001< caching strategy} for context.
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions).toHaveLength(4);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        line: 2,
      });

      expect(mentions[1]).toMatchObject({
        id: 'R042',
        line: 3,
      });

      expect(mentions[2]).toMatchObject({
        id: 'T001',
        inclusionModifiers: { content: true },
        line: 4,
      });

      expect(mentions[3]).toMatchObject({
        id: 'Q001',
        inclusionModifiers: { incomingReferences: true },
        line: 5,
      });
    });

    it('should parse mentions with extensions in comments', () => {
      const content = `
// We need secure user authentication {D001+ JWT auth: Don't forget to encrypt}.
/* Based on {R042$ API design: REST is simpler than GraphQL for this use case}. */
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
          blockStart: /\/\*/,
          blockEnd: /\*\//,
        },
      });

      expect(mentions).toHaveLength(2);

      expect(mentions[0]).toMatchObject({
        id: 'D001',
        inclusionModifiers: { content: true },
        contentExtension: "Don't forget to encrypt",
        line: 2,
      });

      expect(mentions[1]).toMatchObject({
        id: 'R042',
        inclusionModifiers: { contextHints: true },
        contentExtension: 'REST is simpler than GraphQL for this use case',
        line: 3,
      });
    });
  });

  describe('Multiline note annotations', () => {
    it('should parse multiline annotations in block comments', () => {
      const content = `
/**
 * {D001#architecture:
 *   Use event-driven architecture for:
 *   - Loose coupling
 *   - Scalability
 *   - Async processing
 * }
 */
class EventBus {
}`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          blockStart: /\/\*/,
          blockEnd: /\*\//,
          blockLine: /^\s*\*/,
        },
      });

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        line: 3,
      });
      expect(mentions[0].contentExtension).toBe(
        'Use event-driven architecture for:\n- Loose coupling\n- Scalability\n- Async processing',
      );
    });

    it('should parse multiline annotations in consecutive single-line comments', () => {
      const content = `
// {T001#refactoring:
//   Refactor this method to:
//   - Reduce complexity
//   - Improve readability
// }
function complexMethod() {
}`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'T001',
        line: 2,
      });
      expect(mentions[0].contentExtension).toBe('Refactor this method to:\n- Reduce complexity\n- Improve readability');
    });
  });

  describe('Context extraction', () => {
    it('should extract context for class annotations', () => {
      const content = `
/**
 * {D001: Use singleton pattern}
 */
export class ConfigService {
  constructor() {}
}`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          blockStart: /\/\*/,
          blockEnd: /\*\//,
          blockLine: /^\s*\*/,
        },
        includeContext: true,
      });

      expect(mentions[0].context).toBe('export class ConfigService {');
    });

    it('should extract context for function annotations', () => {
      const content = `
// {T001: Add input validation}
export async function processUser(data: UserData): Promise<User> {
  return data;
}`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
        includeContext: true,
      });

      expect(mentions[0].context).toBe('export async function processUser(data: UserData): Promise<User> {');
    });

    it('should extract context for variable annotations', () => {
      const content = `
// {D001: Use environment variables}
const API_KEY = process.env.API_KEY;`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
        includeContext: true,
      });

      expect(mentions[0].context).toBe('const API_KEY = process.env.API_KEY;');
    });
  });

  describe('Mixed with regular comments', () => {
    it('should only parse note mentions', () => {
      const content = `
// This is a regular comment
// {D001: This is a note annotation}
// TODO: This is a regular TODO comment
// {T001: This is a task note}
/* Regular block comment */
/* {Q001: Question note} */
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
          blockStart: /\/\*/,
          blockEnd: /\*\//,
        },
      });

      expect(mentions).toHaveLength(3);
      expect(mentions.map((m) => m.id)).toEqual(['D001', 'T001', 'Q001']);
    });
  });

  describe('Special cases', () => {
    it('should handle annotations with special characters', () => {
      const content = `
// {D001: Use "strict" TypeScript config}
// {T001: Implement @deprecated decorator}
// {Q001: Should we use \`async/await\`?}
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions[0].contentExtension).toContain('"strict"');
      expect(mentions[1].contentExtension).toContain('@deprecated');
      expect(mentions[2].contentExtension).toContain('`async/await`');
    });

    it('should handle empty lines in multiline annotations', () => {
      const content = `
/**
 * {D001:
 *   Decision with empty lines:
 *   
 *   - First point
 *   
 *   - Second point
 * }
 */`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          blockStart: /\/\*/,
          blockEnd: /\*\//,
          blockLine: /^\s*\*/,
        },
      });

      expect(mentions[0].contentExtension).toContain('Decision with empty lines:');
      expect(mentions[0].contentExtension).toContain('- First point');
      expect(mentions[0].contentExtension).toContain('- Second point');
    });
  });

  describe('Invalid formats', () => {
    it('should not parse invalid note formats in comments', () => {
      const content = `
// {}: Empty ID
// {#auth}: Missing ID
// D001: Missing braces
// {XXXXXX001: Invalid shortcode too long}
// {D00: Invalid number format}
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions).toHaveLength(0);
    });

    it('should handle unclosed multiline annotations', () => {
      const content = `
// {D001:
//   This annotation is never closed
//   Missing closing brace
function test() {}`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      // Should not parse unclosed annotations
      expect(mentions).toHaveLength(0);
    });
  });

  describe('Multiple extensions in code', () => {
    it('should track multiple extensions of same note', () => {
      const content = `
// {D001#architecture: Initial architectural decision}

// Later in the file...
// {D001#performance: Performance implications of this decision}

// Even later...
// {D001#security: Security considerations}
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions).toHaveLength(3);
      expect(mentions.every((m) => m.id === 'D001')).toBe(true);

      expect(mentions[0].contentExtension).toBe('Initial architectural decision');
      expect(mentions[1].contentExtension).toBe('Performance implications of this decision');
      expect(mentions[2].contentExtension).toBe('Security considerations');
    });
  });

  describe('TypeScript/JSX specific cases', () => {
    it('should parse annotations in TSX/JSX comments', () => {
      const content = `
function Component() {
  return (
    <div>
      {/* {D001: Use functional components} */}
      {/* {T001#ui: Add loading state} */}
    </div>
  );
}`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          blockStart: /\/\*/,
          blockEnd: /\*\//,
        },
      });

      expect(mentions).toHaveLength(2);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        contentExtension: 'Use functional components',
      });
    });

    it('should parse annotations in TypeScript type definitions', () => {
      const content = `
// {D001: Use discriminated unions}
type Action = 
  | { type: 'ADD'; payload: Item }
  | { type: 'REMOVE'; id: string };

interface User {
  // {Q001: Should we make email optional?}
  email: string;
}`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions).toHaveLength(2);
    });
  });
});

describe('Note Parser - Configurable Parser', () => {
  describe('Custom comment patterns', () => {
    it('should parse Python-style comments', () => {
      const content = `
# {D001: Use async/await pattern}
# {T001#python: Add type hints}
# Based on {R001}, we implement this
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^#/,
        },
      });

      expect(mentions).toHaveLength(3);
      expect(mentions[0]).toMatchObject({
        id: 'D001',
        contentExtension: 'Use async/await pattern',
      });
      expect(mentions[2]).toMatchObject({
        id: 'R001',
      });
      expect(mentions[2].contentExtension).toBeUndefined();
    });

    it('should parse SQL-style comments', () => {
      const content = `
-- {D001: Use indexes for performance}
-- {Q001: Should we partition this table?}
/* {T001: Add foreign key constraints} */
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^--/,
          blockStart: /\/\*/,
          blockEnd: /\*\//,
        },
      });

      expect(mentions).toHaveLength(3);
    });

    it('should parse Ruby-style block comments', () => {
      const content = `
=begin
{D001#ruby: Use symbols instead of strings}
{T001: Implement method_missing}
=end
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          blockStart: /^=begin/,
          blockEnd: /^=end/,
        },
      });

      expect(mentions).toHaveLength(2);
    });
  });

  describe('Mixed mode parsing', () => {
    it('should parse both raw mentions and comments when configured', () => {
      const content = `
# Documentation Section
{D001: Architecture decision in markdown}

## Code Example
\`\`\`python
# {T001: Refactor this function}
def process():
    pass
\`\`\`

{R001: Raw requirement in markdown}
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^#/,
        },
      });

      expect(mentions).toHaveLength(3);
      expect(mentions.map((m) => m.id)).toEqual(['D001', 'T001', 'R001']);
    });

    it('should handle markdown with embedded JavaScript', () => {
      const content = `
# Design Doc
{D001: Use event-driven architecture}

\`\`\`javascript
// {T001: Implement event emitter}
class EventBus {
  // Based on {D001}, we need this
}
\`\`\`

See {D001} for more details.
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      // Should find: D001 with extension, T001 with extension, D001 without extension (in comment), D001 without extension (raw)
      expect(mentions).toHaveLength(4);
      expect(mentions[0]).toMatchObject({ id: 'D001', contentExtension: 'Use event-driven architecture' });
      expect(mentions[1]).toMatchObject({ id: 'T001', contentExtension: 'Implement event emitter' });
      expect(mentions[2]).toMatchObject({ id: 'D001' });
      expect(mentions[2].contentExtension).toBeUndefined();
      expect(mentions[3]).toMatchObject({ id: 'D001' });
      expect(mentions[3].contentExtension).toBeUndefined();
    });
  });

  describe('Context preservation options', () => {
    it('should preserve context based on comment type', () => {
      const pythonContent = `
# {D001: Use list comprehensions}
result = [x*2 for x in range(10)]
`;

      const jsContent = `
// {D001: Use arrow functions}
const double = x => x * 2;
`;

      const pythonMentions = parseNoteMentions(pythonContent, {
        commentPatterns: { single: /^#/ },
        includeContext: true,
      });

      const jsMentions = parseNoteMentions(jsContent, {
        commentPatterns: { single: /^\/\// },
        includeContext: true,
      });

      expect(pythonMentions[0].context).toBe('result = [x*2 for x in range(10)]');
      expect(jsMentions[0].context).toBe('const double = x => x * 2;');
    });
  });

  describe('Default configurations', () => {
    it('should parse raw mentions by default', () => {
      const content = `
{D001: Raw note}
// {T001: This will be parsed as raw text, not comment}
`;

      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(2);
      expect(mentions[0].id).toBe('D001');
      expect(mentions[1].id).toBe('T001');
    });

    it('should parse both comments and raw mentions when comment patterns provided', () => {
      const content = `
{D001: This will be parsed}
// {T001: This will be parsed}
/* {Q001: This too} */
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
          blockStart: /\/\*/,
          blockEnd: /\*\//,
        },
      });

      expect(mentions).toHaveLength(3);
      expect(mentions.map((m) => m.id)).toEqual(['D001', 'T001', 'Q001']);
    });
  });

  describe('Edge cases', () => {
    it('should handle notes at comment boundaries', () => {
      const content = `
/* Start of comment {D001: Note at start}
Middle content
{T001: Note in middle} more content
End of comment {Q001: Note at end} */
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          blockStart: /\/\*/,
          blockEnd: /\*\//,
        },
      });

      expect(mentions).toHaveLength(3);
    });

    it('should handle nested comment styles', () => {
      const content = `
# Python comment with {D001: Note} and // JS-style comment
// JS comment with {T001: Note} and # Python char
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^(#|\/\/)/, // Both Python and JS
        },
      });

      expect(mentions).toHaveLength(2);
    });

    it('should handle empty comment patterns gracefully', () => {
      const content = `
{D001: Raw note}
// {T001: JS comment}
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {}, // Empty patterns
      });

      // Should parse raw notes when no valid comment patterns
      expect(mentions).toHaveLength(2);
    });
  });

  describe('Performance considerations', () => {
    it('should efficiently handle files with no notes', () => {
      const content = `
// This is just a regular comment
function regularCode() {
  // No notes here
  return 42;
}
`;

      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions).toHaveLength(0);
    });

    it('should handle very long lines efficiently', () => {
      const longLine = '// ' + 'a'.repeat(1000) + ' {D001: Note at end}';

      const mentions = parseNoteMentions(longLine, {
        commentPatterns: {
          single: /^\/\//,
        },
      });

      expect(mentions).toHaveLength(1);
    });
  });
});

describe('Note Parser - Claim-Level Addressability', () => {
  describe('backward compatibility', () => {
    it('should still parse {R004} without claim path', () => {
      const content = 'See {R004} for details.';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        line: 1,
      });
      expect(mentions[0].claimPath).toBeUndefined();
      expect(mentions[0].claimMetadata).toBeUndefined();
    });

    it('should still parse {R004+} with modifier', () => {
      const content = '{R004+}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        inclusionModifiers: { content: true },
      });
      expect(mentions[0].claimPath).toBeUndefined();
    });

    it('should still parse {R004#tag} with tag extension', () => {
      const content = '{R004#security}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        tagExtensions: ['security'],
      });
      expect(mentions[0].claimPath).toBeUndefined();
    });

    it('should still parse {R004: extension content}', () => {
      const content = '{R004: Use PostgreSQL for persistence}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        contentExtension: 'Use PostgreSQL for persistence',
      });
      expect(mentions[0].claimPath).toBeUndefined();
    });
  });

  describe('claim path parsing', () => {
    it('should capture claim path {R004.§3.AC.01}', () => {
      const content = 'Implements {R004.§3.AC.01} acceptance criteria.';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.§3.AC.01',
      });
    });

    it('should capture claim path {R004.3.AC.01} without §', () => {
      const content = 'See {R004.3.AC.01} for the acceptance criterion.';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.3.AC.01',
      });
    });

    it('should capture section-only reference {R004.§3}', () => {
      const content = 'Refer to {R004.§3} for section details.';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.§3',
      });
    });

    it('should capture section-only reference {R004.3} without §', () => {
      const content = 'Refer to {R004.3} for details.';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.3',
      });
    });

    it('should capture multi-level section path {R004.3.1.AC.01}', () => {
      const content = 'This satisfies {R004.3.1.AC.01}.';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.3.1.AC.01',
      });
    });

    it('should capture claim path with sub-letter {R004.§3.AC.01a}', () => {
      const content = 'Addresses {R004.§3.AC.01a} specifically.';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.§3.AC.01a',
      });
    });
  });

  describe('claim path with metadata', () => {
    it('should capture {R004.§3.AC.01:P0} with claim path and metadata', () => {
      const content = 'Critical: {R004.§3.AC.01:P0}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.§3.AC.01',
        claimMetadata: ['P0'],
      });
    });

    it('should capture multi-value metadata {R004.§3.AC.01:P0,security}', () => {
      const content = '{R004.§3.AC.01:P0,security}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.§3.AC.01',
        claimMetadata: ['P0', 'security'],
      });
    });
  });

  describe('claim path with modifiers', () => {
    it('should capture {R004.3.1.AC.01+} with claim path and modifier', () => {
      const content = '{R004.3.1.AC.01+}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.3.1.AC.01',
        inclusionModifiers: { content: true },
      });
    });

    it('should capture claim path with modifier and tag', () => {
      const content = '{R004.§3.AC.01+#auth}';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.§3.AC.01',
        inclusionModifiers: { content: true },
        tagExtensions: ['auth'],
      });
    });
  });

  describe('multiple claim references', () => {
    it('should parse multiple claim references in the same content', () => {
      const content = 'This implements {R004.§3.AC.01} and relates to {R005.§1.SEC.02}.';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(2);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.§3.AC.01',
      });
      expect(mentions[1]).toMatchObject({
        id: 'R005',
        claimPath: '.§1.SEC.02',
      });
    });

    it('should handle mix of claim refs and plain refs', () => {
      const content = 'See {D001} and {R004.§3.AC.01} for context.';
      const mentions = parseNoteMentions(content);

      expect(mentions).toHaveLength(2);
      expect(mentions[0]).toMatchObject({ id: 'D001' });
      expect(mentions[0].claimPath).toBeUndefined();
      expect(mentions[1]).toMatchObject({
        id: 'R004',
        claimPath: '.§3.AC.01',
      });
    });
  });

  describe('claim references in source code comments', () => {
    it('should parse claim references in single-line comments', () => {
      const content = '// @implements {R004.§1.AC.03}';
      const mentions = parseNoteMentions(content, {
        commentPatterns: { single: /^\// },
        includeContext: true,
      });

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.§1.AC.03',
      });
    });

    it('should parse claim references in block comments', () => {
      const content = `/**
 * @implements {R004.§3.AC.01}
 */`;
      const mentions = parseNoteMentions(content, {
        commentPatterns: {
          blockStart: /\/\*/,
          blockEnd: /\*\//,
          blockLine: /^\s*\*/,
        },
      });

      expect(mentions).toHaveLength(1);
      expect(mentions[0]).toMatchObject({
        id: 'R004',
        claimPath: '.§3.AC.01',
      });
    });
  });
});
