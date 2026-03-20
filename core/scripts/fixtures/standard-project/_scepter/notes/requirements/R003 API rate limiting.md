---
created: 2025-07-20
categories: [api, security, performance]
---

# R003 - API rate limiting

Implement rate limiting to prevent abuse:

- Per-user rate limits based on subscription tier
- IP-based rate limiting for anonymous requests
- Configurable limits per endpoint
- Rate limit headers in responses

Related to {R001} for authenticated rate limits and supports {D004} microservices architecture.

See {Q002} for real-time API considerations.