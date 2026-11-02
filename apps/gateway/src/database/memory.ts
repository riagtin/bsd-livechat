// SPDX-License-Identifier: AGPL-3.0-only
import { Channel, ChatMessage, Tenant, VisitorSession } from '@bintangstudio/livechat-sdk';
import {
  IChannelRepository,
  IDatabase,
  IMessageRepository,
  ISessionRepository,
  ITenantRepository,
} from './types.js';

export class MemoryTenantRepository implements ITenantRepository {
  private tenants = new Map<string, Tenant>();

  async get(tenantId: string): Promise<Tenant | undefined> {
    return this.tenants.get(tenantId);
  }

  async save(tenant: Tenant): Promise<Tenant> {
    this.tenants.set(tenant.tenantId, tenant);
    return tenant;
  }

  async list(): Promise<Tenant[]> {
    return Array.from(this.tenants.values());
  }
}

export class MemoryChannelRepository implements IChannelRepository {
  private channels = new Map<string, Channel>();

  async get(channelId: string): Promise<Channel | undefined> {
    return this.channels.get(channelId);
  }

  async getByCsPhone(csPhone: string): Promise<Channel[]> {
    const normPhone = csPhone.replace(/\D/g, '');
    const result: Channel[] = [];
    for (const ch of this.channels.values()) {
      if ((ch.csPhone || '').replace(/\D/g, '') === normPhone && ch.status === 'active') {
        result.push(ch);
      }
    }
    return result;
  }

  async save(channel: Channel): Promise<Channel> {
    this.channels.set(channel.channelId, channel);
    return channel;
  }

  async list(): Promise<Channel[]> {
    return Array.from(this.channels.values());
  }
}

export class MemorySessionRepository implements ISessionRepository {
  private sessions = new Map<string, VisitorSession>();

  async get(sessionId: string): Promise<VisitorSession | undefined> {
    const s = this.sessions.get(sessionId);
    if (s) s.lastActiveAt = Date.now();
    return s;
  }

  async save(session: VisitorSession): Promise<VisitorSession> {
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async getActiveByChannels(channelIds: string[], thresholdMs: number): Promise<VisitorSession[]> {
    const now = Date.now();
    const set = new Set(channelIds);
    return Array.from(this.sessions.values()).filter(
      (s) => set.has(s.channelId) && now - s.lastActiveAt <= thresholdMs
    );
  }

  async cleanupExpired(ttlMs: number): Promise<number> {
    const now = Date.now();
    let count = 0;
    for (const [id, s] of this.sessions.entries()) {
      if (now - s.lastActiveAt > ttlMs) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }
}

export class MemoryMessageRepository implements IMessageRepository {
  private messagesBySession = new Map<string, ChatMessage[]>();
  private wamidToSession = new Map<string, string>();
  private wamidToLocals = new Map<string, string[]>();

  async add(message: ChatMessage): Promise<ChatMessage> {
    let list = this.messagesBySession.get(message.sessionId);
    if (!list) {
      list = [];
      this.messagesBySession.set(message.sessionId, list);
    }
    list.push(message);
    if (message.wamid) {
      this.wamidToSession.set(message.wamid, message.sessionId);
    }
    return message;
  }

  async getBySession(sessionId: string): Promise<ChatMessage[]> {
    return this.messagesBySession.get(sessionId) || [];
  }

  async linkWamidToLocals(wamid: string, sessionId: string, localIds: string[]): Promise<void> {
    this.wamidToSession.set(wamid, sessionId);
    this.wamidToLocals.set(wamid, localIds);

    const msgs = this.messagesBySession.get(sessionId);
    if (msgs) {
      for (const m of msgs) {
        if (localIds.includes(m.id)) {
          m.status = 'sent';
          m.wamid = wamid;
        }
      }
    }
  }

  async markWamidAsRead(wamid: string): Promise<{ sessionId: string; markedLocalIds: string[] } | undefined> {
    const sessionId = this.wamidToSession.get(wamid);
    if (!sessionId) return undefined;

    const localIds = this.wamidToLocals.get(wamid) || [];
    const msgs = this.messagesBySession.get(sessionId);
    const markedLocalIds: string[] = [];

    if (msgs) {
      for (const m of msgs) {
        if (localIds.includes(m.id) || m.wamid === wamid) {
          m.status = 'read';
          markedLocalIds.push(m.id);
        }
      }
    }

    return { sessionId, markedLocalIds };
  }

  async getSessionIdByWamid(wamid: string): Promise<string | undefined> {
    return this.wamidToSession.get(wamid);
  }
}

export class MemoryDatabase implements IDatabase {
  tenants = new MemoryTenantRepository();
  channels = new MemoryChannelRepository();
  sessions = new MemorySessionRepository();
  messages = new MemoryMessageRepository();

  async init(): Promise<void> {
    console.log('[Database] Initialized in-memory database driver (Zero-Config / Dev Mode).');
  }

  async close(): Promise<void> {
    // No-op for in-memory
  }
}
