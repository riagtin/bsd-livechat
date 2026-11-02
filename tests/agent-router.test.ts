// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { AgentRouter, RoutingChannelInfo } from '../apps/gateway/src/routing/router.js';

describe('Multi-CS Router & Business Hours (Fase 2 §8.1 & §8.2)', () => {
  const router = new AgentRouter();

  it('allows all requests when business_hours_enabled is false', () => {
    const channel: RoutingChannelInfo = {
      channelId: 'chn_test',
      tenantId: 'tnt_test',
      name: '24/7 Channel',
      businessName: 'Bintang Studio',
      businessHoursEnabled: false,
      timezone: 'Asia/Jakarta',
    };

    expect(router.isWithinBusinessHours(channel)).toBe(true);
  });

  it('evaluates business hours correctly inside configured schedule', () => {
    const channel: RoutingChannelInfo = {
      channelId: 'chn_hours',
      tenantId: 'tnt_test',
      name: 'Office Hours Channel',
      businessName: 'Bintang Studio',
      businessHoursEnabled: true,
      timezone: 'Asia/Jakarta',
      schedule: {
        mon: [['08:00', '17:00']],
        tue: [['08:00', '17:00']],
        wed: [['08:00', '17:00']],
        thu: [['08:00', '17:00']],
        fri: [['08:00', '17:00']],
        sat: [['09:00', '13:00']],
      },
    };

    // Test a Monday at 10:00 WIB (03:00 UTC) -> should be inside
    const insideDate = new Date('2026-11-02T03:00:00.000Z');
    expect(router.isWithinBusinessHours(channel, insideDate)).toBe(true);

    // Test a Monday at 20:00 WIB (13:00 UTC) -> should be outside
    const outsideEveningDate = new Date('2026-11-02T13:00:00.000Z');
    expect(router.isWithinBusinessHours(channel, outsideEveningDate)).toBe(false);

    // Test Sunday (no range defined) -> should be outside
    const sundayDate = new Date('2026-11-01T05:00:00.000Z');
    expect(router.isWithinBusinessHours(channel, sundayDate)).toBe(false);
  });
});

