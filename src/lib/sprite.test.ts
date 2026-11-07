import { describe, expect, it } from 'vitest';
import { BOWL_LEAN } from './roam';
import { ANIMS, bedFrame, bedMask, BOWL_AT, BOWL_X, bowlFrame, bowlLeft, fatOn, FATS, flip, hitMask, onBowl, PALETTE, PUDDLE_FRAMES, PUDDLE_H, PUDDLE_W, SCRUFF_AT, SIZE } from './sprite';

const all = FATS.flatMap((fat) =>
  Object.entries(ANIMS[fat]).flatMap(([name, a]) => a.frames.map((f, i) => [`${name}[${i}] жир ${fat}`, f] as const)),
);
const width = (bits: number) => bits.toString(2).replaceAll('0', '').length;
/** Сколько пикселей зверя в кадре. */
const area = (f: string[]) => hitMask(f).reduce((n, row) => n + width(row), 0);

describe('кадры', () => {
  it.each(all)('%s — квадрат SIZE×SIZE только из цветов палитры', (_, f) => {
    expect(f).toHaveLength(SIZE);
    for (const row of f) {
      expect(row).toHaveLength(SIZE);
      for (const ch of row) expect(ch === '.' || ch in PALETTE).toBe(true);
    }
  });

  it('в каждой анимации от 2 до 6 кадров, и они не одинаковые', () => {
    for (const a of FATS.flatMap((fat) => Object.values(ANIMS[fat]))) {
      expect(a.frames.length).toBeGreaterThanOrEqual(2);
      expect(a.frames.length).toBeLessThanOrEqual(6);
      expect(new Set(a.frames.map((f) => f.join('\n'))).size).toBeGreaterThan(1);
    }
  });

  it('всё, кроме сна на рамке, стоит на земле — нижний ряд закрашен', () => {
    for (const fat of FATS)
      for (const name of ['stand', 'walk', 'sit', 'loaf', 'sideLoaf', 'faceplant', 'sidePlant', 'groom', 'hungry', 'eat', 'groggy', 'angry', 'carried', 'squat', 'smug', 'strut'] as const)
        for (const f of ANIMS[fat][name].frames) expect(hitMask(f)[SIZE - 1]).not.toBe(0);
  });

  it('во сне лежит на рамке (ряд 27), ниже свисает только хвост', () => {
    for (const f of FATS.flatMap((fat) => ANIMS[fat].sleep.frames)) {
      const mask = hitMask(f);
      expect(width(mask[27])).toBeGreaterThan(15);
      for (let y = 28; y < SIZE; y++) expect(width(mask[y])).toBeLessThanOrEqual(4);
    }
  });

  it('за краем экрана кошки нет — только «з-з-з», клики проходят насквозь', () => {
    for (const f of FATS.flatMap((fat) => ANIMS[fat].zzz.frames)) expect(area(f)).toBe(0);
  });

  it('flip зеркалит и дважды возвращает исходный кадр', () => {
    const f = ANIMS[0].walk.frames[0];
    expect(flip(f)[20]).toBe([...f[20]].reverse().join(''));
    expect(flip(flip(f))).toEqual(f);
  });
});

describe('лежак', () => {
  it('в лежаке кошка над бортиком, а сам бортик пропускает клик к окну лежака', () => {
    for (const f of FATS.flatMap((fat) => ANIMS[fat].bed.frames)) {
      const mask = hitMask(f);
      for (let y = SIZE - 5; y < SIZE; y++) expect(mask[y]).toBe(0);
      expect(width(mask[SIZE - 6])).toBeGreaterThan(15);
      expect(f[SIZE - 1]).toContain('R');
    }
  });

  it('передний бортик в кадре кошки ложится ровно на бортик окна лежака', () => {
    const bed = bedFrame();
    for (const f of ANIMS[0].bed.frames) expect(f.slice(SIZE - 5)).toEqual(bed.slice(SIZE - 5));
  });

  it('окно лежака кликабельно по всему лежаку, и он симметричен — flip ему не страшен', () => {
    const bed = bedFrame();
    expect(area(bed)).toBe(0);
    for (let y = 0; y < SIZE; y++) expect(bedMask(bed)[y] !== 0).toBe(/[Rrq]/.test(bed[y]));
    expect(flip(bed)).toEqual(bed);
  });
});

