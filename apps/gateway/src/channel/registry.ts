// SPDX-License-Identifier: AGPL-3.0-only
import { Channel, Tenant } from '@bintangstudio/livechat-sdk';
import { config } from '../config/index.js';
import { getDatabase } from '../database/index.js';

export class ChannelRegistry {
  private tenants = new Map<string, Tenant>();
  private channels = new Map<string, Channel>();
  // Maps normalized CS Phone -> Set of Channel IDs for O(1) webhook lookup
  private csPhoneToChannels = new Map<string, Set<string>>();

  private isInitialized = false;

  async init(): Promise<void> {
    if (this.isInitialized) return;
    this.isInitialized = true;

    // 1. Ensure default tenant & channel from .env exist
    await this.initializeDefaultTenantAndChannel();

    // 2. Hydrate in-memory cache from Database
    try {
      const db = getDatabase();
      const dbTenants = await db.tenants.list();
      for (const t of dbTenants) {
        this.tenants.set(t.tenantId, t);
      }

      const dbChannels = await db.channels.list();
      for (const c of dbChannels) {
        this.indexChannelInMemory(c);
      }

      console.log(`[ChannelRegistry] Loaded ${this.tenants.size} tenants and ${this.channels.size} channels.`);
    } catch (err: any) {
      console.warn(`[ChannelRegistry] Error hydrating from database (${err.message}). Using memory defaults.`);
    }
  }

  private async initializeDefaultTenantAndChannel(): Promise<void> {
    const defaultTenant: Tenant = {
      tenantId: 'tnt_default',
      name: 'Default Organization',
      status: 'active',
      createdAt: Date.now(),
    };
    await this.registerTenant(defaultTenant);

    const defaultChannel: Channel = {
      channelId: 'default',
      tenantId: 'tnt_default',
      name: 'General Support',
      businessName: config.businessName,
      csPhone: config.meta.csPhone,
      allowedDomains: config.allowedDomains,
      status: 'active',
      welcomeMessage:
        'Halo! Selamat datang di layanan bantuan kami. Silakan tinggalkan pertanyaan Anda.',
      createdAt: Date.now(),
    };
    await this.registerChannel(defaultChannel);
  }

  async registerTenant(tenant: Partial<Tenant> & { tenantId: string; name: string }): Promise<Tenant> {
    const record: Tenant = {
      tenantId: tenant.tenantId,
      name: tenant.name,
      status: tenant.status || 'active',
      createdAt: tenant.createdAt || Date.now(),
    };

    this.tenants.set(record.tenantId, record);

    try {
      await getDatabase().tenants.save(record);
    } catch (err) {
      // Memory fallback handles this gracefully
    }

    return record;
  }

  async registerChannel(channel: Channel): Promise<Channel> {
    this.indexChannelInMemory(channel);

    try {
      await getDatabase().channels.save(channel);
    } catch (err) {
      // Memory fallback handles this gracefully
    }

    return channel;
  }

  private indexChannelInMemory(channel: Channel): void {
    this.channels.set(channel.channelId, channel);

    const normPhone = (channel.csPhone || '').replace(/\D/g, '');
    if (normPhone) {
      if (!this.csPhoneToChannels.has(normPhone)) {
        this.csPhoneToChannels.set(normPhone, new Set());
      }
      this.csPhoneToChannels.get(normPhone)!.add(channel.channelId);
    }
  }

  getChannel(channelId: string = 'default'): Channel | undefined {
    return this.channels.get(channelId);
  }

  getTenant(tenantId: string): Tenant | undefined {
    return this.tenants.get(tenantId);
  }

  /**
   * Find all active channels handled by a specific CS WhatsApp phone number
   */
  getChannelsForCsPhone(csPhone: string): Channel[] {
    const normPhone = csPhone.replace(/\D/g, '');
    const channelIds = this.csPhoneToChannels.get(normPhone);
    if (!channelIds || channelIds.size === 0) return [];

    const result: Channel[] = [];
    for (const cid of channelIds) {
      const ch = this.channels.get(cid);
      if (ch && ch.status === 'active') {
        result.push(ch);
      }
    }
    return result;
  }

  /**
   * Check if an HTTP origin is allowed for a specific channel
   */
  isDomainAllowedForChannel(channelId: string, origin?: string): boolean {
    if (!origin) return true; // Non-browser / mobile request

    const channel = this.channels.get(channelId);
    if (!channel) return false;

    // Check channel specific allowed domains
    const domains = channel.allowedDomains || config.allowedDomains;
    if (domains.includes('*')) return true;

    return domains.some((d) => origin === d || origin.endsWith(`.${d}`));
  }
}

export const channelRegistry = new ChannelRegistry();
