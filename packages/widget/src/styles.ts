// SPDX-License-Identifier: AGPL-3.0-only
export const WIDGET_CSS = `
:host {
  pointer-events: none;
  /* Default Dark Mode Tokens (Deep Slate / Precision Bintang Studio) */
  --bsd-primary: #00E5FF;
  --bsd-primary-hover: #38BDF8;
  --bsd-bg: #090D16;
  --bsd-card: #0F172A;
  --bsd-border: rgba(255, 255, 255, 0.09);
  --bsd-text: #F8FAFC;
  --bsd-text-muted: #94A3B8;
  --bsd-visitor-bg: linear-gradient(135deg, #0284C7 0%, #2563EB 100%);
  --bsd-agent-bg: rgba(255, 255, 255, 0.05);
  --bsd-agent-border: rgba(255, 255, 255, 0.08);
  --bsd-agent-text: #F8FAFC;
  --bsd-header-bg: rgba(15, 23, 42, 0.85);
  --bsd-input-bg: rgba(15, 23, 42, 0.92);
  --bsd-textarea-bg: rgba(255, 255, 255, 0.05);
  --bsd-textarea-border: rgba(255, 255, 255, 0.12);
  --bsd-textarea-text: #F8FAFC;
  --bsd-textarea-placeholder: #64748B;
  --bsd-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.75), 0 0 25px rgba(0, 229, 255, 0.12);
  --bsd-badge-border: #090D16;
  --bsd-scrollbar: rgba(255, 255, 255, 0.15);
  --bsd-btn-hover: rgba(255, 255, 255, 0.1);
  --bsd-btn-icon: #94A3B8;
  --bsd-welcome-bg: rgba(255, 255, 255, 0.03);
  --bsd-welcome-border: rgba(255, 255, 255, 0.08);
  --bsd-welcome-text: #CBD5E1;
  --bsd-status-text: #10B981;
  --bsd-meta-text: rgba(255, 255, 255, 0.65);
  --bsd-check-read: #00E5FF;
  --bsd-check-sent: rgba(255, 255, 255, 0.55);
  --bsd-wa-green: #25D366;

  --bsd-brand-bintang: #FFFFFF;
  --bsd-brand-support: #00E5FF;
  --bsd-trigger-bg: #090D16;
  --bsd-trigger-border: rgba(0, 229, 255, 0.4);
  --bsd-trigger-shadow: 0 10px 28px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 229, 255, 0.22);
  --bsd-avatar-bg: rgba(255, 255, 255, 0.04);
  --bsd-avatar-border: rgba(0, 229, 255, 0.35);

  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--bsd-text);
  box-sizing: border-box;
}

/* Light Mode Overrides */
.bsd-chat-container.theme-light {
  --bsd-bg: #FFFFFF;
  --bsd-card: #F8FAFC;
  --bsd-border: rgba(15, 23, 42, 0.09);
  --bsd-text: #0F172A;
  --bsd-text-muted: #64748B;
  --bsd-visitor-bg: linear-gradient(135deg, #0284C7 0%, #2563EB 100%);
  --bsd-agent-bg: #F1F5F9;
  --bsd-agent-border: rgba(15, 23, 42, 0.06);
  --bsd-agent-text: #0F172A;
  --bsd-header-bg: rgba(255, 255, 255, 0.92);
  --bsd-input-bg: rgba(255, 255, 255, 0.96);
  --bsd-textarea-bg: #F8FAFC;
  --bsd-textarea-border: rgba(15, 23, 42, 0.15);
  --bsd-textarea-text: #0F172A;
  --bsd-textarea-placeholder: #94A3B8;
  --bsd-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.18), 0 0 25px rgba(0, 229, 255, 0.14);
  --bsd-badge-border: #FFFFFF;
  --bsd-scrollbar: rgba(15, 23, 42, 0.15);
  --bsd-btn-hover: rgba(15, 23, 42, 0.07);
  --bsd-btn-icon: #64748B;
  --bsd-welcome-bg: #F8FAFC;
  --bsd-welcome-border: rgba(15, 23, 42, 0.08);
  --bsd-welcome-text: #334155;
  --bsd-status-text: #059669;
  --bsd-meta-text: rgba(15, 23, 42, 0.55);
  --bsd-check-read: #0284C7;
  --bsd-check-sent: rgba(15, 23, 42, 0.45);
  --bsd-brand-bintang: #090D16;
  --bsd-brand-support: #0284C7;
  --bsd-trigger-bg: #FFFFFF;
  --bsd-trigger-border: rgba(15, 23, 42, 0.12);
  --bsd-trigger-shadow: 0 10px 28px rgba(15, 23, 42, 0.14), 0 0 20px rgba(0, 229, 255, 0.18);
  --bsd-avatar-bg: #F8FAFC;
  --bsd-avatar-border: rgba(15, 23, 42, 0.1);
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.bsd-chat-container {
  position: fixed;
  z-index: 2147483647;
  bottom: 24px;
  right: 24px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  pointer-events: none;
  transition: all 0.25s ease;
}

.bsd-chat-container.pos-left {
  right: auto;
  left: 24px;
  align-items: flex-start;
}

/* Floating Trigger Button (Dual-Brand Trust) */
.bsd-trigger-btn {
  pointer-events: auto;
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: var(--bsd-trigger-bg);
  box-shadow: var(--bsd-trigger-shadow);
  border: 1.5px solid var(--bsd-trigger-border);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  outline: none;
  position: relative;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.bsd-trigger-btn:hover {
  transform: scale(1.08) translateY(-2px);
  box-shadow: 0 14px 34px rgba(0, 229, 255, 0.45);
}

.bsd-trigger-btn:active {
  transform: scale(0.96);
}

.bsd-trigger-icon-chat,
.bsd-trigger-icon-close {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.bsd-trigger-icon-chat {
  opacity: 1;
  transform: rotate(0deg) scale(1);
}

.bsd-trigger-img {
  width: 38px;
  height: 38px;
  object-fit: contain;
  filter: drop-shadow(0 2px 6px rgba(0, 229, 255, 0.3));
}

.bsd-trigger-svg-fallback {
  width: 28px;
  height: 28px;
  fill: var(--bsd-primary);
  filter: drop-shadow(0 2px 6px rgba(0, 229, 255, 0.4));
}

.bsd-trigger-icon-close {
  opacity: 0;
  transform: rotate(-90deg) scale(0.5);
  color: var(--bsd-text);
}

.bsd-trigger-btn.active .bsd-trigger-icon-chat {
  opacity: 0;
  transform: rotate(90deg) scale(0.5);
}

.bsd-trigger-btn.active .bsd-trigger-icon-close {
  opacity: 1;
  transform: rotate(0deg) scale(1);
}

.bsd-trigger-icon-close svg {
  width: 24px;
  height: 24px;
  stroke: var(--bsd-text);
}

/* WhatsApp Verified Corner Badge on Trigger Button */
.bsd-trigger-wa-badge {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #25D366;
  border: 2px solid var(--bsd-trigger-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  transition: transform 0.2s ease, opacity 0.2s ease, border-color 0.3s ease;
  z-index: 2;
}

.bsd-trigger-btn.active .bsd-trigger-wa-badge {
  opacity: 0;
  transform: scale(0);
}

.bsd-trigger-wa-badge svg {
  width: 12px;
  height: 12px;
  fill: #FFFFFF;
}

/* Unread Badge */
.bsd-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  background: #EF4444;
  color: #FFFFFF;
  font-size: 11px;
  font-weight: 700;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bsd-badge-border);
  animation: pulse-badge 2s infinite;
  z-index: 5;
}

@keyframes pulse-badge {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.15); }
}

/* Chat Window */
.bsd-chat-window {
  width: 384px;
  height: 0;
  max-height: 0;
  margin-bottom: 0;
  background: var(--bsd-bg);
  border: 1px solid transparent;
  border-radius: 22px;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateY(20px) scale(0.95);
  transition: opacity 0.32s cubic-bezier(0.16, 1, 0.3, 1),
              transform 0.32s cubic-bezier(0.16, 1, 0.3, 1),
              height 0.32s cubic-bezier(0.16, 1, 0.3, 1),
              max-height 0.32s cubic-bezier(0.16, 1, 0.3, 1),
              margin-bottom 0.25s ease,
              visibility 0.32s,
              background-color 0.3s ease,
              border-color 0.3s ease;
}

.bsd-chat-window.open {
  height: 590px;
  max-height: calc(100vh - 120px);
  margin-bottom: 16px;
  border-color: var(--bsd-border);
  box-shadow: var(--bsd-shadow);
  opacity: 1;
  visibility: visible;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}

/* Header */
.bsd-header {
  padding: 14px 18px;
  background: var(--bsd-header-bg);
  border-bottom: 1px solid var(--bsd-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

.bsd-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

/* Dual-Brand Avatar Container */
.bsd-avatar-container {
  position: relative;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}

.bsd-avatar-emblem {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bsd-avatar-bg);
  border: 1.5px solid var(--bsd-avatar-border);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 229, 255, 0.15);
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

.bsd-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 3px;
  border-radius: 50%;
}

.bsd-avatar-fallback {
  width: 24px;
  height: 24px;
  fill: #00E5FF;
}

/* Blinking Online Indicator on Avatar */
.bsd-avatar-online {
  position: absolute;
  bottom: 0px;
  right: 0px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #10B981;
  border: 2px solid var(--bsd-header-bg);
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.75);
  z-index: 2;
  display: block;
  animation: bsd-online-blink 1.8s ease-in-out infinite;
  box-sizing: border-box;
}

.bsd-avatar-online::after {
  content: '';
  position: absolute;
  top: -2px;
  left: -2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #10B981;
  opacity: 0.75;
  animation: bsd-online-pulse 1.8s cubic-bezier(0.24, 0, 0.38, 1) infinite;
  box-sizing: border-box;
}

@keyframes bsd-online-blink {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
    box-shadow: 0 0 10px rgba(16, 185, 129, 0.85);
  }
  50% {
    opacity: 0.45;
    transform: scale(0.88);
    box-shadow: 0 0 2px rgba(16, 185, 129, 0.25);
  }
}

@keyframes bsd-online-pulse {
  0% {
    transform: scale(0.9);
    opacity: 0.8;
  }
  60% {
    transform: scale(2.3);
    opacity: 0;
  }
  100% {
    transform: scale(2.3);
    opacity: 0;
  }
}

.bsd-header-info {
  min-width: 0;
}

/* Signature Brand Typography (BINTANG in Adaptive White/Slate + STUDIO in Gradient + SUPPORT in Brand Cyan) */
.bsd-brand-title {
  font-size: 14.5px;
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.2;
  white-space: nowrap;
  user-select: none;
  display: flex;
  align-items: center;
}

.bsd-brand-bintang {
  color: var(--bsd-brand-bintang);
  font-weight: 900;
  transition: color 0.3s ease;
}

.bsd-brand-studio {
  background: linear-gradient(135deg, #FF007F 0%, #8A2BE2 50%, #00E5FF 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: transparent;
  display: inline-block;
  font-weight: 900;
  margin-left: 3px;
}

.bsd-brand-support {
  color: var(--bsd-brand-support, #00E5FF);
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.01em;
  margin-left: 4px;
  transition: color 0.3s ease;
}

.bsd-header-info h4 {
  font-size: 15px;
  font-weight: 700;
  color: var(--bsd-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
  transition: color 0.3s ease;
}

.bsd-header-info p {
  font-size: 11.5px;
  color: var(--bsd-status-text);
  font-style: italic;
  margin-top: 2px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.3s ease;
}

/* Live Pulse Radar Ring */
.bsd-status-dot {
  position: relative;
  width: 7px;
  height: 7px;
  background: #10B981;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.bsd-status-dot::after {
  content: '';
  position: absolute;
  top: -2px;
  left: -2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #10B981;
  opacity: 0.6;
  animation: pulse-ring 2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
}

@keyframes pulse-ring {
  0% { transform: scale(0.8); opacity: 0.8; }
  100% { transform: scale(2.2); opacity: 0; }
}

/* Header Actions */
.bsd-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.bsd-icon-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--bsd-btn-icon);
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  outline: none;
}

.bsd-icon-btn:hover {
  background: var(--bsd-btn-hover);
  color: var(--bsd-text);
}

.bsd-icon-btn svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
}

/* Messages Area */
.bsd-messages-list {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--bsd-scrollbar) transparent;
}

.bsd-messages-list::-webkit-scrollbar {
  width: 6px;
}
.bsd-messages-list::-webkit-scrollbar-thumb {
  background: var(--bsd-scrollbar);
  border-radius: 10px;
}

.bsd-bubble {
  max-width: 82%;
  padding: 11px 14px;
  border-radius: 16px;
  font-size: 13.5px;
  line-height: 1.45;
  word-break: break-word;
  animation: slide-up 0.22s ease-out;
  position: relative;
  transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
}

@keyframes slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.bsd-bubble.visitor {
  align-self: flex-end;
  background: var(--bsd-visitor-bg);
  color: #FFFFFF;
  border-bottom-right-radius: 4px;
  box-shadow: 0 4px 14px rgba(2, 132, 199, 0.25);
}

.bsd-bubble.agent {
  align-self: flex-start;
  background: var(--bsd-agent-bg);
  border: 1px solid var(--bsd-agent-border);
  color: var(--bsd-agent-text);
  border-bottom-left-radius: 4px;
}

.bsd-bubble.system {
  align-self: center;
  background: var(--bsd-welcome-bg);
  border: 1px solid var(--bsd-welcome-border);
  font-size: 11px;
  color: var(--bsd-text-muted);
  text-align: center;
  padding: 6px 12px;
  border-radius: 20px;
}

.bsd-bubble-text {
  user-select: text;
}

.bsd-meta-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 4px;
  font-size: 10.5px;
  color: var(--bsd-meta-text);
}

.bsd-bubble.visitor .bsd-meta-row {
  color: rgba(255, 255, 255, 0.75);
}

/* Double Check Icons */
.bsd-check-icon {
  width: 14px;
  height: 14px;
  display: inline-block;
  vertical-align: middle;
}

.bsd-check-icon.read {
  color: #00E5FF;
}

.bsd-check-icon.sent {
  color: rgba(255, 255, 255, 0.65);
}

/* Welcome Box */
.bsd-welcome-card {
  background: var(--bsd-welcome-bg);
  border: 1px solid var(--bsd-welcome-border);
  border-radius: 14px;
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--bsd-welcome-text);
  margin-bottom: 6px;
  transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
}

.bsd-welcome-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--bsd-text);
  margin-bottom: 6px;
  font-size: 13px;
}

.bsd-welcome-header svg {
  width: 16px;
  height: 16px;
  fill: #00E5FF;
}

/* Input Area */
.bsd-input-wrap {
  padding: 12px 16px;
  background: var(--bsd-input-bg);
  border-top: 1px solid var(--bsd-border);
  display: flex;
  align-items: center;
  gap: 10px;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}

.bsd-textarea {
  flex: 1;
  background: var(--bsd-textarea-bg);
  border: 1px solid var(--bsd-textarea-border);
  border-radius: 12px;
  padding: 10px 14px;
  color: var(--bsd-textarea-text);
  font-size: 13.5px;
  font-family: inherit;
  resize: none;
  height: 44px;
  max-height: 100px;
  outline: none;
  transition: border-color 0.2s, background-color 0.2s, color 0.2s;
}

.bsd-textarea:focus {
  border-color: #00E5FF;
  box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.15);
}

.bsd-textarea::placeholder {
  color: var(--bsd-textarea-placeholder);
}

.bsd-send-btn {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: linear-gradient(135deg, #00E5FF 0%, #2563EB 100%);
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s, opacity 0.2s, box-shadow 0.2s;
  outline: none;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0, 229, 255, 0.25);
}

.bsd-send-btn:hover {
  transform: scale(1.05);
  box-shadow: 0 6px 16px rgba(0, 229, 255, 0.35);
}

.bsd-send-btn:active {
  transform: scale(0.95);
}

.bsd-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  transform: none;
}

.bsd-send-btn svg {
  width: 18px;
  height: 18px;
  fill: #FFFFFF;
}

.bsd-powered {
  text-align: center;
  font-size: 10px;
  color: var(--bsd-text-muted);
  padding: 4px 0 8px 0;
  background: var(--bsd-input-bg);
  transition: background-color 0.3s ease, color 0.3s ease;
  user-select: none;
}

.bsd-powered a {
  color: #00E5FF;
  text-decoration: none;
  font-weight: 500;
}

.bsd-powered a:hover {
  text-decoration: underline;
}

/* Mobile Screen Responsiveness */
@media (max-width: 480px) {
  .bsd-chat-container {
    bottom: 16px;
    right: 16px;
    pointer-events: none;
  }
  .bsd-chat-container.pos-left {
    bottom: 16px;
    left: 16px;
  }
  .bsd-chat-window {
    width: calc(100vw - 32px);
    height: 0;
    max-height: 0;
    margin-bottom: 0;
    border-radius: 20px;
  }
  .bsd-chat-window.open {
    width: calc(100vw - 32px);
    height: calc(100vh - 96px);
    max-height: none;
    margin-bottom: 12px;
    pointer-events: auto;
  }
}
`;

