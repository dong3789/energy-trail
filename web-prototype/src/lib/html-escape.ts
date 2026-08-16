// 2026-08-16: HTML escape 유틸 (테스트 가능하도록 main.ts에서 분리)
// - nickname 등 사용자 입력을 innerHTML에 직접 넣을 때 안전하게
// - 호출 위치: renderLogin의 onNext에서 입력값 저장 시 1회
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
