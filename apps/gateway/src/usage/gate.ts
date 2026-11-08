// SPDX-License-Identifier: AGPL-3.0-only
import pg from 'pg';
import crypto from 'node:crypto';

export type OutboundKind =
  | 'notify'
  | 'reassign'
  | 'reminder'
  | 'digest'
  | 'relay'
  | 'alert'
  | 'keepalive'
  | 'verification';

export type OutboundCategory = 'service' | 'template';

export interface OutboundRecord {
  outboundId: string;
  tenantId: string;
  connectionId: string;
  sessionId?: string;
  waPhone: string;
  kind: OutboundKind;
  category: OutboundCategory;
  wamid?: string;
  status: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
  creditCharged: boolean;
  errorCode?: number;
  createdAt: number;
}

export interface CreditDeductionResult {
  allowed: boolean;
  charged: boolean;
  remainingBundle?: number;
  remainingTopup?: number;
}

export interface IUsageGate {
  canSend(tenantId: string, kind: OutboundKind, isByo: boolean): Promise<boolean>;
  deductCredit(
    tenantId: string,
    outboundId: string,
    connectionId: string,
    waPhone: string,
    kind: OutboundKind,
    category: OutboundCategory,
    sessionId?: string,
    isByo?: boolean
  ): Promise<CreditDeductionResult>;
  recordOutbound(record: OutboundRecord): Promise<void>;
  updateOutboundStatus(outboundId: string, status: string, wamid?: string, errorCode?: number): Promise<void>;
  refundFailedOutbound(outboundId: string): Promise<boolean>;
}

/**
 * NoOp Usage Gate for Standalone Community / Self-Hosted Edition
 * Never charges credits, always allows sending.
 */
export class NoOpUsageGate implements IUsageGate {
  async canSend(): Promise<boolean> {
    return true;
  }

  async deductCredit(): Promise<CreditDeductionResult> {
    return { allowed: true, charged: false };
  }

  async recordOutbound(): Promise<void> {}
  async updateOutboundStatus(): Promise<void> {}
  async refundFailedOutbound(): Promise<boolean> {
    return false;
  }
}

/**
 * PostgreSQL Atomic Credit Usage Gate for Cloud SaaS (Roadmap §4.3 & §9.3a)
 * Enforces Zero-Deficit: atomic balance check and deduction in database.
 */
export class CreditUsageGate implements IUsageGate {
  constructor(private pool: pg.Pool) {}

  async canSend(tenantId: string, kind: OutboundKind, isByo: boolean): Promise<boolean> {
    // BYO connections or verification messages do not require platform credit deduction
    if (isByo || kind === 'verification') {
      return true;
    }

    const now = Date.now();
    const res = await this.pool.query(
      `
      SELECT (bundle_balance > 0 OR (topup_balance > 0 AND topup_expires_at > $2)) AS has_credit
      FROM tenant_credit_balances
      WHERE tenant_id = $1
    `,
      [tenantId, now]
    );

    if (res.rows.length === 0) return false;
    return Boolean(res.rows[0].has_credit);
  }

