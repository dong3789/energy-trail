import { describe, it, expect } from 'vitest';
import { applyVisualViewportVars, isFullscreen, requestGameFullscreen } from './fullscreen';

describe('fullscreen helpers', () => {
  it('jsdom 기본은 전체화면이 아니다', () => {
    expect(isFullscreen()).toBe(false);
  });

  it('API가 없으면 request는 false를 반환한다', async () => {
    const ok = await requestGameFullscreen();
    expect(ok).toBe(false);
  });

  it('visual viewport 변수를 설정한다', () => {
    applyVisualViewportVars();
    expect(document.documentElement.style.getPropertyValue('--vv-height').length).toBeGreaterThan(
      0,
    );
  });
});
