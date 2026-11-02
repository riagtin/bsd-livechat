// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import { config } from '../config/index.js';

export interface SessionTokenPayload {
  sid: string;
  cid: string;
  exp: number;
}

/**
 * Returns the configured session signing secret or a secure fallback.
 */
function getSigningSecret(): string {
  if (config.sessionSigningSecret && config.sessionSigningSecret.length > 0) {
    return config.sessionSigningSecret;
  }
  // In development, provide a fallback warning
  console.warn('[SessionToken] WARNING: SESSION_SIGNING_SECRET is not set in environment. Using development secret.');
  return 'bsd_livechat_default_dev_session_signing_secret_32bytes!';
}

/**
 * H2: Generate cryptographically secure session ID using CSPRNG.
 * Replaces legacy Math.random() with 16 bytes CSPRNG base64url.
 */
export function generateSessionId(): string {
  const randomBytes = crypto.randomBytes(16).toString('base64url');
  return `sess_${randomBytes}`;
}

/**
 * H2: Issue HMAC-SHA256 signed session token for a given session & channel.
 * Format: base64url(payload).base64url(hmac_signature)
 */
export function createSessionToken(sessionId: string, channelId: string): string {
  const secret = getSigningSecret();
  const payload: SessionTokenPayload = {
    sid: sessionId,
    cid: channelId,
    exp: Date.now() + config.sessionTtlMs, // Valid for session TTL (e.g. 24 hours)
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');

  return `${payloadBase64}.${signature}`;
}

/**
 * H2: Verify and decode HMAC-SHA256 session token with constant-time comparison.
 */
export function verifySessionToken(token: string | undefined): SessionTokenPayload | null {
  if (!token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadBase64, providedSig] = parts;
  const secret = getSigningSecret();
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');

  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  try {
    const jsonStr = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    const payload = JSON.parse(jsonStr) as SessionTokenPayload;

    if (!payload.sid || !payload.exp) {
      return null;
    }

    // Check expiration
    if (Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

