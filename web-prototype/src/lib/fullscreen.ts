type FsDoc = Document & { webkitFullscreenElement?: Element | null };
type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const doc = document as FsDoc;
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
}

export async function requestGameFullscreen(root?: HTMLElement | null): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  if (isFullscreen()) return true;
  const el = (root ?? document.documentElement) as FsEl;
  try {
    if (typeof el.requestFullscreen === 'function') {
      await el.requestFullscreen();
      return true;
    }
    if (typeof el.webkitRequestFullscreen === 'function') {
      await Promise.resolve(el.webkitRequestFullscreen());
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 주소창이 가리는 만큼 CSS 변수로 밀어 HUD/캔버스가 보이는 영역에 붙게 한다. */
export function applyVisualViewportVars(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const vv = window.visualViewport;
  const top = vv ? Math.max(0, vv.offsetTop) : 0;
  const height = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--vv-top', `${top}px`);
  document.documentElement.style.setProperty('--vv-height', `${height}px`);
}

export function bindVisualViewport(onChange?: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const apply = (): void => {
    applyVisualViewportVars();
    onChange?.();
  };
  apply();
  const vv = window.visualViewport;
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', apply);
  return () => {
    vv?.removeEventListener('resize', apply);
    vv?.removeEventListener('scroll', apply);
    window.removeEventListener('orientationchange', apply);
  };
}
