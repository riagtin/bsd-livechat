// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { createSessionToken, verifySessionToken } from '../apps/gateway/src/session/token.js';
import { generateInternalSignature, verifyInternalSignature } from '../apps/gateway/src/crypto/internal-signature.js';
import { metaClient } from '../apps/gateway/src/meta/client.js';
import { observabilityService } from '../apps/gateway/src/monitoring/observability.js';

describe('Fase 5: Security Hardening & Penetration Testing Suite', () => {
  const secretKey = 'test-signing-secret-for-audit-purposes-only-32bytes';

  beforeEach(() => {
    process.env.SESSION_SIGNING_SECRET = secretKey;
    process.env.INTERNAL_API_SECRET = secretKey;
    process.env.ADMIN_API_TOKEN = 'test-admin-token-for-audit';
  });

  describe('1. Session Token Integrity & Anti-Hijacking', () => {
    it('rejects tampered session tokens', () => {
      const sessionId = 'ses_valid_1234567890abcdef';
      const token = createSessionToken(sessionId, 'default');

      // Tamper with payload (change session ID)
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      payload.sid = 'ses_tampered_attacker_session';
      const tamperedToken = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${parts[1]}`;

      const verified = verifySessionToken(tamperedToken);
      expect(verified).toBeNull();
    });

    it('rejects tokens signed with a different secret', () => {
      const sessionId = 'ses_victim_account_12345';
      const payload = {
        sid: sessionId,
        cid: 'default',
        exp: Date.now() + 86400000,
      };
      const header = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const fakeSignature = crypto
        .createHmac('sha256', 'wrong-attacker-secret-key-1234567890')
        .update(header)
        .digest('base64url');
      const fakeToken = `${header}.${fakeSignature}`;

      const verified = verifySessionToken(fakeToken);
      expect(verified).toBeNull();
    });

    it('rejects expired session tokens', () => {
      const sessionId = 'ses_expired_test_12345';
      const payload = {
        sid: sessionId,
        cid: 'default',
        exp: Date.now() - 1000, // Expired 1 second ago
      };
      const header = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(header)
        .digest('base64url');
      const expiredToken = `${header}.${signature}`;

      const verified = verifySessionToken(expiredToken);
      expect(verified).toBeNull();
    });
  });

  describe('2. Internal Server-to-Server Replay & Forgery Defense', () => {
    it('rejects requests with timestamp older than 5 minutes (Replay Attack)', () => {
      const payload = JSON.stringify({ tenant_id: 'tnt_abc', event: 'credit_grant' });
      const oldTimestamp = String(Date.now() - 360000); // 6 minutes ago
      const nonce = 'nonce_replay_attack_123';
      const signature = generateInternalSignature(payload, oldTimestamp, nonce, secretKey);

      const isValid = verifyInternalSignature(payload, oldTimestamp, nonce, signature, secretKey);
      expect(isValid).toBe(false);
    });

    it('rejects requests with payload altered in transit (Integrity Attack)', () => {
      const originalPayload = JSON.stringify({ tenant_id: 'tnt_abc', amount: 99000 });
      const timestamp = String(Date.now());
      const nonce = 'nonce_integrity_123';
      const signature = generateInternalSignature(originalPayload, timestamp, nonce, secretKey);

      const alteredPayload = JSON.stringify({ tenant_id: 'tnt_abc', amount: 999999999 });
      const isValid = verifyInternalSignature(alteredPayload, timestamp, nonce, signature, secretKey);
      expect(isValid).toBe(false);
    });

    it('rejects requests with mismatched nonce or invalid signature', () => {
      const payload = JSON.stringify({ status: 'ok' });
      const timestamp = String(Date.now());
      const nonce = 'nonce_valid_123';

      const isValid = verifyInternalSignature(payload, timestamp, nonce, 'sha256=invalidhexsignature', secretKey);
      expect(isValid).toBe(false);
    });
  });

  describe('3. Meta Graph API Variable Sanitization (Anti-Error 132000 / 131009)', () => {
    it('replaces all newlines and line breaks with pipeline separator', () => {
      const input = 'Halo min\nsaya mau tanya\r\napakah ada promo?';
      const sanitized = metaClient.sanitizeTemplateVariable(input);
      expect(sanitized).toBe('Halo min | saya mau tanya | apakah ada promo?');
      expect(sanitized.includes('\n')).toBe(false);
      expect(sanitized.includes('\r')).toBe(false);
    });

    it('collapses multiple consecutive spaces and tabs', () => {
      const input = 'Pertanyaan \t\t dengan     banyak    spasi.';
      const sanitized = metaClient.sanitizeTemplateVariable(input);
      expect(sanitized).toBe('Pertanyaan dengan banyak spasi.');
    });

    it('truncates inputs longer than 300 characters cleanly', () => {
      const longInput = 'A'.repeat(500);
      const sanitized = metaClient.sanitizeTemplateVariable(longInput, 300);
      expect(sanitized.length).toBe(300);
      expect(sanitized).toBe('A'.repeat(300));
    });

    it('returns a fallback dash for empty or whitespace-only inputs', () => {
      expect(metaClient.sanitizeTemplateVariable('')).toBe('-');
      expect(metaClient.sanitizeTemplateVariable('   ')).toBe('-');
    });
  });

  describe('4. Observability & Meta Error 131042 Critical Alert Defense', () => {
    it('automatically triggers a critical operational alert when Error 131042 is recorded', () => {
      const alertSpy = vi.spyOn(observabilityService, 'triggerAlert');

      observabilityService.recordMetaApiError(131042, 'Business eligibility payment issue');

      expect(alertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'critical',
          title: expect.stringContaining('131042'),
          code: 131042,
        })
      );

      const snapshot = observabilityService.getSnapshot();
      expect(snapshot.meta_errors['131042']).toBeGreaterThanOrEqual(1);
    });

    it('computes accurate percentile latency for relay performance', () => {
      // Feed controlled latencies from 100ms to 1000ms
      for (let i = 1; i <= 100; i++) {
        observabilityService.recordRelayLatency(i * 10);
      }

      const p50 = observabilityService.getLatencyPercentile(50);
      const p95 = observabilityService.getLatencyPercentile(95);

      expect(p50).toBeGreaterThanOrEqual(500);
      expect(p95).toBeGreaterThanOrEqual(950);
    });

    it('formats valid Prometheus plain text metrics with standard gauges and counters', () => {
      const promText = observabilityService.getPrometheusMetrics();

      expect(promText).toContain('livechat_uptime_seconds');
      expect(promText).toContain('livechat_sse_active_connections');
      expect(promText).toContain('livechat_messages_attempted_total');
      expect(promText).toContain('livechat_relay_latency_p95_ms');
    });
  });
});
