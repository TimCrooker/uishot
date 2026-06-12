import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const pages = ['index', 'login', 'dashboard', 'items', 'wizard'];

export default defineConfig({
  appType: 'mpa',
  build: {
    rollupOptions: {
      input: pages.reduce<Record<string, string>>(
        (acc, p) => ({ ...acc, [p]: resolve(import.meta.dirname, `${p}.html`) }),
        {},
      ),
    },
  },
});
