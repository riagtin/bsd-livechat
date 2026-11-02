import { defineConfig } from 'tsup';

export default defineConfig([
  // Target 1: NPM Package (ESM + CJS)
  {
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2020',
  },
  // Target 2: CDN Embeddable Script (IIFE - window.BsdLiveChat)
  {
    entry: {
      'widget': 'src/embed.ts',
    },
    format: ['iife'],
    globalName: 'BsdLiveChatScript',
    minify: true,
    sourcemap: true,
    target: 'es2020',
    outExtension() {
      return { js: '.js' };
    },
  },
]);
