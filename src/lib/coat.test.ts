import { describe, expect, it } from 'vitest';
import { paint, palette } from './coat';
import { BREEDS } from './settings';
import { ANIMS, PALETTE, SIZE } from './sprite';

/** Ключи вещей: миска, лежак, лоток, мышь, клубок, лужа, наряды, торт, украшения. */
const ITEMS = 'B b c C R r q m n y Y a A W e T t i v V j H I o O g h z s u'.split(' ');
/** Ключи кошки, которые окрас вправе менять. */
const CAT = new Set(['k', 'f', 'd', 'l', 'p', 'E', 'x', 'X']);

describe('окрасы', () => {
  it('серая полосатая — та же палитра, что всегда', () => {
    expect(palette('tabby')).toBe(PALETTE);
  });

  it('окрас меняет только ключи кошки, вещи остаются своего цвета', () => {
    for (const b of BREEDS) {
      const p = palette(b);
      for (const key of ITEMS) {
        if (key in PALETTE) expect(p[key], `${b}: ${key}`).toBe(PALETTE[key]);
      }
      for (const key of Object.keys(p)) if (p[key] !== PALETTE[key]) expect(CAT.has(key), `${b}: ${key}`).toBe(true);
    }
  });

  it('у чёрной и смокинга глаза видны на шерсти, контур темнее шерсти', () => {
    for (const b of ['black', 'tuxedo'] as const) {
      const p = palette(b);
      expect(p.E).not.toBe(p.f);
      expect(p.k).not.toBe(p.f);
      const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
      expect(lum(p.k)).toBeLessThan(lum(p.f));
      expect(lum(p.E)).toBeGreaterThan(lum(p.f) * 2);
    }
  });

  it('однотонным окрасам кадр не трогаем', () => {
    const f = ANIMS[0].sit.frames[0];
    for (const b of BREEDS) if (b !== 'calico') expect(paint(f, b)).toBe(f);
  });

  it('трёхцветная: пятна только по шерсти, лапы и живот белые, все ключи есть в палитре', () => {
    const p = palette('calico');
    let patched = 0;
    for (const fat of [0, 1, 2] as const) {
      for (const [name, anim] of Object.entries(ANIMS[fat])) {
        for (const f of anim.frames) {
          const out = paint(f, 'calico');
          expect(out.length).toBe(f.length);
          out.forEach((row, y) => {
            expect(row.length).toBe(f[y].length);
            for (let x = 0; x < row.length; x++) {
              if (row[x] === f[y][x]) continue;
              patched++;
              expect('fd'.includes(f[y][x]), `${name} ${x},${y}`).toBe(true);
              expect('xX'.includes(row[x])).toBe(true);
              expect(y).toBeLessThan(25);
            }
            for (const c of row) if (c !== '.') expect(p[c], `${name}: ${c}`).toBeDefined();
          });
        }
      }
    }
    expect(patched).toBeGreaterThan(0);
    expect(SIZE).toBe(32);
  });
});
