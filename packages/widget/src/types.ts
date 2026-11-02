// SPDX-License-Identifier: AGPL-3.0-only
export interface WidgetOptions {
  gatewayUrl: string;
  channelId?: string;
  businessName?: string;
  welcomeMessage?: string;
  theme?: 'dark' | 'light' | 'auto';
  logoUrl?: string;
  position?: 'bottom-right' | 'bottom-left';
  lang?: 'id' | 'en';
  autoOpenDelayMs?: number;
  soundEnabled?: boolean;
}
