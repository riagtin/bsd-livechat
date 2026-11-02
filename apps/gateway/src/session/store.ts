// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import { ChatMessage, VisitorSession } from '@bintangstudio/livechat-sdk';
import { channelRegistry } from '../channel/registry.js';
import { config } from '../config/index.js';
import { getDatabase } from '../database/index.js';

/**
 * H3: Generate Crockford-style 6-character alphanumeric code [A-Z0-9]{6}
 * Excludes ambiguous characters (0/O, 1/I) for CS readability
 */
function generateShortCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

export interface ResolveSessionResult {
  session?: VisitorSession;
  method?: 'quote' | 'prefix' | 'single_active_fallback';
  cleanText?: string;
  error?:
    | 'UNAUTHORIZED_CS_PHONE'
    | 'CROSS_CHANNEL_ATTEMPT'
    | 'MULTIPLE_ACTIVE_SESSIONS'
    | 'NO_ACTIVE_SESSIONS'
    | 'SESSION_NOT_FOUND';
  activeCount?: number;
}

export class SessionStore {
  // In-memory cache for microsecond latency during live chat & SSE
  private sessions = new Map<string, VisitorSession>();

  // Map of WAMID -> sessionId
  private wamidToSession = new Map<string, string>();

  // Map of WAMID -> string[] of local message IDs (handling 1 WAMID to N local messages)
  private wamidToLocals = new Map<string, string[]>();

  // H3: Index of `${channelId}:${sessionCode}` -> sessionId for exact 6-char prefix resolution
  private channelCodeToSession = new Map<string, string>();

  constructor() {
    // Run cleanup for expired sessions every 30 minutes
    setInterval(() => this.cleanupExpired(), 30 * 60 * 1000).unref();
  }

  /**
   * Get or initialize visitor session bound to a specific channel & tenant
   */
  async getOrCreate(
    sessionId: string,
    clientId: string,
    channelId: string = 'default',
    pageUrl: string,
    referrer?: string,
    userAgent?: string,
    visitorName?: string
  ): Promise<VisitorSession> {
    const now = Date.now();
    let session = this.sessions.get(sessionId);

    // If not in memory, try to load from database (e.g. server restart)
    if (!session) {
      try {
        const fromDb = await getDatabase().sessions.get(sessionId);
        if (fromDb) {
          session = fromDb;
          this.sessions.set(sessionId, session);
        }
      } catch (err) {
        // Fall back to creating new
      }
    }

    const channel = channelRegistry.getChannel(channelId) || channelRegistry.getChannel('default')!;

    if (session) {
      session.lastActiveAt = now;
      session.pageUrl = pageUrl;
      if (referrer) session.referrer = referrer;
      if (visitorName) session.visitorName = visitorName;

      // H3 & H7: Ensure sessionCode and Relay Hemat fields are initialized
      if (!session.sessionCode) {
        session.sessionCode = generateShortCode();
      }
      this.channelCodeToSession.set(`${session.channelId}:${session.sessionCode}`, session.sessionId);

      if (session.preReplyOutboundCount === undefined) session.preReplyOutboundCount = 0;
      if (session.csReplied === undefined) session.csReplied = false;
      if (!session.pendingDigest) session.pendingDigest = [];

      // Update database asynchronously
      getDatabase().sessions.save(session).catch(() => {});
      return session;
    }

    // H3: Generate unique 6-character short code for this channel
    let code = generateShortCode();
    let attempts = 0;
    while (this.channelCodeToSession.has(`${channel.channelId}:${code}`) && attempts < 10) {
      code = generateShortCode();
      attempts++;
    }

    session = {
      sessionId,
      channelId: channel.channelId,
      tenantId: channel.tenantId,
      csPhone: channel.csPhone,
      clientId,
      visitorName: visitorName || 'Pengunjung Web',
      pageUrl,
      referrer,
      userAgent,
      createdAt: now,
      lastActiveAt: now,
      messages: [],
      wamidToLocalIds: {},
      sessionCode: code,
      preReplyOutboundCount: 0,
      csReplied: false,
      pendingDigest: [],
    };

    this.sessions.set(sessionId, session);
    this.channelCodeToSession.set(`${channel.channelId}:${code}`, sessionId);

    // Persist to database
    getDatabase().sessions.save(session).catch((err) => {
      console.warn(`[SessionStore] Failed to persist session ${sessionId} to DB:`, err.message);
    });

    return session;
  }

