// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { verifyMetaSignature } from '../packages/sdk/src/signature.js';

describe('Meta Webhook Signature Verification (Lapis 0 HMAC)', () => {
  const secret = 'test_meta_app_secret_12345';
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

  it('validates a correct HMAC-SHA256 signature', () => {
    const validHash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const header = `sha256=${validHash}`;

    expect(verifyMetaSignature(payload, header, secret)).toBe(true);
  });

  it('rejects an altered payload with original signature', () => {
    const validHash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const header = `sha256=${validHash}`;
    const alteredPayload = JSON.stringify({ object: 'hacked_account' });

    expect(verifyMetaSignature(alteredPayload, header, secret)).toBe(false);
  });

  it('rejects missing or malformed signature header', () => {
    expect(verifyMetaSignature(payload, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(payload, 'invalid_header', secret)).toBe(false);
    expect(verifyMetaSignature(payload, 'md5=somehash', secret)).toBe(false);
  });

  it('rejects incorrect app secret', () => {
    const validHash = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const header = `sha256=${validHash}`;

    expect(verifyMetaSignature(payload, header, 'wrong_secret')).toBe(false);
  });
});
