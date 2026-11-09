import { describe, expect, it } from 'vitest';
import { paint, palette } from './coat';
import { BREEDS } from './settings';
import { ANIMS, type Frame, headAt, PALETTE, SIZE } from './sprite';
import { YOUNG_ANIMS } from './sprite-young';
import { WEAR_PALETTE } from './wardrobe';

/** Ключи вещей: миска, лежак, лоток, мышь, клубок, лужа, наряды, торт, украшения. */
const ITEMS = 'B b c C R r q m n y Y a A W e T t i v V j H I o O g h z s u'.split(' ');
/** Ключи кошки, которые окрас вправе менять, и наряды за достижения (цифры) — их он подбирает под шерсть. */
const CAT = new Set(['k', 'f', 'd', 'l', 'p', 'E', 'x', 'X', ...Object.keys(WEAR_PALETTE)]);

/** Расстояние между цветами в RGB. */
const dist = (a: string, b: string): number =>
  Math.hypot(...[1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));

/** Кадр, сдвинутый влево на n клеток, как калачик на таймере (hourglass.ts). */
const shiftLeft = (frame: Frame, n: number): Frame => frame.map((row) => row.slice(n) + '.'.repeat(n));

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

  it('бантик, ошейник, шапочка и платок отделяются от шерсти и грудки в любом окрасе', () => {
    for (const b of BREEDS) {
      const p = palette(b);
      for (const key of ['1', '3', '6', '8'])
        for (const fur of ['f', 'l'] as const) expect(dist(p[key], p[fur]), `${b}: ${key} на ${fur}`).toBeGreaterThanOrEqual(100);
    }
  });

  it('трёхцветная: на таймере калачик сдвигается вместе с пятнами', () => {
    for (const byFat of [ANIMS, YOUNG_ANIMS[0], YOUNG_ANIMS[1]])
      for (const fat of [0, 1, 2] as const)
        for (const f of byFat[fat].sleep.frames) expect(paint(shiftLeft(f, 4), 'calico')).toEqual(shiftLeft(paint(f, 'calico'), 4));
  });

  it('трёхцветная: мордочка одна и та же во всех позах', () => {
    for (const byFat of [ANIMS, YOUNG_ANIMS[0], YOUNG_ANIMS[1]]) {
      // клетка головы (от левого края и ряда макушки) → во что она перекрашена
      const seen = new Map<string, string>();
      for (const fat of [0, 1, 2] as const)
        for (const [name, anim] of Object.entries(byFat[fat]))
          for (const f of anim.frames) {
            const head = headAt(f);
            if (!head) continue;
            const out = paint(f, 'calico');
            // только клетки головы: у малыша она уже, по краям рядом бывает спина
            for (let dy = 1; dy <= (head.kit ? 3 : 4); dy++)
              for (let dx = head.kit ? 1 : 0; dx < (head.kit ? 11 : 12); dx++) {
                const [x, y] = [head.x + dx, head.y + dy];
                if (y >= SIZE || !'fd'.includes(f[y]?.[x] ?? '.')) continue;
                // у малыша часть поз взрослая (потягушки, лоток): голова там взрослая, и мордочка своя
                const key = `${head.kit ? 'малыш' : 'взрослая'} ${dx},${dy}`;
                const c = out[y][x] === 'x' || out[y][x] === 'X' ? out[y][x] : '.';
                expect(seen.get(key) ?? c, `${name} ${key}`).toBe(c);
                seen.set(key, c);
              }
          }
    }
  });

  it('трёхцветная: пятна только по шерсти, лапы и живот белые, все ключи есть в палитре', () => {
    const p = palette('calico');
    let patched = 0;
    for (const fat of [0, 1, 2] as const) {
      for (const [name, anim] of Object.entries(ANIMS[fat])) {
        for (const f of anim.frames) {
          const head = headAt(f);
          const out = paint(f, 'calico');
          expect(out.length).toBe(f.length);
          out.forEach((row, y) => {
            expect(row.length).toBe(f[y].length);
            for (let x = 0; x < row.length; x++) {
              if (row[x] === f[y][x]) continue;
              patched++;
              expect('fd'.includes(f[y][x]), `${name} ${x},${y}`).toBe(true);
              expect('xX'.includes(row[x])).toBe(true);
              // ниже 25-го ряда — лапы и живот; пятно там бывает только на голове, уткнувшейся в пол
              if (y >= 25) expect(head !== null && y - head.y >= -2 && y - head.y <= 7, `${name} ${x},${y}`).toBe(true);
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
