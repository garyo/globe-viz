import { defineConfig } from 'astro/config';
import solidJs from '@astrojs/solid-js';
import { fileURLToPath } from 'node:url';

// https://astro.build/config
export default defineConfig({
  integrations: [solidJs()],
  vite: {
    esbuild: {
      supported: {
        'top-level-await': true
      },
    },
    resolve: {
      // ECharts and its dep zrender each ship a nested CJS tslib that breaks
      // Vite's CJS-to-ESM interop ("Cannot destructure property '__extends'
      // of 'import_tslib.default'"). Force all tslib imports to the top-level
      // ESM build so the named helpers are reachable.
      alias: {
        tslib: fileURLToPath(new URL('./node_modules/tslib/tslib.es6.mjs', import.meta.url)),
      },
    },
  },
});
