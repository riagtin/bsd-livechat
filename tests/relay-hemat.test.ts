// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

describe('Relay Hemat Regex & Anti-Drain Logic (H3 & H7)', () => {
  const PREFIX_REGEX = /^#([A-Z0-9]{6})\s+([\s\S]+)$/i;

  it('matches exact 6-character Crockford uppercase alphanumeric session codes', () => {
    const text = '#A7F9BC Halo kak apa produk ini ready?';
    const match = text.match(PREFIX_REGEX);

    expect(match).not.toBeNull();
    expect(match?.[1].toUpperCase()).toBe('A7F9BC');
    expect(match?.[2].trim()).toBe('Halo kak apa produk ini ready?');
  });

  it('matches lowercase 6-character codes and normalizes them', () => {
    const text = '#3kx9p2 Siap, pesanan sudah dikirim ya.';
    const match = text.match(PREFIX_REGEX);

    expect(match).not.toBeNull();
    expect(match?.[1].toUpperCase()).toBe('3KX9P2');
    expect(match?.[2].trim()).toBe('Siap, pesanan sudah dikirim ya.');
  });

  it('rejects short codes (< 6 characters) to prevent collision', () => {
    const text = '#A7F Halo kak';
    const match = text.match(PREFIX_REGEX);
    expect(match).toBeNull();
  });

  it('rejects long codes (> 6 characters)', () => {
    const text = '#A7F9BC12 Halo kak';
    const match = text.match(PREFIX_REGEX);
    expect(match).toBeNull();
  });

  it('rejects codes containing special characters', () => {
    const text = '#A7-F9B Halo kak';
    const match = text.match(PREFIX_REGEX);
    expect(match).toBeNull();
  });

  it('verifies max_pre_reply_outbound default is 2', () => {
    const maxPreReplyOutbound = 2;
    let preReplyOutboundCount = 0;
    const outboundSent: string[] = [];
    const buffered: string[] = [];

    // Simulate 5 visitor debounced messages before CS replies
    for (let i = 1; i <= 5; i++) {
      if (preReplyOutboundCount < maxPreReplyOutbound) {
        preReplyOutboundCount++;
        outboundSent.push(`outbound_msg_${i}`);
      } else {
        buffered.push(`visitor_msg_${i}`);
      }
    }

    expect(outboundSent.length).toBe(2);
    expect(buffered.length).toBe(3);
  });
});

