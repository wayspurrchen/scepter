---
created: 2025-07-20
categories: [architecture, security, authentication]
---

# D001 - Use JWT for authentication

We need a stateless authentication mechanism that works well with {D004} microservices architecture.

## Status
Accepted

## Context
Evaluating authentication approaches for distributed services.

## Decision
Use JSON Web Tokens (JWT) for authentication:
- Stateless authentication
- Contains user claims
- Signed with RS256
- Short-lived access tokens (15 min)
- Long-lived refresh tokens (7 days)

## Consequences
- Implements {R001}
- Requires token refresh logic in {C001}
- Must handle token revocation carefully