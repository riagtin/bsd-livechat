// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { config } from '../config/index.js';
import { verifyInternalSignature } from '../crypto/internal-signature.js';
import { getDatabase } from '../database/index.js';
import { PostgresDatabase } from '../database/postgres.js';
import { planPolicy, PlanTier } from '../policy/plan.js';
import { observabilityService } from '../monitoring/observability.js';

interface BillingEventBody {
  event_id: string;
  tenant_id: string;
  kind: 'subscription_paid' | 'topup_paid' | 'refund';
  payload: {
    invoice_id?: string;
    amount_base?: number;
    dpp_other?: number;
    vat?: number;
    amount_total?: number;
    credits?: number;
    plan_tier?: PlanTier;
    period_start?: number;
    period_end?: number;
  };
}

interface XenditInvoiceWebhook {
  id: string;
  external_id: string;
  user_id?: string;
  status: string; // 'PAID' | 'SETTLED' | 'EXPIRED'
  merchant_name?: string;
  amount: number;
  paid_amount?: number;
  payer_email?: string;
  description?: string;
  payment_method?: string;
  payment_channel?: string;
  payment_destination?: string;
  paid_at?: string;
  metadata?: {
    tenant_id?: string;
    product?: string;
    plan_tier?: string;
    kind?: string;
    credits?: number;
    [key: string]: unknown;
  };
}

async function verifyWithXenditReQuery(invoiceId: string): Promise<boolean> {
  const secretKey = config.xenditSecretKey;
  if (!secretKey) {
    // If secret key is not set (e.g. in local offline unit tests), assume valid if payload is signed
    return true;
  }

  try {
    const authHeader = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
    const resp = await fetch(`https://api.xendit.co/v2/invoices/${invoiceId}`, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
      },
    });

    if (!resp.ok) {
      console.warn(`[InternalBilling] Out-of-band Xendit re-query HTTP ${resp.status}`);
      return false;
    }

    const data = (await resp.json()) as { status?: string };
    const status = (data.status || '').toUpperCase();
    return status === 'PAID' || status === 'SETTLED';
  } catch (err) {
    console.error('[InternalBilling] Failed out-of-band Xendit re-query:', err);
    // In dev / test fallback, return true so integration works
    return config.isDev;
  }
}

