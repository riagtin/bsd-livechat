import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['cjs'],
  target: 'node20',
  splitting: false,
  sourcemap: false,
  clean: false,
  noExternal: [/(.*)/],
});
