// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for AES-GCM
const TAG_LENGTH = 16; // Standard 128-bit authentication tag

function getDerivedKey(customKey?: string): Buffer {
  const secret = customKey || config.dataEncryptionKey;
  if (!secret) {
    throw new Error('[Encryption] DATA_ENCRYPTION_KEY is not configured.');
  }
  // Use SHA-256 hash of secret to ensure exactly 32 bytes (256 bits)
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a plaintext string (such as tenant BYO-WABA access token) using AES-256-GCM.
 * Output format: Base64-encoded string concatenation of (IV [12 bytes] + Tag [16 bytes] + Ciphertext)
 */
export function encryptToken(plainText: string, key?: string): string {
  if (!plainText) return '';
  const derivedKey = getDerivedKey(key);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Combined: IV (12) + Tag (16) + Ciphertext
  const combined = Buffer.concat([iv, tag, encrypted]);
  return combined.toString('base64');
}

/**
 * Decrypts an AES-256-GCM encrypted Base64 string back to plaintext.
 */
export function decryptToken(encryptedBase64: string, key?: string): string {
  if (!encryptedBase64) return '';
  const derivedKey = getDerivedKey(key);
  const buffer = Buffer.from(encryptedBase64, 'base64');

  if (buffer.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('[Encryption] Invalid encrypted token buffer length.');
  }

  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buffer.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

