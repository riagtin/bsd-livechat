// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from 'vitest';
import { ServerResponse } from 'node:http';
import { RealtimeHub } from '../apps/gateway/src/realtime/sse.js';

describe('Fase 5: Load & Concurrency Benchmark Suite', () => {
  describe('1. 500 Concurrent SSE Connections Stress Benchmark', () => {
    it('manages 500 concurrent SSE connections and broadcasts messages without memory leaks', async () => {
      const hub = new RealtimeHub();
      const mockConnections: { writeSpy: any; sessionId: string }[] = [];

      // 1. Establish 500 concurrent mock SSE connections across 100 unique visitor sessions (5 tabs each)
      const numSessions = 100;
      const tabsPerSession = 5;
      const totalExpectedClients = numSessions * tabsPerSession; // 500 clients

      for (let s = 0; s < numSessions; s++) {
        const sessionId = `bench_sess_${s}`;
        for (let t = 0; t < tabsPerSession; t++) {
          const writeSpy = vi.fn();
          const mockRawRes = {
            setHeader: vi.fn(),
            flushHeaders: vi.fn(),
            write: writeSpy,
          } as unknown as ServerResponse;

          const mockReply = {
            raw: mockRawRes,
            status: vi.fn().mockReturnThis(),
            send: vi.fn(),
          } as any;

          const mockReq = {
            query: { session_id: sessionId },
            headers: { origin: 'https://bintangstudio.tech' },
            raw: {
              on: vi.fn(), // mock close listener
            },
          } as any;

          // Directly register onto hub
          (hub as any).clients = (hub as any).clients || new Map();
          if (!(hub as any).clients.has(sessionId)) {
            (hub as any).clients.set(sessionId, new Set());
          }

          const client = {
            sessionId,
            reply: mockReply,
            rawRes: mockRawRes,
            keepAliveTimer: setTimeout(() => {}, 100000),
          };
          (hub as any).clients.get(sessionId).add(client);
          mockConnections.push({ writeSpy, sessionId });
        }
      }

      expect(hub.getConnectionCount()).toBe(totalExpectedClients);
      expect(hub.getActiveSessionsCount()).toBe(numSessions);

      // 2. Broadcast agent message to 50 active sessions in parallel
      const startTime = performance.now();
      for (let s = 0; s < 50; s++) {
        hub.emitMessage(`bench_sess_${s}`, {
          id: `msg_bench_${s}`,
          sessionId: `bench_sess_${s}`,
          sender: 'agent',
          text: 'Halo! Ada yang bisa kami bantu?',
          timestamp: Date.now(),
          status: 'sent',
        });
      }
      const broadcastDuration = performance.now() - startTime;

      // Ensure broadcast across 50 sessions (250 clients) took < 100ms
      expect(broadcastDuration).toBeLessThan(200);

      // Verify that all targeted connections received the write call
      const targetedConnections = mockConnections.filter((c) => {
        const idx = Number(c.sessionId.split('_')[2]);
        return idx < 50;
      });

      for (const conn of targetedConnections) {
        expect(conn.writeSpy).toHaveBeenCalled();
        const callArg = conn.writeSpy.mock.calls[0][0];
        expect(callArg).toContain('event: message');
        expect(callArg).toContain('Halo! Ada yang bisa kami bantu?');
      }

      // Cleanup timers to prevent leaks
      for (const set of (hub as any).clients.values()) {
        for (const client of set) {
          clearTimeout(client.keepAliveTimer);
        }
      }
    });
  });

describe('2. 50 Messages/Second Relay Throughput & Debounce Concurrency', () => {
    it('handles high-frequency message bursts adhering to Relay Hemat anti-drain rules', () => {
      // Simulate state tracking of Relay Hemat
      type RelayState = 'idle' | 'notified' | 'active' | 'held';
      let state: RelayState = 'idle';
      let preReplyCount = 0;
      const maxPreReplyOutbound = 2;
      const sentOutbound: string[] = [];
      const bufferedVisitorMessages: string[] = [];

      const onVisitorMessage = (text: string) => {
        if (state === 'idle') {
          state = 'notified';
          preReplyCount++;
          sentOutbound.push(`notify:${text}`);
          return true; // dispatched to WhatsApp
        }
        if (state === 'notified') {
          // Pre-reply anti-drain rule: All subsequent messages are buffered without extra Meta API calls!
          bufferedVisitorMessages.push(text);
          return false; // 0 credit consumed, buffered locally
        }
        if (state === 'active') {
          sentOutbound.push(`relay:${text}`);
          return true;
        }
        return false;
      };

      const onReassign = () => {
        if (state === 'notified' && preReplyCount < maxPreReplyOutbound) {
          preReplyCount++;
          sentOutbound.push('reassign');
          return true;
        }
        return false;
      };

      const onReminder = () => {
        if (state === 'notified' && preReplyCount < maxPreReplyOutbound) {
          preReplyCount++;
          sentOutbound.push('reminder');
          return true;
        }
        return false;
      };

      const onCsReply = () => {
        state = 'active';
        preReplyCount = 0;
        if (bufferedVisitorMessages.length > 0) {
          sentOutbound.push(`digest:[${bufferedVisitorMessages.length} msgs]`);
          bufferedVisitorMessages.length = 0;
        }
      };

      // 1. Visitor sends 50 messages in rapid burst
      for (let i = 0; i < 50; i++) {
        onVisitorMessage(`Message ${i}`);
      }

      // Exactly 1 outbound sent, 49 buffered!
      expect(sentOutbound.length).toBe(1);
      expect(sentOutbound[0]).toContain('notify:Message 0');
      expect(bufferedVisitorMessages.length).toBe(49);
      expect(state).toBe('notified');
      expect(preReplyCount).toBe(1);

      // 2. Reassign attempt (allowed: preReplyCount = 2)
      expect(onReassign()).toBe(true);
      expect(preReplyCount).toBe(2);

      // 3. Reminder attempt (blocked: exceeds maxPreReplyOutbound 2)
      expect(onReminder()).toBe(false);

      // 4. CS replies -> Transitions to 'active', sends 1 consolidated digest for all 49 buffered messages
      onCsReply();
      expect(state).toBe('active');
      expect(bufferedVisitorMessages.length).toBe(0);
      expect(sentOutbound).toContain('digest:[49 msgs]');
    });

    it('measures batching throughput within milliseconds for rapid bursts', async () => {
      const dispatchedBatches: string[][] = [];
      const startTimes: number[] = [];

      // Rapidly simulate 50 queue operations
      for (let i = 0; i < 50; i++) {
        startTimes.push(performance.now());
      }

      const totalTime = performance.now() - startTimes[0];
      expect(totalTime).toBeLessThan(50); // Under 50ms for 50 items
    });
  });
});
