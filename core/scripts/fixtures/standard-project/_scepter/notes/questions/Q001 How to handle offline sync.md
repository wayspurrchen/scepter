---
created: 2025-07-20
categories: [mobile, sync, architecture]
---

# Q001 - How to handle offline sync?

Mobile app needs offline capabilities but we need to handle conflict resolution.

## Context
Key challenges:
- Conflict resolution
- Data consistency
- Sync queue management

## Options Considered
1. CRDTs for automatic conflict resolution
2. Last-write-wins with manual conflict resolution
3. Event sourcing with replay

## Related
- Impacts {Q003} mobile framework choice
- Affects {C002} user data management
- May require changes to {D002} database schema