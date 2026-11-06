import { describe, expect, it } from 'vitest';
import { level, word } from './affection';
import { fresh } from './stats';

const NOW = Date.UTC(2026, 10, 6);

describe('affection', () => {
  it('с нуля — ноль', () => {
    expect(level(fresh(NOW))).toBe(0);
    expect(word(0)).toBe('присматривается');
  });

  it('забота поднимает, но к сотне всё медленнее', () => {
    const a = { ...fresh(NOW), fed: 10, petted: 10 };
    const b = { ...a, fed: 20, petted: 20 };
    const c = { ...a, fed: 1000, petted: 1000 };
    expect(level(a)).toBeGreaterThan(0);
    expect(level(b)).toBeGreaterThan(level(a));
    expect(level(b) - level(a)).toBeLessThan(level(a));
    expect(level(c)).toBeLessThanOrEqual(100);
    expect(word(level(c))).toBe('жить без тебя не может');
  });

  it('побег от голода и месть опускают, ниже нуля не бывает', () => {
    const good = { ...fresh(NOW), fed: 30, petted: 30 };
    expect(level({ ...good, runaways: 1 })).toBeLessThan(level(good));
    expect(level({ ...good, revenges: 5 })).toBeLessThan(level(good));
    expect(level({ ...fresh(NOW), runaways: 3 })).toBe(0);
  });

  it('время рядом тоже считается', () => {
    expect(level({ ...fresh(NOW), together: 50 * 3_600_000 })).toBeGreaterThan(0);
  });
});
