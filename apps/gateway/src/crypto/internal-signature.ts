// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import { config } from '../config/index.js';

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes

// In-memory set for nonce replay protection (purged periodically)
const seenNonces = new Map<string, number>();

function purgeOldNonces(): void {
  const cutoff = Date.now() - TIMESTAMP_TOLERANCE_MS;
  for (const [nonce, ts] of seenNonces.entries()) {
    if (ts < cutoff) {
      seenNonces.delete(nonce);
    }
  }
}

/**
 * Generates an HMAC-SHA256 signature for internal server-to-server calls.
 */
export function generateInternalSignature(
  rawBody: string,
  timestamp: string,
  nonce?: string,
  secret?: string
): string {
  const signingKey = secret || config.internalApiSecret;
  if (!signingKey) {
    throw new Error('[InternalSignature] INTERNAL_API_SECRET is not configured.');
  }

  const payload = nonce ? `${timestamp}.${nonce}.${rawBody}` : `${timestamp}.${rawBody}`;
  return crypto.createHmac('sha256', signingKey).update(payload, 'utf8').digest('hex');
}

/**
 * Verifies an incoming X-BSD-Signature header with timestamp tolerance and nonce check.
 */
export function verifyInternalSignature(
  rawBody: string,
  timestamp: string,
  nonce: string | undefined,
  signature: string,
  secret?: string
): boolean {
  const signingKey = secret || config.internalApiSecret;
  if (!signingKey || !timestamp || !signature) {
    return false;
  }

  // 1. Verify timestamp is within ±5 minutes (handle both seconds and ms timestamps)
  let tsNum = parseInt(timestamp, 10);
  if (isNaN(tsNum)) return false;
  if (tsNum < 10000000000) {
    tsNum = tsNum * 1000; // convert Unix epoch in seconds to milliseconds
  }

  const now = Date.now();
  if (Math.abs(now - tsNum) > TIMESTAMP_TOLERANCE_MS) {
    return false;
  }

  // 2. Prevent replay attacks using nonce cache if nonce is provided
  if (nonce) {
    purgeOldNonces();
    if (seenNonces.has(nonce)) {
      return false; // Replayed nonce
    }
  }

  // 3. Constant-time HMAC comparison
  const expectedSig = generateInternalSignature(rawBody, timestamp, nonce, signingKey);

  try {
    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');

    if (sigBuf.length !== expectedBuf.length) {
      return false;
    }

    const match = crypto.timingSafeEqual(sigBuf, expectedBuf);
    if (match && nonce) {
      seenNonces.set(nonce, now);
    }
    return match;
  } catch {
    return false;
  }
}

