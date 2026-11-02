// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AgentRouter } from '../apps/gateway/src/routing/router.js';
import {
  checkTrialEligibility,
  hashFingerprint,
  normalizeDomain,
  normalizeEmail,
} from '../apps/console/src/lib/trial.js';

describe('Trial Starter Anti-Abuse Suite (Roadmap D12, Q10 & Fase 3 Exit Criteria)', () => {
  const secret = 'bsd_trial_fingerprint_default_hmac_secret_32b';

  beforeEach(() => {
    process.env.TRIAL_FINGERPRINT_SECRET = secret;
  });

  describe('1. Normalization & Fingerprint Hashing', () => {
    it('normalizes email by removing Gmail dots and plus aliases', () => {
      const email1 = 'budi.santoso+promo@gmail.com';
      const email2 = 'budisantoso@gmail.com';
      const email3 = 'b.u.d.i.santoso+test1234@googlemail.com';

      expect(normalizeEmail(email1)).toBe('budisantoso@gmail.com');
      expect(normalizeEmail(email2)).toBe('budisantoso@gmail.com');
      expect(normalizeEmail(email3)).toBe('budisantoso@googlemail.com');

      const hash1 = hashFingerprint(normalizeEmail(email1));
      const hash2 = hashFingerprint(normalizeEmail(email2));
      expect(hash1).toBe(hash2);
    });

    it('normalizes email for non-Gmail providers preserving dots but removing plus tags', () => {
      const emailA = 'marketing+promo@tokobaju.co.id';
      const emailB = 'marketing@tokobaju.co.id';
      expect(normalizeEmail(emailA)).toBe('marketing@tokobaju.co.id');
      expect(hashFingerprint(normalizeEmail(emailA))).toBe(hashFingerprint(normalizeEmail(emailB)));
    });

    it('normalizes domains by stripping protocols, ports, and sub-paths', () => {
      const d1 = 'https://store.bintangstudio.tech/catalog?ref=ads';
      const d2 = 'http://store.bintangstudio.tech:8080/products';
      const d3 = 'store.bintangstudio.tech';

      expect(normalizeDomain(d1)).toBe('store.bintangstudio.tech');
      expect(normalizeDomain(d2)).toBe('store.bintangstudio.tech');
      expect(normalizeDomain(d3)).toBe('store.bintangstudio.tech');

      expect(hashFingerprint(normalizeDomain(d1))).toBe(hashFingerprint(normalizeDomain(d2)));
    });
  });

  describe('2. Handshake WhatsApp Phone Collision Prevention (Gateway Router)', () => {
    it('rejects second trial grant if WhatsApp phone number is already registered in trial_claims', async () => {
      const phone = '081234567890';
      const normPhone = '6281234567890';
      const phoneFp = crypto.createHmac('sha256', secret).update(normPhone).digest('hex');

      // Mock database pool
      const executedQueries: Array<{ sql: string; params?: any[] }> = [];
      const mockClient = {
        query: async (sql: string, params?: any[]) => {
          executedQueries.push({ sql, params });

          // 1. SELECT channel_agents
          if (sql.includes('SELECT * FROM channel_agents')) {
            return {
              rows: [
                {
                  agent_id: 'ag_second_try',
                  channel_id: 'chn_second',
                  tenant_id: 'tnt_second',
                  name: 'Staff CS',
                  wa_phone: normPhone,
                  is_active: false,
                  verification_code: 'CODE12',
                  last_assigned_at: '0',
                  created_at: '1000',
                },
              ],
            };
          }

          // 2. Check if phone was already used in trial_claims
          if (sql.includes('SELECT claim_id FROM trial_claims') && sql.includes('wa_phone_fp = $1')) {
            // Simulate existing phone claim by previous merchant
            return {
              rows: [{ claim_id: 'claim_previous_merchant' }],
            };
          }

          // 3. Pending trial claim of current tenant
          if (sql.includes('SELECT claim_id FROM trial_claims') && sql.includes('tenant_id = $1')) {
            return {
              rows: [{ claim_id: 'claim_second_try' }],
            };
          }

          return { rows: [] };
        },
        release: () => {},
      };

      const mockPool = {
        connect: async () => mockClient,
      } as any;

      const router = new AgentRouter(mockPool);
      const agent = await router.verifyAgentByCode(phone, 'CODE12');

      // Agent is activated
      expect(agent).toBeDefined();
      expect(agent?.agentId).toBe('ag_second_try');
      expect(agent?.isActive).toBe(true);

      // Verify trial claim was marked 'rejected' and 20 trial credits were NOT issued
      const rejectedClaimUpdate = executedQueries.find(
        (q) => q.sql.includes('UPDATE trial_claims') && q.sql.includes("status = 'rejected'")
      );
      expect(rejectedClaimUpdate).toBeDefined();

      const creditGrantQuery = executedQueries.find((q) =>
        q.sql.includes('INSERT INTO tenant_credit_balances')
      );
      expect(creditGrantQuery).toBeUndefined(); // Zero credit granted!
    });

    it('grants 20 trial credits when WhatsApp phone number is fresh and claim is pending', async () => {
      const phone = '089999999999';
      const normPhone = '628999999999';

      const executedQueries: Array<{ sql: string; params?: any[] }> = [];
      const mockClient = {
        query: async (sql: string, params?: any[]) => {
          executedQueries.push({ sql, params });

          if (sql.includes('SELECT * FROM channel_agents')) {
            return {
              rows: [
                {
                  agent_id: 'ag_fresh',
                  channel_id: 'chn_fresh',
                  tenant_id: 'tnt_fresh',
                  name: 'Owner CS',
                  wa_phone: normPhone,
                  is_active: false,
                  verification_code: 'FRESH1',
                  last_assigned_at: '0',
                  created_at: '1000',
                },
              ],
            };
          }

          // Phone check -> fresh (not in trial_claims)
          if (sql.includes('SELECT claim_id FROM trial_claims') && sql.includes('wa_phone_fp = $1')) {
            return { rows: [] };
          }

          // Pending trial claim exists
          if (sql.includes('SELECT claim_id FROM trial_claims') && sql.includes('tenant_id = $1')) {
            return { rows: [{ claim_id: 'claim_fresh_1' }] };
          }

          return { rows: [] };
        },
        release: () => {},
      };

      const mockPool = {
        connect: async () => mockClient,
      } as any;

      const router = new AgentRouter(mockPool);
      const agent = await router.verifyAgentByCode(phone, 'FRESH1');

      expect(agent).toBeDefined();

      // Trial claim is granted with phone_fp
      const grantedClaimUpdate = executedQueries.find(
        (q) => q.sql.includes('UPDATE trial_claims') && q.sql.includes("status = 'granted'")
      );
      expect(grantedClaimUpdate).toBeDefined();

      // Tenant credit balance receives 20 bundle credits
      const creditGrantQuery = executedQueries.find((q) =>
        q.sql.includes('INSERT INTO tenant_credit_balances')
      );
      expect(creditGrantQuery).toBeDefined();
    });
  });
});
