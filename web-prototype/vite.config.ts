import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/ws': {
        target: 'http://127.0.0.1:8791',
        ws: true,
      },
    },
  },
});
