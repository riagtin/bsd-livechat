// SPDX-License-Identifier: AGPL-3.0-only
import pg from 'pg';
import { metaClient } from '../meta/client.js';
import { wabaManager } from '../meta/connection.js';

const KEEPALIVE_LOCK_ID = 7429104;
const RETENTION_LOCK_ID = 7429105;
const TOPUP_EXPIRY_LOCK_ID = 7429106;
const SUBSCRIPTION_LIFECYCLE_LOCK_ID = 7429107;

export class MaintenanceScheduler {
  private timer?: NodeJS.Timeout;

  constructor(private pool: pg.Pool) {}

  start(): void {
    // Run every 10 minutes
    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[MaintenanceScheduler] Error during scheduled maintenance tick:', msg);
      });
    }, 10 * 60 * 1000);
    this.timer.unref();

    console.log('[MaintenanceScheduler] Background maintenance worker active.');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    await this.runKeepAliveJob();
    await this.runRetentionJob();
    await this.runTopupExpirationJob();
    await this.runSubscriptionLifecycleJob();
  }

  /**
   * Evaluates and dispatches keepalive ping to BYO-WABA agents at hour 23 (Roadmap §9.3d)
   * Guard: Hard stops when service_sent >= 900 in current month.
   */
  async runKeepAliveJob(): Promise<number> {
    const client = await this.pool.connect();
    try {
      const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
        KEEPALIVE_LOCK_ID,
      ]);
      if (!lockRes.rows[0]?.acquired) {
        return 0; // Lock held by peer instance
      }

      const now = Date.now();
      const inOneHour = now + 60 * 60 * 1000;
      const currentPeriodYm = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

      const candidateQuery = `
        SELECT w.connection_id, w.wa_phone
        FROM wa_windows w
        JOIN waba_connections c ON c.connection_id = w.connection_id AND c.owner_type = 'tenant' AND c.status = 'active'
        LEFT JOIN waba_connection_usage u ON u.connection_id = w.connection_id AND u.period_ym = $3
        WHERE w.window_expires_at > $1
          AND w.window_expires_at <= $2
          AND w.keepalive_sent_at < w.last_inbound_at
          AND COALESCE(u.service_sent, 0) < 900
          AND EXISTS (
              SELECT 1 FROM channel_agents a
              JOIN channels ch ON ch.channel_id = a.channel_id
              WHERE a.wa_phone = w.wa_phone
                AND ch.waba_connection_id = w.connection_id
                AND ch.keepalive_enabled = true
                AND a.is_active = true
                AND a.verified_at IS NOT NULL
                AND a.opted_out_at IS NULL
          )
      `;

      const res = await client.query(candidateQuery, [now, inOneHour, currentPeriodYm]);
      let sentCount = 0;

      for (const row of res.rows) {
        const { connection_id, wa_phone } = row;
        const conn = await wabaManager.getById(connection_id);
        if (!conn) continue;

        const creds = wabaManager.resolveCredentials(conn);
        const sendRes = await metaClient.sendFreeFormText(
          wa_phone,
          '🔔 *Bintang Studio LiveChat Ping*\nJendela obrolan WhatsApp Anda diperbarui untuk 24 jam ke depan.',
          creds
        );

        if (sendRes.success) {
          sentCount++;
          // Update keepalive_sent_at
          await client.query(
            'UPDATE wa_windows SET keepalive_sent_at = $1 WHERE connection_id = $2 AND wa_phone = $3',
            [Date.now(), connection_id, wa_phone]
          );

          // Track service usage per connection
          await client.query(
            `
            INSERT INTO waba_connection_usage (connection_id, period_ym, service_sent)
            VALUES ($1, $2, 1)
            ON CONFLICT (connection_id, period_ym) DO UPDATE SET
              service_sent = waba_connection_usage.service_sent + 1
          `,
            [connection_id, currentPeriodYm]
          );
        }
      }

      return sentCount;
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [KEEPALIVE_LOCK_ID]);
      } catch {
        // Ignored
      }
      client.release();
    }
  }

  /**
   * Data Retention Cleanup (Roadmap §13.1)
   */
  async runRetentionJob(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
        RETENTION_LOCK_ID,
      ]);
      if (!lockRes.rows[0]?.acquired) {
        return;
      }

      const now = Date.now();

      // 1. Purge expired trial claims past purge_after (12 months)
      await client.query('DELETE FROM trial_claims WHERE purge_after < $1', [now]);

      // 2. Purge revoked or expired merchant refresh tokens
      await client.query(
        'DELETE FROM merchant_refresh_tokens WHERE expires_at < $1 OR revoked_at IS NOT NULL',
        [now]
      );

      // 3. Purge orphaned sessions older than 90 days default
      const defaultCutoff = now - 90 * 86400000;
      await client.query('DELETE FROM chat_sessions WHERE last_active_at < $1', [defaultCutoff]);
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [RETENTION_LOCK_ID]);
      } catch {
        // Ignored
      }
      client.release();
    }
  }

  /**
   * Top-Up Expiration Job (Roadmap §11.1 & §11.2)
   * Credits expire 12 months after top-up if unused.
   */
  async runTopupExpirationJob(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
        TOPUP_EXPIRY_LOCK_ID,
      ]);
      if (!lockRes.rows[0]?.acquired) {
        return;
      }

      const now = Date.now();
      const expiredRes = await client.query(
        `SELECT tenant_id, topup_balance, bundle_balance
         FROM tenant_credit_balances
         WHERE topup_expires_at > 0 AND topup_expires_at < $1 AND topup_balance > 0`,
        [now]
      );

      for (const row of expiredRes.rows) {
        const { tenant_id, topup_balance, bundle_balance } = row;
        const expiredAmount = Number(topup_balance);
        const totalAfter = Number(bundle_balance);

        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE tenant_credit_balances
             SET topup_balance = 0, topup_expires_at = 0, updated_at = $1
             WHERE tenant_id = $2`,
            [now, tenant_id]
          );

          const txId = `tx_exp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          await client.query(
            `INSERT INTO tenant_credit_transactions (
              transaction_id, tenant_id, bucket, amount_credits, amount_idr,
              type, external_ref, balance_after, created_at
            ) VALUES ($1, $2, 'topup', $3, 0, 'topup_expire', $4, $5, $6)
            ON CONFLICT (external_ref) DO NOTHING`,
            [txId, tenant_id, -expiredAmount, `expire:${tenant_id}:${now}`, totalAfter, now]
          );
          await client.query('COMMIT');
          console.log(`[MaintenanceScheduler] Expired ${expiredAmount} topup credits for tenant ${tenant_id}`);
        } catch (txErr) {
          await client.query('ROLLBACK');
          console.error(`[MaintenanceScheduler] Failed to expire credits for tenant ${tenant_id}:`, txErr);
        }
      }
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [TOPUP_EXPIRY_LOCK_ID]);
      } catch {
        // Ignored
      }
      client.release();
    }
  }

  /**
   * Subscription Anniversary & Lifecycle Job (Roadmap §11.2)
   * Evaluates active subscriptions past current_period_end:
   * - <= 3 days: enters 'grace' period
   * - > 3 days: enters 'suspended', monthly bundle balance resets to 0 (hangus)
   * - If pending_plan_tier exists: transition to new tier
   */
  async runSubscriptionLifecycleJob(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [
        SUBSCRIPTION_LIFECYCLE_LOCK_ID,
      ]);
      if (!lockRes.rows[0]?.acquired) {
        return;
      }

      const now = Date.now();
      const threeDaysMs = 3 * 86400000;

      // 1. Mark grace period for active tenants past current_period_end within 3 days
      await client.query(
        `UPDATE tenants
         SET subscription_status = 'grace'
         WHERE subscription_status = 'active'
           AND current_period_end > 0
           AND current_period_end < $1
           AND current_period_end >= $2`,
        [now, now - threeDaysMs]
      );

      // 2. Mark suspended for tenants past grace period (> 3 days)
      const suspendedRes = await client.query(
        `SELECT tenant_id
         FROM tenants
         WHERE subscription_status IN ('active', 'grace')
           AND current_period_end > 0
           AND current_period_end < $1`,
        [now - threeDaysMs]
      );

      for (const row of suspendedRes.rows) {
        const { tenant_id } = row;
        try {
          await client.query('BEGIN');
          await client.query(
            `UPDATE tenants SET subscription_status = 'suspended' WHERE tenant_id = $1`,
            [tenant_id]
          );

          // Expire bundle balance
          const balRes = await client.query(
            `SELECT bundle_balance, topup_balance FROM tenant_credit_balances WHERE tenant_id = $1`,
            [tenant_id]
          );
          if (balRes.rows.length > 0) {
            const bundleBal = Number(balRes.rows[0].bundle_balance);
            const topupBal = Number(balRes.rows[0].topup_balance);
            if (bundleBal > 0) {
              await client.query(
                `UPDATE tenant_credit_balances SET bundle_balance = 0, updated_at = $1 WHERE tenant_id = $2`,
                [now, tenant_id]
              );
              const txId = `tx_bnd_exp_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
              await client.query(
                `INSERT INTO tenant_credit_transactions (
                  transaction_id, tenant_id, bucket, amount_credits, amount_idr,
                  type, external_ref, balance_after, created_at
                ) VALUES ($1, $2, 'bundle', $3, 0, 'bundle_expire', $4, $5, $6)
                ON CONFLICT (external_ref) DO NOTHING`,
                [txId, tenant_id, -bundleBal, `bnd_exp:${tenant_id}:${now}`, topupBal, now]
              );
            }
          }
          await client.query('COMMIT');
          console.log(`[MaintenanceScheduler] Suspended expired tenant ${tenant_id}`);
        } catch (txErr) {
          await client.query('ROLLBACK');
          console.error(`[MaintenanceScheduler] Failed to suspend tenant ${tenant_id}:`, txErr);
        }
      }
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [SUBSCRIPTION_LIFECYCLE_LOCK_ID]);
      } catch {
        // Ignored
      }
      client.release();
    }
  }
}

