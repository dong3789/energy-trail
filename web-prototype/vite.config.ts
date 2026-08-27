import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

function gitShortHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(gitShortHash()),
  },
  server: {
    proxy: {
      '/ws': {
        target: 'http://127.0.0.1:8791',
        ws: true,
      },
    },
  },
});

