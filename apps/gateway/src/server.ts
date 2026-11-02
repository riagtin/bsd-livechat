// SPDX-License-Identifier: AGPL-3.0-only
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { config, validateConfig } from './config/index.js';
import { channelRegistry } from './channel/registry.js';
import { initDatabase } from './database/index.js';
import { channelRoutes } from './routes/channel.js';
import { clientRoutes } from './routes/client.js';
import { internalRoutes } from './routes/internal.js';
import { webhookRoutes } from './routes/webhook.js';
import { observabilityService } from './monitoring/observability.js';

export async function buildServer() {
  // G8 Fail-Fast: Validate mandatory configuration variables before startup
  validateConfig();

  const server = Fastify({
    logger: {
      level: config.isDev ? 'info' : 'warn',
    },
  });

  // Enable raw body capture for webhook HMAC signature verification
  server.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      try {
        (req as unknown as { rawBody?: Buffer }).rawBody = body;
        const json = JSON.parse(body.toString('utf-8'));
        done(null, json);
      } catch (err: unknown) {
        done(err instanceof Error ? err : new Error(String(err)), undefined);
      }
    }
  );

  // Register CORS
  await server.register(fastifyCors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) return cb(null, true);

      if (config.allowedDomains.includes('*')) {
        return cb(null, true);
      }

      const isAllowed = config.allowedDomains.some((domain) => {
        return origin === domain || origin.endsWith(`.${domain}`);
      });

      if (isAllowed) {
        cb(null, true);
      } else {
        cb(new Error(`CORS error: Origin ${origin} is not allowed.`), false);
      }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  });

  // Register Global Rate Limiting
  await server.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Health check endpoint (silent logging to prevent Docker probe noise)
  server.get('/health', { logLevel: 'silent' }, async () => {
    return observabilityService.getDetailedHealth();
  });

  // Prometheus Metrics endpoint for container monitoring
  server.get('/metrics', { logLevel: 'silent' }, async (req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return observabilityService.getPrometheusMetrics();
  });

  server.get('/', async () => {
    return {
      service: 'BSD LiveChat Gateway',
      version: '2.0.0',
      license: 'AGPL-3.0-only',
      brand: 'Bintang Studio',
      source: 'https://github.com/bintangstudio/livechat',
      docs: 'https://bintangstudio.tech/docs',
    };
  });

  // Register Route Plugins
  await server.register(clientRoutes, { prefix: '/api/v1/client' });
  await server.register(webhookRoutes, { prefix: '/api/v1/webhook' });
  await server.register(channelRoutes, { prefix: '/api/v1/channels' });
  await server.register(internalRoutes, { prefix: '/api/v1/internal' });

  return server;
}

async function start() {
  // 1. Initialize Database Driver (PostgreSQL with auto-fallback to Memory)
  await initDatabase();

  // 2. Initialize Channel Registry & cache
  await channelRegistry.init();

  const server = await buildServer();

  try {
    const address = await server.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`\n=============================================================`);
    console.log(`🚀 BSD LiveChat Gateway running at: ${address}`);
    console.log(`📱 Target CS WhatsApp Phone: ${config.meta.csPhone || 'NOT CONFIGURED'}`);
    console.log(`🔒 Allowed CORS Domains: ${config.allowedDomains.join(', ')}`);
    console.log(`⚡ Real-time Stream: ${address}/api/v1/client/stream`);
    console.log(`☁️ Meta Webhook: ${address}/api/v1/webhook/meta`);
    console.log(`=============================================================\n`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Start the server
start();

