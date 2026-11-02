// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import { channelRegistry } from '../channel/registry.js';
import { config } from '../config/index.js';
import { metaClient } from '../meta/client.js';
import { wabaManager } from '../meta/connection.js';
import { agentRouter } from '../routing/router.js';
import { sessionStore } from '../session/store.js';
import { getUsageGate, OutboundCategory } from '../usage/index.js';

interface PendingMessage {
  localId: string;
  text: string;
  timestamp: number;
}

interface DebounceEntry {
  timer: NodeJS.Timeout;
  sessionId: string;
  channelId: string;
  visitorName: string;
  pageUrl: string;
  messages: PendingMessage[];
}

export class MessageDebouncer {
  private queue = new Map<string, DebounceEntry>();

  /**
   * Enqueue a visitor message for debouncing & batching.
   */
  enqueue(
    sessionId: string,
    channelId: string,
    localId: string,
    text: string,
    visitorName: string,
    pageUrl: string
  ): void {
    let entry = this.queue.get(sessionId);

    if (entry) {
      clearTimeout(entry.timer);
      entry.messages.push({ localId, text, timestamp: Date.now() });
      entry.visitorName = visitorName;
      entry.pageUrl = pageUrl;
      entry.channelId = channelId;
    } else {
      entry = {
        timer: null as unknown as NodeJS.Timeout,
        sessionId,
        channelId,
        visitorName,
        pageUrl,
        messages: [{ localId, text, timestamp: Date.now() }],
      };
      this.queue.set(sessionId, entry);
    }

    entry.timer = setTimeout(() => {
      this.flush(sessionId).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Debouncer] Error flushing session ${sessionId}: ${msg}`);
      });
    }, config.debounceDelayMs);
  }

  /**
   * Flush pending messages for a session, combine them, enforce Zero-Deficit Credit Gate,
   * Relay Hemat caps, and forward to channel's assigned CS WhatsApp.
   */
  async flush(sessionId: string): Promise<void> {
    const entry = this.queue.get(sessionId);
    if (!entry || entry.messages.length === 0) return;

    this.queue.delete(sessionId);

    const channel =
      channelRegistry.getChannel(entry.channelId) || channelRegistry.getChannel('default')!;
    const businessName = channel.businessName || config.businessName;
    const session = sessionStore.get(sessionId);

    // 1. Business Hours Evaluation (Roadmap §8.2)
    if (channel && !agentRouter.isWithinBusinessHours(channel)) {
      if (session) {
        session.relayState = 'offline';
      }
      console.log(
        `[Debouncer] Channel [${channel.channelId}] is outside business hours. Session ${sessionId} placed in Mode Offline (0 Meta calls).`
      );
      return;
    }

    // 2. Multi-CS Agent Resolution (Roadmap §8.1)
    let toPhone = '';
    let agentId: string | undefined = session?.assignedAgentId;

    if (agentId && session?.csPhone) {
      toPhone = session.csPhone.replace(/\D/g, '');
    }

    if (!toPhone) {
      const selectedAgent = await agentRouter.selectAgentForSession(
        channel.channelId,
        channel.wabaConnectionId
      );
      if (selectedAgent) {
        toPhone = selectedAgent.waPhone;
        agentId = selectedAgent.agentId;
        if (session) {
          session.assignedAgentId = selectedAgent.agentId;
          session.csPhone = selectedAgent.waPhone;
        }
      } else {
        // v1 compatibility fallback: use channel.csPhone
        toPhone = (channel.csPhone || config.meta.csPhone).replace(/\D/g, '');
      }
    }

    if (!toPhone) {
      if (session) session.relayState = 'offline';
      console.warn(
        `[Debouncer] No active agent or CS phone found for channel [${channel.channelId}]. Session placed in Mode Offline.`
      );
      return;
    }

    const localIds = entry.messages.map((m) => m.localId);
    const combinedText = entry.messages.map((m) => m.text).join('\n');

    // 3. Relay Hemat Anti-Drain Gate (Roadmap H7 & §6.1)
    const maxPreReply = channel.maxPreReplyOutbound || config.maxPreReplyOutbound || 2;
    if (session && !session.csReplied) {
      const currentCount = session.preReplyOutboundCount ?? 0;
      if (currentCount >= maxPreReply) {
        if (!session.pendingDigest) session.pendingDigest = [];
        session.pendingDigest.push(...entry.messages.map((m) => ({ localId: m.localId, text: m.text })));
        console.log(
          `[Debouncer] [RelayHemat] Session ${sessionId} reached max_pre_reply_outbound (${maxPreReply}). Buffering ${localIds.length} messages. 0 Meta API calls made.`
        );
        return;
      }
      session.preReplyOutboundCount = currentCount + 1;
    }

    // 4. Resolve WABA Connection Credentials (Roadmap §6)
    const connId = channel.wabaConnectionId || 'conn_platform_default';
    const conn = await wabaManager.getById(connId);
    const resolvedCreds = conn ? wabaManager.resolveCredentials(conn) : undefined;
    const isByo = conn?.ownerType === 'tenant';

    // 5. Zero-Deficit Credit Gate (Roadmap §4.3 & §9.3a)
    const outboundId = `out_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const usageGate = getUsageGate();
    const category: OutboundCategory = 'template';

    const deductResult = await usageGate.deductCredit(
      channel.tenantId,
      outboundId,
      connId,
      toPhone,
      'notify',
      category,
      sessionId,
      isByo
    );

    if (!deductResult.allowed) {
      console.warn(
        `[Debouncer] [Zero-Deficit Gate] Tenant ${channel.tenantId} has zero credits. Session ${sessionId} held in Mode Offline (0 Meta calls).`
      );
      if (session) {
        session.relayState = 'offline';
      }
      return;
    }

    console.log(
      `[Debouncer] Batching ${localIds.length} messages for session ${sessionId} to WhatsApp CS (${toPhone}) in channel [${channel.channelId}].`
    );

    // 6. Forward to WhatsApp with Auto-Fallback
    const result = await metaClient.notifyCsWithAutoFallback(
      toPhone,
      businessName,
      sessionId,
      entry.visitorName,
      entry.pageUrl,
      combinedText,
      session?.sessionCode,
      resolvedCreds
    );

    if (result.success && result.wamid) {
      sessionStore.linkWamidToLocalIds(result.wamid, sessionId, localIds);
      await usageGate.updateOutboundStatus(outboundId, 'sent', result.wamid);
      if (session) {
        session.relayState = 'notified';
        session.notifiedAt = Date.now();
      }
    } else {
      await usageGate.updateOutboundStatus(outboundId, 'failed', undefined, result.errorCode);
      // Automatically and idempotently refund credit on failure (Roadmap §5.4)
      await usageGate.refundFailedOutbound(outboundId);
    }
  }
}

export const messageDebouncer = new MessageDebouncer();
