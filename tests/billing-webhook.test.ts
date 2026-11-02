// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, beforeEach } from 'vitest';
import { generateInternalSignature, verifyInternalSignature } from '../apps/gateway/src/crypto/internal-signature.js';

describe('Internal Billing Signature & Idempotency (Roadmap §11.3)', () => {
  const secret = 'test_internal_secret_for_billing_32_bytes_long';

  it('generates and verifies nonced internal signature', () => {
    const rawBody = JSON.stringify({ event_id: 'ev_123', status: 'PAID' });
    const timestamp = Date.now().toString();
    const nonce = 'nonce_' + Math.random().toString(36).substring(2);

    const sig = generateInternalSignature(rawBody, timestamp, nonce, secret);
    expect(sig).toBeDefined();

    const isValid = verifyInternalSignature(rawBody, timestamp, nonce, sig, secret);
    expect(isValid).toBe(true);
  });

  it('generates and verifies non-nonced internal signature (BSDWeb Dispatcher format)', () => {
    const rawBody = JSON.stringify({ external_id: 'LIVECHAT-TOPUP-202611-abcd1234ef56', amount: 50000 });
    // Timestamp in seconds as sent by BSDWeb Dispatcher
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const sig = generateInternalSignature(rawBody, timestamp, undefined, secret);
    expect(sig).toBeDefined();

    const isValid = verifyInternalSignature(rawBody, timestamp, undefined, sig, secret);
    expect(isValid).toBe(true);
  });

  it('rejects tampered body or invalid signature', () => {
    const rawBody = JSON.stringify({ id: 'inv_100', status: 'PAID' });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sig = generateInternalSignature(rawBody, timestamp, undefined, secret);

    const tamperedBody = JSON.stringify({ id: 'inv_100', status: 'UNPAID' });
    const isValid = verifyInternalSignature(tamperedBody, timestamp, undefined, sig, secret);
    expect(isValid).toBe(false);
  });

  it('rejects expired timestamp beyond 5-minute tolerance', () => {
    const rawBody = JSON.stringify({ id: 'inv_old' });
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString(); // > 5 minutes ago
    const sig = generateInternalSignature(rawBody, oldTimestamp, undefined, secret);

    const isValid = verifyInternalSignature(rawBody, oldTimestamp, undefined, sig, secret);
    expect(isValid).toBe(false);
  });
});

