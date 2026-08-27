import { describe, it, expect } from 'vitest';
import { appVersionLabel } from './app-version';

describe('appVersionLabel', () => {
  it('uses the git hash when present', () => {
    expect(appVersionLabel('8ebe868')).toBe('8ebe868');
  });

  it('falls back to dev when missing', () => {
    expect(appVersionLabel(undefined)).toBe('dev');
    expect(appVersionLabel('')).toBe('dev');
    expect(appVersionLabel('   ')).toBe('dev');
  });
});
