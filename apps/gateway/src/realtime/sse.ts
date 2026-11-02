// SPDX-License-Identifier: AGPL-3.0-only
import { ServerResponse } from 'node:http';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ChatMessage, SSEAgentReadEvent } from '@bintangstudio/livechat-sdk';
import { config } from '../config/index.js';
import { sessionStore } from '../session/store.js';

interface SSEClient {
  sessionId: string;
  reply: FastifyReply;
  rawRes: ServerResponse;
  keepAliveTimer: NodeJS.Timeout;
}

export class RealtimeHub {
  // Map of sessionId -> Set<SSEClient> (supports multiple tabs open by same visitor)
  private clients = new Map<string, Set<SSEClient>>();

  /**
   * Register a new SSE connection for a session
   */
  register(
    req: FastifyRequest<{ Querystring: { session_id: string } }>,
    reply: FastifyReply
  ): void {
    const { session_id: sessionId } = req.query;

    if (!sessionId) {
      reply.status(400).send({ error: 'Missing session_id query parameter' });
      return;
    }

    const session = sessionStore.get(sessionId);
    if (!session) {
      reply.status(404).send({ error: 'Session not found or expired' });
      return;
    }

    // Set CORS headers explicitly on raw response before flushing headers
    const reqOrigin = (req.headers.origin as string) || '*';
    reply.raw.setHeader('Access-Control-Allow-Origin', reqOrigin);
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
    reply.raw.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID');
    reply.raw.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    // Set standard SSE response headers
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering (NGINX)
    reply.raw.flushHeaders();

    // Critical Requirement #3:
    // Heartbeat / Keep-Alive every 25 seconds to prevent Cloudflare/NGINX from closing idle connections
    const keepAliveTimer = setInterval(() => {
      try {
        reply.raw.write(': keepalive\n\n');
      } catch (err) {
        clearInterval(keepAliveTimer);
      }
    }, config.keepAliveIntervalMs);

    const client: SSEClient = {
      sessionId,
      reply,
      rawRes: reply.raw,
      keepAliveTimer,
    };

    if (!this.clients.has(sessionId)) {
      this.clients.set(sessionId, new Set());
    }
    this.clients.get(sessionId)!.add(client);

    console.log(`[SSE] Client connected for session: ${sessionId}`);

    // Send initial connected event
    this.sendToClient(client, 'connected', {
      session_id: sessionId,
      status: 'connected',
      timestamp: Date.now(),
    });

    // Handle Last-Event-ID reconnection replay
    const lastEventId = (req.headers['last-event-id'] as string) || '';
    if (lastEventId && session.messages.length > 0) {
      const lastIndex = session.messages.findIndex((m) => m.id === lastEventId);
      if (lastIndex !== -1 && lastIndex < session.messages.length - 1) {
        const missedMessages = session.messages.slice(lastIndex + 1);
        for (const msg of missedMessages) {
          if (msg.sender === 'agent') {
            this.sendToClient(client, 'message', { message: msg }, msg.id);
          }
        }
      }
    }

    // Cleanup on disconnect
    req.raw.on('close', () => {
      clearInterval(keepAliveTimer);
      const set = this.clients.get(sessionId);
      if (set) {
        set.delete(client);
        if (set.size === 0) {
          this.clients.delete(sessionId);
        }
      }
      console.log(`[SSE] Client disconnected for session: ${sessionId}`);
    });
  }

  /**
   * Broadcast a new agent message to all active tabs of a visitor session
   */
  emitMessage(sessionId: string, message: ChatMessage): void {
    this.broadcast(sessionId, 'message', { message }, message.id);
  }

  /**
   * Returns current active SSE connection count across all sessions
   */
  getConnectionCount(): number {
    let total = 0;
    for (const set of this.clients.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Returns total number of active sessions with at least one open SSE stream
   */
  getActiveSessionsCount(): number {
    return this.clients.size;
  }

  /**
   * Critical Requirement #1:
   * Broadcast agent_read event containing all local message IDs marked as read.
   */
  emitAgentRead(sessionId: string, wamid: string, messageIds: string[]): void {
    const payload: SSEAgentReadEvent = {
      wamid,
      message_ids: messageIds,
      timestamp: Date.now(),
    };
    this.broadcast(sessionId, 'agent_read', payload);
  }

  /**
   * Broadcast arbitrary event to all connected clients of a session
   */
  private broadcast(sessionId: string, event: string, data: any, eventId?: string): void {
    const set = this.clients.get(sessionId);
    if (!set || set.size === 0) return;

    for (const client of set) {
      this.sendToClient(client, event, data, eventId);
    }
  }

  private sendToClient(client: SSEClient, event: string, data: any, eventId?: string): void {
    try {
      let chunk = '';
      if (eventId) {
        chunk += `id: ${eventId}\n`;
      }
      chunk += `event: ${event}\n`;
      chunk += `data: ${JSON.stringify(data)}\n\n`;
      client.rawRes.write(chunk);
    } catch (err) {
      console.error(`[SSE] Failed writing to client in session ${client.sessionId}:`, err);
    }
  }
}

export const realtimeHub = new RealtimeHub();
