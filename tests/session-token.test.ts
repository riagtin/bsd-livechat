// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { generateSessionId, createSessionToken, verifySessionToken } from '../apps/gateway/src/session/token.js';

describe('CSPRNG Session ID & HMAC Session Token (H2)', () => {
  it('generates a valid CSPRNG session id with base64url format', () => {
    const id1 = generateSessionId();
    const id2 = generateSessionId();

    expect(id1).toMatch(/^sess_[A-Za-z0-9_-]{20,}$/);
    expect(id2).toMatch(/^sess_[A-Za-z0-9_-]{20,}$/);
    expect(id1).not.toBe(id2);
  });

  it('creates and verifies a valid HMAC-signed session token', () => {
    const sessionId = generateSessionId();
    const channelId = 'chn_support';

    const token = createSessionToken(sessionId, channelId);
    expect(token).toContain('.');

    const payload = verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sid).toBe(sessionId);
    expect(payload?.cid).toBe(channelId);
    expect(payload?.exp).toBeGreaterThan(Date.now());
  });

  it('rejects tampered session tokens', () => {
    const sessionId = generateSessionId();
    const channelId = 'chn_support';

    const token = createSessionToken(sessionId, channelId);
    const [payloadBase64, sig] = token.split('.');

    // Tamper payload
    const tamperedPayload = Buffer.from(JSON.stringify({ sid: 'sess_hacked', cid: channelId, exp: Date.now() + 10000 }))
      .toString('base64url');
    const tamperedToken = `${tamperedPayload}.${sig}`;

    expect(verifySessionToken(tamperedToken)).toBeNull();
  });

  it('rejects expired session tokens', () => {
    const expiredPayload = {
      sid: 'sess_expired',
      cid: 'chn_support',
      exp: Date.now() - 5000, // 5 seconds in the past
    };
    const secret = 'bsd_livechat_default_dev_session_signing_secret_32bytes!';
    const b64 = Buffer.from(JSON.stringify(expiredPayload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
    const expiredToken = `${b64}.${sig}`;

    expect(verifySessionToken(expiredToken)).toBeNull();
  });
});
