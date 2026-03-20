/**
 * Authentication Service
 * @implements {C001}
 * 
 * This service handles all authentication operations including
 * JWT token generation and validation as per {D001}.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { UserRepository } from '../db/user-repository';

export class AuthService {
  constructor() {
    // Initialize according to {R001} requirements
    this.userRepo = new UserRepository();
    this.tokenSecret = process.env.JWT_SECRET;
  }

  /**
   * Authenticate user with credentials
   * @see {R001} for authentication requirements
   * @addresses {T008} user registration implementation
   */
  async authenticate(username, password) {
    const user = await this.userRepo.findByUsername(username);
    
    if (!user) {
      throw new Error('Invalid credentials');
    }

    // Verify password per security requirements {R001}
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    // Generate JWT token following {D001} decision
    return this.generateToken(user);
  }

  /**
   * Generate JWT token
   * Implements token structure from {D001}
   */
  generateToken(user) {
    const payload = {
      id: user.id,
      username: user.username,
      roles: user.roles
    };

    // 15 minute access token as specified in {D001}
    return jwt.sign(payload, this.tokenSecret, { 
      expiresIn: '15m',
      algorithm: 'RS256'
    });
  }

  /**
   * Validate JWT token
   * Part of {C001} authentication service implementation
   */
  validateToken(token) {
    try {
      return jwt.verify(token, this.tokenSecret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  /**
   * Handle MFA verification
   * Addresses {R001} multi-factor authentication requirement
   */
  async verifyMFA(userId, code) {
    // MFA implementation per requirements
    // ...
  }
}
