// SPDX-License-Identifier: AGPL-3.0-only
import { Channel, ChatMessage, Tenant, VisitorSession } from '@bintangstudio/livechat-sdk';

export interface ITenantRepository {
  get(tenantId: string): Promise<Tenant | undefined>;
  save(tenant: Tenant): Promise<Tenant>;
  list(): Promise<Tenant[]>;
}

export interface IChannelRepository {
  get(channelId: string): Promise<Channel | undefined>;
  getByCsPhone(csPhone: string): Promise<Channel[]>;
  save(channel: Channel): Promise<Channel>;
  list(): Promise<Channel[]>;
}

export interface ISessionRepository {
  get(sessionId: string): Promise<VisitorSession | undefined>;
  save(session: VisitorSession): Promise<VisitorSession>;
  delete(sessionId: string): Promise<void>;
  getActiveByChannels(channelIds: string[], thresholdMs: number): Promise<VisitorSession[]>;
  cleanupExpired(ttlMs: number): Promise<number>;
}

export interface IMessageRepository {
  add(message: ChatMessage): Promise<ChatMessage>;
  getBySession(sessionId: string): Promise<ChatMessage[]>;
  linkWamidToLocals(wamid: string, sessionId: string, localIds: string[]): Promise<void>;
  markWamidAsRead(wamid: string): Promise<{ sessionId: string; markedLocalIds: string[] } | undefined>;
  getSessionIdByWamid(wamid: string): Promise<string | undefined>;
}

export interface IDatabase {
  tenants: ITenantRepository;
  channels: IChannelRepository;
  sessions: ISessionRepository;
  messages: IMessageRepository;
  init(): Promise<void>;
  close(): Promise<void>;
}
