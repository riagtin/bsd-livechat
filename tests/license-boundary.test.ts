// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('One-Way Dependency & License Boundary (Rule §4 & ADR D2)', () => {
  const rootDir = process.cwd();

  function scanImports(dirPath: string): string[] {
    const violations: string[] = [];
    if (!fs.existsSync(dirPath)) return violations;

    const files = fs.readdirSync(dirPath, { recursive: true }) as string[];
    for (const file of files) {
      if (typeof file === 'string' && (file.endsWith('.ts') || file.endsWith('.tsx'))) {
        const fullPath = path.join(dirPath, file);
        const content = fs.readFileSync(fullPath, 'utf8');

        // Check for illegal imports from AGPL packages
        if (
          content.includes('@bintangstudio/livechat-widget') ||
          content.includes('bsd-livechat-gateway') ||
          content.includes('../widget/') ||
          content.includes('../apps/gateway/')
        ) {
          violations.push(`${file} imports AGPL package`);
        }
      }
    }
    return violations;
  }

  it('ensures packages/sdk (MPL-2.0) has 0 imports from AGPL packages', () => {
    const violations = scanImports(path.join(rootDir, 'packages', 'sdk', 'src'));
    expect(violations).toEqual([]);
  });

  it('ensures packages/react (MPL-2.0) has 0 imports from AGPL packages', () => {
    const violations = scanImports(path.join(rootDir, 'packages', 'react', 'src'));
    expect(violations).toEqual([]);
  });

  it('ensures packages/react package.json does not depend on widget or gateway', () => {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'packages', 'react', 'package.json'), 'utf8')
    );
    const allDeps = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
      ...pkgJson.peerDependencies,
    };

    expect(allDeps['@bintangstudio/livechat-widget']).toBeUndefined();
    expect(allDeps['bsd-livechat-gateway']).toBeUndefined();
    expect(pkgJson.license).toBe('MPL-2.0');
  });

  it('ensures packages/sdk package.json has license MPL-2.0', () => {
    const pkgJson = JSON.parse(
      fs.readFileSync(path.join(rootDir, 'packages', 'sdk', 'package.json'), 'utf8')
    );
    expect(pkgJson.license).toBe('MPL-2.0');
  });
});

