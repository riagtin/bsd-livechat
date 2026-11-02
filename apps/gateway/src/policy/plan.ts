// SPDX-License-Identifier: AGPL-3.0-only

export type PlanTier = 'community' | 'starter' | 'pro' | 'enterprise';

export interface PlanLimits {
  tier: PlanTier;
  maxChannels: number;
  maxAgentsPerChannel: number;
  monthlyBundleCredits: number;
  allowWatermarkRemoval: boolean;
  maxAllowedDomains: number;
  allowTopup: boolean;
  chatHistoryDays: number;
  hourlySessionCap: number;
}

export interface IPlanPolicy {
  getLimits(tier: PlanTier, overrides?: Partial<PlanLimits>): PlanLimits;
  canRemoveWatermark(tier: PlanTier): boolean;
  isDomainAllowed(tier: PlanTier, currentDomainsCount: number): boolean;
}

const DEFAULT_PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  community: {
    tier: 'community',
    maxChannels: 1,
    maxAgentsPerChannel: 1,
    monthlyBundleCredits: 0, // Self-hosted (direct WABA, no platform credits)
    allowWatermarkRemoval: false, // NOTICE §7(b) mandatory attribution
    maxAllowedDomains: 10,
    allowTopup: false,
    chatHistoryDays: 30,
    hourlySessionCap: 50,
  },
  starter: {
    tier: 'starter',
    maxChannels: 1,
    maxAgentsPerChannel: 2,
    monthlyBundleCredits: 200,
    allowWatermarkRemoval: false, // Watermark mandatory
    maxAllowedDomains: 1, // Exactly 1 domain
    allowTopup: true,
    chatHistoryDays: 30,
    hourlySessionCap: 50,
  },
  pro: {
    tier: 'pro',
    maxChannels: 5,
    maxAgentsPerChannel: 10,
    monthlyBundleCredits: 0, // BYO-WABA (billed directly by Meta)
    allowWatermarkRemoval: true,
    maxAllowedDomains: 10,
    allowTopup: false,
    chatHistoryDays: 90,
    hourlySessionCap: 200,
  },
  enterprise: {
    tier: 'enterprise',
    maxChannels: 999,
    maxAgentsPerChannel: 999,
    monthlyBundleCredits: 10000,
    allowWatermarkRemoval: true,
    maxAllowedDomains: 999,
    allowTopup: true,
    chatHistoryDays: 365,
    hourlySessionCap: 1000,
  },
};

export class PlanCatalogPolicy implements IPlanPolicy {
  getLimits(tier: PlanTier, overrides?: Partial<PlanLimits>): PlanLimits {
    const base = DEFAULT_PLAN_LIMITS[tier] || DEFAULT_PLAN_LIMITS.starter;
    if (tier === 'enterprise' && overrides) {
      return { ...base, ...overrides };
    }
    return base;
  }

  canRemoveWatermark(tier: PlanTier): boolean {
    return this.getLimits(tier).allowWatermarkRemoval;
  }

  isDomainAllowed(tier: PlanTier, currentDomainsCount: number): boolean {
    const limits = this.getLimits(tier);
    return currentDomainsCount < limits.maxAllowedDomains;
  }
}

export const planPolicy = new PlanCatalogPolicy();

