// SPDX-License-Identifier: AGPL-3.0-only
import { config } from '../config/index.js';
import { usageTracker } from '../usage/tracker.js';
import { ResolvedWabaCredentials } from './connection.js';
import { observabilityService } from '../monitoring/observability.js';

export interface MetaSendResult {
  success: boolean;
  wamid?: string;
  is24hExpired?: boolean;
  errorCode?: number;
  errorMessage?: string;
  mode?: 'free_form' | 'utility_template';
  category?: 'service' | 'template';
}

export interface MetaCredentialsOverride {
  phoneNumberId?: string;
  accessToken?: string;
  templateName?: string;
}

interface MetaGraphResponse {
  messages?: Array<{ id: string }>;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: {
      details?: string;
    };
  };
}

export class MetaClient {
  private getBaseUrl(phoneNumberId?: string): string {
    const id = phoneNumberId || config.meta.phoneNumberId;
    return `https://graph.facebook.com/${config.meta.apiVersion}/${id}/messages`;
  }

  private getHeaders(accessToken?: string): Record<string, string> {
    const token = accessToken || config.meta.accessToken;
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Send free-form text message to WhatsApp recipient (CS or user within 24h window)
   */
  async sendFreeFormText(
    to: string,
    bodyText: string,
    credentials?: ResolvedWabaCredentials | MetaCredentialsOverride
  ): Promise<MetaSendResult> {
    const phoneId = credentials?.phoneNumberId || config.meta.phoneNumberId;
    const token = credentials?.accessToken || config.meta.accessToken;

    if (!phoneId || !token) {
      console.warn('[MetaClient] Missing META_PHONE_NUMBER_ID or META_ACCESS_TOKEN. Mocking send.');
      return { success: true, wamid: `mock_wamid_${Date.now()}`, category: 'service' };
    }

    try {
      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
          preview_url: false,
          body: bodyText,
        },
      };

      const response = await fetch(this.getBaseUrl(phoneId), {
        method: 'POST',
        headers: this.getHeaders(token),
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as MetaGraphResponse;

      if (!response.ok) {
        const error = data?.error || {};
        console.error('[MetaClient] Failed to send free-form message:', error);

        observabilityService.recordMetaApiError(error.code || 0, error.message);
        observabilityService.recordOutboundMessage('free_form', 'service', false);

        // Error code 131047: Re-engagement message required (24h service window expired)
        const is24hExpired =
          error.code === 131047 ||
          error.error_subcode === 131047 ||
          error.code === 131026 ||
          (typeof error.message === 'string' && /24\s*hour|re-engagement/i.test(error.message)) ||
          (typeof error.error_data?.details === 'string' && /24\s*hour|re-engagement/i.test(error.error_data.details));

        return {
          success: false,
          errorCode: error.code,
          errorMessage: error.message,
          is24hExpired,
          category: 'service',
        };
      }

      const wamid = data?.messages?.[0]?.id;
      // H8: Track outbound service message
      usageTracker.recordOutbound('free_form');
      observabilityService.recordOutboundMessage('free_form', 'service', true);
      return { success: true, wamid, mode: 'free_form', category: 'service' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[MetaClient] Network error sending free-form message:', msg);
      return { success: false, errorMessage: msg, category: 'service' };
    }
  }

  /**
   * Critical Requirement:
   * Sanitize template variable {{5}} (visitor message) to prevent Error 132000 / 131009.
   * - No newlines (\n or \r\n) -> replaced with " | "
   * - No tabs (\t) -> replaced with space
   * - No >= 4 consecutive spaces -> collapsed to single space
   * - Truncated to max 300 characters
   */
  sanitizeTemplateVariable(text: string, maxLength = 300): string {
    if (!text) return '-';

    const cleaned = text
      .replace(/\r?\n/g, ' | ') // Replace newlines with separator
      .replace(/\t/g, ' ') // Replace tabs with space
      .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
      .trim()
      .slice(0, maxLength); // Truncate to max 300 characters

    return cleaned || '-';
  }

  /**
   * Send approved Utility Template (livechat_ticket_alert) to wake up CS / open 24h window
   */
  async sendUtilityTemplate(
    to: string,
    sessionId: string,
    businessName: string,
    pageUrl: string,
    rawVisitorText: string,
    sessionCode?: string,
    credentials?: ResolvedWabaCredentials | MetaCredentialsOverride
  ): Promise<MetaSendResult> {
    const phoneId = credentials?.phoneNumberId || config.meta.phoneNumberId;
    const token = credentials?.accessToken || config.meta.accessToken;
    const templateName = credentials?.templateName || config.meta.utilityTemplateName;

    if (!phoneId || !token) {
      console.warn('[MetaClient] Missing META credentials. Mocking template send.');
      return { success: true, wamid: `mock_tpl_wamid_${Date.now()}`, category: 'template' };
    }

    const shortSessionId = (sessionCode || sessionId.slice(-6)).toUpperCase();
    const safePageUrl = pageUrl || '/';
    const sanitizedPageUrl = safePageUrl.replace(/https?:\/\/[^/]+/i, '').slice(0, 50) || '/';
    const channelSource = sanitizedPageUrl === '/' ? 'Live Chat Web' : `Live Chat Web (${sanitizedPageUrl})`;
    const nowWib =
      new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta',
      }) + ' WIB';
    const sanitizedText = this.sanitizeTemplateVariable(rawVisitorText, 300);
    const targetBusinessName = (businessName || config.businessName || 'Bintang Studio Support').slice(0, 60);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: config.meta.templateLanguage,
        },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: shortSessionId },
              { type: 'text', text: targetBusinessName },
              { type: 'text', text: channelSource },
              { type: 'text', text: nowWib },
              { type: 'text', text: sanitizedText },
            ],
          },
        ],
      },
    };

    try {
      const response = await fetch(this.getBaseUrl(phoneId), {
        method: 'POST',
        headers: this.getHeaders(token),
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as MetaGraphResponse;

      if (!response.ok) {
        const error = data?.error || {};
        console.error('[MetaClient] Failed to send Utility Template:', error);
        observabilityService.recordMetaApiError(error.code || 0, error.message);
        observabilityService.recordOutboundMessage('utility_template', 'template', false);
        return {
          success: false,
          errorCode: error.code,
          errorMessage: error.message,
          category: 'template',
        };
      }

      const wamid = data?.messages?.[0]?.id;
      // H8: Track outbound utility template message
      usageTracker.recordOutbound('utility_template');
      observabilityService.recordOutboundMessage('utility_template', 'template', true);
      return { success: true, wamid, mode: 'utility_template', category: 'template' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[MetaClient] Network error sending Utility Template:', msg);
      return { success: false, errorMessage: msg, category: 'template' };
    }
  }

  /**
   * Notify CS with automatic 24-hour service window fallback:
   * - If 24-hr window is active (isWindowOpen = true): send free-form message
   * - If 24-hr window is closed (isWindowOpen = false): directly send approved Utility Template to wake up CS and open window
   */
  async notifyCsWithAutoFallback(
    toPhone: string,
    businessName: string,
    sessionId: string,
    visitorName: string,
    pageUrl: string,
    batchedText: string,
    sessionCode?: string,
    credentials?: ResolvedWabaCredentials | MetaCredentialsOverride,
    isWindowOpen = false
  ): Promise<MetaSendResult> {
    const to = (toPhone || config.meta.csPhone).replace(/\D/g, '');
    if (!to) {
      console.warn('[MetaClient] CS phone number is not configured for this channel. Messages will not be forwarded.');
      return { success: true, wamid: `mock_no_cs_${Date.now()}`, category: 'service' };
    }

    // Step 1: If 24-hr window is known to be open, send free-form text
    if (isWindowOpen) {
      const shortId = (sessionCode || sessionId.slice(-6)).toUpperCase();
      const formattedMessage = `*${businessName} - #${shortId}*\n${batchedText}`;
      const freeFormResult = await this.sendFreeFormText(to, formattedMessage, credentials);

      if (freeFormResult.success) {
        return freeFormResult;
      }

      console.warn(
        `[MetaClient] Free-form send failed for CS (${to}) [Error: ${freeFormResult.errorCode || 'UNKNOWN'}]. Falling back to Utility Template.`
      );
    }

    // Step 2: Window is closed (or free-form attempt was rejected): send approved Utility Template to wake up CS
    console.log(
      `[MetaClient] 24-Hour Window is closed for CS (${to}). Dispatching Utility Template (${credentials?.templateName || config.meta.utilityTemplateName}) to open 24h window.`
    );

    return await this.sendUtilityTemplate(
      to,
      sessionId,
      businessName,
      pageUrl,
      batchedText,
      sessionCode,
      credentials
    );
  }

  /**
   * Send direct warning alert to CS WhatsApp (e.g. anti-data-breach notification)
   */
  async sendCsAlert(
    toPhone: string,
    alertMessage: string,
    credentials?: ResolvedWabaCredentials | MetaCredentialsOverride
  ): Promise<MetaSendResult> {
    const to = (toPhone || config.meta.csPhone).replace(/\D/g, '');
    if (!to) return { success: false, category: 'service' };
    return this.sendFreeFormText(to, alertMessage, credentials);
  }
}

export const metaClient = new MetaClient();
