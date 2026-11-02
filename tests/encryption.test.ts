// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken } from '../apps/gateway/src/crypto/encryption.js';

describe('AES-256-GCM Token Encryption (Fase 2 §7.6)', () => {
  const testKey = 'test_secret_32_bytes_super_secure_key_123';

  it('encrypts and decrypts tenant WABA access token accurately', () => {
    const plainToken = 'EAABwb79XyZBZBZ...livechat_production_permanent_token';
    const encrypted = encryptToken(plainToken, testKey);

    expect(encrypted).toBeDefined();
    expect(encrypted).not.toBe(plainToken);
    // Base64 check
    expect(Buffer.from(encrypted, 'base64').toString('base64')).toBe(encrypted);

    const decrypted = decryptToken(encrypted, testKey);
    expect(decrypted).toBe(plainToken);
  });

  it('generates unique ciphertexts for identical plaintext (different IVs)', () => {
    const plainToken = 'SAME_TOKEN_VALUE';
    const enc1 = encryptToken(plainToken, testKey);
    const enc2 = encryptToken(plainToken, testKey);

    expect(enc1).not.toBe(enc2);
    expect(decryptToken(enc1, testKey)).toBe(plainToken);
    expect(decryptToken(enc2, testKey)).toBe(plainToken);
  });

  it('throws error when decrypting tampered ciphertext', () => {
    const plainToken = 'SECRET_TOKEN';
    const encrypted = encryptToken(plainToken, testKey);
    const buf = Buffer.from(encrypted, 'base64');

    // Tamper with the last byte of ciphertext
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');

    expect(() => decryptToken(tampered, testKey)).toThrow();
  });
});

