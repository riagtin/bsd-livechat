// SPDX-License-Identifier: AGPL-3.0-only
export const POSTGRES_SCHEMA = `
-- 1. Tenants Table (Organisasi / Klien SaaS)
CREATE TABLE IF NOT EXISTS tenants (
    tenant_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(32) DEFAULT 'active',
    created_at BIGINT NOT NULL
);

-- 2. Channels Table (Saluran Chat & Nomor CS)
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

-- 3. Visitor Sessions Table
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

-- 4. Messages Table
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

-- 5. WAMID to Local IDs Mapping Table (For 1 WAMID to Multiple Local IDs from debouncer)
CREATE TABLE IF NOT EXISTS wamid_mappings (
    wamid VARCHAR(128) PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    local_ids TEXT[] NOT NULL,
    created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wamid_session ON wamid_mappings(session_id);
`;
