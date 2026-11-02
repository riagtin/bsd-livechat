// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  generateInternalSignature,
  verifyInternalSignature,
} from '../apps/gateway/src/crypto/internal-signature.js';

describe('Server-to-Server Internal HMAC Signature (Fase 2 §7.4)', () => {
  const secret = 'bsdweb_gateway_internal_secret_key_123';
  const sampleBody = JSON.stringify({
    event_id: 'evt_1001',
    tenant_id: 'tnt_abc',
    kind: 'subscription_paid',
  });

  it('generates and verifies valid internal signature within tolerance', () => {
    const timestamp = String(Date.now());
    const nonce = 'nonce_unique_123';
    const sig = generateInternalSignature(sampleBody, timestamp, nonce, secret);

    const isValid = verifyInternalSignature(sampleBody, timestamp, nonce, sig, secret);
    expect(isValid).toBe(true);
  });

  it('rejects tampered body or incorrect secret', () => {
    const timestamp = String(Date.now());
    const nonce = 'nonce_unique_456';
    const sig = generateInternalSignature(sampleBody, timestamp, nonce, secret);

    // Tampered body
    const tamperedBody = JSON.stringify({ event_id: 'evt_HACKED' });
    expect(verifyInternalSignature(tamperedBody, timestamp, nonce, sig, secret)).toBe(false);

    // Wrong secret
    expect(verifyInternalSignature(sampleBody, timestamp, nonce, sig, 'wrong_secret')).toBe(false);
  });

  it('rejects expired timestamps (> 5 minutes tolerance)', () => {
    const oldTimestamp = String(Date.now() - 6 * 60 * 1000); // 6 minutes ago
    const nonce = 'nonce_old_789';
    const sig = generateInternalSignature(sampleBody, oldTimestamp, nonce, secret);

    const isValid = verifyInternalSignature(sampleBody, oldTimestamp, nonce, sig, secret);
    expect(isValid).toBe(false);
  });

  it('rejects replayed nonce within tolerance window', () => {
    const timestamp = String(Date.now());
    const nonce = 'nonce_replay_guard';
    const sig = generateInternalSignature(sampleBody, timestamp, nonce, secret);

    // First attempt succeeds
    expect(verifyInternalSignature(sampleBody, timestamp, nonce, sig, secret)).toBe(true);

    // Second attempt with exact same nonce fails (replay protection)
    expect(verifyInternalSignature(sampleBody, timestamp, nonce, sig, secret)).toBe(false);
  });
});

