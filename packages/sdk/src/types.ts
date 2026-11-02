// SPDX-License-Identifier: MPL-2.0
/**
 * BSD LiveChat - Official Meta WhatsApp Cloud API Bridge
 * Shared TypeScript Definitions
 * Bintang Studio
 */

export type MessageSender = 'visitor' | 'agent' | 'system';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'held';

export interface ChatMessage {
  id: string; // msg_local_xxx or msg_wamid_xxx
  sessionId: string;
  sender: MessageSender;
  text: string;
  timestamp: number;
  status: MessageStatus;
  wamid?: string; // Associated WhatsApp Message ID from Meta
}

// Multi-Tenant & Channel Modeling
export interface Tenant {
  tenantId: string;
  name: string;
  status: 'active' | 'suspended';
  planTier?: 'community' | 'starter' | 'pro' | 'enterprise';
  subscriptionStatus?: 'pending_payment' | 'trialing' | 'active' | 'grace' | 'suspended' | 'canceled';
  createdAt: number;
}

export interface Channel {
  channelId: string;
  tenantId: string;
  name: string; // e.g. "Customer Support", "Sales Team"
  businessName: string; // Displayed on widget header and WhatsApp message
  csPhone?: string; // Target CS WhatsApp Phone (International format e.g. 6281234567890)
  wabaConnectionId?: string;
  routingMode?: string;
  reassignAfterSec?: number;
  reminderAfterSec?: number;
  maxPreReplyOutbound?: number;
  businessHoursEnabled?: boolean;
  timezone?: string;
  schedule?: Record<string, Array<[string, string]>>;
  awayMessage?: string;
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  allowedDomains?: string[]; // CORS whitelisted origins for this channel
  welcomeMessage?: string;
  status: 'active' | 'suspended';
  createdAt: number;
}

export interface VisitorSession {
  sessionId: string;
  channelId: string;
  tenantId: string;
  csPhone?: string;
  clientId: string;
  visitorName: string;
  pageUrl: string;
  referrer?: string;
  userAgent?: string;
  createdAt: number;
  lastActiveAt: number;
  messages: ChatMessage[];
  // Mapping of 1 WAMID to multiple local message IDs (due to debouncing)
  wamidToLocalIds: Record<string, string[]>;
  // H3: 6-character short code unique per channel for WhatsApp CS manual reply (e.g. "#A7F9BC")
  sessionCode?: string;
  // H7: Relay Hemat pre-reply tracking
  preReplyOutboundCount?: number;
  csReplied?: boolean;
  pendingDigest?: Array<{ localId: string; text: string }>;
  // Fase 2: Multi-CS and Relay Hemat state
  assignedAgentId?: string;
  relayState?: 'idle' | 'notified' | 'active' | 'offline';
  notifiedAt?: number;
  visitorContact?: string;
}

// Client Requests & Responses
export interface InitSessionRequest {
  channel_id?: string;
  client_id: string;
  existing_session_id?: string;
  page_url: string;
  referrer?: string;
  user_agent?: string;
  visitor_name?: string;
}

export interface InitSessionResponse {
  session_id: string;
  session_token?: string; // H2: HMAC-signed token for session authentication
  channel_id: string;
  status: 'connected' | 'restored';
  business_name: string;
  welcome_message?: string;
  history: ChatMessage[];
}

export interface SendMessageRequest {
  session_id: string;
  session_token?: string; // H2: Optional body token (can also be passed in header)
  local_id?: string;
  text: string;
}

export interface SendMessageResponse {
  message_id: string;
  status: 'queued_debouncing' | 'sent';
  timestamp: number;
}

// Meta Webhook Types (Official Meta WhatsApp Cloud API v22.0)
export interface MetaWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      value?: {
        messaging_product: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        contacts?: Array<{
          profile?: {
            name?: string;
          };
          wa_id?: string;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: {
            body: string;
          };
          context?: {
            from?: string;
            id?: string; // The quoted message WAMID
          };
        }>;
        statuses?: Array<{
          id: string; // The WAMID that was read/delivered
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id?: string;
          errors?: Array<{
            code: number;
            title: string;
            message?: string;
          }>;
        }>;
      };
      field: string;
    }>;
  }>;
}

// Server-Sent Events (SSE) Payloads
export interface SSEMessageEvent {
  message: ChatMessage;
}

export interface SSEAgentReadEvent {
  message_ids: string[]; // List of msg_local_xxx that were marked read
  wamid: string;
  timestamp: number;
}

export interface SSESystemNoticeEvent {
  notice: string;
  type: 'info' | 'warning' | 'error';
  timestamp: number;
}
