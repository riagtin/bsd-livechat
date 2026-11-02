// SPDX-License-Identifier: AGPL-3.0-only
import { ChatMessage, InitSessionResponse, SSEAgentReadEvent, SSEMessageEvent } from '@bintangstudio/livechat-sdk';
import { playNotificationSound } from './sound.js';
import { WIDGET_CSS } from './styles.js';
import { WidgetOptions } from './types.js';

export class BsdLiveChatWidget {
  private options: Required<WidgetOptions>;
  private hostEl: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;

  private sessionId: string = '';
  private sessionToken: string = '';
  private clientId: string = '';
  private eventSource: EventSource | null = null;
  private messages: ChatMessage[] = [];
  private isOpen: boolean = false;
  private unreadCount: number = 0;
  private isConnecting: boolean = false;
  private currentTheme: 'dark' | 'light' = 'dark';

  constructor(options: WidgetOptions) {
    this.options = {
      gatewayUrl: options.gatewayUrl.replace(/\/+$/, ''),
      channelId: options.channelId || 'default',
      businessName: options.businessName || 'Bintang Studio Support',
      welcomeMessage:
        options.welcomeMessage ||
        'Halo! Selamat datang di layanan bantuan kami. Silakan tinggalkan pertanyaan Anda, tim kami akan merespons langsung.',
      theme: options.theme || 'auto',
      logoUrl: options.logoUrl || '/livechat.png',
      position: options.position || 'bottom-right',
      lang: options.lang || 'id',
      autoOpenDelayMs: options.autoOpenDelayMs || 0,
      soundEnabled: options.soundEnabled ?? true,
    };
    this.currentTheme = this.resolveInitialTheme();
  }

