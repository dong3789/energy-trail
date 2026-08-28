/** Build-time deploy label shown on the intro heading. Empty/missing → "dev". */
export function appVersionLabel(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  return v.length > 0 ? v : 'dev';
}
