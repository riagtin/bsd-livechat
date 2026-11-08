// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import pg from 'pg';
import { config } from '../config/index.js';

export interface ChannelAgent {
  agentId: string;
  channelId: string;
  tenantId: string;
  name: string;
  waPhone: string;
  isActive: boolean;
  verificationCode?: string;
  verificationExpiresAt?: number;
  verifiedAt?: number;
  consentAt?: number;
  optedOutAt?: number;
  lastAssignedAt: number;
  createdAt: number;
}

export interface ChannelSchedule {
  [day: string]: Array<[string, string]>; // e.g. "mon": [["08:00", "17:00"]]
}

export interface RoutingChannelInfo {
  channelId: string;
  tenantId: string;
  name: string;
  businessName: string;
  csPhone?: string;
  wabaConnectionId?: string;
  routingMode?: string;
  reassignAfterSec?: number;
  reminderAfterSec?: number;
  maxPreReplyOutbound?: number;
  businessHoursEnabled?: boolean;
  timezone?: string;
  schedule?: ChannelSchedule;
  awayMessage?: string;
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
}

export class AgentRouter {
  constructor(private pool?: pg.Pool) {}

  setPool(pool: pg.Pool): void {
    this.pool = pool;
  }

  /**
   * Checks if channel is currently within business hours (Roadmap §8.2)
   */
  isWithinBusinessHours(channel: RoutingChannelInfo, atDate = new Date()): boolean {
    if (!channel.businessHoursEnabled || !channel.schedule) {
      return true; // Business hours disabled -> always open
    }

    try {
      // Format day of week in target timezone (mon, tue, wed, thu, fri, sat, sun)
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        timeZone: channel.timezone || 'Asia/Jakarta',
      });
      const dayKey = dayFormatter.format(atDate).toLowerCase(); // 'mon', 'tue', etc.

      const dayRanges = channel.schedule[dayKey];
      if (!dayRanges || dayRanges.length === 0) {
        return false; // No operating hours configured for this day
      }

