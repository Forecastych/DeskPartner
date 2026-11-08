import { afterEach, describe, expect, it } from 'vitest';
import { AWARDS, board, check, choose, fresh, herald, load, progress, save, wardrobe, worn, type Prize } from './awards';
import { setLang } from './i18n';
import { dress, PALETTE, SIZE, ANIMS } from './sprite';
import * as tally from './stats';
import { WEAR_ART, WEAR_PALETTE, WEARS } from './wardrobe';

const DAY = 24 * 3600_000;
const T0 = new Date(2026, 10, 1, 12, 0).getTime();
const stats = (o: Partial<tally.Stats> = {}, since = T0): tally.Stats => ({ ...tally.fresh(since), ...o });

afterEach(() => setLang('ru'));

describe('awards: список', () => {
  it('id уникальны, пороги положительные, каждый наряд выдаёт ровно одно достижение', () => {
    expect(new Set(AWARDS.map((a) => a.id)).size).toBe(AWARDS.length);
    expect(AWARDS.length).toBeGreaterThanOrEqual(8);
    expect(AWARDS.length).toBeLessThanOrEqual(12);
    for (const a of AWARDS) expect(a.need).toBeGreaterThan(0);
    const wears = AWARDS.flatMap((a) => (a.wear ? [a.wear] : []));
    expect([...wears].sort()).toEqual([...WEARS].sort());
  });

  it('первое — за день-два, последнее — за месяцы', () => {
    // день обычной работы: погладили десяток раз
    expect(check(fresh(), stats({ petted: 10 }), T0 + DAY).got).toHaveProperty('petted10');
    // корона — только на сотый календарный день
    expect(check(fresh(), stats({}), T0 + 98 * DAY).got).not.toHaveProperty('days100');
    expect(check(fresh(), stats({}), T0 + 99 * DAY).got).toHaveProperty('days100');
  });
});

describe('awards: получение', () => {
  it('выдаёт достигнутое один раз и с датой, ничего нового — тот же объект', () => {
    const s = stats({ petted: 12, keys: 10_000, mouseMm: 999_999 });
    const p = check(fresh(), s, T0 + 5);
    expect(Object.keys(p.got).sort()).toEqual(['keys10k', 'petted10']);
    expect(p.got.petted10).toBe(T0 + 5);
    expect(p.unsaid).toEqual(['petted10', 'keys10k']);
    expect(check(p, s, T0 + 10)).toBe(p);
    // статистику обнулили — полученное не отнимается
    expect(check(p, stats(), T0 + 10).got).toEqual(p.got);
  });

  it('облачко одно: на одно достижение — его реплика, на несколько — общая', () => {
    const one = check(fresh(), stats({ petted: 10 }), T0);
    const [after, text] = herald(one)!;
    expect(text).toContain('бантик');
    expect(after.unsaid).toEqual([]);
    expect(after.got).toEqual(one.got);
    expect(herald(after)).toBeNull();

    const many = check(fresh(), stats({ petted: 10, fed: 50, caught: 10 }), T0);
    expect(herald(many)![1]).toBe('Новых достижений сразу 3! Загляни в статистику');
  });

  it('несказанное ждёт: не сказали — остаётся в unsaid и переживает перезапуск', () => {
    let p = check(fresh(), stats({ petted: 10 }), T0);
    p = load(save(p));
    expect(p.unsaid).toEqual(['petted10']);
    p = check(p, stats({ petted: 10, fed: 50 }), T0 + 1);
    expect(p.unsaid).toEqual(['petted10', 'fed50']);
  });
});

