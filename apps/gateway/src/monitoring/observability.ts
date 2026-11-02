// SPDX-License-Identifier: AGPL-3.0-only
import { realtimeHub } from '../realtime/sse.js';
import { getDatabase } from '../database/index.js';
import { PostgresDatabase } from '../database/postgres.js';

export interface AlertRecord {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  code?: string | number;
  timestamp: number;
}

export class ObservabilityService {
  private messagesSentByKind = new Map<string, number>();
  private messagesSentByCategory = new Map<string, number>();
  private creditsConsumedByTenant = new Map<string, number>();
  private metaErrorsByCode = new Map<string, number>();
  private relayLatencies: number[] = [];
  private recentAlerts: AlertRecord[] = [];
  private totalMessagesAttempted = 0;
  private totalMessagesFailed = 0;

  /**
   * Record an outbound message attempt & result
   */
  recordOutboundMessage(kind: string, category: string, success: boolean, latencyMs?: number): void {
    this.totalMessagesAttempted += 1;
    if (!success) {
      this.totalMessagesFailed += 1;
      this.checkFailureRate();
    }

    const currentKindCount = this.messagesSentByKind.get(kind) || 0;
    this.messagesSentByKind.set(kind, currentKindCount + 1);

    const currentCatCount = this.messagesSentByCategory.get(category) || 0;
    this.messagesSentByCategory.set(category, currentCatCount + 1);

    if (latencyMs !== undefined && latencyMs >= 0) {
      this.recordRelayLatency(latencyMs);
    }
  }

  /**
   * Record credit deduction
   */
  recordCreditConsumed(tenantId: string, amount: number): void {
    const current = this.creditsConsumedByTenant.get(tenantId) || 0;
    this.creditsConsumedByTenant.set(tenantId, current + amount);
  }

  /**
   * Record Meta Graph API error with intelligent alert dispatch
   */
  recordMetaApiError(code: number | string, message?: string): void {
    const strCode = String(code);
    const count = (this.metaErrorsByCode.get(strCode) || 0) + 1;
    this.metaErrorsByCode.set(strCode, count);

    // CRITICAL ALERT: Error 131042 (Business eligibility payment issue / auto-debit failure)
    if (strCode === '131042') {
      this.triggerAlert({
        severity: 'critical',
        title: 'META PAYMENT AUTO-DEBIT FAILURE (Error 131042)',
        detail:
          'Meta Business Portfolio payment failed or billing threshold reached without successful charge. ' +
          'Verify primary & backup credit card in Meta Business Manager immediately.',
        code: 131042,
      });
    } else if (strCode === '130429') {
      this.triggerAlert({
        severity: 'warning',
        title: 'META GRAPH API RATE LIMIT EXCEEDED (Error 130429)',
        detail: message || 'Hit Cloud API rate limit. Throttling outbound queues.',
        code: 130429,
      });
    }
  }

  /**
   * Record relay latency sample (capped sliding window)
   */
  recordRelayLatency(ms: number): void {
    this.relayLatencies.push(ms);
    if (this.relayLatencies.length > 500) {
      this.relayLatencies.shift();
    }
  }

