// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from '../config/index.js';

const ADVISORY_LOCK_ID = 7429103;

interface MigrationItem {
  version: string;
  sql: string;
}

// Embedded migrations for resilient execution regardless of build/bundle path
const EMBEDDED_MIGRATIONS: Record<string, string> = {
  '001_baseline.sql': `
CREATE TABLE IF NOT EXISTS tenants (
    tenant_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) DEFAULT 'active',
    created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
    channel_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    business_name VARCHAR(255) NOT NULL,
    cs_phone VARCHAR(32) NOT NULL,
    allowed_domains TEXT[] DEFAULT ARRAY['*'],
    welcome_message TEXT,
    status VARCHAR(32) DEFAULT 'active',
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channels_cs_phone ON channels(cs_phone);
CREATE INDEX IF NOT EXISTS idx_channels_tenant ON channels(tenant_id);

CREATE TABLE IF NOT EXISTS chat_sessions (
    session_id VARCHAR(64) PRIMARY KEY,
    channel_id VARCHAR(64) NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL,
    cs_phone VARCHAR(32) NOT NULL,
    client_id VARCHAR(64) NOT NULL,
    visitor_name VARCHAR(255),
    page_url TEXT,
    referrer TEXT,
    user_agent TEXT,
    created_at BIGINT NOT NULL,
    last_active_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_channel_active ON chat_sessions(channel_id, last_active_at);

CREATE TABLE IF NOT EXISTS chat_messages (
    id VARCHAR(64) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    sender VARCHAR(16) NOT NULL,
    text TEXT NOT NULL,
    wamid VARCHAR(128),
    status VARCHAR(16) DEFAULT 'queued',
    timestamp BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON chat_messages(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_wamid ON chat_messages(wamid);

CREATE TABLE IF NOT EXISTS wamid_mappings (
    wamid VARCHAR(128) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    local_ids TEXT[] NOT NULL,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wamid_session ON wamid_mappings(session_id);
`,
  '002_saas_core.sql': `
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(16) NOT NULL DEFAULT 'starter';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_overrides JSONB;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(16) NOT NULL DEFAULT 'pending_payment';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_start BIGINT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_end BIGINT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_until BIGINT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pending_plan_tier VARCHAR(16);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_started_at BIGINT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at BIGINT;

DO $$ BEGIN
  ALTER TABLE tenants ADD CONSTRAINT chk_tenants_plan_tier
    CHECK (plan_tier IN ('community', 'starter', 'pro', 'enterprise'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE tenants ADD CONSTRAINT chk_tenants_subscription_status
    CHECK (subscription_status IN ('pending_payment', 'trialing', 'active', 'grace', 'suspended', 'canceled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS merchant_users (
    user_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(16) NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin')),
    email_verified_at BIGINT,
    last_login_at BIGINT,
    created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_users_email ON merchant_users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_merchant_users_tenant ON merchant_users (tenant_id);

CREATE TABLE IF NOT EXISTS merchant_refresh_tokens (
    token_hash CHAR(64) PRIMARY KEY,
    family_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL REFERENCES merchant_users(user_id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL,
    revoked_at BIGINT,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON merchant_refresh_tokens (family_id);

CREATE TABLE IF NOT EXISTS trial_claims (
    claim_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    email_fp CHAR(64) NOT NULL,
    wa_phone_fp CHAR(64),
    domain_fp CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'granted', 'converted', 'expired', 'rejected')),
    created_at BIGINT NOT NULL,
    granted_at BIGINT,
    purge_after BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_email ON trial_claims (email_fp)
    WHERE status IN ('granted', 'converted', 'expired');
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_domain ON trial_claims (domain_fp)
    WHERE status IN ('granted', 'converted', 'expired');
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_phone ON trial_claims (wa_phone_fp)
    WHERE wa_phone_fp IS NOT NULL AND status IN ('granted', 'converted', 'expired');

CREATE TABLE IF NOT EXISTS waba_connections (
    connection_id VARCHAR(64) PRIMARY KEY,
    owner_type VARCHAR(16) NOT NULL CHECK (owner_type IN ('platform', 'tenant')),
    meta_app_key VARCHAR(16) NOT NULL CHECK (meta_app_key IN ('relay', 'tech_provider')),
    tenant_id VARCHAR(64) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    waba_id VARCHAR(64) NOT NULL,
    phone_number_id VARCHAR(64) NOT NULL UNIQUE,
    display_phone_number VARCHAR(32) NOT NULL,
    access_token_enc TEXT,
    token_key_version SMALLINT NOT NULL DEFAULT 1,
    template_name VARCHAR(128) NOT NULL DEFAULT 'livechat_ticket_alert',
    template_status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    quality_rating VARCHAR(16) NOT NULL DEFAULT 'GREEN',
    status VARCHAR(16) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'throttled', 'suspended', 'disconnected')),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    CONSTRAINT chk_waba_owner CHECK (
        (owner_type = 'platform' AND tenant_id IS NULL) OR
        (owner_type = 'tenant'   AND tenant_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_waba_conn_tenant ON waba_connections (tenant_id);

CREATE TABLE IF NOT EXISTS waba_connection_usage (
    connection_id VARCHAR(64) NOT NULL REFERENCES waba_connections(connection_id) ON DELETE CASCADE,
    period_ym VARCHAR(7) NOT NULL,
    service_sent INT NOT NULL DEFAULT 0,
    template_sent INT NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, period_ym)
);

ALTER TABLE channels ALTER COLUMN cs_phone DROP NOT NULL;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS waba_connection_id VARCHAR(64) REFERENCES waba_connections(connection_id);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS routing_mode VARCHAR(16) NOT NULL DEFAULT 'round_robin';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS reassign_after_sec INT NOT NULL DEFAULT 180;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS reminder_after_sec INT NOT NULL DEFAULT 300;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS max_pre_reply_outbound SMALLINT NOT NULL DEFAULT 2;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS keepalive_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS offline_capture_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS business_hours_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Jakarta';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS schedule JSONB;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS away_message TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS primary_color VARCHAR(16) DEFAULT '#00E5FF';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS accent_color VARCHAR(16) DEFAULT '#2563EB';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS logo_url TEXT;
CREATE INDEX IF NOT EXISTS idx_channels_connection ON channels (waba_connection_id);

CREATE TABLE IF NOT EXISTS channel_agents (
    agent_id VARCHAR(64) PRIMARY KEY,
    channel_id VARCHAR(64) NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    wa_phone VARCHAR(32) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    verification_code VARCHAR(16) UNIQUE,
    verification_expires_at BIGINT,
    verified_at BIGINT,
    consent_at BIGINT,
    opted_out_at BIGINT,
    last_assigned_at BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    CONSTRAINT uq_channel_agent_phone UNIQUE (channel_id, wa_phone)
);
CREATE INDEX IF NOT EXISTS idx_agents_routing ON channel_agents (channel_id, is_active, last_assigned_at)
    WHERE verified_at IS NOT NULL AND opted_out_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agents_phone ON channel_agents (wa_phone);

CREATE TABLE IF NOT EXISTS wa_windows (
    connection_id VARCHAR(64) NOT NULL REFERENCES waba_connections(connection_id) ON DELETE CASCADE,
    wa_phone VARCHAR(32) NOT NULL,
    last_inbound_at BIGINT NOT NULL DEFAULT 0,
    window_expires_at BIGINT NOT NULL DEFAULT 0,
    keepalive_sent_at BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, wa_phone)
);
CREATE INDEX IF NOT EXISTS idx_wa_windows_expiry ON wa_windows (window_expires_at);

ALTER TABLE chat_sessions ALTER COLUMN cs_phone DROP NOT NULL;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS assigned_agent_id VARCHAR(64)
    REFERENCES channel_agents(agent_id) ON DELETE SET NULL;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS short_code VARCHAR(8);
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS relay_state VARCHAR(16) NOT NULL DEFAULT 'idle';
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS pre_reply_outbound SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS notified_at BIGINT;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS visitor_contact VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_channel_code ON chat_sessions (channel_id, short_code)
    WHERE short_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_agent_active ON chat_sessions (assigned_agent_id, last_active_at);

CREATE TABLE IF NOT EXISTS outbound_messages (
    outbound_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    connection_id VARCHAR(64) NOT NULL REFERENCES waba_connections(connection_id),
    session_id VARCHAR(64) REFERENCES chat_sessions(session_id) ON DELETE SET NULL,
    wa_phone VARCHAR(32) NOT NULL,
    kind VARCHAR(16) NOT NULL
        CHECK (kind IN ('notify', 'reassign', 'reminder', 'digest', 'relay', 'alert', 'keepalive', 'verification')),
    category VARCHAR(16) NOT NULL CHECK (category IN ('service', 'template')),
    wamid VARCHAR(128) UNIQUE,
    status VARCHAR(16) NOT NULL DEFAULT 'accepted',
    credit_charged BOOLEAN NOT NULL DEFAULT false,
    error_code INT,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_tenant_time ON outbound_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_connection_time ON outbound_messages (connection_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_credit_balances (
    tenant_id VARCHAR(64) PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    bundle_balance INT NOT NULL DEFAULT 0 CHECK (bundle_balance >= 0),
    topup_balance INT NOT NULL DEFAULT 0 CHECK (topup_balance >= 0),
    topup_expires_at BIGINT NOT NULL DEFAULT 0,
    low_balance_notified_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_credit_transactions (
    transaction_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    bucket VARCHAR(8) NOT NULL CHECK (bucket IN ('bundle', 'topup')),
    amount_credits INT NOT NULL,
    amount_idr NUMERIC(12, 2) NOT NULL DEFAULT 0,
    type VARCHAR(32) NOT NULL CHECK (type IN (
        'topup_xendit', 'bundle_grant', 'bundle_expire', 'topup_expire',
        'trial_grant', 'trial_expire',
        'usage_message', 'refund_failed', 'upgrade_conversion', 'manual_adjust')),
    external_ref VARCHAR(128) UNIQUE,
    balance_after INT NOT NULL,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_tenant ON tenant_credit_transactions (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_events (
    event_id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL CHECK (kind IN ('subscription_paid', 'topup_paid', 'refund')),
    payload JSONB NOT NULL,
    processed_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_usage_stats (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    period_start BIGINT NOT NULL,
    web_sessions INT NOT NULL DEFAULT 0,
    outbound_service INT NOT NULL DEFAULT 0,
    outbound_template INT NOT NULL DEFAULT 0,
    credits_used INT NOT NULL DEFAULT 0,
    offline_captures INT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, period_start)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    log_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    actor_user_id VARCHAR(64) REFERENCES merchant_users(user_id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    metadata JSONB,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs (tenant_id, created_at DESC);
`,
};

