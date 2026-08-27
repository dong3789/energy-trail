/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 2026-08-25: 멀티플레이 WS 서버 오버라이드 — Vercel 정적 호스팅 시 Fly.io 등 별도 호스트 지정 */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