  /**
   * Trigger an operational alert
   */
  triggerAlert(alert: Omit<AlertRecord, 'id' | 'timestamp'>): void {
    const record: AlertRecord = {
      id: `alt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      ...alert,
    };

    this.recentAlerts.unshift(record);
    if (this.recentAlerts.length > 50) {
      this.recentAlerts.pop();
    }

    const logPrefix = record.severity === 'critical' ? '🚨 [CRITICAL ALERT]' : '⚠️ [ALERT]';
    console.error(`${logPrefix} ${record.title} | ${record.detail}`);
  }

  private checkFailureRate(): void {
    if (this.totalMessagesAttempted >= 20) {
      const failureRate = (this.totalMessagesFailed / this.totalMessagesAttempted) * 100;
      if (failureRate > 15) {
        this.triggerAlert({
          severity: 'warning',
          title: 'HIGH MESSAGE FAILURE RATE',
          detail: `Outbound failure rate reached ${failureRate.toFixed(1)}% (${this.totalMessagesFailed}/${this.totalMessagesAttempted}). Check Meta API connectivity.`,
        });
      }
    }
  }

  /**
   * Calculate percentile latency
   */
  getLatencyPercentile(p: number): number {
    if (this.relayLatencies.length === 0) return 0;
    const sorted = [...this.relayLatencies].sort((a, b) => a - b);
    const index = Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1);
    return sorted[index];
  }

  /**
   * Deep health check
   */
  async getDetailedHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'down';
    uptime_seconds: number;
    sse_connections: number;
    database: {
      driver: string;
      connected: boolean;
      latency_ms: number;
    };
    memory_mb: {
      rss: number;
      heap_total: number;
      heap_used: number;
    };
    alerts: AlertRecord[];
  }> {
    const mem = process.memoryUsage();
    let dbConnected = false;
    let dbLatency = -1;
    const dbDriver = getDatabase() instanceof PostgresDatabase ? 'postgres' : 'memory';

    if (getDatabase() instanceof PostgresDatabase) {
      const start = Date.now();
      try {
        const pool = (getDatabase() as PostgresDatabase).getPool();
        await pool.query('SELECT 1');
        dbLatency = Date.now() - start;
        dbConnected = true;
      } catch {
        dbConnected = false;
      }
    } else {
      dbConnected = true;
      dbLatency = 0;
    }

    const hasCritical = this.recentAlerts.some((a) => a.severity === 'critical');
    let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
    if (!dbConnected) {
      overallStatus = 'down';
    } else if (hasCritical || (dbLatency > 1000 && dbLatency !== -1)) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      uptime_seconds: Math.floor(process.uptime()),
      sse_connections: realtimeHub.getConnectionCount(),
      database: {
        driver: dbDriver,
        connected: dbConnected,
        latency_ms: dbLatency,
      },
      memory_mb: {
        rss: Math.round(mem.rss / (1024 * 1024)),
        heap_total: Math.round(mem.heapTotal / (1024 * 1024)),
        heap_used: Math.round(mem.heapUsed / (1024 * 1024)),
      },
      alerts: this.recentAlerts.slice(0, 10),
    };
  }

  /**
   * Get metrics snapshot in JSON
   */
  getSnapshot(): {
    timestamp: number;
    uptime_seconds: number;
    sse: {
      active_connections: number;
      active_sessions: number;
    };
    messages: {
      attempted_total: number;
      failed_total: number;
      by_kind: Record<string, number>;
      by_category: Record<string, number>;
    };
    credits_consumed_total: number;
    meta_errors: Record<string, number>;
    latency_ms: {
      p50: number;
      p95: number;
      p99: number;
      samples: number;
    };
  } {
    let totalCredits = 0;
    for (const val of this.creditsConsumedByTenant.values()) {
      totalCredits += val;
    }

    return {
      timestamp: Date.now(),
      uptime_seconds: Math.floor(process.uptime()),
      sse: {
        active_connections: realtimeHub.getConnectionCount(),
        active_sessions: realtimeHub.getActiveSessionsCount(),
      },
      messages: {
        attempted_total: this.totalMessagesAttempted,
        failed_total: this.totalMessagesFailed,
        by_kind: Object.fromEntries(this.messagesSentByKind),
        by_category: Object.fromEntries(this.messagesSentByCategory),
      },
      credits_consumed_total: totalCredits,
      meta_errors: Object.fromEntries(this.metaErrorsByCode),
      latency_ms: {
        p50: this.getLatencyPercentile(50),
        p95: this.getLatencyPercentile(95),
        p99: this.getLatencyPercentile(99),
        samples: this.relayLatencies.length,
      },
    };
  }

  /**
   * Format Prometheus-compatible plain text metrics
   */
  getPrometheusMetrics(): string {
    const snapshot = this.getSnapshot();
    const lines: string[] = [];

    lines.push('# HELP livechat_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE livechat_uptime_seconds gauge');
    lines.push(`livechat_uptime_seconds ${snapshot.uptime_seconds}`);

    lines.push('# HELP livechat_sse_active_connections Current active SSE connections');
    lines.push('# TYPE livechat_sse_active_connections gauge');
    lines.push(`livechat_sse_active_connections ${snapshot.sse.active_connections}`);

    lines.push('# HELP livechat_sse_active_sessions Sessions with active SSE streams');
    lines.push('# TYPE livechat_sse_active_sessions gauge');
    lines.push(`livechat_sse_active_sessions ${snapshot.sse.active_sessions}`);

    lines.push('# HELP livechat_messages_attempted_total Total outbound relay attempts');
    lines.push('# TYPE livechat_messages_attempted_total counter');
    lines.push(`livechat_messages_attempted_total ${snapshot.messages.attempted_total}`);

    lines.push('# HELP livechat_messages_failed_total Total outbound relay failures');
    lines.push('# TYPE livechat_messages_failed_total counter');
    lines.push(`livechat_messages_failed_total ${snapshot.messages.failed_total}`);

    lines.push('# HELP livechat_credits_consumed_total Total credits consumed by tenants');
    lines.push('# TYPE livechat_credits_consumed_total counter');
    lines.push(`livechat_credits_consumed_total ${snapshot.credits_consumed_total}`);

    lines.push('# HELP livechat_relay_latency_p95_ms 95th percentile relay latency in milliseconds');
    lines.push('# TYPE livechat_relay_latency_p95_ms gauge');
    lines.push(`livechat_relay_latency_p95_ms ${snapshot.latency_ms.p95}`);

    // Breakdowns
    for (const [kind, count] of Object.entries(snapshot.messages.by_kind)) {
      lines.push(`livechat_messages_by_kind_total{kind="${kind}"} ${count}`);
    }

    for (const [code, count] of Object.entries(snapshot.meta_errors)) {
      lines.push(`livechat_meta_errors_total{code="${code}"} ${count}`);
    }

    return lines.join('\n') + '\n';
  }
}

export const observabilityService = new ObservabilityService();

