---
created: 2025-07-20
categories: [real-time, architecture, performance]
---

# Q002 - Best approach for real-time updates?

Need real-time updates for notifications, collaboration, and live dashboards.

## Context
Required for:
- {C003} Notification delivery
- Collaborative features
- Live dashboard updates in {C004}

## Options
1. WebSockets with fallback to SSE
2. GraphQL subscriptions
3. Polling with smart intervals

## Considerations
- {R003} Rate limiting complications
- {D004} Microservices communication
- Scale requirements for {M002}