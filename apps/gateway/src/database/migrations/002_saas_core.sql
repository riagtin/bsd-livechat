-- SPDX-License-Identifier: AGPL-3.0-only
-- Migration: 002_saas_core.sql
-- SaaS Core Multi-Tenant, WABA Connections, Multi-CS Routing, Credit & Ledger

-- =====================================================================
-- A. AKUN MERCHANT & AUTENTIKASI
-- =====================================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_tier VARCHAR(16) NOT NULL DEFAULT 'starter';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_overrides JSONB;              -- Khusus Enterprise
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(16) NOT NULL DEFAULT 'pending_payment';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_start BIGINT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS current_period_end BIGINT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_until BIGINT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pending_plan_tier VARCHAR(16);     -- Downgrade terjadwal
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_started_at BIGINT;           -- D12: diisi saat handshake uji coba berhasil
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at BIGINT;              -- trial_started_at + 7 hari

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
    password_hash TEXT NOT NULL,                     -- argon2id
    role VARCHAR(16) NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'admin')),
    email_verified_at BIGINT,
    last_login_at BIGINT,
    created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_merchant_users_email ON merchant_users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_merchant_users_tenant ON merchant_users (tenant_id);

CREATE TABLE IF NOT EXISTS merchant_refresh_tokens (
    token_hash CHAR(64) PRIMARY KEY,                 -- SHA-256 dari token opaque
    family_id VARCHAR(64) NOT NULL,                  -- Deteksi reuse: cabut seluruh keluarga
    user_id VARCHAR(64) NOT NULL REFERENCES merchant_users(user_id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL,
    revoked_at BIGINT,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_refresh_family ON merchant_refresh_tokens (family_id);

-- Klaim uji coba Starter (D12): sidik jari HMAC, tanpa menyimpan PII mentah.
CREATE TABLE IF NOT EXISTS trial_claims (
    claim_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) REFERENCES tenants(tenant_id) ON DELETE SET NULL,
    email_fp CHAR(64) NOT NULL,                      -- HMAC-SHA256(TRIAL_FINGERPRINT_SECRET, email ternormalisasi)
    wa_phone_fp CHAR(64),                            -- HMAC nomor agen 628xxx; diisi saat handshake
    domain_fp CHAR(64) NOT NULL,                     -- HMAC eTLD+1 domain website
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'granted', 'converted', 'expired', 'rejected')),
    created_at BIGINT NOT NULL,
    granted_at BIGINT,
    purge_after BIGINT NOT NULL                      -- created_at + 12 bulan
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_email ON trial_claims (email_fp)
    WHERE status IN ('granted', 'converted', 'expired');
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_domain ON trial_claims (domain_fp)
    WHERE status IN ('granted', 'converted', 'expired');
CREATE UNIQUE INDEX IF NOT EXISTS uq_trial_phone ON trial_claims (wa_phone_fp)
    WHERE wa_phone_fp IS NOT NULL AND status IN ('granted', 'converted', 'expired');

-- =====================================================================
-- B. KONEKSI WABA (SHARED RELAY & BYO-WABA)
-- =====================================================================
CREATE TABLE IF NOT EXISTS waba_connections (
    connection_id VARCHAR(64) PRIMARY KEY,
    owner_type VARCHAR(16) NOT NULL CHECK (owner_type IN ('platform', 'tenant')),
    meta_app_key VARCHAR(16) NOT NULL CHECK (meta_app_key IN ('relay', 'tech_provider')),  -- D11: penentu App Secret HMAC
    tenant_id VARCHAR(64) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    waba_id VARCHAR(64) NOT NULL,
    phone_number_id VARCHAR(64) NOT NULL UNIQUE,
    display_phone_number VARCHAR(32) NOT NULL,
    access_token_enc TEXT,                           -- AES-256-GCM; NULL = token platform dari env
    token_key_version SMALLINT NOT NULL DEFAULT 1,
    template_name VARCHAR(128) NOT NULL DEFAULT 'livechat_ticket_alert',
    template_status VARCHAR(16) NOT NULL DEFAULT 'PENDING',  -- PENDING | APPROVED | REJECTED
    quality_rating VARCHAR(16) NOT NULL DEFAULT 'GREEN',     -- GREEN | YELLOW | RED
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

-- Pemakaian bulanan per nomor (guard kuota 1.000 service message gratis)
CREATE TABLE IF NOT EXISTS waba_connection_usage (
    connection_id VARCHAR(64) NOT NULL REFERENCES waba_connections(connection_id) ON DELETE CASCADE,
    period_ym VARCHAR(7) NOT NULL,                   -- 'YYYY-MM'
    service_sent INT NOT NULL DEFAULT 0,
    template_sent INT NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, period_ym)
);

-- =====================================================================
-- C. CHANNEL, AGEN, & JENDELA 24 JAM
-- =====================================================================
ALTER TABLE channels ALTER COLUMN cs_phone DROP NOT NULL;     -- Channel multi-agen
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
ALTER TABLE channels ADD COLUMN IF NOT EXISTS updated_at BIGINT;
CREATE INDEX IF NOT EXISTS idx_channels_connection ON channels (waba_connection_id);

