// SPDX-License-Identifier: AGPL-3.0-only
import crypto from 'node:crypto';
import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { Channel } from '@bintangstudio/livechat-sdk';
import { channelRegistry } from '../channel/registry.js';
import { config } from '../config/index.js';
import { usageTracker } from '../usage/tracker.js';

export const channelRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  /**
   * Register or update a chat channel (Admin / Onboarding endpoint)
   * Protected with ADMIN_API_TOKEN (H1)
   */
  fastify.post<{ Body: Partial<Channel> & { channelId: string; csPhone: string; businessName: string } }>(
    '/',
    async (req, reply) => {
      // H1: Constant-time authentication with ADMIN_API_TOKEN
      const authHeader = req.headers.authorization;
      const adminHeader = req.headers['x-admin-token'] as string | undefined;
      let providedToken = adminHeader;
      if (!providedToken && authHeader && authHeader.startsWith('Bearer ')) {
        providedToken = authHeader.slice(7).trim();
      }

      if (!config.adminApiToken) {
        console.error('[Channel] ADMIN_API_TOKEN is not configured on server.');
        return reply.status(500).send({
          error: 'Server security configuration error: ADMIN_API_TOKEN not configured.',
        });
      }

      if (!providedToken) {
        return reply.status(401).send({
          error: 'Unauthorized: Missing administrative authorization token.',
        });
      }

      const providedBuf = Buffer.from(providedToken, 'utf8');
      const expectedBuf = Buffer.from(config.adminApiToken, 'utf8');
      if (
        providedBuf.length !== expectedBuf.length ||
        !crypto.timingSafeEqual(providedBuf, expectedBuf)
      ) {
        return reply.status(401).send({
          error: 'Unauthorized: Invalid administrative authorization token.',
        });
      }

      const { channelId, tenantId, name, businessName, csPhone, allowedDomains, welcomeMessage } = req.body;

      if (!channelId || !csPhone || !businessName) {
        return reply.status(400).send({
          error: 'Missing required fields: channelId, csPhone, and businessName are required.',
        });
      }

      const channel: Channel = {
        channelId,
        tenantId: tenantId || `tnt_${channelId}`,
        name: name || businessName,
        businessName,
        csPhone: csPhone.replace(/\D/g, ''),
        allowedDomains: allowedDomains || ['*'],
        welcomeMessage,
        status: 'active',
        createdAt: Date.now(),
      };

      channelRegistry.registerChannel(channel);

      return reply.send({
        status: 'success',
        message: `Channel '${channel.channelId}' successfully registered.`,
        channel,
      });
    }
  );

  /**
   * Get public channel metadata
   */
  fastify.get<{ Params: { channelId: string } }>('/:channelId', async (req, reply) => {
    const { channelId } = req.params;
    const channel = channelRegistry.getChannel(channelId);

    if (!channel) {
      return reply.status(404).send({ error: 'Channel not found' });
    }

    // Return safe public details (exclude raw csPhone for privacy if needed)
    return reply.send({
      channelId: channel.channelId,
      name: channel.name,
      businessName: channel.businessName,
      welcomeMessage: channel.welcomeMessage,
      status: channel.status,
    });
  });

  /**
   * Get monthly Meta WhatsApp Cloud API usage statistics (H8 monitoring)
   */
  fastify.get('/admin/usage', async (req, reply) => {
    const authHeader = req.headers.authorization;
    const adminHeader = req.headers['x-admin-token'] as string | undefined;
    let providedToken = adminHeader;
    if (!providedToken && authHeader && authHeader.startsWith('Bearer ')) {
      providedToken = authHeader.slice(7).trim();
    }

    if (!config.adminApiToken || !providedToken) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const providedBuf = Buffer.from(providedToken, 'utf8');
    const expectedBuf = Buffer.from(config.adminApiToken, 'utf8');
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    return reply.send({
      status: 'success',
      usage: usageTracker.getStats(),
    });
  });
};
