// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, beforeAll } from 'vitest';
import { ChannelRegistry } from '../apps/gateway/src/channel/registry.js';
import { getWidgetScript } from '../apps/gateway/src/assets/widgetScript.js';
import { Channel } from '@bintangstudio/livechat-sdk';
import { config } from '../apps/gateway/src/config/index.js';

describe('Domain Restriction & Widget CDN Delivery', () => {
  let registry: ChannelRegistry;

  beforeAll(async () => {
    registry = new ChannelRegistry();
    // Register test channel with btpgold.store
    const testChannel: Channel = {
      channelId: 'chn_btpgold',
      tenantId: 'tnt_btpgold',
      name: 'BTP Gold Store',
      businessName: 'BTP Gold Store Official',
      allowedDomains: ['btpgold.store'],
      status: 'active',
      createdAt: Date.now(),
    };
    await registry.registerChannel(testChannel);
  });

  describe('1. Channel Allowed Domains Guard', () => {
    it('authorizes exact registered domain', () => {
      expect(registry.isDomainAllowedForChannel('chn_btpgold', 'https://btpgold.store')).toBe(true);
      expect(registry.isDomainAllowedForChannel('chn_btpgold', 'http://btpgold.store')).toBe(true);
    });

    it('authorizes subdomains of registered domain', () => {
      expect(registry.isDomainAllowedForChannel('chn_btpgold', 'https://shop.btpgold.store')).toBe(true);
      expect(registry.isDomainAllowedForChannel('chn_btpgold', 'https://checkout.btpgold.store')).toBe(true);
    });

    it('always authorizes local development origins', () => {
      expect(registry.isDomainAllowedForChannel('chn_btpgold', 'http://localhost:3000')).toBe(true);
      expect(registry.isDomainAllowedForChannel('chn_btpgold', 'http://127.0.0.1:8080')).toBe(true);
    });

    it('strictly rejects unauthorized third-party domains', () => {
      expect(registry.isDomainAllowedForChannel('chn_btpgold', 'https://malicious-site.com')).toBe(false);
      expect(registry.isDomainAllowedForChannel('chn_btpgold', 'https://random-store.id')).toBe(false);
      expect(registry.isDomainAllowedForChannel('chn_btpgold', 'https://fakebtpgold.store.attacker.com')).toBe(false);
    });
  });

  describe('2. Global Dynamic Origin Matcher for CORS', () => {
    it('recognizes domain registered across active channels', () => {
      expect(registry.isOriginAllowedAnywhere('https://btpgold.store')).toBe(true);
      expect(registry.isOriginAllowedAnywhere('btpgold.store')).toBe(true);
    });

    it('rejects domains not registered in any channel', () => {
      // Ensure wildcard is not present in config.allowedDomains during strict test
      const original = [...config.allowedDomains];
      config.allowedDomains = ['bintangstudio.tech', 'chat.bintangstudio.tech'];
      try {
        expect(registry.isOriginAllowedAnywhere('https://unregistered-domain.com')).toBe(false);
      } finally {
        config.allowedDomains = original;
      }
    });
  });

  describe('3. Widget Bundle CDN Serving', () => {
    it('resolves and returns the full widget.js script bundle', () => {
      const script = getWidgetScript();
      expect(script).toBeDefined();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(1000);
      expect(script).toContain('BsdLiveChat');
    });
  });
});