describe('за шкирку', () => {
  it('висит загривком в SCRUFF_AT, а кадр симметричен по контуру', () => {
    const [x, y] = [SCRUFF_AT[0], Math.floor(SCRUFF_AT[1])];
    for (const f of FATS.flatMap((fat) => ANIMS[fat].carried.frames)) {
      expect(f[y][x]).not.toBe('.');
      expect(f[y][x - 1]).not.toBe('.');
      expect(hitMask(flip(f))).toEqual(hitMask(f));
    }
  });
});

describe('hitMask', () => {
  it('ставит бит x там, где нарисован пиксель', () => {
    const frame = Array(SIZE).fill('.'.repeat(SIZE));
    frame[3] = 'k' + '.'.repeat(SIZE - 2) + 'k';
    const mask = hitMask(frame);
    expect(mask[3]).toBe(0x8000_0001);
    expect(mask[0]).toBe(0);
  });

  it('сердечко и «з-з-з» пропускают клик насквозь', () => {
    const frame = Array(SIZE).fill('.'.repeat(SIZE));
    frame[0] = 'hz' + '.'.repeat(SIZE - 3) + 'f';
    expect(hitMask(frame)[0]).toBe(0x8000_0000);
    // в кадре поглаживания сердечко есть, но в маску не попадает
    const petted = ANIMS[0].petted.frames[0];
    const heartRows = petted.map((r, y) => (r.includes('h') ? y : -1)).filter((y) => y >= 0);
    expect(heartRows.length).toBeGreaterThan(0);
    for (const y of heartRows) expect(hitMask(petted)[y]).toBe(0);
  });
});

describe('миска', () => {
  const at = (f: string[], keys: string) => {
    const y = f.findIndex((r) => [...r].some((c) => keys.includes(c)));
    return [[...f[y]].findIndex((c) => keys.includes(c)), y] as const;
  };

  it('клик по миске попадает в миску, по кошке и мимо — нет', () => {
    for (const f of FATS.flatMap((fat) => [...ANIMS[fat].hungry.frames, ...ANIMS[fat].eat.frames])) {
      expect(onBowl(f, ...at(f, 'b'))).toBe(true);
      expect(onBowl(f, ...at(f, 'p'))).toBe(false);
      expect(onBowl(f, -1, 0)).toBe(false);
      expect(onBowl(f, 0, SIZE)).toBe(false);
    }
  });

  it('миска кликабельна — она в маске, а не украшение', () => {
    const f = ANIMS[0].hungry.frames[0];
    const [x, y] = at(f, 'b');
    expect(hitMask(f)[y] & (1 << x)).not.toBe(0);
  });

  it('голодная просит у пустой миски, а ест из полной', () => {
    expect(ANIMS[0].hungry.frames.some((f) => f.join('').includes('c'))).toBe(false);
    for (const f of ANIMS[0].eat.frames) expect(f.join('')).toContain('c');
  });
});

