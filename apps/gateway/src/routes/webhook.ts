// SPDX-License-Identifier: AGPL-3.0-only
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { MetaWebhookPayload, verifyMetaSignature } from '@bintangstudio/livechat-sdk';
import { channelRegistry } from '../channel/registry.js';
import { config } from '../config/index.js';
import { metaClient } from '../meta/client.js';
import { wabaManager } from '../meta/connection.js';
import { realtimeHub } from '../realtime/sse.js';
import { agentRouter } from '../routing/router.js';
import { sessionStore } from '../session/store.js';
import { getUsageGate } from '../usage/index.js';

export const webhookRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * Meta Webhook Verification (Challenge)
   */
  fastify.get<{
    Querystring: {
      'hub.mode'?: string;
      'hub.challenge'?: string;
      'hub.verify_token'?: string;
    };
  }>('/meta', async (req, reply) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Support both Relay verify token and Tech Provider override verify token
    const isTokenValid =
      token === config.meta.verifyToken ||
      (config.meta.tpOverrideVerifyToken && token === config.meta.tpOverrideVerifyToken);

    if (mode === 'subscribe' && isTokenValid) {
      console.log('[Webhook] Meta verification challenge accepted successfully.');
      return reply.status(200).send(challenge);
    }

    console.warn('[Webhook] Meta verification failed: Invalid verify token or mode.');
    return reply.status(403).send({ error: 'Verification failed' });
  });

  /**
   * Meta Webhook Event Receiver (Messages & Status Updates)
   * Enforces 4-Layer Isolation (Roadmap §7.5)
   */
  fastify.post('/meta', async (req, reply) => {
    const rawBodyBuf = (req as unknown as { rawBody?: Buffer }).rawBody;
    const rawBody = rawBodyBuf ? rawBodyBuf.toString('utf-8') : JSON.stringify(req.body);
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    const payload = req.body as MetaWebhookPayload;
    if (payload.object !== 'whatsapp_business_account') {
      return reply.status(200).send({ status: 'IGNORED_NON_WABA' });
    }

    // Extract recipient phone number ID from payload to resolve connection
    const firstChange = payload.entry?.[0]?.changes?.[0]?.value;
    const phoneNumberId = firstChange?.metadata?.phone_number_id;

    // Resolve WABA Connection
    const conn = phoneNumberId ? await wabaManager.getByPhoneNumberId(phoneNumberId) : undefined;

    // =========================================================================
    // Lapis 0 — Keaslian Multi-App HMAC (Roadmap §7.5)
    // =========================================================================
    let secret = config.meta.appSecret;
    let alternateSecret: string | undefined = undefined;

    if (conn?.metaAppKey === 'tech_provider') {
      secret = config.meta.tpAppSecret;
      alternateSecret = config.meta.tpAppSecretPrevious || undefined;
    }

    if (secret) {
      let isValid = verifyMetaSignature(rawBody, signature, secret);
      if (!isValid && alternateSecret) {
        isValid = verifyMetaSignature(rawBody, signature, alternateSecret);
      }

      if (!isValid) {
        console.warn(
          `[Webhook] [Lapis 0] Invalid HMAC-SHA256 signature for app key '${conn?.metaAppKey || 'relay'}'.`
        );
        return reply.status(401).send({ error: 'Invalid signature' });
      }
    }

    const connectionId = conn?.connectionId || 'conn_platform_default';

    try {
      const entries = payload.entry || [];
      for (const entry of entries) {
        const changes = entry.changes || [];
        for (const change of changes) {
          const val = change.value;
          if (!val) continue;

          // Process Status Updates (Delivery, Read, Failed)
          if (val.statuses && val.statuses.length > 0) {
            for (const status of val.statuses) {
              const wamid = status.id;
              const statusName = status.status;
              const errorCode = status.errors?.[0]?.code;

              // Update outbound message status in ledger
              await getUsageGate().updateOutboundStatus(wamid, statusName, wamid, errorCode);

              // Auto-refund credit on 'failed' delivery (Roadmap §5.4)
              if (statusName === 'failed') {
                console.warn(`[Webhook] Outbound message ${wamid} failed delivery. Triggering automatic refund...`);
                await getUsageGate().refundFailedOutbound(wamid);
              }

              // Read receipts handling
              if (statusName === 'read') {
                const result = await sessionStore.markWamidAsRead(wamid);
                if (result) {
                  console.log(
                    `[Webhook] CS read WAMID ${wamid}. Marking ${result.markedLocalIds.length} messages read in session ${result.sessionId}.`
                  );
                  realtimeHub.emitAgentRead(result.sessionId, wamid, result.markedLocalIds);
                }
              }
            }
          }

          // Process Incoming Messages (CS replying from WhatsApp or verification handshake)
          if (val.messages && val.messages.length > 0) {
            for (const msg of val.messages) {
              if (msg.type !== 'text' || !msg.text?.body) continue;

              // =========================================================================
              // Lapis 1 — Koneksi, Normalisasi Pengirim, & Handshake (Roadmap §7.5)
              // =========================================================================
              let csPhone = msg.from.replace(/\D/g, '');
              if (csPhone.startsWith('0')) {
                csPhone = '62' + csPhone.slice(1);
              }

              const csText = msg.text.body.trim();
              const quotedWamid = msg.context?.id;

              // H6: Log only metadata, never log chat message text in production logs
              console.log(
                `[Webhook] Inbound WhatsApp message from ${csPhone} [len: ${csText.length}, quoted: ${quotedWamid || 'NONE'}]`
              );

              // Handshake check: VERIFIKASI <KODE> or VERIFY <KODE>
              const verifyMatch = csText.match(/^(?:VERIFIKASI|VERIFY)\s+([A-Z0-9]+)$/i);
              if (verifyMatch) {
                const code = verifyMatch[1];
                const verifiedAgent = await agentRouter.verifyAgentByCode(csPhone, code);
                if (verifiedAgent) {
                  console.log(
                    `[Webhook] [Lapis 1 Handshake] Agent ${verifiedAgent.name} (${csPhone}) successfully verified!`
                  );
                  await metaClient.sendFreeFormText(
                    csPhone,
                    `✅ *Verifikasi Berhasil!*\n\nNomor WhatsApp Anda telah aktif sebagai agen customer service Bintang Studio.`
                  );
                  // Lapis 3: Inbound window opened
                  await agentRouter.recordInboundWindow(connectionId, csPhone);
                  continue;
                }
              }

              // Sender validation: must be an active, verified agent
              const agent = await agentRouter.findAgentByPhone(csPhone);
              const legacyChannels = channelRegistry.getChannelsForCsPhone(csPhone);

              if (!agent && legacyChannels.length === 0) {
                // H5: Silent drop for unregistered sender
                console.warn(
                  `[Webhook] [Lapis 1 Silent Drop] Unregistered phone (${csPhone}) sent WhatsApp message. Dropping silently.`
                );
                continue;
              }

              // =========================================================================
              // Lapis 2 — Resolusi Sesi Terlingkup & Claim (Roadmap §7.5)
              // =========================================================================
              const resolveResult = sessionStore.resolveSessionForCs(
                csPhone,
                quotedWamid,
                csText,
                agent?.agentId
              );

              if (resolveResult.error === 'UNAUTHORIZED_CS_PHONE') {
                console.warn(`[Webhook] Unauthorized phone (${csPhone}) blocked silently.`);
                continue;
              }

              if (resolveResult.error === 'CROSS_CHANNEL_ATTEMPT') {
                console.warn(`[Webhook] CROSS-CHANNEL ATTEMPT BLOCKED for CS (${csPhone})!`);
                await metaClient.sendCsAlert(
                  csPhone,
                  `🚫 *AKSES DITOLAK DEMI KEAMANAN DATA!*\nAnda mencoba membalas sesi obrolan milik channel/toko yang berbeda.`
                );
                continue;
              }

              if (resolveResult.error === 'MULTIPLE_ACTIVE_SESSIONS') {
                console.warn(
                  `[Webhook] DANGER BLOCKED: CS (${csPhone}) replied without quote during ${resolveResult.activeCount} active sessions in channel.`
                );
                await metaClient.sendCsAlert(
                  csPhone,
                  `⚠️ *PESAN GAGAL DITERUSKAN KE WEB!*\n\n` +
                    `Saat ini terdapat *${resolveResult.activeCount} pengunjung aktif* di channel Anda.\n` +
                    `Sistem menolak meneruskan pesan tanpa identitas penerima demi mencegah kebocoran data antar-pengunjung.\n\n` +
                    `👉 *Solusi:* Mohon *Quote Reply* pada pesan pengunjung yang ingin Anda balas, atau awali pesan dengan kode sesi (contoh: *#A7F9BC Halo...*).`
                );
                continue;
              }

              if (resolveResult.error === 'NO_ACTIVE_SESSIONS') {
                console.warn(`[Webhook] CS (${csPhone}) replied but no active visitor session was found.`);
                await metaClient.sendCsAlert(
                  csPhone,
                  `⚠️ *Pesan tidak dapat diteruskan.*\nTidak ditemukan sesi pengunjung aktif di channel Anda saat ini. Sesi mungkin telah berakhir.`
                );
                continue;
              }

              if (resolveResult.session) {
                const targetSession = resolveResult.session;
                const replyText = resolveResult.cleanText || csText;

                // =========================================================================
                // Lapis 3 — Jendela 24 Jam Terbuka (Roadmap §7.5)
                // =========================================================================
                await agentRouter.recordInboundWindow(connectionId, csPhone);

                // Relay Hemat: Mark that CS has replied to this session
                targetSession.csReplied = true;
                targetSession.preReplyOutboundCount = 0;
                targetSession.relayState = 'active';

                // Add to session history
                const agentMsg = await sessionStore.addAgentMessage(
                  targetSession.sessionId,
                  replyText,
                  msg.id
                );

                if (agentMsg) {
                  // Forward agent reply to web visitor via SSE
                  realtimeHub.emitMessage(targetSession.sessionId, agentMsg);
                  console.log(
                    `[Webhook] Successfully forwarded CS reply to session ${targetSession.sessionId} (Channel: ${targetSession.channelId}) via SSE.`
                  );
                }

                // Relay Hemat: Flush any buffered visitor messages held during pre-reply throttle
                if (targetSession.pendingDigest && targetSession.pendingDigest.length > 0) {
                  const buffered = [...targetSession.pendingDigest];
                  targetSession.pendingDigest = [];
                  const bufferedText = buffered.map((m) => m.text).join('\n');
                  const bufferedLocalIds = buffered.map((m) => m.localId);
                  const channel = channelRegistry.getChannel(targetSession.channelId);
                  const bizName = channel?.businessName || config.businessName;

                  console.log(
                    `[Webhook] [RelayHemat] CS replied! Flushing ${buffered.length} buffered messages as consolidated digest to CS.`
                  );

                  // Send single consolidated digest to CS (free-form message valid within active 24h window)
                  const shortCode =
                    targetSession.sessionCode || targetSession.sessionId.slice(-6).toUpperCase();
                  const digestResult = await metaClient.sendFreeFormText(
                    csPhone,
                    `*${bizName} - #${shortCode} (Pesan Pengunjung Lanjutan)*\n${bufferedText}`
                  );

                  if (digestResult.wamid) {
                    sessionStore.linkWamidToLocalIds(
                      digestResult.wamid,
                      targetSession.sessionId,
                      bufferedLocalIds
                    );
                  }
                }
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Webhook] Error processing Meta webhook payload:', msg);
    }

    // Always acknowledge 200 OK to Meta
    return reply.status(200).send({ status: 'EVENT_RECEIVED' });
  });
};
