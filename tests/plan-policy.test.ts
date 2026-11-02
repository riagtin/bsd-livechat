// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { PlanCatalogPolicy } from '../apps/gateway/src/policy/plan.js';

describe('Plan Catalog Policy & Open-Core Boundaries (Fase 2 §2B & §11.1)', () => {
  const policy = new PlanCatalogPolicy();

  it('enforces mandatory watermark for Community and Starter tiers', () => {
    expect(policy.canRemoveWatermark('community')).toBe(false);
    expect(policy.canRemoveWatermark('starter')).toBe(false);
  });

  it('allows watermark removal for Pro and Enterprise tiers', () => {
    expect(policy.canRemoveWatermark('pro')).toBe(true);
    expect(policy.canRemoveWatermark('enterprise')).toBe(true);
  });

  it('enforces strict single-domain limit on Starter Cloud tier', () => {
    expect(policy.isDomainAllowed('starter', 0)).toBe(true); // 0 current domains -> allowed
    expect(policy.isDomainAllowed('starter', 1)).toBe(false); // 1 current domain -> rejected
  });

  it('allows multi-domain on Pro and Enterprise tiers', () => {
    expect(policy.isDomainAllowed('pro', 1)).toBe(true);
    expect(policy.isDomainAllowed('pro', 9)).toBe(true);
    expect(policy.isDomainAllowed('pro', 10)).toBe(false); // Pro cap is 10
  });

  it('provides Starter with 200 monthly bundle credits and Pro with 0 (BYO-WABA direct billing)', () => {
    const starterLimits = policy.getLimits('starter');
    const proLimits = policy.getLimits('pro');

    expect(starterLimits.monthlyBundleCredits).toBe(200);
    expect(proLimits.monthlyBundleCredits).toBe(0);
  });

  it('supports Enterprise custom plan overrides without polluting static limits', () => {
    const customEnterprise = policy.getLimits('enterprise', {
      maxChannels: 2000,
      monthlyBundleCredits: 50000,
    });

    expect(customEnterprise.maxChannels).toBe(2000);
    expect(customEnterprise.monthlyBundleCredits).toBe(50000);

    // Standard enterprise remains intact
    const standardEnterprise = policy.getLimits('enterprise');
    expect(standardEnterprise.maxChannels).toBe(999);
  });
});

