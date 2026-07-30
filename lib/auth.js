import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Hashes a plain text password with bcrypt
 */
export function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

/**
 * Compares a plain text password with a hashed password
 */
export function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Generates a signed JWT for given user payload
 */
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verifies a JWT and returns the decoded payload or null
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Generates an 8-character uppercase alphanumeric referral code
 */
export function generateReferralCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

/**
 * Generates a v4 UUID
 */
export function generateUUID() {
  return uuidv4();
}

export default {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  generateReferralCode,
  generateUUID
};