// SPDX-License-Identifier: AGPL-3.0-only
import dotenv from 'dotenv';
import path from 'node:path';

// Load .env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3100', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  
  businessName: process.env.BUSINESS_NAME || 'Bintang Studio Support',

  // Administrative & Security Tokens (H1, H2)
  adminApiToken: process.env.ADMIN_API_TOKEN || '',
  sessionSigningSecret: process.env.SESSION_SIGNING_SECRET || '',
  internalApiSecret: process.env.INTERNAL_API_SECRET || '',
  xenditSecretKey: process.env.XENDIT_SECRET_KEY || '',
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || '',
  trialFingerprintSecret: process.env.TRIAL_FINGERPRINT_SECRET || '',

  // Trial Starter Caps (D12 & Q10)
  trialDailyCap: parseInt(process.env.TRIAL_DAILY_CAP || '10', 10),
  trialMonthlyCap: parseInt(process.env.TRIAL_MONTHLY_CAP || '100', 10),

  // Relay Hemat Settings (H7)
  maxPreReplyOutbound: parseInt(process.env.MAX_PRE_REPLY_OUTBOUND || '2', 10),

  // Service Message Quota Monitoring (H8)
  serviceMonthlyQuota: parseInt(process.env.SERVICE_MONTHLY_QUOTA || '1000', 10),
  serviceMonthlyWarningThreshold: parseInt(process.env.SERVICE_MONTHLY_WARNING_THRESHOLD || '900', 10),

  // Allowed origins for CORS
  allowedDomains: (process.env.ALLOWED_DOMAINS || '*')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean),

  // Meta WhatsApp Cloud API credentials (G8 Fail-fast: no default secrets in source code)
  meta: {
    apiVersion: process.env.META_API_VERSION || 'v22.0',
    wabaId: process.env.META_WABA_ID || '',
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
    displayPhoneNumber: process.env.META_DISPLAY_PHONE || '6285121140886',
    accessToken: process.env.META_ACCESS_TOKEN || '',
    appSecret: process.env.META_APP_SECRET || '',
    verifyToken: process.env.META_VERIFY_TOKEN || '',
    csPhone: (process.env.CS_WHATSAPP_PHONE || '').replace(/\D/g, ''),
    utilityTemplateName: process.env.META_UTILITY_TEMPLATE_NAME || 'livechat_ticket_alert',
    templateLanguage: process.env.META_TEMPLATE_LANGUAGE || 'id',
    planningCostIdr: parseInt(process.env.META_PLANNING_COST_IDR || '425', 10),

    // Tech Provider App (D11a - Shared with WABA Hub for BYO-WABA)
    tpAppId: process.env.META_TP_APP_ID || '',
    tpAppSecret: process.env.META_TP_APP_SECRET || '',
    tpAppSecretPrevious: process.env.META_TP_APP_SECRET_PREVIOUS || '',
    tpEsConfigId: process.env.META_TP_ES_CONFIG_ID || '',
    tpOverrideVerifyToken: process.env.META_TP_OVERRIDE_VERIFY_TOKEN || '',
  },

  // Database Configuration (Dual-Driver: memory | postgres)
  db: {
    driver: (process.env.DB_DRIVER || (process.env.DATABASE_URL ? 'postgres' : 'memory')).toLowerCase() as 'memory' | 'postgres',
    url: process.env.DATABASE_URL || '',
    maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
  },

  // Timing constants
  debounceDelayMs: parseInt(process.env.DEBOUNCE_DELAY_MS || '2500', 10),
  sessionTtlMs: parseInt(process.env.SESSION_TTL_MS || '86400000', 10), // 24 hours
  keepAliveIntervalMs: 25000, // 25s for reverse proxy keep-alive
  multiSessionThresholdMs: 300000, // 5 minutes
};

/**
 * Fail-Fast Configuration Validation (Roadmap G8 & Rule §2A)
 * Validates that essential environment variables are properly configured on startup.
 */
export function validateConfig(): void {
  const missing: string[] = [];

  if (config.nodeEnv === 'production') {
    if (!config.meta.verifyToken) missing.push('META_VERIFY_TOKEN');
    if (!config.meta.appSecret) missing.push('META_APP_SECRET');
    if (!config.meta.accessToken) missing.push('META_ACCESS_TOKEN');
    if (!config.meta.phoneNumberId) missing.push('META_PHONE_NUMBER_ID');
    if (!config.adminApiToken) missing.push('ADMIN_API_TOKEN');
    if (!config.sessionSigningSecret) missing.push('SESSION_SIGNING_SECRET');
  }

  if (config.db.driver === 'postgres' && !config.db.url) {
    missing.push('DATABASE_URL');
  }

  if (missing.length > 0) {
    const errorMsg = `[Config] 🚨 CRITICAL FAIL-FAST: Missing mandatory environment variables: ${missing.join(', ')}. Server startup aborted.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}