describe('сезонный жирок', () => {
  it('летом 0, в ноябре и марте 1, с декабря по февраль 2', () => {
    const byMonth = Array.from({ length: 12 }, (_, m) => fatOn(new Date(2026, m, 15)));
    expect(byMonth).toEqual([2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
  });

  it('с каждым уровнем зверь крупнее в каждой позе', () => {
    // за краем экрана толстеть некому
    for (const name of (Object.keys(ANIMS[0]) as (keyof (typeof ANIMS)[0])[]).filter((n) => n !== 'zzz'))
      for (let i = 0; i < ANIMS[0][name].frames.length; i++) {
        const [thin, plump, fat] = FATS.map((lvl) => area(ANIMS[lvl][name].frames[i]));
        expect(plump).toBeGreaterThan(thin);
        expect(fat).toBeGreaterThan(plump);
      }
  });
});

describe('окно миски', () => {
  it('пустая миска совпадает с миской в позе hungry, отражённой влево и сдвинутой, как её сдвигает App', () => {
    const empty = bowlFrame(0);
    const dx = BOWL_X - BOWL_AT;
    for (const fat of FATS)
      for (const f of ANIMS[fat].hungry.frames) {
        const g = flip(f);
        for (let y = 0; y < SIZE; y++)
          for (let x = 0; x < SIZE; x++) if (onBowl(empty, x, y)) expect(g[y][x - dx]).toBe(empty[y][x]);
      }
  });

  it('горка растёт с порциями и вся кликается как миска', () => {
    const sizes = [0, 1, 2, 3, 4, 6].map((n) => hitMask(bowlFrame(n)).reduce((a, r) => a + r.toString(2).replaceAll('0', '').length, 0));
    expect(sizes[1]).toBeGreaterThan(sizes[0]);
    expect(sizes[2]).toBe(sizes[3]);
    expect(sizes[4]).toBeGreaterThan(sizes[3]);
    expect(sizes[5]).toBe(sizes[4]);
    const f = bowlFrame(6);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (f[y][x] !== '.') expect(onBowl(f, x, y)).toBe(true);
  });

  it('просит и ест над одной и той же миской: она на BOWL_AT и в прямом кадре, и в отражённом', () => {
    for (const fat of FATS)
      for (const f of [...ANIMS[fat].hungry.frames, ...ANIMS[fat].eat.frames]) {
        expect(bowlLeft(f)).toBe(BOWL_AT);
        expect(bowlLeft(flip(f))).toBe(BOWL_AT);
      }
  });

  it('roam ставит кошку у миски ровно на сдвиг миски в кадре', () => {
    expect(BOWL_LEAN * SIZE).toBe(BOWL_X - BOWL_AT);
  });

  it('без миски в кадре — null', () => {
    expect(bowlLeft(ANIMS[0].sit.frames[0])).toBeNull();
  });
});

describe('лужа мести', () => {
  it.each(PUDDLE_FRAMES.map((f, i) => [i, f] as const))('кадр %i — SIZE×SIZE из палитры, по центру внизу, не шире PUDDLE_W×PUDDLE_H', (_, f) => {
    expect(f).toHaveLength(SIZE);
    for (const row of f) {
      expect(row).toHaveLength(SIZE);
      for (const ch of row) expect(ch === '.' || ch in PALETTE).toBe(true);
    }
    const rows = f.map((row, y) => [y, row] as const).filter(([, row]) => row.trim().replaceAll('.', '') !== '');
    expect(rows[rows.length - 1][0]).toBe(SIZE - 1);
    expect(rows.length).toBeLessThanOrEqual(PUDDLE_H);
    const xs = f.flatMap((row) => [...row].flatMap((ch, x) => (ch === '.' ? [] : [x])));
    expect(Math.max(...xs) - Math.min(...xs) + 1).toBeLessThanOrEqual(PUDDLE_W);
    // по центру: поля слева и справа разнятся не больше чем на клетку
    expect(Math.abs(Math.min(...xs) - (SIZE - 1 - Math.max(...xs)))).toBeLessThanOrEqual(1);
  });

  it('растёт, потом бледнеет: кадры разные, полная — самая большая', () => {
    const sizes = PUDDLE_FRAMES.map((f) => f.join('').replaceAll('.', '').length);
    expect(new Set(PUDDLE_FRAMES.map((f) => f.join('|'))).size).toBe(PUDDLE_FRAMES.length);
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);
    expect(sizes[4]).toBeLessThan(sizes[3]);
    expect(Math.max(...sizes)).toBe(sizes[2]);
  });

  it('полупрозрачная: сквозь неё видно окно', () => {
    for (const ch of new Set(PUDDLE_FRAMES.flat().join('').replaceAll('.', ''))) expect(PALETTE[ch as keyof typeof PALETTE]).toMatch(/^rgba\(/);
  });
});
