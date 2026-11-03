// SPDX-License-Identifier: AGPL-3.0-only
import { WidgetOptions } from './types.js';
import { BsdLiveChatWidget } from './widget-core.js';

declare global {
  interface Window {
    BsdLiveChat?: {
      init: (options: WidgetOptions) => BsdLiveChatWidget;
      instance?: BsdLiveChatWidget;
    };
  }
}

let capturedScript: Element | null = null;
if (typeof document !== 'undefined') {
  capturedScript =
    document.currentScript ||
    document.querySelector('script[data-channel-id]') ||
    document.querySelector('script[data-channel]') ||
    document.querySelector('script[data-gateway-url]') ||
    document.querySelector('script[src*="widget.js"]');
}

function autoInitFromScriptTag(): void {
  if (typeof document === 'undefined') return;
  if (typeof window !== 'undefined' && window.BsdLiveChat?.instance) return;

  const currentScript =
    capturedScript ||
    document.currentScript ||
    document.querySelector('script[data-channel-id]') ||
    document.querySelector('script[data-channel]') ||
    document.querySelector('script[data-gateway-url]') ||
    document.querySelector('script[src*="widget.js"]');

  let gatewayUrl = currentScript?.getAttribute('data-gateway-url');
  if (!gatewayUrl && currentScript && (currentScript as HTMLScriptElement).src) {
    try {
      const parsed = new URL((currentScript as HTMLScriptElement).src, window.location.href);
      gatewayUrl = parsed.origin;
    } catch {
      // fallback
    }
  }
  if (!gatewayUrl) {
    // Default to production cloud gateway
    gatewayUrl = 'https://chat.bintangstudio.tech';
  }

  const channelId =
    currentScript?.getAttribute('data-channel-id') ||
    currentScript?.getAttribute('data-channel') ||
    undefined;
  const businessName = currentScript?.getAttribute('data-business-name') || undefined;
  const welcomeMessage = currentScript?.getAttribute('data-welcome-message') || undefined;
  const theme = (currentScript?.getAttribute('data-theme') as any) || undefined;
  const logoUrl = currentScript?.getAttribute('data-logo-url') || undefined;
  const position = (currentScript?.getAttribute('data-position') as any) || undefined;
  const lang = (currentScript?.getAttribute('data-lang') as any) || undefined;

  const widget = new BsdLiveChatWidget({
    gatewayUrl,
    channelId,
    businessName,
    welcomeMessage,
    theme,
    logoUrl,
    position,
    lang,
  });

  widget.mount().catch((err) => {
    console.error('[BsdLiveChat] Auto-mount failed:', err);
  });

  if (typeof window !== 'undefined') {
    if (!window.BsdLiveChat) {
      window.BsdLiveChat = {
        init: (opts) => {
          const w = new BsdLiveChatWidget(opts);
          w.mount();
          return w;
        },
      };
    }
    window.BsdLiveChat.instance = widget;
  }
}

// Attach global API
if (typeof window !== 'undefined') {
  if (!window.BsdLiveChat) {
    window.BsdLiveChat = {
      init: (opts: WidgetOptions) => {
        const widget = new BsdLiveChatWidget(opts);
        widget.mount();
        window.BsdLiveChat!.instance = widget;
        return widget;
      },
    };
  }

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitFromScriptTag);
  } else {
    autoInitFromScriptTag();
  }
}

export { BsdLiveChatWidget };
