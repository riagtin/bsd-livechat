// SPDX-License-Identifier: MPL-2.0
/**
 * BSD LiveChat - Official Meta WhatsApp Cloud API Bridge
 * React Thin Loader Component (@bintangstudio/livechat-react)
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import React, { useEffect, useRef } from 'react';

export interface LiveChatWidgetProps {
  /**
   * Base URL of the BSD LiveChat Gateway server
   * @example "https://chat.bintangstudio.tech"
   */
  gatewayUrl: string;

  /**
   * Optional custom URL to the hosted widget.js CDN file.
   * Defaults to `${gatewayUrl}/widget.js`
   */
  cdnUrl?: string;

  /**
   * Target Channel ID registered on the Gateway
   * @default "default"
   */
  channelId?: string;

  /**
   * Brand or business display name shown on the widget header
   * @default "Bintang Studio Support"
   */
  businessName?: string;

  /**
   * Initial welcome greeting displayed to the visitor
   */
  welcomeMessage?: string;

  /**
   * Widget visual color theme
   * @default "auto"
   */
  theme?: 'auto' | 'dark' | 'light';

  /**
   * Widget launcher position on the screen
   * @default "bottom-right"
   */
  position?: 'bottom-right' | 'bottom-left';

  /**
   * Interface language
   * @default "id"
   */
  lang?: 'id' | 'en';

  /**
   * Delay in milliseconds before automatically expanding the chat window
   * @default 0 (Disabled)
   */
  autoOpenDelayMs?: number;

  /**
   * Whether incoming message notification chime sound is enabled
   * @default true
   */
  soundEnabled?: boolean;
}

/**
 * BsdChatWidget: Thin React loader component that injects the official CDN widget
 * script without bundling the core widget code, maintaining clean MPL-2.0 isolation.
 */
export const BsdChatWidget: React.FC<LiveChatWidgetProps> = ({
  gatewayUrl,
  cdnUrl,
  channelId = 'default',
  businessName,
  welcomeMessage,
  theme = 'auto',
  position = 'bottom-right',
  lang = 'id',
  autoOpenDelayMs,
  soundEnabled = true,
}) => {
  const injectedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || injectedRef.current) return;

    // Prevent duplicate script tag injection
    const existingScript = document.getElementById('bsd-livechat-cdn-script');
    if (existingScript) return;

    injectedRef.current = true;
    const script = document.createElement('script');
    script.id = 'bsd-livechat-cdn-script';
    script.src = cdnUrl || `${gatewayUrl.replace(/\/+$/, '')}/widget.js`;
    script.defer = true;
    script.setAttribute('data-gateway-url', gatewayUrl);
    script.setAttribute('data-channel-id', channelId);
    if (businessName) script.setAttribute('data-business-name', businessName);
    if (welcomeMessage) script.setAttribute('data-welcome-message', welcomeMessage);
    script.setAttribute('data-theme', theme);
    script.setAttribute('data-position', position);
    script.setAttribute('data-lang', lang);
    if (autoOpenDelayMs !== undefined) script.setAttribute('data-auto-open-delay', String(autoOpenDelayMs));
    script.setAttribute('data-sound', String(soundEnabled));

    document.body.appendChild(script);
  }, [
    gatewayUrl,
    cdnUrl,
    channelId,
    businessName,
    welcomeMessage,
    theme,
    position,
    lang,
    autoOpenDelayMs,
    soundEnabled,
  ]);

  return null;
};