      // Format current time as HH:MM
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: channel.timezone || 'Asia/Jakarta',
      });
      const currentTime = timeFormatter.format(atDate);

      // Check if current time falls into any configured range [start, end]
      for (const [start, end] of dayRanges) {
        if (currentTime >= start && currentTime <= end) {
          return true;
        }
      }

      return false;
    } catch (err: unknown) {
      console.warn('[AgentRouter] Error parsing business hours schedule, defaulting to open:', err);
      return true;
    }
  }

  /**
   * Selects an eligible agent using Round Robin (Roadmap §9.3c)
   * Prioritizes agents with open 24h WhatsApp windows for BYO-WABA.
   */
  async selectAgentForSession(
    channelId: string,
    connectionId?: string,
    excludeAgentIds: string[] = []
  ): Promise<ChannelAgent | undefined> {
    if (!this.pool) return undefined;

    const now = Date.now();
    const connId = connectionId || 'conn_platform_default';

    const client = await this.pool.connect();
    try {
      // Query 9.3c from roadmap
      const query = `
        SELECT a.*
        FROM channel_agents a
        LEFT JOIN wa_windows w ON w.connection_id = $2 AND w.wa_phone = a.wa_phone
        WHERE a.channel_id = $1
          AND a.is_active = true
          AND a.verified_at IS NOT NULL
          AND a.opted_out_at IS NULL
          AND NOT (a.agent_id = ANY($4::varchar[]))
        ORDER BY (COALESCE(w.window_expires_at, 0) > $3) DESC, a.last_assigned_at ASC
        LIMIT 1
        FOR UPDATE OF a SKIP LOCKED
      `;

      const res = await client.query(query, [channelId, connId, now, excludeAgentIds]);

      if (res.rows.length === 0) {
        return undefined;
      }

      const row = res.rows[0];
      const selectedAgent = this.mapAgentRow(row);

      // Update last_assigned_at timestamp
      await client.query(
        'UPDATE channel_agents SET last_assigned_at = $1 WHERE agent_id = $2',
        [now, selectedAgent.agentId]
      );

      return selectedAgent;
    } finally {
      client.release();
    }
  }

  /**
   * Handshake: verifies an agent using verification code sent via WhatsApp (Roadmap §7.5)
   */
  async verifyAgentByCode(senderPhone: string, code: string): Promise<ChannelAgent | undefined> {
    if (!this.pool) return undefined;

    const normPhone = senderPhone.replace(/\D/g, '');
    const normCode = code.trim().toUpperCase();
    const now = Date.now();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const localPhone = normPhone.startsWith('62') ? '0' + normPhone.slice(2) : normPhone;
      const cleanCode = normCode.replace(/[^A-Z0-9]/g, '');

      const res = await client.query(
        `
        SELECT * FROM channel_agents
        WHERE (wa_phone = $1 OR wa_phone = $4)
          AND (verification_code = $2 OR verification_code = $5)
          AND (verification_expires_at IS NULL OR verification_expires_at > $3)
        FOR UPDATE
      `,
        [normPhone, normCode, now, localPhone, cleanCode]
      );

      if (res.rows.length === 0) {
        await client.query('ROLLBACK');
        return undefined;
      }

      const agent = this.mapAgentRow(res.rows[0]);

      // Complete handshake
      await client.query(
        `
        UPDATE channel_agents
        SET verified_at = $1,
            consent_at = $1,
            verification_code = NULL,
            is_active = true
        WHERE agent_id = $2
      `,
        [now, agent.agentId]
      );

      // Check if tenant has pending trial claim and enforce anti-abuse rules (Roadmap D12 & §11.6)
      const trialSecret = config.trialFingerprintSecret || process.env.TRIAL_FINGERPRINT_SECRET || 'bsd_trial_fingerprint_default_hmac_secret_32b';
      const phoneFp = crypto.createHmac('sha256', trialSecret).update(normPhone).digest('hex');

      // 1. Check if phone was already used for trial by another tenant (anti-abuse)
      const existingPhoneRes = await client.query(
        `
        SELECT claim_id FROM trial_claims
        WHERE wa_phone_fp = $1
          AND status IN ('granted', 'converted', 'expired')
        LIMIT 1
        `,
        [phoneFp]
      );
      const isDuplicatePhone = existingPhoneRes.rows.length > 0;

      const pendingClaimRes = await client.query(
        `
        SELECT claim_id FROM trial_claims
        WHERE tenant_id = $1 AND status = 'pending'
        LIMIT 1
        `,
        [agent.tenantId]
      );

      if (pendingClaimRes.rows.length > 0) {
        const claimId = pendingClaimRes.rows[0].claim_id;
        if (isDuplicatePhone) {
          // Reject trial claim due to duplicate phone number (D12 anti-abuse)
          await client.query(
            `
            UPDATE trial_claims
            SET status = 'rejected'
            WHERE claim_id = $1
            `,
            [claimId]
          );
        } else {
          // Grant trial claim & activate 20 credits
          await client.query(
            `
            UPDATE trial_claims
            SET status = 'granted',
                wa_phone_fp = $1,
                granted_at = $2
            WHERE claim_id = $3
            `,
            [phoneFp, now, claimId]
          );

          const trialEndsAt = now + (7 * 86400000);
          await client.query(
            `
            UPDATE tenants
            SET subscription_status = 'trialing',
                trial_started_at = $1,
                trial_ends_at = $2
            WHERE tenant_id = $3
              AND subscription_status = 'pending_payment'
              AND plan_tier = 'starter'
            `,
            [now, trialEndsAt, agent.tenantId]
          );
        }
      }

      // Automatically deposit 20 trial credits if tenant balance is empty
      if (!isDuplicatePhone) {
        await client.query(
          `
          INSERT INTO tenant_credit_balances (tenant_id, bundle_balance, topup_balance, updated_at)
          VALUES ($1, 20, 0, $2)
          ON CONFLICT (tenant_id) DO UPDATE SET
            bundle_balance = GREATEST(tenant_credit_balances.bundle_balance, 20),
            updated_at = $2
          `,
          [agent.tenantId, now]
        );
      }

      await client.query('COMMIT');
      return { ...agent, verifiedAt: now, consentAt: now, isActive: true };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      console.error('[AgentRouter] Error during agent verification handshake:', err);
      return undefined;
    } finally {
      client.release();
    }
  }

  /**
   * Find verified agent by phone number and channel
   */
  async findAgentByPhone(waPhone: string, channelId?: string): Promise<ChannelAgent | undefined> {
    if (!this.pool) return undefined;
    const normPhone = waPhone.replace(/\D/g, '');

    let query = 'SELECT * FROM channel_agents WHERE wa_phone = $1 AND verified_at IS NOT NULL';
    const params: unknown[] = [normPhone];

    if (channelId) {
      query += ' AND channel_id = $2';
      params.push(channelId);
    }

    const res = await this.pool.query(query, params);
    if (res.rows.length === 0) return undefined;
    return this.mapAgentRow(res.rows[0]);
  }

  /**
   * Upsert WhatsApp 24-hour service window (Lapis 3 - Roadmap §9.3b)
   */
  async recordInboundWindow(connectionId: string, waPhone: string): Promise<void> {
    if (!this.pool) return;
    const normPhone = waPhone.replace(/\D/g, '');
    const now = Date.now();
    const expiresAt = now + 86400000; // 24 hours

    await this.pool.query(
      `
      INSERT INTO wa_windows (connection_id, wa_phone, last_inbound_at, window_expires_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (connection_id, wa_phone) DO UPDATE
      SET last_inbound_at = EXCLUDED.last_inbound_at,
          window_expires_at = EXCLUDED.window_expires_at
    `,
      [connectionId, normPhone, now, expiresAt]
    );
  }

  /**
   * Check if 24-hour WhatsApp service window is currently active for CS phone
   */
  async isWindowActive(connectionId: string, waPhone: string): Promise<boolean> {
    if (!this.pool) return false;
    const normPhone = waPhone.replace(/\D/g, '');
    const now = Date.now();
    try {
      const res = await this.pool.query(
        `SELECT 1 FROM wa_windows WHERE connection_id = $1 AND wa_phone = $2 AND window_expires_at > $3 LIMIT 1`,
        [connectionId, normPhone, now]
      );
      return res.rows.length > 0;
    } catch (err) {
      console.warn('[AgentRouter] Error querying wa_windows active state:', err);
      return false;
    }
  }

  private mapAgentRow(r: Record<string, unknown>): ChannelAgent {
    return {
      agentId: String(r.agent_id),
      channelId: String(r.channel_id),
      tenantId: String(r.tenant_id),
      name: String(r.name),
      waPhone: String(r.wa_phone),
      isActive: Boolean(r.is_active),
      verificationCode: r.verification_code ? String(r.verification_code) : undefined,
      verificationExpiresAt: r.verification_expires_at ? Number(r.verification_expires_at) : undefined,
      verifiedAt: r.verified_at ? Number(r.verified_at) : undefined,
      consentAt: r.consent_at ? Number(r.consent_at) : undefined,
      optedOutAt: r.opted_out_at ? Number(r.opted_out_at) : undefined,
      lastAssignedAt: Number(r.last_assigned_at || 0),
      createdAt: Number(r.created_at),
    };
  }
}

export const agentRouter = new AgentRouter();