describe('awards: неделя без побудок', () => {
  const naps = (n: number, woken = 0) => stats({ naps: n, woken });

  it('засекает отсчёт с первой проверки и засчитывает неделю со снами', () => {
    let p = check(fresh(), naps(3), T0);
    expect(p.calm).toEqual({ at: T0, naps: 3, woken: 0 });
    p = check(p, naps(10), T0 + 6 * DAY);
    expect(p.got).not.toHaveProperty('calm7');
    p = check(p, naps(10), T0 + 7 * DAY);
    expect(p.got).toHaveProperty('calm7');
  });

  it('разбудили — отсчёт заново', () => {
    let p = check(fresh(), naps(0), T0);
    p = check(p, naps(6, 1), T0 + 5 * DAY);
    expect(p.calm).toEqual({ at: T0 + 5 * DAY, naps: 6, woken: 1 });
    p = check(p, naps(20, 1), T0 + 8 * DAY);
    expect(p.got).not.toHaveProperty('calm7');
    p = check(p, naps(20, 1), T0 + 12 * DAY);
    expect(p.got).toHaveProperty('calm7');
  });

  it('программу неделю не включали — без снов не считается', () => {
    let p = check(fresh(), naps(2), T0);
    p = check(p, naps(4), T0 + 30 * DAY);
    expect(p.got).not.toHaveProperty('calm7');
    expect(board(p, naps(4), T0 + 30 * DAY, 12).next.find((n) => n.id === 'calm7')!.progress).toBe('6 / 7 дн');
  });
});

describe('awards: наряды', () => {
  const got = (ids: Record<string, number>, wear: Prize['wear'] = null): Prize => ({ ...fresh(), got: ids, wear });

  it('сама надевает последний полученный наряд, без нарядов — ничего', () => {
    expect(worn(fresh())).toBeNull();
    expect(worn(got({ keys10k: 1 }))).toBeNull();
    expect(worn(got({ petted10: 1, km10: 5, caught50: 3 }))).toBe('bell');
    expect(wardrobe(got({ km10: 5, petted10: 1 }))).toEqual(['bow', 'bell']);
  });

  it('выбор: наряд, без наряда, сама; неполученное не надеть', () => {
    const p = got({ petted10: 1, km10: 5 });
    expect(worn(choose(p, 'bow'))).toBe('bow');
    expect(worn(choose(p, 'none'))).toBeNull();
    expect(choose(p, 'crown').wear).toBeNull();
    expect(choose(p, 'pumpkin').wear).toBeNull();
    expect(choose(p, null)).toBe(p);
  });

  it('праздничный наряд важнее: App берёт holidays.outfit() ?? worn()', () => {
    // это соглашение, а не код awards; здесь — что наряды-награды вообще надеваются dress
    const sit = ANIMS[0].sit.frames[0];
    for (const w of WEARS) expect(dress(sit, w)).not.toEqual(sit);
  });
});

describe('awards: хранение', () => {
  it('битое и чужое не роняет', () => {
    expect(load(null)).toEqual(fresh());
    expect(load('oops')).toEqual(fresh());
    expect(load('[1,2]')).toEqual(fresh());
    const p = load(JSON.stringify({ got: { petted10: 5, nope: 3, km1: 'x' }, unsaid: ['nope', 'petted10', 'km1', 'petted10'], wear: 'tiara', calm: { at: -1 } }));
    expect(p.got).toEqual({ petted10: 5 });
    expect(p.unsaid).toEqual(['petted10']);
    expect(p.wear).toBeNull();
    expect(p.calm.naps).toBe(-1);
  });

  it('туда и обратно', () => {
    const p: Prize = { got: { petted10: 5, km10: 9 }, unsaid: ['km10'], wear: 'none', calm: { at: 7, naps: 2, woken: 1 } };
    expect(load(save(p))).toEqual(p);
  });
});

