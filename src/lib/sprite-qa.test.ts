// Общие проверки рисунка для всех возрастов и жирка: то, что глазами ловится долго, а тестом — сразу.
// Идея и первые версии проверок — из форка DeskRat (github.com/makedev102/DeskRat), см. README.
import { describe, expect, it } from 'vitest';
import { ANIMS, bedFrame, bowlFrame, dress, FATS, headAt, outfitAt, flip, hitMask, litterFrame, LITTER_CLUMPS, LITTER_WEAR, MOUSE_ANIMS, OUTFITS as ART, PALETTE, PUDDLE_FRAMES, SIZE, type Frame, type Outfit } from './sprite';
import { YOUNG_ANIMS } from './sprite-young';
import { WEARS } from './wardrobe';

const FORMS = [
  ['малыш', YOUNG_ANIMS[0]],
  ['подросток', YOUNG_ANIMS[1]],
  ['взрослая', ANIMS],
] as const;

const poses = FORMS.flatMap(([form, byFat]) =>
  FATS.flatMap((fat) =>
    Object.entries(byFat[fat]).flatMap(([name, a]) => a.frames.map((frame, i) => ({ label: `${form} ${name}[${i}] жир ${fat}`, name, frame }))),
  ),
);

const OUTFITS: Outfit[] = ['hat', 'pumpkin', ...WEARS];

/** Прозрачные клетки, до которых не добраться от края кадра: дырка внутри силуэта. */
function holes(f: Frame): string[] {
  const seen = new Set<string>();
  const queue: [number, number][] = [];
  for (let n = 0; n < SIZE; n++) queue.push([n, 0], [n, SIZE - 1], [0, n], [SIZE - 1, n]);
  while (queue.length) {
    const [x, y] = queue.pop()!;
    const key = `${x},${y}`;
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE || seen.has(key) || f[y][x] !== '.') continue;
    seen.add(key);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (dx || dy) queue.push([x + dx, y + dy]);
  }
  return f.flatMap((row, y) => [...row].flatMap((c, x) => (c === '.' && !seen.has(`${x},${y}`) ? [`${x},${y}`] : [])));
}

/**
 * Просветы, которые так и задуманы: между лапами над бортиком лотка и между тарелкой тортика
 * и пузом зимней кошки. Это не тело, а воздух между кошкой и вещью.
 */
const GAPS_OK = /^\S+ (dig\[[01]\]|cake\[[01]\]) /;

const mirror = (bits: number) => parseInt(bits.toString(2).padStart(SIZE, '0').split('').reverse().join(''), 2);

describe('рисунок во всех возрастах', () => {
  it('стыки деталей не оставляют замкнутых прозрачных дыр внутри силуэта', () => {
    const bad = poses.flatMap(({ label, frame }) => (holes(frame).length && !GAPS_OK.test(label) ? [`${label}: ${holes(frame).join(' ')}`] : []));
    expect(bad).toEqual([]);
  });

  it('в кадре только клетки палитры, сетка 32×32', () => {
    for (const { label, frame } of poses) {
      expect(frame, label).toHaveLength(SIZE);
      for (const row of frame) {
        expect(row, label).toHaveLength(SIZE);
        expect([...row].every((c) => c === '.' || c in PALETTE), `${label}: ${row}`).toBe(true);
      }
    }
  });
});

