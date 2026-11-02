// SPDX-License-Identifier: AGPL-3.0-only
import { config } from '../config/index.js';

export interface UsageStats {
  periodYM: string;
  serviceSent: number;
  templateSent: number;
  totalOutbound: number;
  quota: number;
  warningThreshold: number;
  lastUpdated: number;
}

/**
 * H8: In-Memory / Operational Monthly Service Message Usage Monitor
 * Tracks free-form service messages (subject to 1,000 free/month cap per WhatsApp Business Number)
 * and Utility template messages. Triggers structured warnings when approaching limits.
 */
export class MonthlyUsageTracker {
  private currentPeriodYM: string = '';
  private serviceSentCount: number = 0;
  private templateSentCount: number = 0;
  private lastUpdatedAt: number = Date.now();

  constructor() {
    this.refreshPeriod();
  }

  private getNowYM(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private refreshPeriod(): void {
    const currentYM = this.getNowYM();
    if (this.currentPeriodYM !== currentYM) {
      if (this.currentPeriodYM) {
        console.log(
          `[UsageTracker] Rollover period: ${this.currentPeriodYM} -> ${currentYM}. Previous usage: Service=${this.serviceSentCount}, Utility=${this.templateSentCount}.`
        );
      }
      this.currentPeriodYM = currentYM;
      this.serviceSentCount = 0;
      this.templateSentCount = 0;
      this.lastUpdatedAt = Date.now();
    }
  }

  /**
   * Record outbound message delivery and monitor thresholds
   */
  recordOutbound(mode: 'free_form' | 'utility_template'): UsageStats {
    this.refreshPeriod();

    if (mode === 'free_form') {
      this.serviceSentCount += 1;
      
      // H8 Threshold Monitoring
      if (this.serviceSentCount === config.serviceMonthlyWarningThreshold) {
        console.warn(
          `[UsageTracker] ⚠️ WARNING: Monthly free-form service messages reached ${this.serviceSentCount}/${config.serviceMonthlyQuota} in period ${this.currentPeriodYM}!`
        );
      } else if (this.serviceSentCount >= config.serviceMonthlyQuota) {
        console.warn(
          `[UsageTracker] 🚨 CRITICAL: Monthly service message quota (${config.serviceMonthlyQuota}) EXHAUSTED for period ${this.currentPeriodYM} (${this.serviceSentCount} sent). Further free-form messages may be billed as utility rate.`
        );
      }
    } else {
      this.templateSentCount += 1;
    }

    this.lastUpdatedAt = Date.now();
    return this.getStats();
  }

  /**
   * Retrieve current monthly usage statistics
   */
  getStats(): UsageStats {
    this.refreshPeriod();
    return {
      periodYM: this.currentPeriodYM,
      serviceSent: this.serviceSentCount,
      templateSent: this.templateSentCount,
      totalOutbound: this.serviceSentCount + this.templateSentCount,
      quota: config.serviceMonthlyQuota,
      warningThreshold: config.serviceMonthlyWarningThreshold,
      lastUpdated: this.lastUpdatedAt,
    };
  }
}

export const usageTracker = new MonthlyUsageTracker();