export class DatabaseMigrator {
  constructor(private pool: pg.Pool) {}

  /**
   * Runs all pending migrations under pg_advisory_lock
   */
  async runMigrations(): Promise<void> {
    const client = await this.pool.connect();
    try {
      console.log(`[Migrator] Acquiring PostgreSQL advisory lock (${ADVISORY_LOCK_ID})...`);
      await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);
      console.log('[Migrator] Advisory lock acquired.');

      // 1. Ensure schema_migrations table
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version VARCHAR(64) PRIMARY KEY,
          applied_at BIGINT NOT NULL
        )
      `);

      // 2. Get already applied migrations
      const res = await client.query('SELECT version FROM schema_migrations');
      const applied = new Set<string>(res.rows.map((r: { version: string }) => r.version));

      // 3. Collect migration files
      const migrations = this.loadMigrations();

      // 4. Apply pending migrations sequentially in transactions
      for (const m of migrations) {
        if (!applied.has(m.version)) {
          console.log(`[Migrator] Applying migration: ${m.version}...`);
          await client.query('BEGIN');
          try {
            await client.query(m.sql);
            await client.query(
              'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)',
              [m.version, Date.now()]
            );
            await client.query('COMMIT');
            console.log(`[Migrator] ✅ Migration ${m.version} applied successfully.`);
          } catch (err: unknown) {
            await client.query('ROLLBACK');
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Migrator] ❌ Failed to apply migration ${m.version}: ${msg}`);
            throw err;
          }
        } else {
          console.log(`[Migrator] Migration ${m.version} is already applied.`);
        }
      }

      // 5. Seed platform connection and internal tenant
      await this.seedPlatformConnection(client);
    } finally {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]);
        console.log('[Migrator] Advisory lock released.');
      } catch (err: unknown) {
        console.warn('[Migrator] Warning: Failed to release advisory lock:', err);
      }
      client.release();
    }
  }

  private loadMigrations(): MigrationItem[] {
    const migrations: MigrationItem[] = [];

    // Attempt to read from migrations directory first
    const possibleDirs = [
      path.resolve(process.cwd(), 'src/database/migrations'),
      path.resolve(process.cwd(), 'apps/gateway/src/database/migrations'),
      path.resolve(__dirname, 'migrations'),
    ];

    let foundDir: string | null = null;
    for (const dir of possibleDirs) {
      if (fs.existsSync(dir)) {
        foundDir = dir;
        break;
      }
    }

    if (foundDir) {
      const files = fs.readdirSync(foundDir).filter((f) => f.endsWith('.sql')).sort();
      for (const file of files) {
        const fullPath = path.join(foundDir, file);
        const sql = fs.readFileSync(fullPath, 'utf-8');
        migrations.push({ version: file, sql });
      }
    }

    // Fallback to embedded migrations if no files found on disk
    if (migrations.length === 0) {
      for (const [version, sql] of Object.entries(EMBEDDED_MIGRATIONS)) {
        migrations.push({ version, sql });
      }
      migrations.sort((a, b) => a.version.localeCompare(b.version));
    }

    return migrations;
  }

  /**
   * Seed platform connection from env (Roadmap §9.1)
   * Safely links existing channels to the platform connection and sets tnt_default to enterprise.
   */
  private async seedPlatformConnection(client: pg.PoolClient): Promise<void> {
    const now = Date.now();

    // 1. Ensure platform default tenant exists with enterprise tier
    await client.query(
      `
      INSERT INTO tenants (tenant_id, name, plan_tier, subscription_status, created_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (tenant_id) DO UPDATE SET
        plan_tier = 'enterprise',
        subscription_status = 'active'
    `,
      ['tnt_default', 'Bintang Studio Platform', 'enterprise', 'active', now]
    );

    // 2. Ensure initial balance for platform default tenant
    await client.query(
      `
      INSERT INTO tenant_credit_balances (tenant_id, bundle_balance, topup_balance, updated_at)
      VALUES ($1, 999999, 0, $2)
      ON CONFLICT (tenant_id) DO NOTHING
    `,
      ['tnt_default', now]
    );

    // 3. Seed platform WABA connection if META_PHONE_NUMBER_ID is provided
    if (config.meta.phoneNumberId) {
      const connId = 'conn_platform_default';
      const wabaId = config.meta.wabaId || 'waba_platform';
      const displayPhone = config.meta.displayPhoneNumber || config.meta.csPhone || '6281234567890';

      await client.query(
        `
        INSERT INTO waba_connections (
          connection_id, owner_type, meta_app_key, waba_id,
          phone_number_id, display_phone_number, status, template_name,
          quality_rating, created_at, updated_at
        )
        VALUES ($1, 'platform', 'relay', $2, $3, $4, 'active', $5, 'GREEN', $6, $6)
        ON CONFLICT (phone_number_id) DO UPDATE SET
          meta_app_key = 'relay',
          waba_id = EXCLUDED.waba_id,
          display_phone_number = EXCLUDED.display_phone_number,
          updated_at = EXCLUDED.updated_at
      `,
        [connId, wabaId, config.meta.phoneNumberId, displayPhone, config.meta.utilityTemplateName, now]
      );

      // Link any channel that currently has no waba_connection_id to the platform connection
      await client.query(
        `UPDATE channels SET waba_connection_id = $1 WHERE waba_connection_id IS NULL`,
        [connId]
      );

      // If CS phone is configured, ensure default channel and default agent exist
      if (config.meta.csPhone) {
        await client.query(
          `
          INSERT INTO channels (
            channel_id, tenant_id, name, business_name, cs_phone,
            waba_connection_id, status, created_at
          )
          VALUES ('chn_default', 'tnt_default', 'General Support', $1, $2, $3, 'active', $4)
          ON CONFLICT (channel_id) DO UPDATE SET
            waba_connection_id = COALESCE(channels.waba_connection_id, EXCLUDED.waba_connection_id)
        `,
          [config.businessName, config.meta.csPhone, connId, now]
        );

        await client.query(
          `
          INSERT INTO channel_agents (
            agent_id, channel_id, tenant_id, name, wa_phone,
            is_active, verified_at, consent_at, created_at
          )
          VALUES ('agt_default', 'chn_default', 'tnt_default', 'CS Support', $1, true, $2, $2, $2)
          ON CONFLICT (channel_id, wa_phone) DO UPDATE SET
            is_active = true,
            verified_at = COALESCE(channel_agents.verified_at, EXCLUDED.verified_at)
        `,
          [config.meta.csPhone, now]
        );
      }
    }

    console.log('[Migrator] ✅ Platform connection & internal tenant seed verified.');
  }
}

