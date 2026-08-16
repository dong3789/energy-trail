import { describe, it, expect } from 'vitest';
import { escapeHtml } from './html-escape';

describe('escapeHtml (XSS 방지)', () => {
  it('일반 텍스트는 그대로', () => {
    expect(escapeHtml('Mungz')).toBe('Mungz');
    expect(escapeHtml('한글닉')).toBe('한글닉');
    expect(escapeHtml('User123')).toBe('User123');
  });

  it('< > " \' & escape', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('XSS 페이로드 무력화 (입력값 그대로 innerHTML에 넣어도 안전)', () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '"><script>alert(1)</script>',
      "' onmouseover=alert(1) '",
      '<a href="javascript:alert(1)">x</a>',
    ];
    for (const payload of payloads) {
      const escaped = escapeHtml(payload);
      // & or &lt; or &gt; or &quot; or &#39; 중 최소 1개 포함되어야 함
      expect(escaped).toMatch(/&(amp|lt|gt|quot|#39);/);
      // 원본 payload의 위험한 태그/속성 구분자가 그대로 남아있으면 안 됨
      // - <img, <script>, <svg 등 태그의 '<'
      // - 'javascript:' 자체는 escape 후 텍스트로 남지만, <a>의 '<'가 escape되어
      //   실제 href 속성이 만들어지지 않으므로 안전
      expect(escaped).not.toContain('<img');
      expect(escaped).not.toContain('<script>');
      expect(escaped).not.toContain('<svg');
      expect(escaped).not.toContain('<a '); // 속성 시작 '<' escape
    }
  });

  it('빈 문자열', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('연속 & 처리 (&amp; 중복 escape 방지 안 함 — 입력 단계 1회만)', () => {
    // 1회 escape만 보장. 더블 escape (&amp; → &amp;amp;)는 의도.
    // (사용자 입력이 escape된 값을 다시 escape하면 발생 가능 — nickname은 입력 1회만)
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  it('이모지 보존', () => {
    // 이모지/한글/유니코드는 escape 안 됨
    expect(escapeHtml('🎮 한글')).toBe('🎮 한글');
    expect(escapeHtml('⭐️💎')).toBe('⭐️💎');
  });

  it('공백/개행 보존', () => {
    expect(escapeHtml('한글 닉네임')).toBe('한글 닉네임');
    expect(escapeHtml('A B C')).toBe('A B C');
  });

  it('숫자만', () => {
    expect(escapeHtml('12345')).toBe('12345');
    expect(escapeHtml('0')).toBe('0');
  });

  it('속성 값 (작은따옴표, 큰따옴표 모두 escape)', () => {
    // XSS 방어 핵심 — 속성 값에 사용할 때 안전
    expect(escapeHtml(`" onerror="alert(1)`)).toBe('&quot; onerror=&quot;alert(1)');
    expect(escapeHtml(`' onmouseover='alert(1)`)).toBe('&#39; onmouseover=&#39;alert(1)');
  });
});
