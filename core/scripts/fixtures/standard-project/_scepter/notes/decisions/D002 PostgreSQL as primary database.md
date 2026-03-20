---
created: 2025-07-20
categories: [architecture, database, infrastructure]
---

# D002 - PostgreSQL as primary database

Need a reliable, scalable database that supports complex queries and modern features.

## Status
Accepted

## Context
Evaluating databases that support:
- Complex queries for {C004} analytics
- JSON data types for flexibility
- Full-text search capabilities

## Decision
Use PostgreSQL 14+ as the primary database.

## Consequences
- Affects {R004} data export implementation
- Requires proper indexing for {C002} user queries
- Enables advanced features for {M001}