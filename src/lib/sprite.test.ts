import { describe, expect, it } from 'vitest';
import { ANIMS, fatOn, FATS, flip, hitMask, PALETTE, SIZE } from './sprite';

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

  it('стоит, идёт и сидит на земле — нижний ряд закрашен', () => {
    for (const fat of FATS)
      for (const name of ['stand', 'walk', 'sit'] as const)
        for (const f of ANIMS[fat][name].frames) expect(hitMask(f)[SIZE - 1]).not.toBe(0);
  });

  it('во сне лежит на рамке (ряд 27), ниже свисает только хвост', () => {
    for (const f of FATS.flatMap((fat) => ANIMS[fat].sleep.frames)) {
      const mask = hitMask(f);
      expect(width(mask[27])).toBeGreaterThan(15);
      for (let y = 28; y < SIZE; y++) expect(width(mask[y])).toBeLessThanOrEqual(4);
    }
  });

  it('flip зеркалит и дважды возвращает исходный кадр', () => {
    const f = ANIMS[0].walk.frames[0];
    expect(flip(f)[20]).toBe([...f[20]].reverse().join(''));
    expect(flip(flip(f))).toEqual(f);
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

describe('сезонный жирок', () => {
  it('летом 0, в ноябре и марте 1, с декабря по февраль 2', () => {
    const byMonth = Array.from({ length: 12 }, (_, m) => fatOn(new Date(2026, m, 15)));
    expect(byMonth).toEqual([2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
  });

  it('с каждым уровнем зверь крупнее в каждой позе', () => {
    for (const name of Object.keys(ANIMS[0]) as (keyof (typeof ANIMS)[0])[])
      for (let i = 0; i < ANIMS[0][name].frames.length; i++) {
        const [thin, plump, fat] = FATS.map((lvl) => area(ANIMS[lvl][name].frames[i]));
        expect(plump).toBeGreaterThan(thin);
        expect(fat).toBeGreaterThan(plump);
      }
  });
});
