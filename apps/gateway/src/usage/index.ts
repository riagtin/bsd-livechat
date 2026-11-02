// SPDX-License-Identifier: AGPL-3.0-only
import pg from 'pg';
import { config } from '../config/index.js';
import { CreditUsageGate, IUsageGate, NoOpUsageGate } from './gate.js';

let activeUsageGate: IUsageGate = new NoOpUsageGate();

export function initUsageGate(pool?: pg.Pool): IUsageGate {
  if (config.db.driver === 'postgres' && pool) {
    activeUsageGate = new CreditUsageGate(pool);
  } else {
    activeUsageGate = new NoOpUsageGate();
  }
  return activeUsageGate;
}

export function getUsageGate(): IUsageGate {
  return activeUsageGate;
}

export * from './gate.js';