  async deductCredit(
    tenantId: string,
    outboundId: string,
    connectionId: string,
    waPhone: string,
    kind: OutboundKind,
    category: OutboundCategory,
    sessionId?: string,
    isByo: boolean = false
  ): Promise<CreditDeductionResult> {
    const now = Date.now();

    // Free tier actions (verification messages or BYO connections) are not charged
    if (isByo || kind === 'verification') {
      await this.recordOutbound({
        outboundId,
        tenantId,
        connectionId,
        sessionId,
        waPhone,
        kind,
        category,
        status: 'accepted',
        creditCharged: false,
        createdAt: now,
      });
      return { allowed: true, charged: false };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Atomic deduction query (Roadmap §9.3a):
      // Deducts bundle_balance first if > 0, otherwise topup_balance if valid
      const deductRes = await client.query(
        `
        UPDATE tenant_credit_balances
        SET bundle_balance = bundle_balance - CASE WHEN bundle_balance > 0 THEN 1 ELSE 0 END,
            topup_balance  = topup_balance  - CASE WHEN bundle_balance = 0 THEN 1 ELSE 0 END,
            updated_at     = $2
        WHERE tenant_id = $1
          AND (bundle_balance > 0 OR (topup_balance > 0 AND topup_expires_at > $2))
        RETURNING bundle_balance, topup_balance
      `,
        [tenantId, now]
      );

      // 0 rows returned = insufficient credit -> reject immediately
      if (deductRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { allowed: false, charged: false };
      }

      const { bundle_balance, topup_balance } = deductRes.rows[0];
      const remainingBundle = Number(bundle_balance);
      const remainingTopup = Number(topup_balance);
      const totalRemaining = remainingBundle + remainingTopup;

      // Determine which bucket was charged
      const bucket = remainingBundle >= 0 && deductRes.rows[0].bundle_balance !== undefined ? 'bundle' : 'topup';

      // Record transaction with idempotency external_ref = 'out:<outbound_id>'
      const txId = `tx_${crypto.randomBytes(12).toString('hex')}`;
      await client.query(
        `
        INSERT INTO tenant_credit_transactions (
          transaction_id, tenant_id, bucket, amount_credits, amount_idr,
          type, external_ref, balance_after, created_at
        )
        VALUES ($1, $2, $3, -1, 0, 'usage_message', $4, $5, $6)
        ON CONFLICT (external_ref) DO NOTHING
      `,
        [txId, tenantId, bucket, `out:${outboundId}`, totalRemaining, now]
      );

      // Record outbound message in ledger
      await client.query(
        `
        INSERT INTO outbound_messages (
          outbound_id, tenant_id, connection_id, session_id, wa_phone,
          kind, category, status, credit_charged, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'accepted', true, $8)
      `,
        [outboundId, tenantId, connectionId, sessionId || null, waPhone, kind, category, now]
      );

      await client.query('COMMIT');
      return {
        allowed: true,
        charged: true,
        remainingBundle,
        remainingTopup,
      };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async recordOutbound(record: OutboundRecord): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO outbound_messages (
        outbound_id, tenant_id, connection_id, session_id, wa_phone,
        kind, category, wamid, status, credit_charged, error_code, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (outbound_id) DO UPDATE SET
        wamid = COALESCE(EXCLUDED.wamid, outbound_messages.wamid),
        status = EXCLUDED.status,
        error_code = COALESCE(EXCLUDED.error_code, outbound_messages.error_code)
    `,
      [
        record.outboundId,
        record.tenantId,
        record.connectionId,
        record.sessionId || null,
        record.waPhone,
        record.kind,
        record.category,
        record.wamid || null,
        record.status,
        record.creditCharged,
        record.errorCode || null,
        record.createdAt,
      ]
    );
  }

  async updateOutboundStatus(outboundId: string, status: string, wamid?: string, errorCode?: number): Promise<void> {
    await this.pool.query(
      `
      UPDATE outbound_messages
      SET status = $2,
          wamid = COALESCE($3, wamid),
          error_code = COALESCE($4, error_code)
      WHERE outbound_id = $1 OR wamid = $1
    `,
      [outboundId, status, wamid || null, errorCode || null]
    );
  }

  /**
   * Idempotently refunds credits for failed outbound messages (Roadmap §5.4)
   * external_ref = 'refund:<outbound_id>' ensures zero duplicate refunds.
   */
  async refundFailedOutbound(outboundId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const outRes = await client.query(
        `SELECT tenant_id, credit_charged, status, outbound_id FROM outbound_messages WHERE outbound_id = $1 OR wamid = $1`,
        [outboundId]
      );

      if (outRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      const { tenant_id, credit_charged, outbound_id: resolvedOutboundId } = outRes.rows[0];
      if (!credit_charged) {
        await client.query('ROLLBACK');
        return false; // Free message, no credit to refund
      }

      const externalRef = `refund:${resolvedOutboundId || outboundId}`;

      // Check if already refunded
      const existRes = await client.query(
        `SELECT transaction_id FROM tenant_credit_transactions WHERE external_ref = $1`,
        [externalRef]
      );
      if (existRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return true; // Already refunded (idempotent)
      }

      const now = Date.now();

      // Top up credit balance by 1
      const updateRes = await client.query(
        `
        UPDATE tenant_credit_balances
        SET topup_balance = topup_balance + 1,
            updated_at = $2
        WHERE tenant_id = $1
        RETURNING bundle_balance, topup_balance
      `,
        [tenant_id, now]
      );

      const totalBalance = updateRes.rows.length > 0
        ? Number(updateRes.rows[0].bundle_balance) + Number(updateRes.rows[0].topup_balance)
        : 1;

      // Record refund transaction
      const txId = `tx_ref_${crypto.randomBytes(12).toString('hex')}`;
      await client.query(
        `
        INSERT INTO tenant_credit_transactions (
          transaction_id, tenant_id, bucket, amount_credits, amount_idr,
          type, external_ref, balance_after, created_at
        )
        VALUES ($1, $2, 'topup', 1, 0, 'refund_failed', $3, $4, $5)
      `,
        [txId, tenant_id, externalRef, totalBalance, now]
      );

      await client.query('COMMIT');
      console.log(`[UsageGate] ✅ Successfully refunded 1 credit for failed outbound ${outboundId}`);
      return true;
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      console.error(`[UsageGate] Failed to refund outbound ${outboundId}:`, err);
      return false;
    } finally {
      client.release();
    }
  }
}