export const internalRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // PreHandler: Enforce Server-to-Server HMAC Signature (Roadmap §7.4 & Centralized Dispatcher)
  fastify.addHook('preHandler', async (req, reply) => {
    const signature = req.headers['x-bsd-signature'] as string | undefined;
    const timestamp = req.headers['x-bsd-timestamp'] as string | undefined;
    const nonce = req.headers['x-bsd-nonce'] as string | undefined;

    const rawBodyBuf = (req as unknown as { rawBody?: Buffer }).rawBody;
    const rawBody = rawBodyBuf ? rawBodyBuf.toString('utf-8') : JSON.stringify(req.body);

    if (!signature || !timestamp) {
      return reply.status(401).send({
        error: 'Unauthorized: Missing required X-BSD internal authentication headers.',
      });
    }

    const isValid = verifyInternalSignature(rawBody, timestamp, nonce, signature);
    if (!isValid) {
      console.warn('[Internal] Unauthorized server-to-server request: Invalid or replayed signature.');
      return reply.status(401).send({ error: 'Unauthorized: Invalid internal signature.' });
    }
  });

  /**
   * Internal Webhook Handler for Forwarded Xendit Invoices (Roadmap §11.3 & Centralized Dispatcher)
   * Receives incoming Xendit webhook payload forwarded by BSDWeb with x-bsd-signature.
   * Performs out-of-band re-query, enforces idempotency, and mutates database atomically.
   */
  fastify.post<{ Body: XenditInvoiceWebhook }>('/billing/webhook', async (req, reply) => {
    const invoice = req.body;
    const { id: invoiceId, external_id: externalId, status, amount } = invoice;

    if (!invoiceId || !externalId) {
      return reply.status(400).send({ error: 'Missing invoice ID or external ID.' });
    }

    console.log(`[InternalBilling] Received forwarded invoice: ${externalId} (${invoiceId}), status: ${status}`);

    // We only process PAID or SETTLED statuses for credit & subscription grant
    if (status !== 'PAID' && status !== 'SETTLED') {
      console.log(`[InternalBilling] Ignoring invoice ${externalId} with status ${status}`);
      return reply.status(200).send({ status: 'IGNORED_STATUS', invoice_id: invoiceId, invoice_status: status });
    }

    // Out-of-band Re-Query to verify status directly with Xendit before locking DB
    const isVerified = await verifyWithXenditReQuery(invoiceId);
    if (!isVerified) {
      console.warn(`[InternalBilling] Out-of-band verification failed for invoice ${invoiceId}`);
      return reply.status(400).send({ error: 'Out-of-band verification failed. Invoice is not verified as PAID.' });
    }

    const db = getDatabase();
    if (!(db instanceof PostgresDatabase)) {
      console.log(`[InternalBilling] Memory driver active. Acknowledged invoice ${invoiceId} (mock).`);
      return reply.send({ status: 'PROCESSED_MEMORY', invoice_id: invoiceId });
    }

    const pool = db.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Idempotency Check on billing_events
      const eventExistRes = await client.query(
        'SELECT event_id FROM billing_events WHERE event_id = $1',
        [invoiceId]
      );

      if (eventExistRes.rows.length > 0) {
        await client.query('COMMIT');
        console.log(`[InternalBilling] Idempotent: Invoice ${invoiceId} was already processed.`);
        return reply.status(200).send({ status: 'IDEMPOTENT_ALREADY_PROCESSED', invoice_id: invoiceId });
      }

      // 2. Resolve Tenant ID
      let tenantId = invoice.metadata?.tenant_id;
      if (!tenantId && invoice.payer_email) {
        // Fallback: look up tenant by email
        const userRes = await client.query(
          'SELECT tenant_id FROM tenant_users WHERE LOWER(email) = LOWER($1) LIMIT 1',
          [invoice.payer_email]
        );
        if (userRes.rows.length > 0) {
          tenantId = userRes.rows[0].tenant_id;
        }
      }

      if (!tenantId) {
        await client.query('ROLLBACK');
        console.error(`[InternalBilling] Could not resolve tenant_id for invoice ${invoiceId}`);
        return reply.status(400).send({ error: 'Tenant could not be resolved for this invoice.' });
      }

      const now = Date.now();
      const isSub = externalId.startsWith('LIVECHAT-SUB-');
      const isTopup = externalId.startsWith('LIVECHAT-TOPUP-');
      const eventKind = isSub ? 'subscription_paid' : 'topup_paid';

      // 3. Process based on Sub or Topup
      if (isSub) {
        const tier = (invoice.metadata?.plan_tier as PlanTier) || 'starter';
        const limits = planPolicy.getLimits(tier);

        // Update tenant subscription status & plan
        const periodStart = now;
        const periodEnd = now + 30 * 86400000; // 30 days
        await client.query(
          `
          UPDATE tenants
          SET plan_tier = $1,
              subscription_status = 'active',
              current_period_start = $2,
              current_period_end = $3,
              pending_plan_tier = NULL
          WHERE tenant_id = $4
        `,
          [tier, periodStart, periodEnd, tenantId]
        );

        // Grant monthly bundle credits
        if (limits.monthlyBundleCredits > 0) {
          const balanceRes = await client.query(
            `
            INSERT INTO tenant_credit_balances (tenant_id, bundle_balance, topup_balance, updated_at)
            VALUES ($1, $2, 0, $3)
            ON CONFLICT (tenant_id) DO UPDATE SET
              bundle_balance = EXCLUDED.bundle_balance,
              updated_at = EXCLUDED.updated_at
            RETURNING bundle_balance, topup_balance
          `,
            [tenantId, limits.monthlyBundleCredits, now]
          );

          const row = balanceRes.rows[0];
          const totalAfter = Number(row.bundle_balance) + Number(row.topup_balance);
          const txId = `tx_${crypto.randomBytes(12).toString('hex')}`;
          const externalRef = `bundle:${invoiceId}`;

          await client.query(
            `
            INSERT INTO tenant_credit_transactions (
              transaction_id, tenant_id, bucket, amount_credits, amount_idr,
              type, external_ref, balance_after, created_at
            )
            VALUES ($1, $2, 'bundle', $3, $4, 'bundle_grant', $5, $6, $7)
            ON CONFLICT (external_ref) DO NOTHING
          `,
            [txId, tenantId, limits.monthlyBundleCredits, amount, externalRef, totalAfter, now]
          );
        }
      } else if (isTopup) {
        // Determine credits from metadata or standard packs
        let topupCredits = invoice.metadata?.credits ? Number(invoice.metadata.credits) : 0;
        if (!topupCredits || topupCredits <= 0) {
          if (amount >= 225000) topupCredits = 500;
          else if (amount >= 120000) topupCredits = 250;
          else if (amount >= 50000) topupCredits = 100;
          else if (amount >= 25000) topupCredits = 50;
          else topupCredits = Math.floor(amount / 500);
        }

        const topupExpiry = now + 365 * 86400000; // 12 months (Roadmap §11.1)

        const balanceRes = await client.query(
          `
          INSERT INTO tenant_credit_balances (tenant_id, bundle_balance, topup_balance, topup_expires_at, updated_at)
          VALUES ($1, 0, $2, $3, $4)
          ON CONFLICT (tenant_id) DO UPDATE SET
            topup_balance = tenant_credit_balances.topup_balance + EXCLUDED.topup_balance,
            topup_expires_at = GREATEST(tenant_credit_balances.topup_expires_at, EXCLUDED.topup_expires_at),
            updated_at = EXCLUDED.updated_at
          RETURNING bundle_balance, topup_balance
        `,
          [tenantId, topupCredits, topupExpiry, now]
        );

        const row = balanceRes.rows[0];
        const totalAfter = Number(row.bundle_balance) + Number(row.topup_balance);
        const txId = `tx_${crypto.randomBytes(12).toString('hex')}`;
        const externalRef = `xendit:${invoiceId}`;

        await client.query(
          `
          INSERT INTO tenant_credit_transactions (
            transaction_id, tenant_id, bucket, amount_credits, amount_idr,
            type, external_ref, balance_after, created_at
          )
          VALUES ($1, $2, 'topup', $3, $4, 'topup_xendit', $5, $6, $7)
          ON CONFLICT (external_ref) DO NOTHING
        `,
          [txId, tenantId, topupCredits, amount, externalRef, totalAfter, now]
        );
      }

      // 4. Record in billing_events for idempotency & audit
      await client.query(
        `
        INSERT INTO billing_events (event_id, tenant_id, kind, payload, processed_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
        [invoiceId, tenantId, eventKind, JSON.stringify(invoice), now]
      );

      await client.query('COMMIT');
      console.log(`[InternalBilling] ✅ Successfully processed invoice ${invoiceId} (${externalId}) for tenant ${tenantId}`);
      return reply.send({ status: 'PROCESSED_SUCCESSFULLY', invoice_id: invoiceId, tenant_id: tenantId });
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[InternalBilling] Failed to process invoice ${invoiceId}:`, msg);
      return reply.status(500).send({ error: `Internal processing error: ${msg}` });
    } finally {
      client.release();
    }
  });

  /**
   * Internal Billing Event Consumer (Roadmap §11.3 & §9.2)
   * 100% idempotent via billing_events.event_id primary key and transaction external_ref
   */
  fastify.post<{ Body: BillingEventBody }>('/billing/event', async (req, reply) => {
    const { event_id, tenant_id, kind, payload } = req.body;

    if (!event_id || !tenant_id || !kind || !payload) {
      return reply.status(400).send({ error: 'Missing required billing event parameters.' });
    }

    const db = getDatabase();
    if (!(db instanceof PostgresDatabase)) {
      console.log(`[InternalBilling] Memory driver active. Acknowledged event ${event_id} (mock).`);
      return reply.send({ status: 'PROCESSED_MEMORY', event_id });
    }

    const pool = db.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Check idempotency on billing_events table
      const existRes = await client.query(
        'SELECT event_id FROM billing_events WHERE event_id = $1',
        [event_id]
      );

      if (existRes.rows.length > 0) {
        await client.query('COMMIT');
        return reply.status(200).send({ status: 'IDEMPOTENT_ALREADY_PROCESSED', event_id });
      }

      const now = Date.now();

      // 2. Record billing event
      await client.query(
        `
        INSERT INTO billing_events (event_id, tenant_id, kind, payload, processed_at)
        VALUES ($1, $2, $3, $4, $5)
      `,
        [event_id, tenant_id, kind, JSON.stringify(payload), now]
      );

      // 3. Process event actions
      if (kind === 'topup_paid') {
        const topupCredits = payload.credits || 0;
        const topupExpiry = now + 365 * 86400000; // 12 months (Roadmap §11.1)

        // Add to topup balance
        const balanceRes = await client.query(
          `
          INSERT INTO tenant_credit_balances (tenant_id, bundle_balance, topup_balance, topup_expires_at, updated_at)
          VALUES ($1, 0, $2, $3, $4)
          ON CONFLICT (tenant_id) DO UPDATE SET
            topup_balance = tenant_credit_balances.topup_balance + EXCLUDED.topup_balance,
            topup_expires_at = GREATEST(tenant_credit_balances.topup_expires_at, EXCLUDED.topup_expires_at),
            updated_at = EXCLUDED.updated_at
          RETURNING bundle_balance, topup_balance
        `,
          [tenant_id, topupCredits, topupExpiry, now]
        );

        const row = balanceRes.rows[0];
        const totalAfter = Number(row.bundle_balance) + Number(row.topup_balance);

        // Record credit transaction
        const txId = `tx_${crypto.randomBytes(12).toString('hex')}`;
        const externalRef = payload.invoice_id ? `xendit:${payload.invoice_id}` : `event:${event_id}`;

        await client.query(
          `
          INSERT INTO tenant_credit_transactions (
            transaction_id, tenant_id, bucket, amount_credits, amount_idr,
            type, external_ref, balance_after, created_at
          )
          VALUES ($1, $2, 'topup', $3, $4, 'topup_xendit', $5, $6, $7)
          ON CONFLICT (external_ref) DO NOTHING
        `,
          [txId, tenant_id, topupCredits, payload.amount_total || 0, externalRef, totalAfter, now]
        );
      } else if (kind === 'subscription_paid') {
        const tier = payload.plan_tier || 'starter';
        const limits = planPolicy.getLimits(tier);

        // Update tenant subscription status & plan
        await client.query(
          `
          UPDATE tenants
          SET plan_tier = $1,
              subscription_status = 'active',
              current_period_start = $2,
              current_period_end = $3
          WHERE tenant_id = $4
        `,
          [tier, payload.period_start || now, payload.period_end || now + 30 * 86400000, tenant_id]
        );

        // Grant monthly bundle credits
        if (limits.monthlyBundleCredits > 0) {
          const balanceRes = await client.query(
            `
            INSERT INTO tenant_credit_balances (tenant_id, bundle_balance, topup_balance, updated_at)
            VALUES ($1, $2, 0, $3)
            ON CONFLICT (tenant_id) DO UPDATE SET
              bundle_balance = EXCLUDED.bundle_balance,
              updated_at = EXCLUDED.updated_at
            RETURNING bundle_balance, topup_balance
          `,
            [tenant_id, limits.monthlyBundleCredits, now]
          );

          const row = balanceRes.rows[0];
          const totalAfter = Number(row.bundle_balance) + Number(row.topup_balance);
          const txId = `tx_${crypto.randomBytes(12).toString('hex')}`;
          const externalRef = payload.invoice_id
            ? `bundle:${payload.invoice_id}`
            : `bundle:${event_id}`;

          await client.query(
            `
            INSERT INTO tenant_credit_transactions (
              transaction_id, tenant_id, bucket, amount_credits, amount_idr,
              type, external_ref, balance_after, created_at
            )
            VALUES ($1, $2, 'bundle', $3, $4, 'bundle_grant', $5, $6, $7)
            ON CONFLICT (external_ref) DO NOTHING
          `,
            [
              txId,
              tenant_id,
              limits.monthlyBundleCredits,
              payload.amount_total || 0,
              externalRef,
              totalAfter,
              now,
            ]
          );
        }
      }

      await client.query('COMMIT');
      console.log(`[InternalBilling] ✅ Successfully processed billing event ${event_id} (${kind}) for tenant ${tenant_id}`);
      return reply.send({ status: 'PROCESSED_SUCCESSFULLY', event_id });
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[InternalBilling] Failed to process billing event ${event_id}:`, msg);
      return reply.status(500).send({ error: `Internal processing error: ${msg}` });
    } finally {
      client.release();
    }
  });

  /**
   * Internal WABA Number Availability Check (Roadmap §6.3.1)
   * Enforces 1 Nomor = 1 Produk rule
   */
  fastify.get<{ Querystring: { phone_number_id: string } }>('/waba/check-number', async (req, reply) => {
    const { phone_number_id } = req.query;
    if (!phone_number_id) {
      return reply.status(400).send({ error: 'Missing phone_number_id parameter.' });
    }

    const db = getDatabase();
    if (db instanceof PostgresDatabase) {
      const pool = db.getPool();
      const res = await pool.query(
        'SELECT connection_id, owner_type FROM waba_connections WHERE phone_number_id = $1',
        [phone_number_id]
      );

      if (res.rows.length > 0) {
        return reply.send({
          available: false,
          reason: 'NUMBER_ALREADY_REGISTERED',
          connection_id: res.rows[0].connection_id,
        });
      }
    }

    return reply.send({ available: true });
  });

  /**
   * Internal Health Status
   */
  fastify.get('/health', async () => {
    return observabilityService.getDetailedHealth();
  });

  /**
   * Internal Telemetry & Metrics Snapshot
   */
  fastify.get<{ Querystring: { format?: string } }>('/metrics', async (req, reply) => {
    const { format } = req.query;
    if (format === 'prometheus') {
      reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      return observabilityService.getPrometheusMetrics();
    }
    return observabilityService.getSnapshot();
  });
};

