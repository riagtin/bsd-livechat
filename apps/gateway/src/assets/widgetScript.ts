// SPDX-License-Identifier: AGPL-3.0-only
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedWidgetJs: string | null = null;

function resolveCandidates(): string[] {
  const candidates: string[] = [];
  const cwd = process.cwd();

  // 1. Current working directory checks (Docker container or CLI)
  candidates.push(path.resolve(cwd, 'widget.js'));
  candidates.push(path.resolve(cwd, 'apps/gateway/widget.js'));
  candidates.push(path.resolve(cwd, 'packages/widget/dist/widget.js'));
  candidates.push(path.resolve(cwd, 'dist/widget.js'));

  // 2. __dirname based checks (Compiled dist or tsx watch)
  try {
    const currentDir = typeof __dirname !== 'undefined'
      ? __dirname
      : path.dirname(fileURLToPath(import.meta.url));

    candidates.push(path.resolve(currentDir, 'widget.js'));
    candidates.push(path.resolve(currentDir, '../widget.js'));
    candidates.push(path.resolve(currentDir, '../../packages/widget/dist/widget.js'));
    candidates.push(path.resolve(currentDir, '../../../packages/widget/dist/widget.js'));
    candidates.push(path.resolve(currentDir, '../../../../packages/widget/dist/widget.js'));
  } catch {
    // ignore
  }

  return candidates;
}

export function getWidgetScript(): string {
  if (cachedWidgetJs && process.env.NODE_ENV === 'production') {
    return cachedWidgetJs;
  }

  const candidatePaths = resolveCandidates();

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        if (content && content.length > 500) {
          cachedWidgetJs = content;
          return cachedWidgetJs;
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  if (cachedWidgetJs) {
    return cachedWidgetJs;
  }

  throw new Error('[Gateway] widget.js bundle not found in candidate paths: ' + candidatePaths.join(', '));
}

