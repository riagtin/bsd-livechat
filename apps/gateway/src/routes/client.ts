// SPDX-License-Identifier: AGPL-3.0-only
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  InitSessionRequest,
  InitSessionResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '@bintangstudio/livechat-sdk';
import { channelRegistry } from '../channel/registry.js';
import { messageDebouncer } from '../debounce/debouncer.js';
import { realtimeHub } from '../realtime/sse.js';
import { sessionStore } from '../session/store.js';
import {
  generateSessionId,
  createSessionToken,
  verifySessionToken,
} from '../session/token.js';

export const clientRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * Initialize or restore a visitor session bound to a specific channel
   */
  fastify.post<{ Body: InitSessionRequest }>('/session', {
    config: {
      rateLimit: {
        max: 15,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const {
      channel_id,
      client_id,
      existing_session_id,
      page_url,
      referrer,
      user_agent,
      visitor_name,
    } = req.body;

    if (!client_id && !existing_session_id) {
      return reply.status(400).send({ error: 'Missing client_id or existing_session_id' });
    }

    const targetChannelId = channel_id || 'default';
    const channel = channelRegistry.getChannel(targetChannelId);

    if (!channel) {
      return reply.status(404).send({ error: `Channel '${targetChannelId}' not found.` });
    }

    if (channel.status !== 'active') {
      return reply.status(403).send({ error: `Channel '${targetChannelId}' is currently suspended.` });
    }

    // Validate domain origin security for this specific channel
    const origin = req.headers.origin as string | undefined;
    if (origin && !channelRegistry.isDomainAllowedForChannel(channel.channelId, origin)) {
      return reply.status(403).send({
        error: `Origin '${origin}' is not authorized for channel '${channel.channelId}'.`,
      });
    }

    // H2: Use existing session ID if active in store; otherwise generate fresh CSPRNG session ID
    let sessionId: string;
    let isRestored = false;

    if (existing_session_id && sessionStore.get(existing_session_id)) {
      sessionId = existing_session_id;
      isRestored = true;
    } else {
      sessionId = generateSessionId();
    }

    const session = await sessionStore.getOrCreate(
      sessionId,
      client_id || sessionId,
      channel.channelId,
      page_url || '/',
      referrer,
      user_agent || (req.headers['user-agent'] as string),
      visitor_name
    );

    // H2: Sign session token with HMAC-SHA256
    const sessionToken = createSessionToken(session.sessionId, channel.channelId);

    const response: InitSessionResponse = {
      session_id: session.sessionId,
      session_token: sessionToken,
      channel_id: session.channelId,
      status: isRestored ? 'restored' : 'connected',
      business_name: channel.businessName,
      welcome_message: channel.welcomeMessage,
      history: session.messages,
    };

    return reply.send(response);
  });

  /**
   * Real-time Server-Sent Events (SSE) Stream
   * Protected with session_token (H2)
   */
  fastify.get<{ Querystring: { session_id: string; token?: string } }>('/stream', async (req, reply) => {
    const { session_id: sessionId, token } = req.query;

    if (!sessionId) {
      return reply.status(400).send({ error: 'Missing session_id parameter.' });
    }

    // H2: Verify session token for SSE stream
    const verified = verifySessionToken(token);
    if (!verified || verified.sid !== sessionId) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid or expired stream token.' });
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found or expired.' });
    }

    // Validate origin for this channel
    const origin = req.headers.origin as string | undefined;
    if (origin && !channelRegistry.isDomainAllowedForChannel(session.channelId, origin)) {
      return reply.status(403).send({ error: `Origin '${origin}' is not authorized for channel '${session.channelId}'.` });
    }

    realtimeHub.register(req, reply);
  });

  /**
   * Send a message from web visitor -> Queued into debouncer -> Forwarded to CS WhatsApp of the channel
   * Protected with session_token (H2)
   */
  fastify.post<{ Body: SendMessageRequest }>('/message', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const { session_id: sessionId, text, local_id, session_token: bodyToken } = req.body;

    if (!sessionId || !text || !text.trim()) {
      return reply.status(400).send({ error: 'Missing session_id or message text' });
    }

    // H2: Verify session token from header (X-Session-Token) or body (session_token)
    const headerToken = req.headers['x-session-token'] as string | undefined;
    const token = headerToken || bodyToken;
    const verified = verifySessionToken(token);

    if (!verified || verified.sid !== sessionId) {
      return reply.status(401).send({ error: 'Unauthorized: Invalid or expired session token.' });
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Session not found or expired' });
    }

    // Validate domain origin security for this specific channel
    const origin = req.headers.origin as string | undefined;
    if (origin && !channelRegistry.isDomainAllowedForChannel(session.channelId, origin)) {
      return reply.status(403).send({
        error: `Origin '${origin}' is not authorized for channel '${session.channelId}'.`,
      });
    }

    const cleanText = text.trim();
    const localId =
      local_id || `msg_local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Add to session history
    await sessionStore.addVisitorMessage(sessionId, localId, cleanText);

    // 2. Enqueue into debouncer with channelId
    messageDebouncer.enqueue(
      sessionId,
      session.channelId,
      localId,
      cleanText,
      session.visitorName,
      session.pageUrl
    );

    const response: SendMessageResponse = {
      message_id: localId,
      status: 'queued_debouncing',
      timestamp: Date.now(),
    };

    return reply.send(response);
  });
};
