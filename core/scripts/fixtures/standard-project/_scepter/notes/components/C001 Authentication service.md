---
created: 2025-07-20
categories: [component, service, authentication]
---

# C001 - Authentication service

Microservice handling all authentication per {D004} architecture.

## Overview
Core authentication service for the system.

## Responsibilities
- Implement {R001} requirements
- {D001} JWT token generation/validation
- Session management
- Password reset flows
- MFA implementation

## API Endpoints
- POST /auth/login
- POST /auth/logout  
- POST /auth/refresh
- POST /auth/password-reset
- POST /auth/mfa/verify

## Dependencies
- {D002} PostgreSQL for user store
- Redis for session cache

Used by {T002} user registration.