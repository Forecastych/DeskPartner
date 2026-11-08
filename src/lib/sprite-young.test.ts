import { describe, expect, it } from 'vitest';
import { ANIMS, bowlLeft, BOWL_AT, dress, FATS, flip, hitMask, onBowl, PALETTE, SCRUFF_AT, SIZE } from './sprite';
import { YOUNG_ANIMS, YOUNG_POSES, type Young } from './sprite-young';

const STAGES: Young[] = [0, 1];
const width = (bits: number) => bits.toString(2).replaceAll('0', '').length;
const area = (f: string[]) => hitMask(f).reduce((n, row) => n + width(row), 0);
const all = STAGES.flatMap((st) =>
  FATS.flatMap((fat) =>
    YOUNG_POSES.flatMap((name) => YOUNG_ANIMS[st][fat][name].frames.map((f, i) => [`стадия ${st} ${name}[${i}] жир ${fat}`, f] as const)),
  ),
);

describe('кадры малыша и подростка', () => {
  it.each(all)('%s — квадрат SIZE×SIZE только из цветов палитры', (_, f) => {
    expect(f).toHaveLength(SIZE);
    for (const row of f) {
      expect(row).toHaveLength(SIZE);
      for (const ch of row) expect(ch === '.' || ch in PALETTE).toBe(true);
    }
  });

  it('в каждой позе столько же кадров и та же скорость, что у взрослой, и кадры не одинаковые', () => {
    for (const st of STAGES)
      for (const fat of FATS)
        for (const name of YOUNG_POSES) {
          const a = YOUNG_ANIMS[st][fat][name];
          expect(a.frames.length).toBe(ANIMS[fat][name].frames.length);
          expect(a.ms).toBe(ANIMS[fat][name].ms);
          expect(new Set(a.frames.map((f) => f.join('\n'))).size).toBeGreaterThan(1);
        }
  });

  it('покрыты основные позы, а набор поз тот же, что у взрослой', () => {
    for (const name of ['stand', 'walk', 'run', 'sit', 'sleep', 'eat', 'loaf', 'bed', 'hungry', 'carried'] as const)
      expect(YOUNG_POSES).toContain(name);
    for (const st of STAGES) expect(Object.keys(YOUNG_ANIMS[st][0]).sort()).toEqual(Object.keys(ANIMS[0]).sort());
  });

  it('малыш меньше подростка, подросток меньше взрослой — в каждой своей позе', () => {
    for (const fat of FATS)
      for (const name of YOUNG_POSES.filter((n) => n !== 'zzz'))
        for (let i = 0; i < ANIMS[fat][name].frames.length; i++) {
          const [kit, teen, adult] = [YOUNG_ANIMS[0][fat], YOUNG_ANIMS[1][fat], ANIMS[fat]].map((a) => area(a[name].frames[i]));
          expect(kit, `${name}[${i}] жир ${fat}`).toBeLessThan(teen);
          expect(teen, `${name}[${i}] жир ${fat}`).toBeLessThan(adult);
        }
  });

  it('стоит на той же земле — нижний ряд закрашен', () => {
    for (const st of STAGES)
      for (const fat of FATS)
        for (const name of ['stand', 'walk', 'sit', 'loaf', 'sideLoaf', 'faceplant', 'groom', 'hungry', 'eat', 'groggy', 'smug', 'strut', 'cake'] as const)
          for (const f of YOUNG_ANIMS[st][fat][name].frames) expect(hitMask(f)[SIZE - 1], `${st} ${name}`).not.toBe(0);
  });

  it('во сне лежит на рамке (ряд 27), ниже свисает только хвост', () => {
    for (const st of STAGES)
      for (const f of FATS.flatMap((fat) => YOUNG_ANIMS[st][fat].sleep.frames)) {
        const mask = hitMask(f);
        expect(width(mask[27])).toBeGreaterThan(15);
        for (let y = 28; y < SIZE; y++) expect(width(mask[y])).toBeLessThanOrEqual(4);
      }
  });

  it('в лежаке над бортиком, бортик пропускает клик', () => {
    for (const st of STAGES)
      for (const f of FATS.flatMap((fat) => YOUNG_ANIMS[st][fat].bed.frames)) {
        const mask = hitMask(f);
        for (let y = SIZE - 5; y < SIZE; y++) expect(mask[y]).toBe(0);
        expect(width(mask[SIZE - 6])).toBeGreaterThan(15);
      }
  });

  it('за шкирку висит загривком в SCRUFF_AT, кадр симметричен по контуру', () => {
    const [x, y] = [SCRUFF_AT[0], Math.floor(SCRUFF_AT[1])];
    for (const st of STAGES)
      for (const f of FATS.flatMap((fat) => YOUNG_ANIMS[st][fat].carried.frames)) {
        expect(f[y][x]).not.toBe('.');
        expect(f[y][x - 1]).not.toBe('.');
        expect(hitMask(flip(f))).toEqual(hitMask(f));
      }
  });

  it('просит и ест над той же миской, что взрослая: BOWL_AT в прямом и отражённом кадре', () => {
    for (const st of STAGES)
      for (const fat of FATS) {
        const { hungry, eat } = YOUNG_ANIMS[st][fat];
        for (const f of [...hungry.frames, ...eat.frames]) {
          expect(bowlLeft(f)).toBe(BOWL_AT);
          expect(bowlLeft(flip(f))).toBe(BOWL_AT);
          const y = f.findIndex((r) => r.includes('b'));
          expect(onBowl(f, f[y].indexOf('b'), y)).toBe(true);
        }
        expect(hungry.frames.some((f) => f.join('').includes('c'))).toBe(false);
        for (const f of eat.frames) expect(f.join('')).toContain('c');
      }
  });

  it('с каждым уровнем жирка крупнее, а земля та же', () => {
    for (const st of STAGES)
      for (const name of YOUNG_POSES)
        for (let i = 0; i < ANIMS[0][name].frames.length; i++) {
          const [thin, plump, fat] = FATS.map((lvl) => area(YOUNG_ANIMS[st][lvl][name].frames[i]));
          expect(plump, `${st} ${name}[${i}]`).toBeGreaterThan(thin);
          expect(fat, `${st} ${name}[${i}]`).toBeGreaterThan(plump);
        }
  });

  it('хвост сидя и лёжа не дёргается: кадры с одинаковыми глазами совпадают целиком', () => {
    for (const st of STAGES) {
      const { sit, loaf, sideLoaf } = YOUNG_ANIMS[st][0];
      for (const a of [sit, loaf, sideLoaf]) expect(new Set(a.frames.slice(0, 4).map((f) => f.join())).size).toBe(1);
    }
  });

  it('шапка и тыква надеваются и малышу, и подростку', () => {
    for (const st of STAGES) {
      const f = YOUNG_ANIMS[st][0].sit.frames[0];
      expect(dress(f, 'hat').join('')).toContain('H');
      expect(dress(f, 'pumpkin').join('')).toContain('O');
    }
  });
});