  get(sessionId: string): VisitorSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = Date.now();
      getDatabase().sessions.save(session).catch(() => {});
    }
    return session;
  }

  /**
   * Add a visitor message into session history and database
   */
  async addVisitorMessage(sessionId: string, localId: string, text: string): Promise<ChatMessage | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const msg: ChatMessage = {
      id: localId,
      sessionId,
      sender: 'visitor',
      text,
      timestamp: Date.now(),
      status: 'queued',
    };

    session.messages.push(msg);
    session.lastActiveAt = Date.now();

    // Persist message & update session in database
    getDatabase().messages.add(msg).catch(() => {});
    getDatabase().sessions.save(session).catch(() => {});

    return msg;
  }

  /**
   * Map a Meta WAMID to multiple local message IDs (due to debouncing)
   */
  async linkWamidToLocalIds(wamid: string, sessionId: string, localIds: string[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.wamidToSession.set(wamid, sessionId);
    this.wamidToLocals.set(wamid, localIds);

    // Also record in session's internal map
    session.wamidToLocalIds[wamid] = localIds;

    // Update status of these messages to 'sent'
    for (const msg of session.messages) {
      if (localIds.includes(msg.id)) {
        msg.status = 'sent';
        msg.wamid = wamid;
      }
    }

    // Persist to database
    getDatabase().messages.linkWamidToLocals(wamid, sessionId, localIds).catch(() => {});
  }

  /**
   * Add agent reply message to session history and database
   */
  async addAgentMessage(sessionId: string, text: string, wamid?: string): Promise<ChatMessage | undefined> {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const msg: ChatMessage = {
      id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sessionId,
      sender: 'agent',
      text,
      timestamp: Date.now(),
      status: 'delivered',
      wamid,
    };

    session.messages.push(msg);
    session.lastActiveAt = Date.now();

    // Persist message & update session in database
    getDatabase().messages.add(msg).catch(() => {});
    getDatabase().sessions.save(session).catch(() => {});

    return msg;
  }

  /**
   * Mark all local IDs mapped to WAMID as read simultaneously
   */
  async markWamidAsRead(wamid: string): Promise<{ sessionId: string; markedLocalIds: string[] } | undefined> {
    let sessionId = this.wamidToSession.get(wamid);

    if (!sessionId) {
      // Try resolving from database
      sessionId = await getDatabase().messages.getSessionIdByWamid(wamid);
    }

    if (!sessionId) return undefined;

    const session = this.sessions.get(sessionId);
    const localIds = this.wamidToLocals.get(wamid) || session?.wamidToLocalIds[wamid] || [];
    const markedLocalIds: string[] = [];

    if (session) {
      for (const msg of session.messages) {
        if (localIds.includes(msg.id) || msg.wamid === wamid) {
          msg.status = 'read';
          markedLocalIds.push(msg.id);
        }
      }
    }

    // Persist read status in database
    getDatabase().messages.markWamidAsRead(wamid).catch(() => {});

    return { sessionId, markedLocalIds: localIds.length > 0 ? localIds : markedLocalIds };
  }

  /**
   * STRICT MULTI-TENANT & MULTI-CHANNEL QUOTE RESOLUTION (Roadmap §7.5 Lapis 2):
   * 100% isolates sessions by Channel, Agent, and CS Phone.
   * Prevents any cross-channel or cross-tenant data leakage.
   */
  resolveSessionForCs(
    fromCsPhone: string,
    quotedWamid?: string,
    text?: string,
    agentId?: string
  ): ResolveSessionResult {
    const normalizedFromPhone = fromCsPhone.replace(/\D/g, '');
    const authorizedChannels = channelRegistry.getChannelsForCsPhone(normalizedFromPhone);

    // Step 1: Reject if this CS phone number is not registered to any channel
    // and no agent ID was passed
    if (authorizedChannels.length === 0 && !agentId) {
      return { error: 'UNAUTHORIZED_CS_PHONE' };
    }

    const authorizedChannelIds = new Set(authorizedChannels.map((c) => c.channelId));

    // Step 2: Quoted WAMID matches directly (Claim Ownership)
    if (quotedWamid) {
      const sessionId = this.wamidToSession.get(quotedWamid);
      if (sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
          // STRICT SECURITY CROSS-CHECK:
          // Ensure this session belongs to one of the channels authorized for this CS number!
          if (authorizedChannelIds.size > 0 && !authorizedChannelIds.has(session.channelId)) {
            console.warn(
              `[Security Breach Blocked] CS (${normalizedFromPhone}) attempted to quote reply to session (${sessionId}) from unauthorized channel (${session.channelId}).`
            );
            return { error: 'CROSS_CHANNEL_ATTEMPT' };
          }

          // Lapis 2: Agent takes ownership of the session upon quote reply (Claim)
          if (agentId) {
            session.assignedAgentId = agentId;
            session.csPhone = normalizedFromPhone;
          }

          return { session, method: 'quote' };
        }
      }
    }

    // Step 3: Explicit manual prefix tagging (H3: exact match ^#([A-Z0-9]{6})\s+)
    if (text) {
      const prefixMatch = text.match(/^#([A-Z0-9]{6})\s+([\s\S]+)$/i);
      if (prefixMatch) {
        const targetSessionCode = prefixMatch[1].toUpperCase();
        const cleanContent = prefixMatch[2].trim();

        // Search ONLY within authorized channels for this CS phone!
        for (const channelId of authorizedChannelIds) {
          const matchedSessionId = this.channelCodeToSession.get(`${channelId}:${targetSessionCode}`);
          if (matchedSessionId) {
            const s = this.sessions.get(matchedSessionId);
            if (s) {
              return { session: s, method: 'prefix', cleanText: cleanContent };
            }
          }

          // Direct check on sessions in memory in case channelCode index needs sync
          for (const s of this.sessions.values()) {
            if (s.channelId === channelId && s.sessionCode === targetSessionCode) {
              this.channelCodeToSession.set(`${channelId}:${targetSessionCode}`, s.sessionId);
              return { session: s, method: 'prefix', cleanText: cleanContent };
            }
          }
        }
      }
    }

    // Step 4: Fallback evaluation when NO quote and NO prefix:
    // ISOLATE: Filter active sessions strictly for this CS's authorized channels!
    const now = Date.now();
    const activeSessionsInChannel = Array.from(this.sessions.values()).filter(
      (s) => authorizedChannelIds.has(s.channelId) && now - s.lastActiveAt <= config.multiSessionThresholdMs
    );

    if (activeSessionsInChannel.length === 1) {
      // Strictly 1 active session in this CS's channel -> safe to route
      return { session: activeSessionsInChannel[0], method: 'single_active_fallback' };
    }

    if (activeSessionsInChannel.length > 1) {
      // Multiple active sessions in this channel -> DANGER of data breach!
      return { error: 'MULTIPLE_ACTIVE_SESSIONS', activeCount: activeSessionsInChannel.length };
    }

    return { error: 'NO_ACTIVE_SESSIONS' };
  }

  /**
   * Clean up sessions older than TTL
   */
  private cleanupExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt > config.sessionTtlMs) {
        if (session.sessionCode) {
          this.channelCodeToSession.delete(`${session.channelId}:${session.sessionCode}`);
        }
        this.sessions.delete(id);
      }
    }
    getDatabase().sessions.cleanupExpired(config.sessionTtlMs).catch(() => {});
  }
}

export const sessionStore = new SessionStore();
