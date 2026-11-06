import { describe, expect, it } from 'vitest';
import { cakesReached, celebrate, outfit, years } from './holidays';
import { ANIMS, dress } from './sprite';
import { fresh } from './stats';

const H = 3_600_000;
const SINCE = new Date(2026, 10, 6, 12).getTime();

describe('holidays', () => {
  it('тортик за каждую веху один раз', () => {
    let s = { ...fresh(SINCE), together: 25 * H };
    const first = celebrate(s, SINCE + H);
    expect(first?.[1]).toContain('Сутки');
    s = first![0];
    expect(s.cakes).toBe(1);
    expect(celebrate(s, SINCE + H)).toBeNull();
    s = { ...s, together: 170 * H };
    expect(celebrate(s, SINCE + H)?.[1]).toContain('Неделя');
  });

  it('пропущенные вехи не празднуются по очереди', () => {
    const s = { ...fresh(SINCE), together: 800 * H };
    expect(cakesReached(s.together)).toBe(4);
    const [n, text] = celebrate(s, SINCE + H)!;
    expect(text).toContain('Месяц');
    expect(celebrate(n, SINCE + H)).toBeNull();
  });

  it('годовщина по календарю и важнее тортика', () => {
    expect(years(SINCE, new Date(2027, 10, 5).getTime())).toBe(0);
    expect(years(SINCE, new Date(2027, 10, 6).getTime())).toBe(1);
    const s = { ...fresh(SINCE), together: 30 * H };
    const [n, text] = celebrate(s, new Date(2028, 10, 6).getTime())!;
    expect(text).toBe('2 года, как мы знакомы!');
    expect(n.years).toBe(2);
    expect(n.cakes).toBe(0);
  });

  it('наряды по датам', () => {
    expect(outfit(new Date(2026, 11, 31))).toBe('hat');
    expect(outfit(new Date(2027, 0, 7))).toBe('hat');
    expect(outfit(new Date(2027, 0, 8))).toBeNull();
    expect(outfit(new Date(2026, 9, 31))).toBe('pumpkin');
    expect(outfit(new Date(2026, 10, 6))).toBeNull();
  });

  it('наряд надевается на голову анфас и не трогает позы без неё', () => {
    const sit = ANIMS[0].stand.frames[0];
    const hat = dress(sit, 'hat');
    expect(hat).not.toEqual(sit);
    expect(hat.join('')).toContain('H');
    expect(dress(sit, null)).toBe(sit);
    const zzz = ANIMS[0].zzz.frames[0];
    expect(dress(zzz, 'pumpkin')).toBe(zzz);
  });
});
