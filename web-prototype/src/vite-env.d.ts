/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 멀티플레이 WS 서버 오버라이드 — Mac mini 외부 호스트 등 별도 WS 서버 지정 시 사용 */
  readonly VITE_WS_URL?: string;
  /** git short hash injected at build time for the intro heading */
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
