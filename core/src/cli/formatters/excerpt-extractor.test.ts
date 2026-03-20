import { describe, it, expect } from 'vitest';
import { extractExcerpt } from './excerpt-extractor';

describe('Excerpt Extractor', () => {
  it('should extract first line after title for requirement', () => {
    const content = `# R001 - Core authentication system

The system must provide secure user authentication with the following features:

- Username/password authentication
- Multi-factor authentication (MFA) support
- Session management with configurable timeouts

This requirement is implemented by {C001} based on the architecture decision {D001}.`;

    const result = extractExcerpt(content);
    expect(result).toBe('The system must provide secure user authentication with the following features:');
  });

  it('should extract first line after title for decision', () => {
    const content = `# D001 - Use JWT for authentication

We need a stateless authentication mechanism that works well with {D004} microservices architecture.

## Status
Accepted

## Context
Evaluating authentication approaches for distributed services.`;

    const result = extractExcerpt(content);
    expect(result).toBe(
      'We need a stateless authentication mechanism that works well with {D004} microservices architecture.',
    );
  });

  it('should extract first line after title for task', () => {
    const content = `# T001 - Document auth flows

Document all authentication flows for the system.

## Description
Create comprehensive documentation for all auth-related user journeys.

## Acceptance Criteria
- [ ] Login flow documented`;

    const result = extractExcerpt(content);
    expect(result).toBe('Document all authentication flows for the system.');
  });

  it('should handle content with multiple empty lines after title', () => {
    const content = `# Q001 - How to handle offline sync?



Mobile app needs offline capabilities but we need to handle conflict resolution.

## Context
Key challenges:`;

    const result = extractExcerpt(content);
    expect(result).toBe('Mobile app needs offline capabilities but we need to handle conflict resolution.');
  });

  it('should return empty string for content with only title', () => {
    const content = `# T999 - Some task`;

    const result = extractExcerpt(content);
    expect(result).toBe('');
  });

  it('should return empty string for empty content', () => {
    const result = extractExcerpt('');
    expect(result).toBe('');
  });

  it('should handle content without title', () => {
    const content = `This is just plain content without a title.

More content here.`;

    const result = extractExcerpt(content);
    expect(result).toBe('This is just plain content without a title.');
  });

  it('should skip list items under headers', () => {
    const content = `# C001 - Authentication service

## Overview
- Microservice for auth
- Handles JWT tokens
- Session management

Microservice handling all authentication per {D004} architecture.`;

    const result = extractExcerpt(content);
    expect(result).toBe('Microservice handling all authentication per {D004} architecture.');
  });
});