CREATE TABLE IF NOT EXISTS channel_agents (
    agent_id VARCHAR(64) PRIMARY KEY,
    channel_id VARCHAR(64) NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    name VARCHAR(128) NOT NULL,
    wa_phone VARCHAR(32) NOT NULL,                   -- Format 628xxx tanpa '+'
    is_active BOOLEAN NOT NULL DEFAULT true,         -- Toggle shift on/off
    verification_code VARCHAR(16) UNIQUE,
    verification_expires_at BIGINT,
    verified_at BIGINT,                              -- NULL = belum terverifikasi
    consent_at BIGINT,                               -- Bukti opt-in (pesan inbound pertama)
    opted_out_at BIGINT,
    last_assigned_at BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    CONSTRAINT uq_channel_agent_phone UNIQUE (channel_id, wa_phone)
);
CREATE INDEX IF NOT EXISTS idx_agents_routing ON channel_agents (channel_id, is_active, last_assigned_at)
    WHERE verified_at IS NOT NULL AND opted_out_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agents_phone ON channel_agents (wa_phone);

-- Jendela 24 jam terikat pada pasangan (koneksi, nomor CS)
CREATE TABLE IF NOT EXISTS wa_windows (
    connection_id VARCHAR(64) NOT NULL REFERENCES waba_connections(connection_id) ON DELETE CASCADE,
    wa_phone VARCHAR(32) NOT NULL,
    last_inbound_at BIGINT NOT NULL DEFAULT 0,       -- Epoch ms
    window_expires_at BIGINT NOT NULL DEFAULT 0,     -- Epoch ms
    keepalive_sent_at BIGINT NOT NULL DEFAULT 0,     -- Epoch ms
    PRIMARY KEY (connection_id, wa_phone)
);
CREATE INDEX IF NOT EXISTS idx_wa_windows_expiry ON wa_windows (window_expires_at);

-- =====================================================================
-- D. SESI, RELAY HEMAT, & PESAN KELUAR
-- =====================================================================
ALTER TABLE chat_sessions ALTER COLUMN cs_phone DROP NOT NULL;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS assigned_agent_id VARCHAR(64)
    REFERENCES channel_agents(agent_id) ON DELETE SET NULL;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS short_code VARCHAR(8);
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS relay_state VARCHAR(16) NOT NULL DEFAULT 'idle';  -- idle | notified | active | offline
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS pre_reply_outbound SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS notified_at BIGINT;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS visitor_contact VARCHAR(255);  -- Mode Offline
CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_channel_code ON chat_sessions (channel_id, short_code)
    WHERE short_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_agent_active ON chat_sessions (assigned_agent_id, last_active_at);

-- Ledger pesan keluar: dasar pemotongan kredit, refund, dan observabilitas biaya
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
    status VARCHAR(16) NOT NULL DEFAULT 'accepted',  -- accepted | sent | delivered | read | failed
    credit_charged BOOLEAN NOT NULL DEFAULT false,
    error_code INT,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outbound_tenant_time ON outbound_messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbound_connection_time ON outbound_messages (connection_id, created_at DESC);

-- =====================================================================
-- E. KREDIT, BILLING, & PEMAKAIAN (MODUL CLOUD)
-- =====================================================================
CREATE TABLE IF NOT EXISTS tenant_credit_balances (
    tenant_id VARCHAR(64) PRIMARY KEY REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    bundle_balance INT NOT NULL DEFAULT 0 CHECK (bundle_balance >= 0),   -- Hangus di akhir periode
    topup_balance INT NOT NULL DEFAULT 0 CHECK (topup_balance >= 0),
    topup_expires_at BIGINT NOT NULL DEFAULT 0,                          -- 12 bulan sejak top-up terakhir
    low_balance_notified_at BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_credit_transactions (
    transaction_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    bucket VARCHAR(8) NOT NULL CHECK (bucket IN ('bundle', 'topup')),
    amount_credits INT NOT NULL,                     -- Positif = masuk, negatif = pemakaian/hangus
    amount_idr NUMERIC(12, 2) NOT NULL DEFAULT 0,
    type VARCHAR(32) NOT NULL CHECK (type IN (
        'topup_xendit', 'bundle_grant', 'bundle_expire', 'topup_expire',
        'trial_grant', 'trial_expire',
        'usage_message', 'refund_failed', 'upgrade_conversion', 'manual_adjust')),
    external_ref VARCHAR(128) UNIQUE,                -- Idempotensi: 'xendit:<invoice_id>', 'out:<outbound_id>', 'refund:<outbound_id>'
    balance_after INT NOT NULL,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_tenant ON tenant_credit_transactions (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS billing_events (
    event_id VARCHAR(128) PRIMARY KEY,               -- Kunci idempotensi dari BSDWeb
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL CHECK (kind IN ('subscription_paid', 'topup_paid', 'refund')),
    payload JSONB NOT NULL,
    processed_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_usage_stats (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    period_start BIGINT NOT NULL,                    -- Mengikuti tanggal tagih (anniversary)
    web_sessions INT NOT NULL DEFAULT 0,
    outbound_service INT NOT NULL DEFAULT 0,
    outbound_template INT NOT NULL DEFAULT 0,
    credits_used INT NOT NULL DEFAULT 0,
    offline_captures INT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (tenant_id, period_start)
);

-- =====================================================================
-- F. AUDIT LOG
-- =====================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id VARCHAR(64) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    actor_user_id VARCHAR(64) REFERENCES merchant_users(user_id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    metadata JSONB,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs (tenant_id, created_at DESC);

