import { describe, expect, it } from 'vitest';
import { KNOWN_MS, OFF_TIRED, center, describe as words, kind, off, tired } from './chrono';

const H = 3_600_000;

/** Сидел за компьютером с from до to (не включая) по часу в каждом, всего ~`total` мс. */
function day(from: number, to: number, total = 2 * KNOWN_MS): number[] {
  const hours = Array(24).fill(0);
  const span = (to - from + 24) % 24 || 24;
  for (let i = 0; i < span; i++) hours[(from + i) % 24] = total / span;
  return hours;
}

describe('chrono', () => {
  it('центр считается по кругу: 23 и 1 час — около полуночи', () => {
    const hours = Array(24).fill(0);
    hours[23] = H;
    hours[0] = H;
    const c = center(hours)!;
    expect(Math.min(c.hour, 24 - c.hour)).toBeLessThan(0.01);
    expect(center(Array(24).fill(0))).toBeNull();
  });

  it('пока мало вместе — не решает', () => {
    expect(kind(day(6, 15, KNOWN_MS / 2))).toBeNull();
    expect(words(null).value).toBe('пока неясно');
  });

  it('жаворонок, голубь и сова по часам человека', () => {
    expect(kind(day(6, 15))).toBe('lark');
    expect(kind(day(9, 18))).toBe('dove');
    expect(kind(day(14, 2))).toBe('owl');
    expect(kind(day(20, 4))).toBe('owl');
    // круглые сутки — ни то ни сё
    expect(kind(day(0, 24))).toBe('dove');
  });

  it('в «не свои» часы устаёт быстрее', () => {
    expect(off('lark', 22)).toBe(true);
    expect(off('lark', 9)).toBe(false);
    expect(off('owl', 8)).toBe(true);
    expect(off('owl', 23)).toBe(false);
    expect(off('dove', 3)).toBe(true);
    expect(off(null, 3)).toBe(false);
    expect(tired(day(20, 4), 8)).toBe(OFF_TIRED);
    expect(tired(day(20, 4), 22)).toBe(1);
  });

  it('битые часы не ломают расчёт', () => {
    const hours = day(6, 15);
    hours[3] = NaN;
    hours[4] = -H;
    expect(kind(hours)).toBe('lark');
  });
});
