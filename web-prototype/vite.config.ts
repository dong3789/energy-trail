import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * 화면에 노출할 버전.
 * - 태그가 달린 커밋(build/deploy 기준) → 태그명 (예: v2026.08.25.20)
 * - 태그 없는 일반 커밋 → short hash
 * - git 불가 환경 → dev
 */
function releaseVersion(): string {
  try {
    const tag = execSync('git describe --tags --exact-match --abbrev=0 HEAD 2>/dev/null', {
      encoding: 'utf8',
    }).trim();
    if (tag) return tag;
  } catch {
    /* exact tag 없음 → hash */
  }
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(releaseVersion()),
  },
  server: {
    proxy: {
      '/ws': {
        target: 'http://127.0.0.1:8791',
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          game: [
            './src/scene/CharacterFactory.ts',
            './src/scene/PlayerController.ts',
            './src/scene/SceneSetup.ts',
            './src/scene/MapBuilder.ts',
            './src/scene/TrailEmitter.ts',
            './src/scene/AbsorbSystem.ts',
            './src/scene/BoostSystem.ts',
            './src/scene/IceSystem.ts',
            './src/scene/ItemField.ts',
            './src/scene/TaggerAI.ts',
            './src/scene/RunnerAIStub.ts',
            './src/scene/DustSystem.ts',
            './src/scene/SoundManager.ts',
            './src/scene/TouchController.ts',
          ],
        },
      },
    },
  },
});

