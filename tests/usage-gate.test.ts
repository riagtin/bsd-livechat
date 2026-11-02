// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { NoOpUsageGate } from '../apps/gateway/src/usage/gate.js';

describe('Usage Gate & Zero-Deficit Rules (Fase 2 §4.3 & §9.3a)', () => {
  it('NoOpUsageGate always allows outbound messages without deducting credits', async () => {
    const gate = new NoOpUsageGate();
    const canSend = await gate.canSend('tnt_selfhost', 'notify', false);
    expect(canSend).toBe(true);

    const deduction = await gate.deductCredit(
      'tnt_selfhost',
      'out_123',
      'conn_selfhost',
      '628123456789',
      'notify',
      'template'
    );

    expect(deduction.allowed).toBe(true);
    expect(deduction.charged).toBe(false);
  });

  it('NoOpUsageGate safely no-ops on status update and refund', async () => {
    const gate = new NoOpUsageGate();
    await gate.updateOutboundStatus('out_123', 'failed');
    const refunded = await gate.refundFailedOutbound('out_123');
    expect(refunded).toBe(false);
  });
});

