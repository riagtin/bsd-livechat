// SPDX-License-Identifier: MPL-2.0
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validates the X-Hub-Signature-256 header sent by Meta Webhook.
 * @param rawBody - The raw request body as string or buffer
 * @param signatureHeader - Value of X-Hub-Signature-256 header (format: "sha256=HASH")
 * @param appSecret - Meta App Secret
 * @returns boolean
 */
export function verifyMetaSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return false;
  }

  const expectedHash = parts[1];
  const hmac = createHmac('sha256', appSecret);
  hmac.update(rawBody);
  const calculatedHash = hmac.digest('hex');

  try {
    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    const calculatedBuffer = Buffer.from(calculatedHash, 'hex');

    if (expectedBuffer.length !== calculatedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, calculatedBuffer);
  } catch {
    return false;
  }
}
