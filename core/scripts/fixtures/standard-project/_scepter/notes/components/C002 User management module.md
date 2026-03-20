---
created: 2025-07-20
categories: [component, service, user-management]
---

# C002 - User management module

Service for user profile and data management per {R002}.

## Overview
Handles all user-related operations and data.

## Features
- Profile CRUD operations
- Preference management for {R005}
- Privacy settings
- {R004} Data export generation
- User search and listing

## Integration Points
- {C001} for authentication
- {C003} for notification preferences
- {C004} for user analytics

## Database Schema
Uses {D002} PostgreSQL with:
- users table
- profiles table  
- preferences table
- audit_log table