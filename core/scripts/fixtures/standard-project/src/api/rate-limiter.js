/**
 * API Rate Limiting Middleware
 * @implements {R003}
 * 
 * Provides configurable rate limiting for API endpoints
 * to prevent abuse and ensure fair usage.
 */

import Redis from 'redis';

export class RateLimiter {
  constructor() {
    // Configure based on {R003} requirements
    this.redis = Redis.createClient();
    this.limits = {
      anonymous: { requests: 100, window: 3600 },
      authenticated: { requests: 1000, window: 3600 },
      premium: { requests: 10000, window: 3600 }
    };
  }

  /**
   * Rate limiting middleware
   * @depends-on {C001} for user authentication status
   * @see {D004} microservices architecture
   */
  middleware() {
    return async (req, res, next) => {
      const key = this.getKey(req);
      const limit = this.getLimit(req.user);
      
      try {
        const count = await this.incrementCounter(key);
        
        // Add rate limit headers per {R003}
        res.setHeader('X-RateLimit-Limit', limit.requests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, limit.requests - count));
        res.setHeader('X-RateLimit-Reset', this.getResetTime(limit.window));
        
        if (count > limit.requests) {
          return res.status(429).json({
            error: 'Rate limit exceeded',
            retryAfter: limit.window
          });
        }
        
        next();
      } catch (error) {
        // Log error but don't block request
        console.error('Rate limiting error:', error);
        next();
      }
    };
  }

  /**
   * Get rate limit key for request
   * Implements per-user and IP-based limiting from {R003}
   */
  getKey(req) {
    if (req.user) {
      return `rate:${req.user.id}`;
    }
    return `rate:${req.ip}`;
  }

  // Additional implementation details...
}
