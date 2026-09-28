import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  // Serve ../example as the static root, so pages are at /cover.jpg etc.
  publicDir: here('../example'),
  resolve: {
    alias: {
      // Point at source, not dist — edits to the core hot-reload without a build.
      'bookstand': here('../packages/bookstand/src/index.ts'),
    },
  },
  server: { port: 5180, open: false },
});
