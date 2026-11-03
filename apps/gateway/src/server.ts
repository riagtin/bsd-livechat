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
import { getWidgetScript } from './assets/widgetScript.js';

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

      let reqHost = '';
      try {
        reqHost = new URL(origin).hostname.toLowerCase();
      } catch {
        reqHost = origin.toLowerCase().replace(/^https?:\/\//, '').split(':')[0];
      }

      // Selalu izinkan local development (localhost & 127.0.0.1)
      if (reqHost === 'localhost' || reqHost === '127.0.0.1') {
        return cb(null, true);
      }

      // 1. Cek domain statis dari config (.env)
      const isConfigAllowed = config.allowedDomains.some((rawDomain) => {
        const domain = rawDomain.toLowerCase().replace(/^https?:\/\//, '').split(':')[0].trim();
        return reqHost === domain || reqHost.endsWith(`.${domain}`);
      });

      if (isConfigAllowed) {
        return cb(null, true);
      }

      // 2. Cek domain dinamis dari saluran-saluran aktif yang terdaftar di console
      const isChannelAllowed = channelRegistry.isOriginAllowedAnywhere(origin);
      if (isChannelAllowed) {
        return cb(null, true);
      }

      // Sync dari database jika domain baru saja ditambahkan di console
      channelRegistry
        .syncFromDatabase(true)
        .then(() => {
          if (channelRegistry.isOriginAllowedAnywhere(origin)) {
            cb(null, true);
          } else {
            cb(new Error(`CORS error: Origin ${origin} is not allowed.`), false);
          }
        })
        .catch(() => {
          cb(new Error(`CORS error: Origin ${origin} is not allowed.`), false);
        });
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
      source: 'https://github.com/riagtin/bsd-livechat',
      docs: 'https://bintangstudio.tech/docs',
    };
  });

  // CDN Endpoint: Serves the client chat widget bundle directly from Gateway
  server.get('/widget.js', async (req, reply) => {
    try {
      const script = getWidgetScript();
      reply.header('Content-Type', 'application/javascript; charset=utf-8');
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      return reply.send(script);
    } catch (err: any) {
      server.log.error(err, '[WidgetCDN] Failed to load widget script');
      return reply.status(500).send({ error: 'Widget bundle temporarily unavailable.' });
    }
  });

  // Silent 204 for widget source map to prevent browser devtools 404 noise
  server.get('/widget.js.map', { logLevel: 'silent' }, async (req, reply) => {
    return reply.status(204).send();
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
    console.log(`☁️ Meta Relay Sender Phone: ${config.meta.displayPhoneNumber || 'NOT CONFIGURED'}`);
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