describe('наряды во всех возрастах', () => {
  it('наряд либо целиком в кадре, либо не надет: рамка его не обрезает', () => {
    const bad = poses.flatMap(({ label, frame }) => {
      return OUTFITS.flatMap((outfit) => {
        const at = outfitAt(frame, outfit);
        if (!at) return [];
        const { rows } = ART[outfit];
        const top = at[1];
        const inside = top >= 0 && top + rows.length <= SIZE && at[0] >= 0 && at[0] + rows[0].length <= SIZE;
        return inside || dress(frame, outfit) === frame ? [] : [`${label} / ${outfit}`];
      });
    });
    expect(bad).toEqual([]);
  });

  it('за шкирку шапки не налезают на загривок', () => {
    for (const [form, byFat] of FORMS)
      for (const fat of FATS)
        for (const frame of byFat[fat].carried.frames)
          for (const outfit of ['hat', 'pumpkin', 'beanie', 'crown'] as const) expect(dress(frame, outfit), `${form} / ${outfit}`).toBe(frame);
  });

  it('dress не трогает исходный кадр, а наряд зеркалится вместе с маской', () => {
    for (const { label, frame } of poses) {
      const before = [...frame];
      for (const outfit of OUTFITS) {
        const dressed = dress(frame, outfit);
        expect(dressed.every((row) => row.length === SIZE), `${label} / ${outfit}`).toBe(true);
        expect(hitMask(flip(dressed)), `${label} / ${outfit}`).toEqual(hitMask(dressed).map(mirror));
      }
      expect(frame, label).toEqual(before);
    }
  });

  it('стоя ошейник с колокольчиком и платок видны в любом возрасте', () => {
    for (const [form, byFat] of FORMS)
      for (const fat of FATS)
        for (const frame of byFat[fat].stand.frames) {
          expect(dress(frame, 'bell').join(''), `${form} / bell`).toContain('4');
          expect(dress(frame, 'bandana').join(''), `${form} / bandana`).toContain('9');
        }
  });

  it('умываясь, кошка поднимает лапу перед ошейником и платком, а не под ними', () => {
    for (const [form, byFat] of FORMS)
      for (const fat of FATS)
        for (const frame of byFat[fat].groom.frames) {
          // лапа — кончик '.kk.', под ним 'kllk' и столбик 'kffk' до туловища. Проверяем её до трёх
          // рядов от ошейника: ниже столбик сливается с туловищем, там кончик платка висит законно
          const y0 = frame.findIndex((row, y) => y > 0 && row.includes('kllk') && frame[y + 1]?.indexOf('kllk') === row.indexOf('kllk'));
          expect(y0, form).toBeGreaterThan(0);
          const x0 = frame[y0].indexOf('kllk');
          const collar = outfitAt(frame, 'bell');
          expect(collar, form).not.toBeNull();
          let y1 = y0 + 2;
          while (y1 < Math.min(SIZE, collar![1] + 3) && frame[y1].slice(x0, x0 + 4) === 'kffk') y1++;
          for (const outfit of ['bell', 'bandana'] as const) {
            const dressed = dress(frame, outfit);
            for (let y = y0; y < y1; y++) expect(dressed[y].slice(x0, x0 + 4), `${form} / ${outfit} ряд ${y}`).toBe(frame[y].slice(x0, x0 + 4));
          }
        }
  });

  it('мордой в пол шапки сидят на голове, а не стоят на спине', () => {
    for (const [form, byFat] of FORMS)
      for (const fat of FATS)
        for (const frame of byFat[fat].faceplant.frames) {
          const head = headAt(frame);
          if (!head) continue;
          for (const outfit of ['hat', 'pumpkin', 'beanie', 'crown'] as const) {
            const dressed = dress(frame, outfit);
            const rows = dressed.flatMap((row, y) => (row === frame[y] ? [] : [y]));
            expect(rows.length, `${form} / ${outfit}`).toBeGreaterThan(0);
            // нижним рядом наряд ложится на голову, выше макушки — не больше четырёх рядов
            expect(Math.max(...rows), `${form} / ${outfit}`).toBeGreaterThan(head.y);
            expect(Math.min(...rows), `${form} / ${outfit}`).toBeGreaterThanOrEqual(head.y - 4);
          }
        }
  });
});

describe('вещи', () => {
  it('миска, лежак, лоток, мышь, клубок и лужа — сетка 32×32 и клетки палитры', () => {
    const things = [
      ...Object.values(MOUSE_ANIMS).flatMap((a) => a.frames),
      bedFrame(),
      ...[0, 1, 2, 4, 6].map(bowlFrame),
      ...Array.from({ length: LITTER_CLUMPS + 1 }, (_, c) => Array.from({ length: LITTER_WEAR + 1 }, (_, w) => litterFrame(c, w))).flat(),
      ...PUDDLE_FRAMES,
    ];
    for (const frame of things) {
      expect(frame).toHaveLength(SIZE);
      for (const row of frame) {
        expect(row).toHaveLength(SIZE);
        expect([...row].every((c) => c === '.' || c in PALETTE), row).toBe(true);
      }
    }
  });
});
