// SPDX-License-Identifier: AGPL-3.0-only
import pg from 'pg';
import { Channel, ChatMessage, Tenant, VisitorSession } from '@bintangstudio/livechat-sdk';
import { config } from '../config/index.js';
import { DatabaseMigrator } from './migrator.js';
import { agentRouter } from '../routing/router.js';
import { wabaManager } from '../meta/connection.js';
import { initUsageGate } from '../usage/index.js';
import { MaintenanceScheduler } from '../jobs/scheduler.js';
import {
  IChannelRepository,
  IDatabase,
  IMessageRepository,
  ISessionRepository,
  ITenantRepository,
} from './types.js';

const { Pool } = pg;

export class PostgresDatabase implements IDatabase {
  private pool: pg.Pool;

  tenants: ITenantRepository;
  channels: IChannelRepository;
  sessions: ISessionRepository;
  messages: IMessageRepository;

  constructor() {
    this.pool = new Pool({
      connectionString: config.db.url,
      max: config.db.maxConnections, // Respect connection budgeting
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.tenants = new PostgresTenantRepository(this.pool);
    this.channels = new PostgresChannelRepository(this.pool);
    this.sessions = new PostgresSessionRepository(this.pool);
    this.messages = new PostgresMessageRepository(this.pool);
  }

  getPool(): pg.Pool {
    return this.pool;
  }

  async init(): Promise<void> {
    try {
      console.log(`[Database] Connecting to PostgreSQL at: ${config.db.url.replace(/:[^:@]+@/, ':***@')}`);
      const migrator = new DatabaseMigrator(this.pool);
      await migrator.runMigrations();

      // Initialize pool references in modular services
      agentRouter.setPool(this.pool);
      wabaManager.setPool(this.pool);
      initUsageGate(this.pool);

      // Start background maintenance scheduler
      const scheduler = new MaintenanceScheduler(this.pool);
      scheduler.start();

      console.log('[Database] PostgreSQL schema migration and initialization completed successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Database] Failed to initialize PostgreSQL database:', msg);
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PostgresTenantRepository implements ITenantRepository {
  constructor(private pool: pg.Pool) {}

  async get(tenantId: string): Promise<Tenant | undefined> {
    const res = await this.pool.query('SELECT * FROM tenants WHERE tenant_id = $1', [tenantId]);
    if (res.rows.length === 0) return undefined;
    const r = res.rows[0];
    return {
      tenantId: r.tenant_id,
      name: r.name,
      status: r.status,
      createdAt: Number(r.created_at),
    };
  }

  async save(tenant: Tenant): Promise<Tenant> {
    const q = `
      INSERT INTO tenants (tenant_id, name, status, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id) DO UPDATE SET
        name = EXCLUDED.name,
        status = EXCLUDED.status
    `;
    await this.pool.query(q, [tenant.tenantId, tenant.name, tenant.status, tenant.createdAt]);
    return tenant;
  }

  async list(): Promise<Tenant[]> {
    const res = await this.pool.query('SELECT * FROM tenants ORDER BY created_at DESC');
    return res.rows.map((r) => ({
      tenantId: r.tenant_id,
      name: r.name,
      status: r.status,
      createdAt: Number(r.created_at),
    }));
  }
}

class PostgresChannelRepository implements IChannelRepository {
  constructor(private pool: pg.Pool) {}

  async get(channelId: string): Promise<Channel | undefined> {
    const res = await this.pool.query('SELECT * FROM channels WHERE channel_id = $1', [channelId]);
    if (res.rows.length === 0) return undefined;
    return this.mapRow(res.rows[0]);
  }

  async getByCsPhone(csPhone: string): Promise<Channel[]> {
    const normPhone = csPhone.replace(/\D/g, '');
    const res = await this.pool.query(
      'SELECT * FROM channels WHERE cs_phone = $1 AND status = $2',
      [normPhone, 'active']
    );
    return res.rows.map((r) => this.mapRow(r));
  }

  async save(channel: Channel): Promise<Channel> {
    const q = `
      INSERT INTO channels (channel_id, tenant_id, name, business_name, cs_phone, allowed_domains, welcome_message, status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (channel_id) DO UPDATE SET
        name = EXCLUDED.name,
        business_name = EXCLUDED.business_name,
        cs_phone = EXCLUDED.cs_phone,
        allowed_domains = EXCLUDED.allowed_domains,
        welcome_message = EXCLUDED.welcome_message,
        status = EXCLUDED.status
    `;
    const normPhone = (channel.csPhone || '').replace(/\D/g, '');
    await this.pool.query(q, [
      channel.channelId,
      channel.tenantId,
      channel.name,
      channel.businessName,
      normPhone,
      channel.allowedDomains || ['*'],
      channel.welcomeMessage || null,
      channel.status,
      channel.createdAt,
    ]);
    return channel;
  }

  async list(): Promise<Channel[]> {
    const res = await this.pool.query('SELECT * FROM channels ORDER BY created_at DESC');
    return res.rows.map((r) => this.mapRow(r));
  }

  private mapRow(r: Record<string, unknown>): Channel {
    return {
      channelId: String(r.channel_id),
      tenantId: String(r.tenant_id),
      name: String(r.name),
      businessName: String(r.business_name),
      csPhone: String(r.cs_phone || ''),
      allowedDomains: (r.allowed_domains as string[]) || ['*'],
      welcomeMessage: r.welcome_message ? String(r.welcome_message) : undefined,
      status: (r.status as 'active' | 'suspended') || 'active',
      createdAt: Number(r.created_at),
    };
  }
}

class PostgresSessionRepository implements ISessionRepository {
  constructor(private pool: pg.Pool) {}

  async get(sessionId: string): Promise<VisitorSession | undefined> {
    const res = await this.pool.query('SELECT * FROM chat_sessions WHERE session_id = $1', [sessionId]);
    if (res.rows.length === 0) return undefined;
    const r = res.rows[0];

    // Fetch messages for this session
    const msgRes = await this.pool.query(
      'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY timestamp ASC',
      [sessionId]
    );

    const messages: ChatMessage[] = msgRes.rows.map((m) => ({
      id: m.id,
      sessionId: m.session_id,
      sender: m.sender,
      text: m.text,
      wamid: m.wamid || undefined,
      status: m.status,
      timestamp: Number(m.timestamp),
    }));

    return {
      sessionId: r.session_id,
      channelId: r.channel_id,
      tenantId: r.tenant_id,
      csPhone: r.cs_phone,
      clientId: r.client_id,
      visitorName: r.visitor_name,
      pageUrl: r.page_url,
      referrer: r.referrer || undefined,
      userAgent: r.user_agent || undefined,
      createdAt: Number(r.created_at),
      lastActiveAt: Number(r.last_active_at),
      messages,
      wamidToLocalIds: {},
    };
  }

  async save(session: VisitorSession): Promise<VisitorSession> {
    const q = `
      INSERT INTO chat_sessions (session_id, channel_id, tenant_id, cs_phone, client_id, visitor_name, page_url, referrer, user_agent, created_at, last_active_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (session_id) DO UPDATE SET
        page_url = EXCLUDED.page_url,
        referrer = EXCLUDED.referrer,
        visitor_name = EXCLUDED.visitor_name,
        last_active_at = EXCLUDED.last_active_at
    `;
    await this.pool.query(q, [
      session.sessionId,
      session.channelId,
      session.tenantId,
      session.csPhone,
      session.clientId,
      session.visitorName,
      session.pageUrl,
      session.referrer || null,
      session.userAgent || null,
      session.createdAt,
      session.lastActiveAt,
    ]);
    return session;
  }

  async delete(sessionId: string): Promise<void> {
    await this.pool.query('DELETE FROM chat_sessions WHERE session_id = $1', [sessionId]);
  }

  async getActiveByChannels(channelIds: string[], thresholdMs: number): Promise<VisitorSession[]> {
    if (channelIds.length === 0) return [];
    const minTime = Date.now() - thresholdMs;

    const res = await this.pool.query(
      'SELECT * FROM chat_sessions WHERE channel_id = ANY($1) AND last_active_at >= $2',
      [channelIds, minTime]
    );

    return res.rows.map((r) => ({
      sessionId: r.session_id,
      channelId: r.channel_id,
      tenantId: r.tenant_id,
      csPhone: r.cs_phone,
      clientId: r.client_id,
      visitorName: r.visitor_name,
      pageUrl: r.page_url,
      referrer: r.referrer || undefined,
      userAgent: r.user_agent || undefined,
      createdAt: Number(r.created_at),
      lastActiveAt: Number(r.last_active_at),
      messages: [],
      wamidToLocalIds: {},
    }));
  }

  async cleanupExpired(ttlMs: number): Promise<number> {
    const minTime = Date.now() - ttlMs;
    const res = await this.pool.query('DELETE FROM chat_sessions WHERE last_active_at < $1', [minTime]);
    return res.rowCount || 0;
  }
}

class PostgresMessageRepository implements IMessageRepository {
  constructor(private pool: pg.Pool) {}

  async add(message: ChatMessage): Promise<ChatMessage> {
    const q = `
      INSERT INTO chat_messages (id, session_id, sender, text, wamid, status, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        wamid = EXCLUDED.wamid
    `;
    await this.pool.query(q, [
      message.id,
      message.sessionId,
      message.sender,
      message.text,
      message.wamid || null,
      message.status,
      message.timestamp,
    ]);
    return message;
  }

  async getBySession(sessionId: string): Promise<ChatMessage[]> {
    const res = await this.pool.query(
      'SELECT * FROM chat_messages WHERE session_id = $1 ORDER BY timestamp ASC',
      [sessionId]
    );
    return res.rows.map((m) => ({
      id: m.id,
      sessionId: m.session_id,
      sender: m.sender,
      text: m.text,
      wamid: m.wamid || undefined,
      status: m.status,
      timestamp: Number(m.timestamp),
    }));
  }

  async linkWamidToLocals(wamid: string, sessionId: string, localIds: string[]): Promise<void> {
    const now = Date.now();
    // 1. Record mapping
    await this.pool.query(
      `INSERT INTO wamid_mappings (wamid, session_id, local_ids, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (wamid) DO UPDATE SET local_ids = $3`,
      [wamid, sessionId, localIds, now]
    );

    // 2. Update status of local messages in chat_messages
    if (localIds.length > 0) {
      await this.pool.query(
        `UPDATE chat_messages
         SET status = 'sent', wamid = $1
         WHERE id = ANY($2)`,
        [wamid, localIds]
      );
    }
  }

  async markWamidAsRead(wamid: string): Promise<{ sessionId: string; markedLocalIds: string[] } | undefined> {
    // 1. Get mapped local IDs and session
    const mapRes = await this.pool.query('SELECT session_id, local_ids FROM wamid_mappings WHERE wamid = $1', [wamid]);
    if (mapRes.rows.length === 0) return undefined;

    const sessionId = mapRes.rows[0].session_id;
    const localIds: string[] = mapRes.rows[0].local_ids || [];

    // 2. Mark messages read
    await this.pool.query(
      `UPDATE chat_messages
       SET status = 'read'
       WHERE wamid = $1 OR id = ANY($2)`,
      [wamid, localIds]
    );

    return { sessionId, markedLocalIds: localIds };
  }

  async getSessionIdByWamid(wamid: string): Promise<string | undefined> {
    const res = await this.pool.query('SELECT session_id FROM wamid_mappings WHERE wamid = $1', [wamid]);
    if (res.rows.length === 0) return undefined;
    return res.rows[0].session_id;
  }
}