describe('awards: окно статистики', () => {
  it('прогресс коротко', () => {
    expect(progress('count', 7, 10)).toBe('7 / 10');
    expect(progress('count', 70, 10)).toBe('10 / 10');
    expect(progress('keys', 4_321, 10_000)).toBe('4 321 / 10 тыс');
    expect(progress('keys', 64_200, 100_000)).toBe('64 тыс / 100 тыс');
    expect(progress('mm', 3_470_000, 10_000_000)).toBe('3,4 / 10 км');
    expect(progress('mm', 0, 1_000_000)).toBe('0 / 1 км');
    expect(progress('days', 12, 100)).toBe('12 / 100 дн');
    setLang('en');
    expect(progress('keys', 64_200, 100_000)).toBe('64k / 100k');
    expect(progress('mm', 3_470_000, 10_000_000)).toBe('3.4 / 10 km');
  });

  it('полученные свежие сверху, следующие — ближайшие к цели', () => {
    const p = check(fresh(), stats({ petted: 10 }), T0);
    const later = check(p, stats({ petted: 10, fed: 50 }), T0 + DAY);
    const s = stats({ petted: 10, fed: 50, caught: 9, keys: 2000 });
    const b = board(later, s, T0 + DAY);
    expect(b.got.map((g) => g.id)).toEqual(['fed50', 'petted10']);
    expect(b.got[1]).toMatchObject({ title: 'Ласковая', about: 'Погладили 10 раз', wear: 'bow', at: T0 });
    expect(b.next).toHaveLength(3);
    expect(b.next[0]).toMatchObject({ id: 'caught10', progress: '9 / 10', meter: 0.9 });
    expect(b.left).toBe(AWARDS.length - 2 - 3);
  });

  it('по-английски', () => {
    setLang('en');
    const b = board(fresh(), stats(), T0);
    expect(b.next.every((n) => /^[\x20-\x7e’]+$/.test(n.title + n.about + n.progress))).toBe(true);
  });
});

describe('wardrobe', () => {
  it('ключи палитры нарядов свободны и все цвета на месте', () => {
    for (const k of Object.keys(WEAR_PALETTE)) expect(k).toMatch(/^[1-9]$/);
    for (const w of WEARS) {
      const piece = WEAR_ART[w];
      for (const row of piece.rows) {
        expect(row).toHaveLength(12);
        for (const c of row) if (c !== '.') expect(PALETTE[c], `${w}: ${c}`).toBeDefined();
      }
    }
  });

  it('наряд сидит в любой позе с головой анфас и не вылезает за кадр', () => {
    // кадров сотни: expect на каждую строку не укладывается в тайм-аут при полном прогоне — копим промахи
    const bad: string[] = [];
    for (const [i, fat] of Object.entries(ANIMS))
      for (const [name, a] of Object.entries(fat))
        a.frames.forEach((f, n) => {
          for (const w of WEARS) {
            const d = dress(f, w);
            if (d.length !== SIZE || d.some((r) => r.length !== SIZE)) bad.push(`${i} ${name}#${n} ${w}: размер`);
            // голова анфас есть везде, кроме «з-з-з»; ошейник и платок может закрыть бортик лежака.
            // За шкирку голова у самого верха кадра: что не влезает, не надевается (sprite-qa.test.ts)
            else if (name !== 'zzz' && name !== 'carried' && !WEAR_ART[w].under && d.every((r, y) => r === f[y])) bad.push(`${i} ${name}#${n} ${w}: не надет`);
          }
        });
    expect(bad).toEqual([]);
  });

  it('ошейник и платок не висят в воздухе и не налезают на миску', () => {
    const eat = ANIMS[0].eat.frames[0];
    for (const w of ['bell', 'bandana'] as const) {
      const d = dress(eat, w);
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) if (d[y][x] !== eat[y][x]) expect(eat[y][x], `${w} ${x},${y}`).not.toMatch(/[.BbcC]/);
    }
  });

  it('сердечко остаётся поверх наряда', () => {
    const petted = ANIMS[0].petted.frames.find((f) => f.some((r) => r.includes('h')))!;
    for (const w of WEARS) {
      const d = dress(petted, w);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (petted[y][x] === 'h') expect(d[y][x]).toBe('h');
    }
  });
});