  private resolveInitialTheme(): 'dark' | 'light' {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bsd_chat_theme');
      if (saved === 'dark' || saved === 'light') return saved;
      if (this.options.theme === 'light') return 'light';
      if (this.options.theme === 'dark') return 'dark';
      // Auto
      if (document.documentElement.classList.contains('dark')) return 'dark';
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    }
    return this.options.theme === 'light' ? 'light' : 'dark';
  }

  private toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    if (typeof window !== 'undefined') {
      localStorage.setItem('bsd_chat_theme', this.currentTheme);
    }
    const container = this.shadow?.querySelector('.bsd-chat-container');
    if (container) {
      if (this.currentTheme === 'light') {
        container.classList.add('theme-light');
      } else {
        container.classList.remove('theme-light');
      }
    }
    this.updateThemeButton();
  }

  private updateThemeButton(): void {
    const btn = this.shadow?.querySelector('.bsd-theme-toggle') as HTMLButtonElement;
    if (!btn) return;
    const isEn = this.options.lang === 'en';
    if (this.currentTheme === 'dark') {
      btn.title = isEn ? 'Switch to Light Mode' : 'Beralih ke Mode Terang';
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
    } else {
      btn.title = isEn ? 'Switch to Dark Mode' : 'Beralih ke Mode Gelap';
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }
  }

  /**
   * Mount widget into DOM and initialize session
   */
  async mount(): Promise<void> {
    if (typeof window === 'undefined') return;

    // Prevent double mount
    if (document.getElementById('bsd-livechat-root')) return;

    this.hostEl = document.createElement('div');
    this.hostEl.id = 'bsd-livechat-root';
    this.hostEl.style.pointerEvents = 'none';
    document.body.appendChild(this.hostEl);

    this.shadow = this.hostEl.attachShadow({ mode: 'open' });

    // Inject Scoped Stylesheet into Shadow DOM
    const styleEl = document.createElement('style');
    styleEl.textContent = WIDGET_CSS;
    this.shadow.appendChild(styleEl);

    // Render HTML Skeleton
    this.renderSkeleton();

    // Setup Local Storage & Init Session
    this.initClientIds();
    await this.initSession();

    // Auto open if configured
    if (this.options.autoOpenDelayMs > 0) {
      setTimeout(() => this.setOpen(true), this.options.autoOpenDelayMs);
    }

    // Resilient auto-sync every 6 seconds when chat window is open
    setInterval(() => {
      if (this.isOpen) {
        this.syncMessages();
      }
    }, 6000);
  }

  private initClientIds(): void {
    let cid = localStorage.getItem('bsd_chat_client_id');
    if (!cid) {
      cid = `cid_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem('bsd_chat_client_id', cid);
    }
    this.clientId = cid;
    const channelKey = this.options.channelId || 'default';
    this.sessionId = localStorage.getItem(`bsd_chat_session_${channelKey}`) || '';
    this.sessionToken = localStorage.getItem(`bsd_chat_token_${channelKey}`) || '';
  }

  private async initSession(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      const payload = {
        channel_id: this.options.channelId,
        client_id: this.clientId,
        existing_session_id: this.sessionId || undefined,
        page_url: window.location.href,
        referrer: document.referrer || undefined,
        user_agent: navigator.userAgent,
      };

      const res = await fetch(`${this.options.gatewayUrl}/api/v1/client/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data: InitSessionResponse = await res.json();
      this.sessionId = data.session_id;
      const channelKey = this.options.channelId || 'default';
      localStorage.setItem(`bsd_chat_session_${channelKey}`, this.sessionId);
      if (data.session_token) {
        this.sessionToken = data.session_token;
        localStorage.setItem(`bsd_chat_token_${channelKey}`, this.sessionToken);
      }

      // Dynamically sync business name & welcome message from channel
      if (data.business_name) {
        this.options.businessName = data.business_name;
        const headerInfoEl = this.shadow?.querySelector('.bsd-header-info');
        if (headerInfoEl) {
          const isBsd = data.business_name.includes('Bintang Studio');
          if (isBsd) {
            const brandTitle = headerInfoEl.querySelector('.bsd-brand-title');
            if (!brandTitle) {
              const h4 = headerInfoEl.querySelector('h4');
              if (h4) {
                h4.outerHTML = `<div class="bsd-brand-title"><span class="bsd-brand-bintang">B</span><span class="bsd-brand-studio"> SD</span> <span class="bsd-brand-support">Support</span></div>`;
              }
            }
          } else {
            const h4 = headerInfoEl.querySelector('h4');
            if (h4) {
              h4.textContent = data.business_name;
            } else {
              const brandTitle = headerInfoEl.querySelector('.bsd-brand-title');
              if (brandTitle) {
                brandTitle.outerHTML = `<h4>${this.escapeHtml(data.business_name)}</h4>`;
              }
            }
          }
        }
      }
      if (data.welcome_message) {
        this.options.welcomeMessage = data.welcome_message;
        if (this.messages.length === 0) {
          this.renderMessages();
        }
      }

      // Restore History
      if (data.history && data.history.length > 0) {
        this.messages = data.history;
        this.renderMessages();
      }

      // Connect to Real-time SSE
      this.connectSSE();
    } catch (err) {
      console.warn('[BsdLiveChat] Failed to connect to chat gateway:', err);
    } finally {
      this.isConnecting = false;
    }
  }

  private connectSSE(): void {
    if (!this.sessionId) return;
    if (this.eventSource) {
      this.eventSource.close();
    }

    const tokenParam = this.sessionToken ? `&token=${encodeURIComponent(this.sessionToken)}` : '';
    const sseUrl = `${this.options.gatewayUrl}/api/v1/client/stream?session_id=${encodeURIComponent(
      this.sessionId
    )}${tokenParam}`;

    this.eventSource = new EventSource(sseUrl);

    const onMessageHandler = (e: MessageEvent) => {
      try {
        const payload: any = JSON.parse(e.data);
        const msg: ChatMessage = payload.message || payload;
        if (msg && msg.text && msg.sender === 'agent') {
          this.handleIncomingAgentMessage(msg);
        }
      } catch (err) {
        console.error('[BsdLiveChat] SSE message parse error:', err);
      }
    };

    this.eventSource.addEventListener('message', onMessageHandler);
    this.eventSource.onmessage = onMessageHandler;

    this.eventSource.addEventListener('agent_read', (e: MessageEvent) => {
      try {
        const payload: SSEAgentReadEvent = JSON.parse(e.data);
        if (payload.message_ids && payload.message_ids.length > 0) {
          this.handleAgentReadReceipt(payload.message_ids);
        }
      } catch (err) {
        console.error('[BsdLiveChat] SSE agent_read parse error:', err);
      }
    });

    this.eventSource.onerror = (err) => {
      // Auto-sync fallback on SSE disconnect
      this.syncMessages();
    };
  }

  private handleIncomingAgentMessage(msg: ChatMessage): void {
    // Avoid duplicates
    if (this.messages.some((m) => m.id === msg.id)) return;

    this.messages.push(msg);
    this.renderMessages();

    if (this.options.soundEnabled) {
      playNotificationSound();
    }

    if (!this.isOpen) {
      this.unreadCount += 1;
      this.updateBadge();
    }
  }

  private handleAgentReadReceipt(messageIds: string[]): void {
    let updated = false;
    for (const msg of this.messages) {
      if (messageIds.includes(msg.id)) {
        msg.status = 'read';
        updated = true;
      }
    }
    if (updated) {
      this.renderMessages();
    }
  }

  private async sendMessage(text: string): Promise<void> {
    if (!text || !text.trim() || !this.sessionId) return;

    const cleanText = text.trim();
    const localId = `msg_local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // Optimistic UI update
    const optimisticMsg: ChatMessage = {
      id: localId,
      sessionId: this.sessionId,
      sender: 'visitor',
      text: cleanText,
      timestamp: Date.now(),
      status: 'queued',
    };

    this.messages.push(optimisticMsg);
    this.renderMessages();

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.sessionToken) {
        headers['X-Session-Token'] = this.sessionToken;
      }

      const res = await fetch(`${this.options.gatewayUrl}/api/v1/client/message`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          session_id: this.sessionId,
          session_token: this.sessionToken || undefined,
          local_id: localId,
          text: cleanText,
        }),
      });

      if (res.status === 401) {
        // H2: Session expired or invalid session token -> Auto renew session and retry
        console.warn('[BsdLiveChat] Session expired or invalid token. Auto-renewing session...');
        const channelKey = this.options.channelId || 'default';
        localStorage.removeItem(`bsd_chat_session_${channelKey}`);
        localStorage.removeItem(`bsd_chat_token_${channelKey}`);
        this.sessionId = '';
        this.sessionToken = '';
        await this.initSession();

        if (this.sessionId && this.sessionToken) {
          const retryHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-Session-Token': this.sessionToken,
          };
          const retryRes = await fetch(`${this.options.gatewayUrl}/api/v1/client/message`, {
            method: 'POST',
            headers: retryHeaders,
            body: JSON.stringify({
              session_id: this.sessionId,
              session_token: this.sessionToken,
              local_id: localId,
              text: cleanText,
            }),
          });
          if (retryRes.ok) {
            optimisticMsg.status = 'sent';
            this.renderMessages();
            return;
          }
        }
        throw new Error(`HTTP ${res.status}`);
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      optimisticMsg.status = 'sent';
      this.renderMessages();
    } catch (err) {
      console.error('[BsdLiveChat] Failed to send message:', err);
      optimisticMsg.status = 'failed';
      this.renderMessages();
    }
  }

  private setOpen(open: boolean): void {
    this.isOpen = open;
    const windowEl = this.shadow?.querySelector('.bsd-chat-window');
    const triggerBtn = this.shadow?.querySelector('.bsd-trigger-btn');

    if (this.isOpen) {
      windowEl?.classList.add('open');
      triggerBtn?.classList.add('active');
      this.unreadCount = 0;
      this.updateBadge();
      this.scrollBottom();
      this.syncMessages();
      // Focus textarea
      setTimeout(() => {
        const textarea = this.shadow?.querySelector('.bsd-textarea') as HTMLTextAreaElement;
        textarea?.focus();
      }, 200);
    } else {
      windowEl?.classList.remove('open');
      triggerBtn?.classList.remove('active');
    }
  }

  private async syncMessages(): Promise<void> {
    if (!this.sessionId || this.isConnecting) return;
    try {
      const res = await fetch(`${this.options.gatewayUrl}/api/v1/client/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId,
          channel_id: this.options.channelId,
          existing_session_id: this.sessionId,
        }),
      });
      if (res.ok) {
        const data: InitSessionResponse = await res.json();
        if (data.session_id) {
          this.sessionId = data.session_id;
          const channelKey = this.options.channelId || 'default';
          localStorage.setItem(`bsd_chat_session_${channelKey}`, this.sessionId);
          if (data.session_token) {
            this.sessionToken = data.session_token;
            localStorage.setItem(`bsd_chat_token_${channelKey}`, this.sessionToken);
          }
        }
        if (data.history && data.history.length > 0) {
          const prevCount = this.messages.length;
          this.messages = data.history;
          this.renderMessages();
          if (!this.isOpen && this.messages.length > prevCount) {
            this.unreadCount += this.messages.length - prevCount;
            this.updateBadge();
          }
        }
      }
    } catch {
      // ignore network errors
    }
  }

  private updateBadge(): void {
    const badgeEl = this.shadow?.querySelector('.bsd-badge') as HTMLElement;
    if (!badgeEl) return;

    if (this.unreadCount > 0) {
      badgeEl.style.display = 'flex';
      badgeEl.textContent = this.unreadCount > 9 ? '9+' : String(this.unreadCount);
    } else {
      badgeEl.style.display = 'none';
    }
  }

  private scrollBottom(): void {
    setTimeout(() => {
      const list = this.shadow?.querySelector('.bsd-messages-list');
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
    }, 50);
  }

  private renderSkeleton(): void {
    if (!this.shadow) return;

    const container = document.createElement('div');
    const isLight = this.currentTheme === 'light';
    container.className = `bsd-chat-container ${this.options.position === 'bottom-left' ? 'pos-left' : ''
      } ${isLight ? 'theme-light' : ''}`;

    const isEn = this.options.lang === 'en';
    const statusText = isEn ? 'Connected via WhatsApp' : 'Terhubung via WhatsApp';
    const closeTitle = isEn ? 'Close Chat' : 'Tutup Chat';
    const placeholderText = isEn ? 'Type your message...' : 'Ketik pesan Anda...';
    const sendTitle = isEn ? 'Send' : 'Kirim';
    const triggerTitle = isEn ? 'Live WhatsApp Support' : 'Bantuan WhatsApp';
    const welcomeHeaderTitle = isEn ? 'Official Support Desk' : 'Pusat Bantuan Resmi';
    const themeToggleTitle = this.currentTheme === 'dark'
      ? (isEn ? 'Switch to Light Mode' : 'Beralih ke Mode Terang')
      : (isEn ? 'Switch to Dark Mode' : 'Beralih ke Mode Gelap');

    const themeIconSvg = this.currentTheme === 'dark'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

    container.innerHTML = `
      <!-- Chat Window -->
      <div class="bsd-chat-window">
        <!-- Header -->
        <div class="bsd-header">
          <div class="bsd-header-left">
            <!-- Avatar Container with Blinking Online Status Indicator -->
            <div class="bsd-avatar-container">
              <div class="bsd-avatar-emblem">
                ${this.options.logoUrl
        ? `<img src="${this.options.logoUrl}" alt="Bintang Studio LiveChat" class="bsd-avatar-img" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='block';" />
                       <svg class="bsd-avatar-fallback" style="display:none;" viewBox="0 0 24 24"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg>`
        : `<svg class="bsd-avatar-fallback" viewBox="0 0 24 24"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg>`
      }
              </div>
              <span class="bsd-avatar-online" title="${statusText}"></span>
            </div>

            <div class="bsd-header-info">
              ${!this.options.businessName || this.options.businessName.includes('Bintang Studio')
        ? `<div class="bsd-brand-title"><span class="bsd-brand-bintang">Bintang</span><span class="bsd-brand-studio">Studio</span> <span class="bsd-brand-support">Support</span></div>`
        : `<h4>${this.options.businessName}</h4>`
      }
              <p>${statusText}</p>
            </div>
          </div>

          <div class="bsd-header-actions">
            <button class="bsd-icon-btn bsd-theme-toggle" title="${themeToggleTitle}">
              ${themeIconSvg}
            </button>
            <button class="bsd-icon-btn bsd-close-btn" title="${closeTitle}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <!-- Messages List -->
        <div class="bsd-messages-list">
          <div class="bsd-welcome-card">
            <div class="bsd-welcome-header">
              <svg viewBox="0 0 24 24"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg>
              <span>${welcomeHeaderTitle}</span>
            </div>
            ${this.escapeHtml(this.options.welcomeMessage)}
          </div>
        </div>

        <!-- Input Area -->
        <div class="bsd-input-wrap">
          <textarea class="bsd-textarea" placeholder="${placeholderText}" rows="1"></textarea>
          <button class="bsd-send-btn" title="${sendTitle}">
            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          </button>
        </div>
        <div class="bsd-powered">
          Powered by <a href="https://bintangstudio.tech" target="_blank" rel="noopener"><span class="bsd-brand-bintang">Bintang</span><span class="bsd-brand-studio">Studio</span></a>
        </div>
      </div>

      <!-- Trigger Button (Dual-Brand Trust with Corner WhatsApp Badge) -->
      <button class="bsd-trigger-btn" title="${triggerTitle}">
        <div class="bsd-trigger-icon-chat">
          <img src="${this.options.logoUrl}" alt="LiveChat" class="bsd-trigger-img" />
        </div>
        <div class="bsd-trigger-icon-close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <div class="bsd-trigger-wa-badge" title="WhatsApp Bridge">
          <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.301-.15-1.78-.879-2.056-.98-.276-.1-.477-.15-.678.15-.2.302-.779.98-.955 1.18-.175.201-.351.226-.652.075-.302-.151-1.272-.47-2.423-1.498-.897-.8-1.503-1.789-1.68-2.09-.175-.302-.019-.465.132-.615.136-.135.301-.351.451-.527.151-.176.201-.293.302-.49.1-.197.05-.37-.025-.521-.075-.151-.678-1.634-.929-2.238-.244-.589-.493-.509-.678-.518-.175-.009-.376-.011-.577-.011-.201 0-.527.075-.803.376-.276.301-1.054 1.03-1.054 2.512 0 1.482 1.079 2.912 1.23 3.113.15.201 2.124 3.243 5.145 4.548.718.311 1.279.497 1.716.636.721.23 1.377.197 1.896.12.577-.087 1.78-.727 2.031-1.429.251-.702.251-1.303.176-1.429-.076-.125-.276-.201-.577-.352z"/></svg>
        </div>
        <span class="bsd-badge" style="display: none;">0</span>
      </button>
    `;

    this.shadow.appendChild(container);

    // Event Listeners
    const triggerBtn = container.querySelector('.bsd-trigger-btn') as HTMLElement;
    const closeBtn = container.querySelector('.bsd-close-btn') as HTMLElement;
    const themeBtn = container.querySelector('.bsd-theme-toggle') as HTMLElement;
    const textarea = container.querySelector('.bsd-textarea') as HTMLTextAreaElement;
    const sendBtn = container.querySelector('.bsd-send-btn') as HTMLElement;

    triggerBtn.addEventListener('click', () => this.setOpen(!this.isOpen));
    closeBtn.addEventListener('click', () => this.setOpen(false));
    themeBtn.addEventListener('click', () => this.toggleTheme());

    const handleSend = () => {
      const val = textarea.value.trim();
      if (!val) return;
      this.sendMessage(val);
      textarea.value = '';
      textarea.style.height = '44px';
    };

    sendBtn.addEventListener('click', handleSend);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Auto resize textarea
    textarea.addEventListener('input', () => {
      textarea.style.height = '44px';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    });
  }

  private renderMessages(): void {
    const list = this.shadow?.querySelector('.bsd-messages-list');
    if (!list) return;

    const isEn = this.options.lang === 'en';
    const welcomeHeaderTitle = isEn ? 'Official Support Desk' : 'Pusat Bantuan Resmi';

    // Retain welcome card
    list.innerHTML = `
      <div class="bsd-welcome-card">
        <div class="bsd-welcome-header">
          <svg viewBox="0 0 24 24"><path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg>
          <span>${welcomeHeaderTitle}</span>
        </div>
        ${this.escapeHtml(this.options.welcomeMessage)}
      </div>
    `;

    for (const msg of this.messages) {
      const bubble = document.createElement('div');
      bubble.className = `bsd-bubble ${msg.sender}`;

      const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      let checkHtml = '';
      if (msg.sender === 'visitor') {
        if (msg.status === 'read') {
          // Double cyan/blue check mark (Read by CS)
          checkHtml = `
            <svg class="bsd-check-icon read" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M1 12l4 4L15 4M7 12l4 4L21 4"/>
            </svg>
          `;
        } else if (msg.status === 'sent' || msg.status === 'delivered') {
          // Single check mark
          checkHtml = `
            <svg class="bsd-check-icon sent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          `;
        }
      }

      bubble.innerHTML = `
        <div class="bsd-bubble-text">${this.escapeHtml(msg.text)}</div>
        <div class="bsd-meta-row">
          <span>${timeStr}</span>
          ${checkHtml}
        </div>
      `;

      list.appendChild(bubble);
    }

    this.scrollBottom();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  }
}
